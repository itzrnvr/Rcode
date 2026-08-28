import { randomUUID } from "crypto";
import { getDb } from "./index";

export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api_format: string;
  api_key: string;
  model_list: string;
  enabled: number;
  is_custom: number;
  created_at: number;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  modelList: Array<{ id: string; vision?: number; context?: string }>;
  enabled: number;
  isCustom: number;
  createdAt: number;
}

function rowToProvider(r: ProviderRow): Provider {
  let list: Provider["modelList"] = [];
  try { list = JSON.parse(r.model_list); } catch {}
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    apiFormat: r.api_format,
    apiKey: r.api_key,
    modelList: list,
    enabled: r.enabled,
    isCustom: r.is_custom,
    createdAt: r.created_at,
  };
}

export function listProviders(): Provider[] {
  const rows = getDb().prepare("SELECT * FROM providers ORDER BY is_custom ASC, name ASC").all() as ProviderRow[];
  return rows.map(rowToProvider);
}

export function getProvider(id: string): Provider | null {
  const row = getDb().prepare("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | undefined;
  return row ? rowToProvider(row) : null;
}

export function createProvider(input: Partial<Provider> & { name: string }): Provider {
  const id = input.id || input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const now = Date.now();
  const p: Provider = {
    id,
    name: input.name,
    baseUrl: input.baseUrl || "",
    apiFormat: input.apiFormat || "openai-completions",
    apiKey: input.apiKey || "",
    modelList: input.modelList || [],
    enabled: input.enabled ?? 1,
    isCustom: input.isCustom ?? 1,
    createdAt: now,
  };
  getDb().prepare(
    "INSERT INTO providers (id, name, base_url, api_format, api_key, model_list, enabled, is_custom, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(p.id, p.name, p.baseUrl, p.apiFormat, p.apiKey, JSON.stringify(p.modelList), p.enabled, p.isCustom, p.createdAt);
  return p;
}

export function updateProvider(id: string, updates: Partial<Provider>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
  if (updates.baseUrl !== undefined) { sets.push("base_url = ?"); vals.push(updates.baseUrl); }
  if (updates.apiFormat !== undefined) { sets.push("api_format = ?"); vals.push(updates.apiFormat); }
  if (updates.apiKey !== undefined) { sets.push("api_key = ?"); vals.push(updates.apiKey); }
  if (updates.modelList !== undefined) { sets.push("model_list = ?"); vals.push(JSON.stringify(updates.modelList)); }
  if (updates.enabled !== undefined) { sets.push("enabled = ?"); vals.push(updates.enabled); }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`).run(...vals as string[]);
}

export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function toggleProvider(id: string): number {
  const row = getDb().prepare("SELECT enabled FROM providers WHERE id = ?").get(id) as { enabled: number } | undefined;
  if (!row) return 0;
  const next = row.enabled ? 0 : 1;
  getDb().prepare("UPDATE providers SET enabled = ? WHERE id = ?").run(next, id);
  return next;
}
