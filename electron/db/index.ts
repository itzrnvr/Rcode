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

  // Seed default providers (mirrors DSH wandb + screenshot providers)
  try {
    const now = Date.now();
    const defaults: Array<[string, string, string, string, string, string, number, number]> = [
        ["zai", "Z.ai", "https://api.z.ai/api/paas/v4", "openai-completions", "", JSON.stringify([{id:"glm-4.5", vision:1, context:"128K"},{id:"glm-4.6", vision:1, context:"200K"}]), 1, 0],
        ["meta", "meta", "https://api.meta.ai/v1", "responses", "sk-...meta", JSON.stringify([{id:"muse-spark-1.2", vision:1, context:"1M"}]), 1, 1],
        ["minimax-proxy", "Minimax-Proxy", "http://127.0.0.1:3477/v1", "openai-completions", "", JSON.stringify([{id:"MiniMax-M3", vision:0, context:"128K"},{id:"MiniMax-M2.5", vision:0, context:"128K"}]), 1, 1],
        ["wandb-proxy", "Wandb-Proxy", "http://127.0.0.1:3478/v1", "openai-completions", "", JSON.stringify([{id:"deepseek-ai/DeepSeek-V4-Flash-0731", vision:1, context:"128K"},{id:"zai-org/GLM-5.2", vision:1, context:"128K"},{id:"meta-llama/Llama-3.1-8B-Instruct", vision:0, context:"128K"}]), 1, 1],
        ["firepass", "firepass", "https://api.firepass.ai/v1", "openai-completions", "", JSON.stringify([{id:"firepass-7b", vision:0, context:"32K"}]), 0, 1],
        ["dashscope", "dashscope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "openai-completions", "", JSON.stringify([{id:"qwen3-coder-480b", vision:0, context:"1M"}]), 1, 1],
        ["zai-coding", "zai-coding", "https://api.z.ai/api/coding/paas/v4", "openai-completions", "", JSON.stringify([{id:"glm-4.6-coding", vision:1, context:"200K"}]), 1, 1],
        ["baidu", "baidu", "https://qianfan.baidubce.com/v2", "openai-completions", "", JSON.stringify([{id:"ernie-4.5", vision:1, context:"128K"}]), 1, 1],
      ];
      const stmt = getDb().prepare("INSERT OR IGNORE INTO providers (id, name, base_url, api_format, api_key, model_list, enabled, is_custom, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of defaults) stmt.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], now);
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
