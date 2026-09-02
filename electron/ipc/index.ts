/*
 * PURPOSE: IPC handler registration — single entry point called by electron/main.ts
 *
 * Each domain module registers its own ipcMain.handle() calls.
 * This keeps main.ts clean and lets handlers be tested/added independently.
 */

import { registerSessionHandlers } from "./sessions";
import { registerMessageHandlers } from "./messages";
import { registerSideChatHandlers } from "./sideChats";
import { registerSettingsHandlers } from "./settings";
import { registerChatHandler } from "./chat";
import { registerTerminalHandlers } from "./terminal";
import { registerProviderHandlers } from "./providers";
import { registerModelCatalogHandler } from "./modelCatalog";
import { registerFeedbackHandlers } from "./feedback";
import { ipcMain } from "electron";
import { registerGitHandlers } from "./git";
import { registerZcodeImportHandlers } from "./zcodeImport";
import { readTrace } from "../agent/trace";

export function registerAllHandlers(): void {
  registerSessionHandlers();
  registerMessageHandlers();
  registerSideChatHandlers();
  registerSettingsHandlers();
  registerChatHandler();
  registerTerminalHandlers();
  registerProviderHandlers();
  registerModelCatalogHandler();
  registerFeedbackHandlers();
  ipcMain.handle("trace:list", (_e, sessionId: string) => readTrace(sessionId));
  registerGitHandlers();
  registerZcodeImportHandlers();
}
