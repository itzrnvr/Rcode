import { ipcMain } from "electron";
import * as providers from "../db/providers";

export function registerProviderHandlers(): void {
  ipcMain.handle("provider:list", () => providers.listProviders());
  ipcMain.handle("provider:get", (_e, id: string) => providers.getProvider(id));
  ipcMain.handle("provider:create", (_e, input: Parameters<typeof providers.createProvider>[0]) => providers.createProvider(input));
  ipcMain.handle("provider:update", (_e, id: string, updates: Parameters<typeof providers.updateProvider>[1]) => providers.updateProvider(id, updates));
  ipcMain.handle("provider:delete", (_e, id: string) => providers.deleteProvider(id));
  ipcMain.handle("provider:toggle", (_e, id: string) => providers.toggleProvider(id));
}
