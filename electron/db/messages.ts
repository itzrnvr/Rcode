/*
 * PURPOSE: Message repository — all SQL for messages table
 *
 * CONSUMERS: ipc/messages.ts, ipc/chat.ts
 */

import { randomUUID } from "crypto";
import { getDb } from "./index";

import type { AgentTurn, Message, MessageRole } from "../../src/types";

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  versions: string;
  version_index: number;
  turn_json: string | null;
  turn_versions: string;
}

function parseVersions(row: MessageRow): { versions: string[]; versionIndex: number } {
  let versions: string[] = [];
  try { versions = JSON.parse(row.versions ?? "[]") as string[]; } catch { versions = []; }
  if (!Array.isArray(versions) || versions.length === 0) versions = [row.content];
  const versionIndex = Math.min(Math.max(row.version_index ?? 0, 0), versions.length - 1);
  return { versions, versionIndex };
}

function parseTurnJson(value: string | null | undefined): AgentTurn | undefined {
  if (!value) return undefined;
  try {
    const turn = JSON.parse(value) as AgentTurn;
    return Array.isArray(turn?.events) ? turn : undefined;
  } catch {
    return undefined;
  }
}

function parseTurnVersions(row: MessageRow): AgentTurn[] {
  const current = parseTurnJson(row.turn_json);
  try {
    const parsed = JSON.parse(row.turn_versions ?? "[]") as AgentTurn[];
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(t => Array.isArray(t?.events))) return parsed;
  } catch {}
  return current ? [current] : [];
}

function turnToContent(turn: AgentTurn): string {
  return turn.finalContent ?? "";
}

export function addMessage(sessionId: string, role: MessageRole, content: string, turn?: AgentTurn): Message {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  const finalContent = turn ? turnToContent(turn) : content;
  const turnVersions = turn ? [turn] : [];

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at, versions, version_index, turn_json, turn_versions)
    VALUES (?, ?, ?, ?, ?, '[]', 0, ?, ?)
  `).run(id, sessionId, role, finalContent, now, turn ? JSON.stringify(turn) : null, JSON.stringify(turnVersions));

  // Bump session updated_at so list ordering reflects recent activity
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

  return { id, sessionId, role, content: finalContent, createdAt: now, versions: [finalContent], versionIndex: 0, turn, turnVersions };
}

export function getMessages(sessionId: string): Message[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY rowid ASC").all(sessionId) as MessageRow[];
  return rows.map(r => {
    const { versions, versionIndex } = parseVersions(r);
    const turn = parseTurnJson(r.turn_json);
    const turnVersions = parseTurnVersions(r);
    const contentVersions = turnVersions.length > 0 ? turnVersions.map(turnToContent) : versions;
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role as MessageRole,
      content: turn ? turnToContent(turn) : r.content,
      createdAt: r.created_at,
      versions: contentVersions,
      versionIndex,
      turn,
      turnVersions,
    };
  });
}

export function updateMessage(id: string, content: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const turn = parseTurnJson(row.turn_json);
  if (!turn) {
    db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
    return;
  }

  // Editing an assistant answer edits the final response event while keeping
  // the reasoning/tool trace intact.
  const events = [...turn.events];
  const lastResponse = [...events].reverse().findIndex(e => e.kind === "response");
  if (lastResponse >= 0) {
    const index = events.length - 1 - lastResponse;
    events[index] = { kind: "response", text: content };
  } else {
    events.push({ kind: "response", text: content });
  }
  const nextTurn = { ...turn, events, finalContent: content };
  const turnVersions = parseTurnVersions(row);
  const idx = Math.min(Math.max(row.version_index ?? 0, 0), turnVersions.length - 1);
  if (turnVersions.length > 0) turnVersions[idx] = nextTurn;
  db.prepare("UPDATE messages SET content = ?, turn_json = ?, turn_versions = ? WHERE id = ?")
    .run(content, JSON.stringify(nextTurn), JSON.stringify(turnVersions.length ? turnVersions : [nextTurn]), id);
}

// Append a regenerated answer; content always mirrors versions[version_index].
export function appendAssistantVersion(id: string, newContent: string, turn?: AgentTurn): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const turnVersions = parseTurnVersions(row);
  if (turn) {
    if (turnVersions.length === 0 && versions.length > 0) {
      // Upgrade legacy text-only versions to structured turn versions before
      // appending the new retry, so switching versions cannot lose history.
      turnVersions.push(...versions.map(content => ({
        secs: 0,
        events: content ? [{ kind: "response" as const, text: content }] : [],
        finalContent: content,
      })));
    }
    turnVersions.push(turn);
  }
  const next = turn ? turnVersions.map(turnToContent) : [...versions, newContent];
  const idx = next.length - 1;
  db.prepare("UPDATE messages SET versions = ?, version_index = ?, content = ?, turn_json = ?, turn_versions = ? WHERE id = ?")
    .run(
      JSON.stringify(next),
      idx,
      turn ? turnToContent(turn) : newContent,
      turn ? JSON.stringify(turn) : row.turn_json,
      JSON.stringify(turnVersions),
      id,
    );
}

export function setMessageVersionIndex(id: string, index: number): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const turnVersions = parseTurnVersions(row);
  const contentVersions = turnVersions.length > 0 ? turnVersions.map(turnToContent) : versions;
  const idx = Math.min(Math.max(index, 0), contentVersions.length - 1);
  const selectedTurn = turnVersions[idx];
  db.prepare("UPDATE messages SET version_index = ?, content = ?, turn_json = ? WHERE id = ?")
    .run(idx, contentVersions[idx], selectedTurn ? JSON.stringify(selectedTurn) : row.turn_json, id);
}

// Branch-aware version switch: archive the current tail under the current
// version, then restore the tail stored under the target version.
export function setVersionWithBranches(id: string, index: number): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!row) return;
  const { versions } = parseVersions(row);
  const turnVersions = parseTurnVersions(row);
  const contentVersions = turnVersions.length > 0 ? turnVersions.map(turnToContent) : versions;
  const idx = Math.min(Math.max(index, 0), contentVersions.length - 1);
  if (idx === row.version_index) return;
  archiveTail(id, row.version_index);
  restoreTail(id, idx);
  const selectedTurn = turnVersions[idx];
  db.prepare("UPDATE messages SET version_index = ?, content = ?, turn_json = ? WHERE id = ?")
    .run(idx, contentVersions[idx], selectedTurn ? JSON.stringify(selectedTurn) : row.turn_json, id);
}

interface TailRow { id: string; role: string; content: string; versions: string; version_index: number; created_at: number; turn_json: string | null; turn_versions: string }

function getTail(sessionId: string, afterId: string): TailRow[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, role, content, versions, version_index, created_at, turn_json, turn_versions FROM messages WHERE session_id = ? AND rowid > (SELECT rowid FROM messages WHERE id = ?) ORDER BY rowid"
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
  const ins = db.prepare("INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at, versions, version_index, turn_json, turn_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of tail) ins.run(r.id, row.session_id, r.role, r.content, r.created_at, r.versions, r.version_index, r.turn_json, r.turn_versions);
  db.prepare("DELETE FROM branches WHERE message_id = ? AND version = ?").run(messageId, version);
}

export function deleteMessage(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
}
