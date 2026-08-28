/*
 * PURPOSE: Minimal PTY-like terminal via child_process shell — no native deps
 *
 * Each Terminal ZTab gets its own shell (powershell.exe on Windows, bash otherwise).
 * Renderer sends input via terminal:input, main writes to stdin and streams
 * stdout/stderr back via webContents.send(`terminal:data:${id}`).
 *
 * Keeps shell alive across tab switches; killed on terminal:close or app quit.
 */

import { ipcMain, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { platform } from "os";

const shells = new Map<string, ChildProcess>();

function getShell(): { cmd: string; args: string[] } {
  if (platform() === "win32") {
    return { cmd: process.env.ComSpec || "powershell.exe", args: [] };
  }
  return { cmd: "bash", args: ["-i"] };
}

function broadcast(id: string, data: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`terminal:data:${id}`, data);
  }
}

export function registerTerminalHandlers(): void {
  ipcMain.handle("terminal:create", (_e, id: string, cwd?: string) => {
    if (shells.has(id)) return;
    const { cmd, args } = getShell();
    try {
      const proc = spawn(cmd, args, {
        cwd: cwd || process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      proc.stdout?.on("data", (d: Buffer) => broadcast(id, d.toString()));
      proc.stderr?.on("data", (d: Buffer) => broadcast(id, d.toString()));
      proc.on("exit", () => {
        broadcast(id, `\r\n[process exited]\r\n`);
        shells.delete(id);
      });
      proc.on("error", (err) => broadcast(id, `\r\n[spawn error: ${err.message}]\r\n`));
      shells.set(id, proc);
      // Send initial prompt after a short delay to allow shell to init
      setTimeout(() => broadcast(id, ""), 100);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      broadcast(id, `[failed to start shell: ${msg}]\r\n`);
    }
  });

  ipcMain.handle("terminal:input", (_e, id: string, data: string) => {
    const proc = shells.get(id);
    if (!proc || !proc.stdin) {
      // Auto-create if missing
      const { cmd, args } = getShell();
      const p = spawn(cmd, args, { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      p.stdout?.on("data", (d: Buffer) => broadcast(id, d.toString()));
      p.stderr?.on("data", (d: Buffer) => broadcast(id, d.toString()));
      shells.set(id, p);
      p.stdin?.write(data);
      return;
    }
    proc.stdin.write(data);
  });

  ipcMain.handle("terminal:close", (_e, id: string) => {
    const proc = shells.get(id);
    if (proc) {
      try { proc.kill(); } catch {}
      shells.delete(id);
    }
  });

  ipcMain.handle("terminal:resize", () => {
    // No-op for non-pty shell; kept for API compat
  });
}
