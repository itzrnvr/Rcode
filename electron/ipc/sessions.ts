/*
 * PURPOSE: Session IPC handlers — thin pass-through to sessions repository
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { registerApiHandler } from "../api/registry";



import * as sessions from "../db/sessions";

import type { CreateSessionInput, Session } from "../../src/types";

type SessionUpdate = Partial<Pick<Session, "title" | "status" | "customInstructions" | "model">>;

export function registerSessionHandlers(): void {
  registerApiHandler("session:create", (_e, input?: CreateSessionInput) => sessions.createSession(input));
  registerApiHandler("session:get", (_e, id: string) => sessions.getSession(id));
  registerApiHandler("session:listMain", () => sessions.listMainSessions());
  registerApiHandler("session:update", (_e, id: string, updates: SessionUpdate) => sessions.updateSession(id, updates));
  registerApiHandler("session:delete", (_e, id: string) => sessions.deleteSession(id));
  registerApiHandler("session:reorder", (_e, orderedIds: string[]) => sessions.reorderSessions(orderedIds));
  registerApiHandler("session:pin", (_e, id: string) => sessions.pinSession(id));
  registerApiHandler("session:unpin", (_e, id: string) => sessions.unpinSession(id));
  registerApiHandler("session:togglePin", (_e, id: string) => sessions.togglePinSession(id));
  registerApiHandler("session:fork", (_e, sessionId: string, upToMessageId: string) => sessions.forkSession(sessionId, upToMessageId));
}
