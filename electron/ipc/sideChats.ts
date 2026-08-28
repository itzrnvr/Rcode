/*
 * PURPOSE: Side chat IPC handlers — creates side chats with optional selected-text context,
 *          manages tab open/close/reorder, and promotes side chats to full sessions
 *
 * KEY DECISIONS:
 * - Selected text added as a system message after side chat creation (keeps repos decoupled)
 * - All tab operations are thin pass-throughs to sideChats repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain } from "electron";

import * as sideChats from "../db/sideChats";
import { addMessage } from "../db/messages";

import type { CreateSideChatInput } from "../../src/types";

export function registerSideChatHandlers(): void {
  ipcMain.handle("sidechat:create", async (_e, input: CreateSideChatInput) => {
    const result = sideChats.createSideChat(input);
    if (input.selectedText) {
      addMessage(result.session.id, "system", `Selected context:\n${input.selectedText}`);
    }
    return result;
  });

  ipcMain.handle("sidechat:tabs", (_e, parentSessionId: string, includeClosed?: boolean) =>
    sideChats.getSideChatTabs(parentSessionId, includeClosed));

  ipcMain.handle("sidechat:closed", (_e, parentSessionId: string) =>
    sideChats.getClosedSideChats(parentSessionId));

  ipcMain.handle("sidechat:close", (_e, tabId: string) => sideChats.closeSideChatTab(tabId));
  ipcMain.handle("sidechat:reopen", (_e, tabId: string) => sideChats.reopenSideChatTab(tabId));
  ipcMain.handle("sidechat:promote", (_e, sideChatId: string) => sideChats.promoteSideChat(sideChatId));
  ipcMain.handle("sidechat:reorder", (_e, parentSessionId: string, tabIds: string[]) =>
    sideChats.reorderSideChatTabs(parentSessionId, tabIds));
}
