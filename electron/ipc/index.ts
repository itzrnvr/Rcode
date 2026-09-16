/*
 * PURPOSE: IPC handler registration — single entry point called by electron/main.ts
 *
 * Each domain module registers its own registerApiHandler() calls.
 * This keeps main.ts clean and lets handlers be tested/added independently.
 */

import { registerApiHandler } from "../api/registry";

import { registerSessionHandlers } from "./sessions";
import { registerMessageHandlers } from "./messages";
import { registerSideChatHandlers } from "./sideChats";
import { registerSettingsHandlers } from "./settings";
import { registerChatHandler } from "./chat";
import { registerTerminalHandlers } from "./terminal";
import { registerProviderHandlers } from "./providers";
import { registerModelCatalogHandler } from "./modelCatalog";
import { registerFeedbackHandlers } from "./feedback";

import { registerGitHandlers } from "./git";
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
  registerApiHandler("trace:list", (_e, sessionId: string) => readTrace(sessionId));
  registerGitHandlers();
}
