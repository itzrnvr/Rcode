/*
 * PURPOSE: Session IPC handlers — thin pass-through to sessions repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain } from "electron";

import * as sessions from "../db/sessions";

import type { CreateSessionInput, Session } from "../../src/types";

type SessionUpdate = Partial<Pick<Session, "title" | "status" | "customInstructions" | "model">>;

export function registerSessionHandlers(): void {
  ipcMain.handle("session:create", (_e, input?: CreateSessionInput) => sessions.createSession(input));
  ipcMain.handle("session:get", (_e, id: string) => sessions.getSession(id));
  ipcMain.handle("session:listMain", () => sessions.listMainSessions());
  ipcMain.handle("session:update", (_e, id: string, updates: SessionUpdate) => sessions.updateSession(id, updates));
  ipcMain.handle("session:delete", (_e, id: string) => sessions.deleteSession(id));
  ipcMain.handle("session:reorder", (_e, orderedIds: string[]) => sessions.reorderSessions(orderedIds));
  ipcMain.handle("session:pin", (_e, id: string) => sessions.pinSession(id));
  ipcMain.handle("session:unpin", (_e, id: string) => sessions.unpinSession(id));
  ipcMain.handle("session:togglePin", (_e, id: string) => sessions.togglePinSession(id));
  ipcMain.handle("session:fork", (_e, sessionId: string, upToMessageId: string) => sessions.forkSession(sessionId, upToMessageId));
}
