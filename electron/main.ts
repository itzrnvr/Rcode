/*
 * PURPOSE: Electron main process — app lifecycle, window creation, IPC registration
 *
 * ARCHITECTURE: This file contains NO business logic. It:
 *   1. Initializes the database (db/index.ts)
 *   2. Registers all IPC handlers (ipc/index.ts)
 *   3. Creates the BrowserWindow and loads the renderer
 *
 * All domain logic lives in db/ (repositories) and ipc/ (handlers).
 */

import { app, BrowserWindow, Menu, ipcMain } from "electron";
import { join } from "path";
import { existsSync } from "fs";
import { writeFileSync } from "fs";

import { initDb } from "./db/index";
import { registerAllHandlers } from "./ipc/index";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#151718",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Dev: load Vite dev server; Prod: load built HTML
  const prodPath = join(__dirname, "../renderer/index.html");
  if (existsSync(prodPath)) {
    mainWindow.loadFile(prodPath);
  } else {
    mainWindow.loadURL("http://localhost:5173");
  }

  if (process.env.NODE_ENV !== "production") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  initDb();
  registerAllHandlers();
  createWindow();

  ipcMain.handle("debug:screenshot", async (_e, path: string) => {
    if (!mainWindow) return false;
    // Double-capture: capturePage() can return a stale composited frame
    // (verified 2026-08-28: first capture lags one frame behind the DOM,
    // causing "ghost" popover states in screenshots). Discard the first.
    await mainWindow.webContents.capturePage();
    const { promise: delayDone, resolve: delayResolve } = Promise.withResolvers<void>();
    setTimeout(delayResolve, 100);
    await delayDone;
    const img = await mainWindow.webContents.capturePage();
    const buf = img.toPNG();
    writeFileSync(path, buf);
    return { ok: buf.length > 0, size: buf.length };
  });

  // Window control IPC handlers
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Remove default menu bar for a cleaner UI
Menu.setApplicationMenu(null);
