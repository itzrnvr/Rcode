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

export function registerAllHandlers(): void {
  registerSessionHandlers();
  registerMessageHandlers();
  registerSideChatHandlers();
  registerSettingsHandlers();
  registerChatHandler();
  registerTerminalHandlers();
}
