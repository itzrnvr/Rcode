/*
 * PURPOSE: one-shot importer for zcode-cli sessions + settings into Rcode.
 *
 * Reads ~/.zcode/cli/db/db.sqlite (read-only) and ~/.zcode/cli/config.json,
 * converts zcode message parts into Rcode's persisted turn format so the
 * existing parseTurn renders them:
 *   [worked:NNs] + [usage:in/out/cacheRead/0] header, <think> blocks for
 *   reasoning, [tool:name(args)]<toolresult>...</toolresult> for tools.
 *
 * Mapping:
 *   - interactive / fork sessions -> regular Rcode sessions (forks keep
 *     their zcode parent link when the parent is imported too)
 *   - selection_side_chat -> Rcode side chats (side_chat_tabs) under the
 *     imported parent
 *   - subagent_child -> skipped (background worker noise), counted
 * Idempotent: zcode_imports table remembers every migrated session id.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "crypto";

import { getDb } from "../db";
import { getProvider } from "../db/providers";
import { getSetting, setSetting } from "../db/settings";

const ZCODE_DB = join(homedir(), ".zcode", "cli", "db", "db.sqlite");
const ZCODE_CONFIG = join(homedir(), ".zcode", "cli", "config.json");

export interface ZcodeImportStatus {
  available: boolean;
  total: number;
  interactive: number;
  forks: number;
  sideChats: number;
  subagents: number;
  alreadyImported: number;
}

export interface ZcodeImportResult {
  sessions: number;
  sideChats: number;
  messages: number;
  skippedSubagents: number;
  settingsApplied: boolean;
}

function openZcodeDb(): Database.Database | null {
  if (!existsSync(ZCODE_DB)) return null;
  try {
    return new Database(ZCODE_DB, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function ensureImportTable(): void {
  getDb().prepare(
    "CREATE TABLE IF NOT EXISTS zcode_imports (zcode_session_id TEXT PRIMARY KEY, rcode_session_id TEXT NOT NULL)"
  ).run();
}

function importedMap(): Map<string, string> {
  ensureImportTable();
  const rows = getDb().prepare("SELECT zcode_session_id, rcode_session_id FROM zcode_imports").all() as Array<{
    zcode_session_id: string;
    rcode_session_id: string;
  }>;
  return new Map(rows.map(r => [r.zcode_session_id, r.rcode_session_id]));
}

// --- part conversion -------------------------------------------------------

interface ZPart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: unknown; output?: unknown };
  reason?: string;
  time?: { start?: number; end?: number };
  tokens?: { input?: number; output?: number; cache?: { read?: number } };
}

function toolOutputText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function convertAssistantParts(parts: Array<{ data: string }>): { content: string; secs: number } {
  const blocks: string[] = [];
  let usage: { input: number; output: number; cacheRead: number } | null = null;
  let start = 0;
  let end = 0;
  for (const row of parts) {
    let p: ZPart;
    try {
      p = JSON.parse(row.data) as ZPart;
    } catch {
      continue;
    }
    if (p.type === "reasoning" && p.text) {
      blocks.push("<think>\n" + p.text + "\n</think>");
      if (!start && p.time?.start) start = p.time.start;
    } else if (p.type === "text" && typeof p.text === "string") {
      blocks.push(p.text);
    } else if (p.type === "tool") {
      const name = p.tool ?? "tool";
      const input = p.state?.input !== undefined ? JSON.stringify(p.state.input) : "{}";
      blocks.push("[tool:" + name + "(" + input + ")]\n<toolresult>\n" + toolOutputText(p.state?.output) + "\n</toolresult>");
    } else if (p.type === "step-start") {
      const t = p.time?.start;
      if (t && (!start || t < start)) start = t;
    } else if (p.type === "step-finish") {
      const t = p.tokens;
      if (t) usage = { input: t.input ?? 0, output: t.output ?? 0, cacheRead: t.cache?.read ?? 0 };
      const te = p.time?.end;
      if (te && te > end) end = te;
    }
  }
  const secs = start && end && end > start ? Math.max(0, Math.round((end - start) / 1000)) : 0;
  const header: string[] = [];
  if (secs > 0 || blocks.some(b => b.startsWith("[tool:"))) header.push("[worked:" + secs + "s]");
  if (usage) header.push("[usage:" + usage.input + "/" + usage.output + "/" + usage.cacheRead + "/0]");
  return { content: (header.length ? header.join("\n\n") + "\n\n" : "") + blocks.join("\n\n"), secs };
}

function convertUserParts(parts: Array<{ data: string }>): string {
  const texts: string[] = [];
  for (const row of parts) {
    try {
      const p = JSON.parse(row.data) as ZPart;
      if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
    } catch {
      /* skip malformed part */
    }
  }
  return texts.join("\n\n");
}

// --- import -----------------------------------------------------------------

export function getZcodeImportStatus(): ZcodeImportStatus {
  const none: ZcodeImportStatus = {
    available: false, total: 0, interactive: 0, forks: 0, sideChats: 0, subagents: 0, alreadyImported: 0,
  };
  const zdb = openZcodeDb();
  if (!zdb) return none;
  try {
    const counts = zdb.prepare("SELECT task_type, COUNT(*) c FROM session GROUP BY task_type").all() as Array<{
      task_type: string;
      c: number;
    }>;
    const byType = new Map(counts.map(r => [r.task_type, r.c]));
    const total = counts.reduce((a, r) => a + r.c, 0);
    const known = importedMap();
    const ids = zdb.prepare("SELECT id FROM session").all() as Array<{ id: string }>;
    let already = 0;
    for (const r of ids) if (known.has(r.id)) already++;
    return {
      available: total > 0,
      total,
      interactive: byType.get("interactive") ?? 0,
      forks: byType.get("fork") ?? 0,
      sideChats: byType.get("selection_side_chat") ?? 0,
      subagents: byType.get("subagent_child") ?? 0,
      alreadyImported: already,
    };
  } finally {
    zdb.close();
  }
}

