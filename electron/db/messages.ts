/*
 * PURPOSE: Message repository — all SQL for messages table
 *
 * CONSUMERS: ipc/messages.ts, ipc/chat.ts
 */

import { randomUUID } from "crypto";
import { getDb } from "./index";

import type { Message, MessageRole } from "../../src/types";

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  versions: string;
  version_index: number;
}

function parseVersions(row: MessageRow): { versions: string[]; versionIndex: number } {
  let versions: string[] = [];
  try { versions = JSON.parse(row.versions ?? "[]") as string[]; } catch { versions = []; }
  if (!Array.isArray(versions) || versions.length === 0) versions = [row.content];
  const versionIndex = Math.min(Math.max(row.version_index ?? 0, 0), versions.length - 1);
  return { versions, versionIndex };
}

export function addMessage(sessionId: string, role: MessageRole, content: string): Message {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at, versions, version_index) VALUES (?, ?, ?, ?, ?, '[]', 0)")
    .run(id, sessionId, role, content, now);

  // Bump session updated_at so list ordering reflects recent activity
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

  return { id, sessionId, role, content, createdAt: now, versions: [content], versionIndex: 0 };
}

export function getMessages(sessionId: string): Message[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as MessageRow[];
  return rows.map(r => {
    const { versions, versionIndex } = parseVersions(r);
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role as MessageRole,
      content: r.content,
      createdAt: r.created_at,
      versions,
      versionIndex,
    };
  });
}

export function updateMessage(id: string, content: string): void {
  const db = getDb();
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

// Append a regenerated answer; content always mirrors versions[version_index].
export function appendAssistantVersion(id: string, newContent: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const next = [...versions, newContent];
  const idx = next.length - 1;
  db.prepare("UPDATE messages SET versions = ?, version_index = ?, content = ? WHERE id = ?")
    .run(JSON.stringify(next), idx, newContent, id);
}

export function setMessageVersionIndex(id: string, index: number): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const idx = Math.min(Math.max(index, 0), versions.length - 1);
  db.prepare("UPDATE messages SET version_index = ?, content = ? WHERE id = ?")
    .run(idx, versions[idx], id);
}

export function deleteMessage(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
}
