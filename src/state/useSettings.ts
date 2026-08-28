/*
 * PURPOSE: Settings state hook — wraps AppContext settings with update operations
 *
 * Reads settings from AppContext and provides typed update functions that
 * persist to DB via the API and then refresh the context.
 *
 * CONSUMERS: components/settings/SettingsModal.tsx, ThemeSettings.tsx, InstructionsEditor.tsx
 */

import { useCallback } from "react";

import { api } from "../api/client";
import { useApp } from "./AppContext";

import type { Theme, Settings } from "../types";

export function useSettings() {
  const { settings, refreshSettings } = useApp();

  const updateSetting = useCallback(async (key: keyof Settings, value: string) => {
    await api.setSetting(key, value);
    await refreshSettings();
  }, [refreshSettings]);

  const updateTheme = useCallback(async (theme: Theme) => {
    await api.setTheme(theme);
    await refreshSettings();
  }, [refreshSettings]);

  return { settings, updateSetting, updateTheme };
}