export function runZcodeImport(): ZcodeImportResult {
  const zdb = openZcodeDb();
  if (!zdb) throw new Error("zcode database not found: " + ZCODE_DB);
  try {
    const known = importedMap();
    const db = getDb();
    ensureImportTable();

    const sessions = zdb
      .prepare("SELECT * FROM session ORDER BY time_created ASC")
      .all() as Array<{ id: string; parent_id: string | null; title: string | null; task_type: string; time_created: number; time_updated: number }>;

    const msgStmt = zdb.prepare("SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC");
    const partStmt = zdb.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY sequence ASC, time_created ASC");

    const insSession = db.prepare(
      "INSERT INTO sessions (id, parent_id, title, task_type, status, model, provider, custom_instructions, created_at, updated_at, sort_order, is_pinned, pinned_at) VALUES (?, ?, ?, ?, 'active', '', '', NULL, ?, ?, ?, 0, 0)"
    );
    const insMessage = db.prepare(
      "INSERT INTO messages (id, session_id, role, content, created_at, versions, version_index) VALUES (?, ?, ?, ?, ?, '[]', 0)"
    );
    const insImport = db.prepare("INSERT OR IGNORE INTO zcode_imports (zcode_session_id, rcode_session_id) VALUES (?, ?)");
    const insTab = db.prepare(
      "INSERT INTO side_chat_tabs (id, parent_session_id, side_chat_id, tab_order, is_closed, created_at) VALUES (?, ?, ?, ?, 0, ?)"
    );

    const result: ZcodeImportResult = { sessions: 0, sideChats: 0, messages: 0, skippedSubagents: 0, settingsApplied: false };

    const importOne = (zs: (typeof sessions)[number]): string => {
      const existing = known.get(zs.id);
      if (existing) return existing;
      const rid = randomUUID();
      const isSideChat = zs.task_type === "selection_side_chat";
      const parentId = zs.parent_id ? known.get(zs.parent_id) ?? null : null;
      insSession.run(
        rid,
        isSideChat ? parentId : null,
        zs.title || "Imported from ZCode",
        isSideChat ? "side_chat" : "main",
        zs.time_created,
        zs.time_updated || zs.time_created,
        zs.time_updated || zs.time_created
      );
      known.set(zs.id, rid);
      insImport.run(zs.id, rid);

      const msgs = msgStmt.all(zs.id) as Array<{ id: string; data: string; time_created: number }>;
      for (const zm of msgs) {
        let meta: { role?: string };
        try {
          meta = JSON.parse(zm.data) as { role?: string };
        } catch {
          continue;
        }
        const role = meta.role === "user" ? "user" : meta.role === "assistant" ? "assistant" : null;
        if (!role) continue;
        const parts = partStmt.all(zm.id) as Array<{ data: string }>;
        const content = role === "user" ? convertUserParts(parts) : convertAssistantParts(parts).content;
        if (!content.trim()) continue;
        insMessage.run(randomUUID(), rid, role, content, zm.time_created);
        result.messages++;
      }

      if (isSideChat && parentId) {
        const countRow = db.prepare("SELECT COUNT(*) c FROM side_chat_tabs WHERE parent_session_id = ?").get(parentId) as { c: number };
        insTab.run(randomUUID(), parentId, rid, countRow.c, zs.time_created);
        result.sideChats++;
      } else {
        result.sessions++;
      }
      return rid;
    };

    // parents before children: mains/forks first, then side chats.
    for (const zs of sessions) {
      if (zs.task_type === "subagent_child") {
        result.skippedSubagents++;
        continue;
      }
      if (zs.task_type !== "selection_side_chat") importOne(zs);
    }
    for (const zs of sessions) {
      if (zs.task_type === "selection_side_chat") importOne(zs);
    }

    result.settingsApplied = importZcodeSettings();
    return result;
  } finally {
    zdb.close();
  }
}

// --- settings ----------------------------------------------------------------

export function importZcodeSettings(): boolean {
  if (!existsSync(ZCODE_CONFIG)) return false;
  try {
    const cfg = JSON.parse(readFileSync(ZCODE_CONFIG, "utf8")) as {
      model?: { main?: string };
      permission?: { mode?: string };
    };
    let applied = false;
    const main = cfg.model?.main;
    if (main && main.includes("/")) {
      // zcode model refs look like "provider/model-id" (model id may contain "/").
      const slash = main.indexOf("/");
      const providerId = main.slice(0, slash);
      const modelId = main.slice(slash + 1);
      if (getProvider(providerId)) {
        setSetting("providerName", providerId);
        setSetting("model", modelId);
        applied = true;
      }
    }
    return applied;
  } catch {
    return false;
  }
}

export function registerZcodeImportHandlers(): void {
  ipcMain.handle("zcode:importStatus", (_e: IpcMainInvokeEvent) => getZcodeImportStatus());
  ipcMain.handle("zcode:import", (_e: IpcMainInvokeEvent) => runZcodeImport());
}
