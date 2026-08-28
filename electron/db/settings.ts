/*
 * PURPOSE: Settings repository — all SQL for settings table (key-value store)
 *          Includes theme JSON serialization/deserialization
 *
 * KEY DECISIONS:
 * - Settings stored as flat key-value pairs, theme as a JSON string under "theme" key
 * - getSettings assembles the full Settings object with defaults for missing keys
 * - Theme merge: parsed JSON spread over DEFAULT_THEME for forward-compatibility
 *
 * CONSUMERS: ipc/settings.ts, ipc/chat.ts
 */

import { getDb } from "./index";

import type { Settings, Theme } from "../../src/types";
import { DEFAULT_SETTINGS, DEFAULT_THEME } from "../../src/types";

interface SettingRow {
  key: string;
  value: string;
}

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  let theme: Theme;
  try {
    theme = { ...DEFAULT_THEME, ...JSON.parse(map.theme ?? "{}") };
  } catch {
    theme = DEFAULT_THEME;
  }

  return {
    apiBase: map.apiBase ?? DEFAULT_SETTINGS.apiBase,
    apiKey: map.apiKey ?? DEFAULT_SETTINGS.apiKey,
    model: map.model ?? DEFAULT_SETTINGS.model,
    providerName: map.providerName ?? DEFAULT_SETTINGS.providerName,
    globalInstructions: map.globalInstructions ?? DEFAULT_SETTINGS.globalInstructions,
    theme,
  };
}

export function setSetting(key: string, value: string): void {
  getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setTheme(theme: Theme): void {
  setSetting("theme", JSON.stringify(theme));
}
