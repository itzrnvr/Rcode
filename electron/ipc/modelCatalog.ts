import { ipcMain } from "electron";
import { getDb } from "../db";
import { DEFAULT_SETTINGS } from "../../src/types";

interface ModelCatalogEntry { id: string; object: string; created: number; owned_by: string; }
interface ModelCatalog { object: string; data: ModelCatalogEntry[]; }

export function registerModelCatalogHandler(): void {
  ipcMain.handle("model:catalog", async () => {
    let apiBase = DEFAULT_SETTINGS.apiBase;
    try {
      const row = getDb().prepare("SELECT value FROM settings WHERE key = 'apiBase'").get() as { value: string } | undefined;
      if (row?.value) apiBase = row.value;
    } catch {}
    const url = apiBase.replace(/\/$/, "") + "/models";
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ModelCatalog;
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { object: "list", data: [], error: msg } as unknown as ModelCatalog;
    }
  });
}
