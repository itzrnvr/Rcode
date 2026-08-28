/*
 * PURPOSE: Full PTY terminal via node-pty — like VS Code
 *
 * Each Terminal ZTab gets its own PTY (conpty on Windows 10+). This gives
 * a real terminal: colors, cursor movement, vim, etc., not just line mode.
 * Falls back to child_process if node-pty fails to load.
 */

import { ipcMain, BrowserWindow } from "electron";
import { platform } from "os";

// Try to load node-pty, fallback to child_process
let pty: typeof import("node-pty") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pty = require("node-pty") as typeof import("node-pty");
} catch {
  pty = null;
}

import { spawn as cpSpawn, type ChildProcess } from "child_process";

type Shell = { write: (d: string) => void; resize: (cols: number, rows: number) => void; kill: () => void; onData: (cb: (d: string) => void) => void; onExit: (cb: () => void) => void };

const shells = new Map<string, Shell>();

function getShell(): { cmd: string; args: string[] } {
  if (platform() === "win32") {
    return { cmd: "powershell.exe", args: [] };
  }
  return { cmd: "bash", args: ["-i"] };
}

function broadcast(id: string, data: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`terminal:data:${id}`, data);
  }
}

function createPtyShell(id: string, cwd?: string): Shell {
  const { cmd, args } = getShell();
  if (pty) {
    const proc = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: process.env as Record<string, string>,
    });
    return {
      write: (d) => proc.write(d),
      resize: (cols, rows) => {
        try { proc.resize(cols, rows); } catch {}
      },
      kill: () => {
        try { proc.kill(); } catch {}
      },
      onData: (cb) => proc.onData(cb),
      onExit: (cb) => proc.onExit(() => cb()),
    };
  }
  // Fallback to child_process
  const proc = cpSpawn(cmd, args, {
    cwd: cwd || process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcess;
  return {
    write: (d) => proc.stdin?.write(d),
    resize: () => {},
    kill: () => {
      try { (proc as ChildProcess).kill(); } catch {}
    },
    onData: (cb) => {
      proc.stdout?.on("data", (d: Buffer) => cb(d.toString()));
      proc.stderr?.on("data", (d: Buffer) => cb(d.toString()));
    },
    onExit: (cb) => proc.on("exit", cb),
  };
}

export function registerTerminalHandlers(): void {
  ipcMain.handle("terminal:create", (_e, id: string, cwd?: string) => {
    if (shells.has(id)) return;
    try {
      const shell = createPtyShell(id, cwd);
      shell.onData((d) => broadcast(id, d));
      shell.onExit(() => {
        broadcast(id, "\r\n[process exited]\r\n");
        shells.delete(id);
      });
      shells.set(id, shell);
      // Give shell a moment to emit prompt
      setTimeout(() => {}, 100);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      broadcast(id, `[failed to start shell: ${msg}]\r\n`);
    }
  });

  ipcMain.handle("terminal:input", (_e, id: string, data: string) => {
    let shell = shells.get(id);
    if (!shell) {
      shell = createPtyShell(id);
      shell.onData((d) => broadcast(id, d));
      shell.onExit(() => {
        broadcast(id, "\r\n[process exited]\r\n");
        shells.delete(id);
      });
      shells.set(id, shell);
    }
    shell.write(data);
  });

  ipcMain.handle("terminal:close", (_e, id: string) => {
    const shell = shells.get(id);
    if (shell) {
      try { shell.kill(); } catch {}
      shells.delete(id);
    }
  });

  ipcMain.handle("terminal:resize", (_e, id: string, cols: number, rows: number) => {
    shells.get(id)?.resize(cols, rows);
  });
}
