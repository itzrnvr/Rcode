/*
 * PURPOSE: Minimal client-side agent toolset for the Rcode agent loop.
 *
 * Tools are OpenAI function-calling schemas sent with chat completions.
 * Execution respects the composer mode:
 *   - plan:       read-only tools only; run_command refused.
 *   - restricted: run_command requires renderer approval (IPC round-trip).
 *   - full-access: run_command executes directly.
 *
 * All results are capped in size so the UI can show them in scroll views
 * without blowing up context.
 */

import { exec } from "child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";

export type AgentMode = "plan" | "full-access" | "restricted";

export interface ToolContext {
  mode: AgentMode;
  cwd: string;
  /** ask the renderer whether a command may run; resolves true/false */
  askApproval: (command: string) => Promise<boolean>;
}

export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file. Returns its content (capped at 100KB).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute or cwd-relative file path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_dir",
      description: "List directory entries (capped at 200 entries).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path (defaults to cwd)" } },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search",
      description: "Regex-search text files under a directory. Returns matching lines (capped).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JS regex source" },
          path: { type: "string", description: "Directory to search (defaults to cwd)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Run a shell command (bash on unix, cmd on windows). Output capped at 20KB. Requires permission per mode.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The command line to execute" } },
        required: ["command"],
      },
    },
  },
];

const CAP = { read: 100 * 1024, exec: 20 * 1024, searchHits: 60, dirEntries: 200 };

function capText(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap) + `\n… [truncated ${s.length - cap} more chars]`;
}

function runShell(command: string, cwd: string): Promise<string> {
  return new Promise(resolvePromise => {
    exec(
      command,
      { cwd, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`[stderr]\n${stderr}`);
        if (error) parts.push(`[exit ${error.code ?? 1}] ${error.message}`);
        resolvePromise(capText(parts.join("\n") || "(no output)", CAP.exec));
      },
    );
  });
}

function searchDir(dir: string, re: RegExp, hits: string[], root: string, depth: number): void {
  if (depth > 5 || hits.length >= CAP.searchHits) return;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (hits.length >= CAP.searchHits) return;
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { searchDir(full, re, hits, root, depth + 1); continue; }
    if (st.size > 512 * 1024) continue;
    let text = "";
    try { text = readFileSync(full, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push(`${full.slice(root.length + 1)}:${i + 1}: ${lines[i].slice(0, 200)}`);
        if (hits.length >= CAP.searchHits) break;
      }
    }
  }
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const p = resolve(ctx.cwd, String(args.path ?? ""));
        if (!existsSync(p)) return `error: file not found: ${p}`;
        const st = statSync(p);
        if (st.size > 4 * 1024 * 1024) return `error: file too large (${st.size} bytes)`;
        return capText(readFileSync(p, "utf8"), CAP.read);
      }
      case "list_dir": {
        const p = resolve(ctx.cwd, String(args.path ?? "."));
        const entries = readdirSync(p, { withFileTypes: true }).slice(0, CAP.dirEntries);
        return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") || "(empty)";
      }
      case "search": {
        const re = new RegExp(String(args.pattern ?? ""), "i");
        const root = resolve(ctx.cwd, String(args.path ?? "."));
        const hits: string[] = [];
        searchDir(root, re, hits, root, 0);
        return hits.join("\n") || "(no matches)";
      }
      case "run_command": {
        const command = String(args.command ?? "");
        if (ctx.mode === "plan") return "error: run_command is not available in Plan mode (read-only).";
        if (ctx.mode === "restricted") {
          const ok = await ctx.askApproval(command);
          if (!ok) return "error: the user denied this command.";
        }
        return await runShell(command, ctx.cwd);
      }
      default:
        return `error: unknown tool ${name}`;
    }
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
