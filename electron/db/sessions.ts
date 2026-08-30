/*
 * PURPOSE: Session repository — all SQL for sessions table
 *
 * KEY DECISIONS:
 * - Depth computed via recursive CTE (parent_id chain walk)
 * - Row-to-domain conversion isolates snake_case from the rest of the app
 * - SessionUpdate type constrains which fields can be patched
 *
 * CONSUMERS: ipc/sessions.ts, ipc/sideChats.ts, ipc/chat.ts
 */

import { randomUUID } from "crypto";
import { getDb } from "./index";

import type { Session, CreateSessionInput, TaskType, MessageRole } from "../../src/types";

interface SessionRow {
  id: string;
  parent_id: string | null;
  title: string;
  task_type: string;
  status: string;
  model: string;
  provider: string;
  custom_instructions: string | null;
  created_at: number;
  updated_at: number;
  sort_order: number;
  is_pinned: number;
  pinned_at: number;
  depth: number;
}

type SessionUpdate = Partial<Pick<Session, "title" | "status" | "customInstructions" | "model">>;

// camelCase → snake_case mapping for updateable fields
const COLUMN_MAP: Record<keyof SessionUpdate, string> = {
  title: "title",
  status: "status",
  customInstructions: "custom_instructions",
  model: "model",
};

const DEPTH_CTE = `
  WITH RECURSIVE depth_calc AS (
    SELECT id, parent_id, 0 as depth FROM sessions WHERE parent_id IS NULL
    UNION ALL
    SELECT s.id, s.parent_id, d.depth + 1
    FROM sessions s JOIN depth_calc d ON s.parent_id = d.id
  )
`;

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    taskType: row.task_type as TaskType,
    status: row.status as Session["status"],
    model: row.model,
    provider: row.provider,
    customInstructions: row.custom_instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    isPinned: row.is_pinned,
    pinnedAt: row.pinned_at,
    depth: row.depth,
  };
}

function computeDepth(sessionId: string): number {
  const db = getDb();
  const row = db.prepare(`${DEPTH_CTE} SELECT depth FROM depth_calc WHERE id = ?`).get(sessionId) as { depth: number } | undefined;
  return row?.depth ?? 0;
}

export function createSession(input: CreateSessionInput = {}): Session {
  const db = getDb();
  const id = randomUUID();
  const parentId = input.parentId ?? null;
  const taskType = input.taskType ?? "main";
  const now = Date.now();
  const sortOrder = now;

  db.prepare(`
    INSERT INTO sessions (id, parent_id, title, task_type, status, model, provider, custom_instructions, created_at, updated_at, sort_order, is_pinned, pinned_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(id, parentId, input.title ?? "New Chat", taskType, input.model ?? "", input.provider ?? "", input.customInstructions ?? null, now, now, sortOrder);

  const depth = parentId ? computeDepth(parentId) + 1 : 0;
  return { id, parentId, title: input.title ?? "New Chat", taskType, status: "active", model: input.model ?? "", provider: input.provider ?? "", customInstructions: input.customInstructions ?? null, createdAt: now, updatedAt: now, sortOrder, isPinned: 0, pinnedAt: 0, depth };
}

export function getSession(id: string): Session | null {
  const db = getDb();
  const row = db.prepare(`
    ${DEPTH_CTE}
    SELECT s.*, COALESCE(d.depth, 0) as depth
    FROM sessions s LEFT JOIN depth_calc d ON s.id = d.id
    WHERE s.id = ?
  `).get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function listMainSessions(): Session[] {
  const db = getDb();
  const rows = db.prepare(`
    ${DEPTH_CTE}
    SELECT s.*, COALESCE(d.depth, 0) as depth
    FROM sessions s LEFT JOIN depth_calc d ON s.id = d.id
    WHERE s.task_type = 'main' AND s.status = 'active'
    ORDER BY s.is_pinned DESC, s.pinned_at DESC, s.sort_order DESC, s.updated_at DESC
  `).all() as SessionRow[];
  return rows.map(rowToSession);
}

export function reorderSessions(orderedIds: string[]): void {
  const db = getDb();
  const tx = db.transaction((ids: string[]) => {
    const base = Date.now();
    for (let i = 0; i < ids.length; i++) {
      const order = base + (ids.length - i) * 1000;
      db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ?").run(order, ids[i]);
    }
  });
  tx(orderedIds);
}

export function pinSession(id: string): void {
  getDb().prepare("UPDATE sessions SET is_pinned = 1, pinned_at = ?, updated_at = ? WHERE id = ?").run(Date.now(), Date.now(), id);
}

export function unpinSession(id: string): void {
  getDb().prepare("UPDATE sessions SET is_pinned = 0, pinned_at = 0, updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function togglePinSession(id: string): number {
  const row = getDb().prepare("SELECT is_pinned FROM sessions WHERE id = ?").get(id) as { is_pinned: number } | undefined;
  if (!row) return 0;
  if (row.is_pinned) {
    unpinSession(id);
    return 0;
  } else {
    pinSession(id);
    return 1;
  }
}

export function updateSession(id: string, updates: SessionUpdate): void {
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const vals: (string | number)[] = [Date.now()];

  for (const [key, value] of Object.entries(updates)) {
    const column = COLUMN_MAP[key as keyof SessionUpdate];
    if (column) {
      sets.push(`${column} = ?`);
      vals.push(value as string | number);
    }
  }

  vals.push(id);
  db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// Fork a whole session up to (and including) a message into a new MAIN session
// that appears in the Recents list. Keeps parentId for lineage.
export function forkSession(sessionId: string, upToMessageId: string): Session {
  const db = getDb();
  const parent = getSession(sessionId);
  if (!parent) throw new Error("Session not found");
  const fork = createSession({
    parentId: sessionId,
    title: `${parent.title} (fork)`,
    taskType: "main",
    model: parent.model,
    provider: parent.provider,
  });
  const rows = db.prepare(
    "SELECT role, content, versions, version_index FROM messages WHERE session_id = ? AND rowid <= (SELECT rowid FROM messages WHERE id = ?) ORDER BY rowid"
  ).all(sessionId, upToMessageId) as Array<{ role: MessageRole; content: string; versions: string; version_index: number }>;
  const ins = db.prepare("INSERT INTO messages (session_id, role, content, versions, version_index, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of rows) ins.run(fork.id, r.role, r.content, r.versions, r.version_index, Date.now());
  return fork;
}
