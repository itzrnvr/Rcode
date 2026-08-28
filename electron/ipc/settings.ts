/*
 * PURPOSE: Settings IPC handlers — thin pass-through to settings repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain } from "electron";

import * as settings from "../db/settings";

import type { Theme } from "../../src/types";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", () => settings.getSettings());
  ipcMain.handle("settings:getOne", (_e, key: string) => settings.getSetting(key));
  ipcMain.handle("settings:set", (_e, key: string, value: string) => settings.setSetting(key, value));
  ipcMain.handle("settings:setTheme", (_e, theme: Theme) => settings.setTheme(theme));
}
