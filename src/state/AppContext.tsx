/*
 * PURPOSE: App-wide React context — shared state that multiple components need
 *
 * Provides:
 * - currentSessionId + setter (which session is active in the chat panel)
 * - settings + refresh (API config, global instructions, theme)
 * - showSettings + setter (settings modal visibility)
 * - sessionListVersion + bumper (triggers SessionList reload on create/delete)
 *
 * ARCHITECTURE: Domain hooks (useSessions, useChat, useSideChats) are NOT in
 * context — they're called by individual components and parameterized by
 * currentSessionId from this context. This keeps re-renders scoped.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

import { api } from "../api/client";

import type { Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

interface AppContextValue {
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  settings: Settings;
  refreshSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  sessionListVersion: number;
  bumpSessionList: () => void;
  sideChatVersion: number;
  bumpSideChats: () => void;
  hasSideChats: boolean;
  setHasSideChats: (v: boolean) => void;
  sidePanelCollapsed: boolean;
  setSidePanelCollapsed: (v: boolean) => void;
  sidePanelWidth: number;
  setSidePanelWidth: (n: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionListVersion, setSessionListVersion] = useState(0);
  const [sideChatVersion, setSideChatVersion] = useState(0);
  const [hasSideChats, setHasSideChats] = useState(false);
  const [sidePanelCollapsed, setSidePanelCollapsedState] = useState(false);
  const [sidePanelWidth, setSidePanelWidthState] = useState(380);

  const refreshSettings = useCallback(async () => {
    const s = await api.getSettings();
    setSettings(s);
  }, []);

  const setSetting = useCallback(async (key: string, value: string) => {
    await api.setSetting(key, value);
    // Optimistically update local state
    setSettings(prev => {
      if (key === "theme") {
        try { return { ...prev, theme: JSON.parse(value) }; }
        catch { return prev; }
      }
      return { ...prev, [key]: value } as Settings;
    });
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    api.getSetting("sidePanelCollapsed").then(v => { if (v === "true") setSidePanelCollapsedState(true); }).catch(() => {});
    api.getSetting("sidePanelWidth").then(v => { const n = parseInt(v ?? "", 10); if (!isNaN(n) && n >= 240 && n <= 600) setSidePanelWidthState(n); }).catch(() => {});
  }, []);

  const setSidePanelCollapsed = useCallback(async (v: boolean) => {
    setSidePanelCollapsedState(v);
    await api.setSetting("sidePanelCollapsed", v ? "true" : "false");
  }, []);
  const setSidePanelWidth = useCallback(async (n: number) => {
    setSidePanelWidthState(n);
    await api.setSetting("sidePanelWidth", String(n));
  }, []);

  const bumpSessionList = useCallback(() => {
    setSessionListVersion(v => v + 1);
  }, []);

  const bumpSideChats = useCallback(() => {
    setSideChatVersion(v => v + 1);
  }, []);

  const value: AppContextValue = {
    currentSessionId,
    setCurrentSessionId,
    settings,
    refreshSettings,
    setSetting,
    showSettings,
    setShowSettings,
    sessionListVersion,
    bumpSessionList,
    sideChatVersion,
    bumpSideChats,
    hasSideChats,
    setHasSideChats,
    sidePanelCollapsed,
    setSidePanelCollapsed,
    sidePanelWidth,
    setSidePanelWidth,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
