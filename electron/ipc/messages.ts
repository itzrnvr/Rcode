/*
 * PURPOSE: Message IPC handlers — thin pass-through to messages repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { registerApiHandler } from "../api/registry";



import * as messages from "../db/messages";

import type { MessageRole } from "../../src/types";

export function registerMessageHandlers(): void {
  registerApiHandler("message:add", (_e, sessionId: string, role: MessageRole, content: string) =>
    messages.addMessage(sessionId, role, content));
  registerApiHandler("message:list", (_e, sessionId: string) =>
    messages.getMessages(sessionId));
  registerApiHandler("message:update", (_e, id: string, content: string) =>
    messages.updateMessage(id, content));
  registerApiHandler("message:setVersion", (_e, id: string, index: number) =>
    messages.setVersionWithBranches(id, index));
  registerApiHandler("message:delete", (_e, id: string) =>
    messages.deleteMessage(id));
}
