/*
 * PURPOSE: Side chat state hook — loads tabs, manages create/close/reopen/promote
 *
 * Maintains two lists: open tabs (for the tab bar) and closed tabs (for the
 * reopenable list). After each mutation, refreshes both lists from the DB.
 *
 * CONSUMERS: components/sidepanel/SidePanel.tsx
 */

import { useState, useEffect, useCallback } from "react";

import { api } from "../api/client";

import type { SideChatTab, CreateSideChatInput } from "../types";

export function useSideChats(sessionId: string | null, sideChatVersion: number) {
  const [tabs, setTabs] = useState<SideChatTab[]>([]);
  const [closedTabs, setClosedTabs] = useState<SideChatTab[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setTabs([]);
      setClosedTabs([]);
      return;
    }
    const [open, closed] = await Promise.all([
      api.getSideChatTabs(sessionId),
      api.getClosedSideChats(sessionId),
    ]);
    setTabs(open);
    setClosedTabs(closed);
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh, sideChatVersion]);

  const createSideChat = useCallback(async (input: CreateSideChatInput) => {
    const result = await api.createSideChat(input);
    await refresh();
    return result;
  }, [refresh]);

  const closeTab = useCallback(async (tabId: string) => {
    await api.closeSideChatTab(tabId);
    await refresh();
  }, [refresh]);

  const reopenTab = useCallback(async (tabId: string) => {
    await api.reopenSideChatTab(tabId);
    await refresh();
  }, [refresh]);

  const promoteSideChat = useCallback(async (sideChatId: string) => {
    await api.promoteSideChat(sideChatId);
    await refresh();
  }, [refresh]);

  return { tabs, closedTabs, createSideChat, closeTab, reopenTab, promoteSideChat, refresh };
}
