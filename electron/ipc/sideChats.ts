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



import * as sideChats from "../db/sideChats";
import { registerApiHandler } from "../api/registry";
import { addMessage } from "../db/messages";

import type { CreateSideChatInput } from "../../src/types";

export function registerSideChatHandlers(): void {
  registerApiHandler("sidechat:create", async (_e, input: CreateSideChatInput) => {
    const result = sideChats.createSideChat(input);
    if (input.selectedText) {
      addMessage(result.session.id, "system", `Selected context:\n${input.selectedText}`);
    }
    return result;
  });

  registerApiHandler("sidechat:tabs", (_e, parentSessionId: string, includeClosed?: boolean) =>
    sideChats.getSideChatTabs(parentSessionId, includeClosed));

  registerApiHandler("sidechat:closed", (_e, parentSessionId: string) =>
    sideChats.getClosedSideChats(parentSessionId));

  registerApiHandler("sidechat:close", (_e, tabId: string) => sideChats.closeSideChatTab(tabId));
  registerApiHandler("sidechat:reopen", (_e, tabId: string) => sideChats.reopenSideChatTab(tabId));
  registerApiHandler("sidechat:promote", (_e, sideChatId: string) => sideChats.promoteSideChat(sideChatId));
  registerApiHandler("sidechat:reorder", (_e, parentSessionId: string, tabIds: string[]) =>
    sideChats.reorderSideChatTabs(parentSessionId, tabIds));
}
