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
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY rowid ASC").all(sessionId) as MessageRow[];
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

// Branch-aware version switch: archive the current tail under the current
// version, then restore the tail stored under the target version.
export function setVersionWithBranches(id: string, index: number): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const idx = Math.min(Math.max(index, 0), versions.length - 1);
  if (idx === row.version_index) return;
  archiveTail(id, row.version_index);
  restoreTail(id, idx);
  db.prepare("UPDATE messages SET version_index = ?, content = ? WHERE id = ?")
    .run(idx, versions[idx], id);
}

interface TailRow { id: string; role: string; content: string; versions: string; version_index: number; created_at: number }

function getTail(sessionId: string, afterId: string): TailRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, role, content, versions, version_index, created_at FROM messages WHERE session_id = ? AND rowid > (SELECT rowid FROM messages WHERE id = ?) ORDER BY rowid"
  ).all(sessionId, afterId) as TailRow[];
}

// Retry semantics: archive the messages after `messageId` under `version` and
// remove them from the live list. Skips empty tails so a switch back and forth
// never clobbers a stored branch.
export function archiveTail(messageId: string, version: number): void {
  const db = getDb();
  const row = db.prepare("SELECT session_id FROM messages WHERE id = ?").get(messageId) as { session_id: string } | undefined;
  if (!row) return;
  const tail = getTail(row.session_id, messageId);
  if (tail.length === 0) return;
  db.prepare("INSERT OR REPLACE INTO branches (message_id, version, messages_json, created_at) VALUES (?, ?, ?, ?)")
    .run(messageId, version, JSON.stringify(tail), Date.now());
  const del = db.prepare("DELETE FROM messages WHERE id = ?");
  for (const r of tail) del.run(r.id);
}

// Restore the tail archived under `version` (move semantics: row is consumed).
export function restoreTail(messageId: string, version: number): void {
  const db = getDb();
  const row = db.prepare("SELECT session_id FROM messages WHERE id = ?").get(messageId) as { session_id: string } | undefined;
  const b = db.prepare("SELECT messages_json FROM branches WHERE message_id = ? AND version = ?").get(messageId, version) as { messages_json: string } | undefined;
  if (!row || !b) return;
  const tail = JSON.parse(b.messages_json) as TailRow[];
  const ins = db.prepare("INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at, versions, version_index) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const r of tail) ins.run(r.id, row.session_id, r.role, r.content, r.created_at, r.versions, r.version_index);
  db.prepare("DELETE FROM branches WHERE message_id = ? AND version = ?").run(messageId, version);
}

export function deleteMessage(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
}
