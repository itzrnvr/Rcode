/*
 * PURPOSE: Typed IPC client — renderer-side access to Electron main process
 *
 * Imports the ElectronAPI type from the preload (type-only, erased at build).
 * Declares window.electron as the typed API surface.
 * All renderer code goes through this `api` object, never raw ipcRenderer.
 */

import type { ElectronAPI } from "../../electron/preload";

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export const api: ElectronAPI = window.electron;
