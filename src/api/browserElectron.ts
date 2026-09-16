import type { ElectronAPI } from "../../electron/preload";

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`/api/ipc/${encodeURIComponent(channel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const payload = await res.json() as { ok?: boolean; result?: T; error?: string };
  if (!res.ok || !payload.ok) throw new Error(payload.error || `API request failed (${res.status})`);
  return payload.result as T;
}

function onEvent<T>(channel: string, callback: (value: T) => void): () => void {
  const source = new EventSource(`/api/events?channel=${encodeURIComponent(channel)}`);
  source.addEventListener("ipc", event => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as { args: unknown[] };
      callback(payload.args[0] as T);
    } catch {
      // Ignore malformed browser bridge events.
    }
  });
  return () => source.close();
}

export const browserElectronAPI: ElectronAPI = {
  createSession: input => invoke("session:create", input),
  getSession: id => invoke("session:get", id),
  listMainSessions: () => invoke("session:listMain"),
  updateSession: (id, updates) => invoke("session:update", id, updates),
  deleteSession: id => invoke("session:delete", id),
  reorderSessions: ids => invoke("session:reorder", ids),
  pinSession: id => invoke("session:pin", id),
  unpinSession: id => invoke("session:unpin", id),
  togglePinSession: id => invoke("session:togglePin", id),

  addMessage: (sessionId, role, content) => invoke("message:add", sessionId, role, content),
  getMessages: sessionId => invoke("message:list", sessionId),
  updateMessage: (id, content) => invoke("message:update", id, content),
  setMessageVersion: (id, index) => invoke("message:setVersion", id, index),
  deleteMessage: id => invoke("message:delete", id),

  createSideChat: input => invoke("sidechat:create", input),
  getSideChatTabs: (parentSessionId, includeClosed) => invoke("sidechat:tabs", parentSessionId, includeClosed),
  getClosedSideChats: parentSessionId => invoke("sidechat:closed", parentSessionId),
  closeSideChatTab: tabId => invoke("sidechat:close", tabId),
  reopenSideChatTab: tabId => invoke("sidechat:reopen", tabId),
  promoteSideChat: sideChatId => invoke("sidechat:promote", sideChatId),
  reorderSideChatTabs: tabIds => invoke("sidechat:reorder", tabIds),

  getSettings: () => invoke("settings:get"),
  getSetting: key => invoke("settings:getOne", key),
  setSetting: (key, value) => invoke("settings:set", key, value),
  setTheme: theme => invoke("settings:setTheme", theme),

  sendChat: request => invoke("chat:send", request),
  resendChat: request => invoke("chat:resend", request),
  traceList: sessionId => invoke("trace:list", sessionId),
  forkSession: (sessionId, upToMessageId) => invoke("session:fork", sessionId, upToMessageId),
  contextInfo: sessionId => invoke("chat:contextInfo", sessionId),
  compactChat: sessionId => invoke("chat:compact", sessionId),
  onChatChunk: (sessionId, callback) => onEvent(`chat:chunk:${sessionId}`, callback),

  createTerminal: (id, cwd) => invoke("terminal:create", id, cwd),
  sendTerminalInput: (id, data) => invoke("terminal:input", id, data),
  closeTerminal: id => invoke("terminal:close", id),
  onTerminalData: (id, callback) => onEvent(`terminal:data:${id}`, callback),
  sendTerminalResize: (id, cols, rows) => invoke("terminal:resize", id, cols, rows),

  modelCatalog: () => invoke("model:catalog"),

  listProviders: () => invoke("provider:list"),
  getProvider: id => invoke("provider:get", id),
  createProvider: input => invoke("provider:create", input),
  updateProvider: (id, updates) => invoke("provider:update", id, updates),
  deleteProvider: id => invoke("provider:delete", id),
  toggleProvider: id => invoke("provider:toggle", id),

  platform: "web" as ElectronAPI["platform"],

  windowMinimize: async () => {},
  windowMaximize: async () => {},
  windowClose: async () => {},
  zoomIn: () => invoke("window:zoomIn"),
  zoomOut: () => invoke("window:zoomOut"),
  zoomReset: () => invoke("window:zoomReset"),
  gitStatus: () => invoke("git:status"),
  gitBranches: () => invoke("git:branches"),
  gitCheckout: branch => invoke("git:checkout", branch),
  gitCommit: message => invoke("git:commit", message),
  gitPush: () => invoke("git:push"),
  gitCwdName: () => invoke("git:cwdName"),

  debugScreenshot: path => invoke("debug:screenshot", path),
  captureForFeedback: async () => {
    throw new Error("Screenshot capture is only available in the desktop app.");
  },
  saveFeedback: payload => invoke("feedback:save", payload),
};
