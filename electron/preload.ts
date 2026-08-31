/*
 * PURPOSE: Preload script — typed context bridge between Electron main and React renderer
 *
 * Exposes a single `electron` object on window with typed IPC methods.
 * The renderer imports the ElectronAPI type for type-safe access.
 *
 * ARCHITECTURE: All Node/Electron APIs are wrapped here. The renderer never
 * touches ipcRenderer directly — it goes through this typed API surface.
 */

import type { Provider } from "./db/providers";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  Session, Message, SideChatTab, Settings, Theme, ChatChunk, ChatRequest,
  CreateSessionInput, CreateSideChatInput,
} from "../src/types";

const electronAPI = {
  // --- Sessions ---
  createSession: (input?: CreateSessionInput): Promise<Session> =>
    ipcRenderer.invoke("session:create", input),
  getSession: (id: string): Promise<Session | null> =>
    ipcRenderer.invoke("session:get", id),
  listMainSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke("session:listMain"),
  updateSession: (id: string, updates: Partial<Pick<Session, "title" | "status" | "customInstructions" | "model">>): Promise<void> =>
    ipcRenderer.invoke("session:update", id, updates),
  deleteSession: (id: string): Promise<void> =>
    ipcRenderer.invoke("session:delete", id),
  reorderSessions: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke("session:reorder", orderedIds),
  pinSession: (id: string): Promise<void> =>
    ipcRenderer.invoke("session:pin", id),
  unpinSession: (id: string): Promise<void> =>
    ipcRenderer.invoke("session:unpin", id),
  togglePinSession: (id: string): Promise<number> =>
    ipcRenderer.invoke("session:togglePin", id),

  // --- Messages ---
  addMessage: (sessionId: string, role: Message["role"], content: string): Promise<Message> =>
    ipcRenderer.invoke("message:add", sessionId, role, content),
  getMessages: (sessionId: string): Promise<Message[]> =>
    ipcRenderer.invoke("message:list", sessionId),
  updateMessage: (id: string, content: string): Promise<void> =>
    ipcRenderer.invoke("message:update", id, content),
  setMessageVersion: (id: string, index: number): Promise<void> =>
    ipcRenderer.invoke("message:setVersion", id, index),
  deleteMessage: (id: string): Promise<void> =>
    ipcRenderer.invoke("message:delete", id),

  // --- Side Chats ---
  createSideChat: (input: CreateSideChatInput): Promise<{ session: Session; tab: SideChatTab }> =>
    ipcRenderer.invoke("sidechat:create", input),
  getSideChatTabs: (parentSessionId: string, includeClosed?: boolean): Promise<SideChatTab[]> =>
    ipcRenderer.invoke("sidechat:tabs", parentSessionId, includeClosed),
  getClosedSideChats: (parentSessionId: string): Promise<SideChatTab[]> =>
    ipcRenderer.invoke("sidechat:closed", parentSessionId),
  closeSideChatTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke("sidechat:close", tabId),
  reopenSideChatTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke("sidechat:reopen", tabId),
  promoteSideChat: (sideChatId: string): Promise<void> =>
    ipcRenderer.invoke("sidechat:promote", sideChatId),
  reorderSideChatTabs: (parentSessionId: string, tabIds: string[]): Promise<void> =>
    ipcRenderer.invoke("sidechat:reorder", parentSessionId, tabIds),

  // --- Settings ---
  getSettings: (): Promise<Settings> =>
    ipcRenderer.invoke("settings:get"),
  getSetting: (key: string): Promise<string | null> =>
    ipcRenderer.invoke("settings:getOne", key),
  setSetting: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke("settings:set", key, value),
  setTheme: (theme: Theme): Promise<void> =>
    ipcRenderer.invoke("settings:setTheme", theme),

  // --- Chat Streaming ---
  sendChat: (request: ChatRequest): Promise<void> =>
    ipcRenderer.invoke("chat:send", request),
  resendChat: (request: { sessionId: string; anchorUserMessageId: string; model?: string }): Promise<void> =>
    ipcRenderer.invoke("chat:resend", request),
  approvalResponse: (approvalId: string, ok: boolean): Promise<void> =>
    ipcRenderer.invoke("chat:approvalResponse", approvalId, ok),
  traceList: (sessionId: string): Promise<unknown[]> =>
    ipcRenderer.invoke("trace:list", sessionId),
  forkSession: (sessionId: string, upToMessageId: string): Promise<import("../src/types").Session> =>
    ipcRenderer.invoke("session:fork", sessionId, upToMessageId),
  contextInfo: (sessionId: string): Promise<{ system: number; tools: number; messages: number; cacheRate: number | null }> =>
    ipcRenderer.invoke("chat:contextInfo", sessionId),
  compactChat: (sessionId: string): Promise<{ summary: string }> =>
    ipcRenderer.invoke("chat:compact", sessionId),
  queueMessage: (sessionId: string, text: string): Promise<{ queued: number }> =>
    ipcRenderer.invoke("chat:queue", sessionId, text),
  onChatChunk: (sessionId: string, callback: (chunk: ChatChunk) => void): (() => void) => {
    const channel = `chat:chunk:${sessionId}`;
    const handler = (_e: IpcRendererEvent, chunk: ChatChunk) => callback(chunk);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // --- Terminal ---
  createTerminal: (id: string, cwd?: string): Promise<void> =>
    ipcRenderer.invoke("terminal:create", id, cwd),
  sendTerminalInput: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke("terminal:input", id, data),
  closeTerminal: (id: string): Promise<void> =>
    ipcRenderer.invoke("terminal:close", id),
  onTerminalData: (id: string, callback: (data: string) => void): (() => void) => {
    const channel = `terminal:data:${id}`;
    const handler = (_e: IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  sendTerminalResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("terminal:resize", id, cols, rows),

  // --- Model Catalog (live) ---
  modelCatalog: (): Promise<{ object: string; data: Array<{ id: string; object: string; created: number; owned_by: string }> }> =>
    ipcRenderer.invoke("model:catalog"),

  // --- Providers ---
  listProviders: (): Promise<Provider[]> =>
    ipcRenderer.invoke("provider:list"),
  getProvider: (id: string): Promise<Provider | null> =>
    ipcRenderer.invoke("provider:get", id),
  createProvider: (input: { name: string; baseUrl?: string; apiFormat?: string; apiKey?: string; modelList?: Provider["modelList"]; enabled?: number; isCustom?: number }): Promise<Provider> =>
    ipcRenderer.invoke("provider:create", input),
  updateProvider: (id: string, updates: Partial<Provider>): Promise<void> =>
    ipcRenderer.invoke("provider:update", id, updates),
  deleteProvider: (id: string): Promise<void> =>
    ipcRenderer.invoke("provider:delete", id),
  toggleProvider: (id: string): Promise<number> =>
    ipcRenderer.invoke("provider:toggle", id),

  // --- Platform ---
  platform: process.platform,

  // --- Window Controls ---
  windowMinimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("window:close"),
  zoomIn: (): Promise<void> => ipcRenderer.invoke("window:zoomIn"),
  zoomOut: (): Promise<void> => ipcRenderer.invoke("window:zoomOut"),
  zoomReset: (): Promise<void> => ipcRenderer.invoke("window:zoomReset"),

  // --- Debug ---
  debugScreenshot: (path: string): Promise<boolean> =>
    ipcRenderer.invoke("debug:screenshot", path),

  // --- Feedback / annotate mode ---
  captureForFeedback: (): Promise<{ dataUrl: string; width: number; height: number }> =>
    ipcRenderer.invoke("feedback:capture"),
  saveFeedback: (payload: { dataUrl: string; note: string }): Promise<{ pngPath: string; txtPath: string; latestPath: string }> =>
    ipcRenderer.invoke("feedback:save", payload),
};

contextBridge.exposeInMainWorld("electron", electronAPI);

export type ElectronAPI = typeof electronAPI;
