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
}

export function addMessage(sessionId: string, role: MessageRole, content: string): Message {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare("INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, sessionId, role, content, now);

  // Bump session updated_at so list ordering reflects recent activity
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

  return { id, sessionId, role, content, createdAt: now };
}

export function getMessages(sessionId: string): Message[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as MessageRow[];
  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role as MessageRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export function updateMessage(id: string, content: string): void {
  const db = getDb();
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

export function deleteMessage(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
}
