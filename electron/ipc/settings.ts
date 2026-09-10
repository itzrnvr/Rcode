/*
 * PURPOSE: Settings IPC handlers — thin pass-through to settings repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */



import * as settings from "../db/settings";
import { registerApiHandler } from "../api/registry";

import type { Theme } from "../../src/types";

export function registerSettingsHandlers(): void {
  registerApiHandler("settings:get", () => settings.getSettings());
  registerApiHandler("settings:getOne", (_e, key: string) => settings.getSetting(key));
  registerApiHandler("settings:set", (_e, key: string, value: string) => settings.setSetting(key, value));
  registerApiHandler("settings:setTheme", (_e, theme: Theme) => settings.setTheme(theme));
}
