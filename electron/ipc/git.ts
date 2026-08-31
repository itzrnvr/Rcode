/*
 * PURPOSE: Minimal git widgets backend for header pills + Git tools panel.
 * All commands run in the user's home cwd (the agent cwd). Read-only except
 * explicit checkout/commit/push actions triggered by the user.
 */

import { ipcMain } from "electron";
import { execFile } from "child_process";
import { homedir } from "os";
import { basename, join } from "path";
import { readFileSync, existsSync } from "fs";
// existsSync aliased below for repoCwd

function repoCwd(): string {
  const home = homedir();
  if (existsSync(join(home, ".git"))) return home;
  for (const cand of ["D:/Rcode", "C:/Users/babys/Rcode"]) {
    if (existsSync(join(cand, ".git"))) return cand;
  }
  return home;
}

function git(args: string[], cwd = repoCwd()): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function status(): Promise<{ branch: string; added: number; deleted: number; files: Array<{ path: string; status: string }> }> {
  const cwd = repoCwd();
  let branch = "";
  try { branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim(); } catch { branch = "(no repo)"; }
  const files: Array<{ path: string; status: string }> = [];
  let added = 0, deleted = 0;
  try {
    const por = await git(["status", "--porcelain"], cwd);
    for (const line of por.split("\n")) {
      if (!line.trim()) continue;
      const st = line.slice(0, 2).trim() || "?";
      const path = line.slice(3).trim();
      files.push({ path, status: st });
      if (st === "??" || st === "A") {
        // untracked/added: count lines if small enough
        try {
          const fp = join(cwd, path);
          if (existsSync(fp) && !path.includes("..")) {
            const txt = readFileSync(fp, "utf8");
            added += Math.min(txt.split("\n").length, 20000);
          }
        } catch {}
      }
    }
    const num = await git(["diff", "HEAD", "--numstat"], cwd);
    for (const line of num.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      if (m[1] !== "-") added += parseInt(m[1], 10);
      if (m[2] !== "-") deleted += parseInt(m[2], 10);
    }
  } catch {}
  return { branch, added, deleted, files };
}

export function registerGitHandlers(): void {
  ipcMain.handle("git:status", () => status());
  ipcMain.handle("git:branches", async () => {
    try {
      const out = await git(["branch", "--list", "--format=%(refname:short)"]);
      return out.split("\n").map(s => s.trim()).filter(Boolean);
    } catch { return []; }
  });
  ipcMain.handle("git:checkout", (_e, branch: string) => git(["checkout", branch]).then(() => ({ ok: true })));
  ipcMain.handle("git:commit", async (_e, message: string) => {
    await git(["add", "-A"]);
    const out = await git(["commit", "-m", message || "Rcode: quick commit"]);
    return { ok: true, out: out.slice(0, 300) };
  });
  ipcMain.handle("git:push", async () => {
    const out = await git(["push"]);
    return { ok: true, out: out.slice(0, 300) };
  });
  ipcMain.handle("git:cwdName", () => basename(repoCwd()));
}
