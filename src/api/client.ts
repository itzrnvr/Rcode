/*
 * Electron desktop uses the context bridge. A normal browser uses the local
 * web API bridge, letting the same React UI run as a webapp.
 */

import type { ElectronAPI } from "../../electron/preload";
import { browserElectronAPI } from "./browserElectron";

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export const api: ElectronAPI = window.electron ?? browserElectronAPI;
