/*
 * PURPOSE: Message IPC handlers — thin pass-through to messages repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain } from "electron";

import * as messages from "../db/messages";

import type { MessageRole } from "../../src/types";

export function registerMessageHandlers(): void {
  ipcMain.handle("message:add", (_e, sessionId: string, role: MessageRole, content: string) =>
    messages.addMessage(sessionId, role, content));
  ipcMain.handle("message:list", (_e, sessionId: string) =>
    messages.getMessages(sessionId));
  ipcMain.handle("message:update", (_e, id: string, content: string) =>
    messages.updateMessage(id, content));
  ipcMain.handle("message:setVersion", (_e, id: string, index: number) =>
    messages.setVersionWithBranches(id, index));
  ipcMain.handle("message:delete", (_e, id: string) =>
    messages.deleteMessage(id));
}
