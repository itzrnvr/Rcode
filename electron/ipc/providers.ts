
import * as providers from "../db/providers";
import { registerApiHandler } from "../api/registry";

export function registerProviderHandlers(): void {
  registerApiHandler("provider:list", () => providers.listProviders());
  registerApiHandler("provider:get", (_e, id: string) => providers.getProvider(id));
  registerApiHandler("provider:create", (_e, input: Parameters<typeof providers.createProvider>[0]) => providers.createProvider(input));
  registerApiHandler("provider:update", (_e, id: string, updates: Parameters<typeof providers.updateProvider>[1]) => providers.updateProvider(id, updates));
  registerApiHandler("provider:delete", (_e, id: string) => providers.deleteProvider(id));
  registerApiHandler("provider:toggle", (_e, id: string) => providers.toggleProvider(id));
}
