/*
 * PURPOSE: SQLite connection management, schema definition, and migrations
 *
 * KEY DECISIONS:
 * - Getter pattern: initDb() creates connection, getDb() retrieves it
 * - WAL mode for concurrent reads from multiple IPC handlers
 * - Schema version table for future migration support
 * - Default settings seeded on first run
 *
 * DEPENDENCIES: better-sqlite3, electron (app path)
 * CONSUMERS: all db/*.ts repository modules
 */

import Database from "better-sqlite3";
import type { Database as DBType } from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { app } from "electron";

import { DEFAULT_SETTINGS, DEFAULT_THEME } from "../../src/types";

let instance: DBType | null = null;

export function getDb(): DBType {
  if (!instance) throw new Error("Database not initialized — call initDb() first");
  return instance;
}

export function initDb(): void {
  const dataDir = join(app.getPath("userData"), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  instance = new Database(join(dataDir, "rcode.db"));
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  createSchema();
  seedDefaults();
}

function createSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      task_type TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'active',
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      custom_instructions TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS side_chat_tabs (
      id TEXT PRIMARY KEY,
      parent_session_id TEXT NOT NULL,
      side_chat_id TEXT NOT NULL,
      tab_order INTEGER NOT NULL DEFAULT 0,
      is_closed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (side_chat_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(task_type);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_tabs_parent ON side_chat_tabs(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_tabs_sidechat ON side_chat_tabs(side_chat_id);

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      api_format TEXT NOT NULL DEFAULT 'openai-completions',
      api_key TEXT NOT NULL DEFAULT '',
      model_list TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_custom INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
  `);

  // Migration: add sort_order for drag-to-reorder persistence (advisory blocker)
  try {
    const cols = getDb().prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!cols.some(c => c.name === "sort_order")) {
      getDb().exec("ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
      getDb().exec("UPDATE sessions SET sort_order = updated_at WHERE sort_order = 0");
      getDb().exec("CREATE INDEX IF NOT EXISTS idx_sessions_sort ON sessions(sort_order)");
    }
  } catch {}

  // Migration: add is_pinned + pinned_at for multiple pinned sessions (ws)
  try {
    const cols2 = getDb().prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!cols2.some(c => c.name === "is_pinned")) {
      getDb().exec("ALTER TABLE sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0");
      getDb().exec("ALTER TABLE sessions ADD COLUMN pinned_at INTEGER NOT NULL DEFAULT 0");
      getDb().exec("CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(is_pinned)");
    }
  } catch {}

  // Migration: response versions for retry / edit-resend (versions JSON + active index)
  try {
    const cols3 = getDb().prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!cols3.some(c => c.name === "versions")) {
      getDb().exec("ALTER TABLE messages ADD COLUMN versions TEXT NOT NULL DEFAULT '[]'");
      getDb().exec("ALTER TABLE messages ADD COLUMN version_index INTEGER NOT NULL DEFAULT 0");
    }
  } catch {}

  // Seed providers from the live wandb proxy fleet (3478) only, for now.
  // Old models (glm-4*, llama*, gpt-oss*) are excluded per user request.
  try {
    const now = Date.now();
    const ml = "[{\"id\":\"zai-org/GLM-5.2\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"zai-org/GLM-5.1\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"deepseek-ai/DeepSeek-V4-Flash-0731\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"deepseek-ai/DeepSeek-V4-Flash\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"deepseek-ai/DeepSeek-V4-Pro\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"deepseek-ai/DeepSeek-V4-Pro-0813\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"deepseek-ai/DeepSeek-V3.1\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"moonshotai/Kimi-K2.7-Code\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"moonshotai/Kimi-K2.6\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3.8-27B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3.6-27B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3.6-35B-A3B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3.5-35B-A3B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3-Coder-480B-A35B-Instruct\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3-235B-A22B-Instruct-2507\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"Qwen/Qwen3-30B-A3B-Instruct-2507\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"OpenPipe/Qwen3-14B-Instruct\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"MiniMaxAI/MiniMax-M3\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"google/gemma-4-31B-it\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"JetBrains/Mellum2-12B-A2.5B-Instruct\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"ibm-granite/granite-4.2-8b\",\"vision\":0,\"context\":\"128K\"},{\"id\":\"ibm-granite/granite-4.1-8b\",\"vision\":0,\"context\":\"128K\"}]";
    getDb().prepare("DELETE FROM providers WHERE id != 'wandb'").run();
    getDb().prepare("INSERT OR REPLACE INTO providers (id, name, base_url, api_format, api_key, model_list, enabled, is_custom, created_at) VALUES ('wandb', 'Wandb-Proxy', 'http://127.0.0.1:3478/v1', 'openai-completions', '', ?, 1, 0, ?)").run(ml, now);
    // Point defaults at a configured model if current selection is not in the list
    const cur = getDb().prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    const list: string[] = (JSON.parse(ml) as Array<{id:string}>).map(m => m.id);
    if (!cur || !list.includes(cur.value)) {
      getDb().prepare("INSERT INTO settings (key, value) VALUES ('model', 'deepseek-ai/DeepSeek-V4-Flash-0731') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      getDb().prepare("INSERT INTO settings (key, value) VALUES ('providerName', 'wandb') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    } else {
      getDb().prepare("INSERT INTO settings (key, value) VALUES ('providerName', 'wandb') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
  } catch (e) {
    console.error("provider seed failed", e);
  }

  const versionRow = db.prepare("SELECT COUNT(*) as c FROM schema_version").get() as { c: number };
  if (versionRow.c === 0) {
    db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
  }
}

function seedDefaults(): void {
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) as c FROM settings").get() as { c: number };
  if (existing.c > 0) return;

  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  stmt.run("apiBase", DEFAULT_SETTINGS.apiBase);
  stmt.run("apiKey", DEFAULT_SETTINGS.apiKey);
  stmt.run("model", DEFAULT_SETTINGS.model);
  stmt.run("providerName", DEFAULT_SETTINGS.providerName);
  stmt.run("globalInstructions", DEFAULT_SETTINGS.globalInstructions);
  stmt.run("theme", JSON.stringify(DEFAULT_THEME));
}
