/*
 * PURPOSE: Session list state hook — loads sessions, provides create/delete
 *
 * Parameterized by sessionListVersion (from AppContext) so the list reloads
 * when sessions are created/deleted from anywhere in the app.
 *
 * CONSUMERS: components/sessions/SessionList.tsx
 */

import { useState, useEffect, useCallback } from "react";

import { api } from "../api/client";

import type { Session, CreateSessionInput } from "../types";

export function useSessions(sessionListVersion: number) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await api.listMainSessions();
    setSessions(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, sessionListVersion]);

  const createSession = useCallback((input?: CreateSessionInput) => {
    return api.createSession(input);
  }, []);

  const deleteSession = useCallback((id: string) => {
    return api.deleteSession(id);
  }, []);

  return { sessions, loading, refresh, createSession, deleteSession };
}
