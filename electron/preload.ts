/*
 * PURPOSE: Preload script — typed context bridge between Electron main and React renderer
 *
 * Exposes a single `electron` object on window with typed IPC methods.
 * The renderer imports the ElectronAPI type for type-safe access.
 *
 * ARCHITECTURE: All Node/Electron APIs are wrapped here. The renderer never
 * touches ipcRenderer directly — it goes through this typed API surface.
 */

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

  // --- Messages ---
  addMessage: (sessionId: string, role: Message["role"], content: string): Promise<Message> =>
    ipcRenderer.invoke("message:add", sessionId, role, content),
  getMessages: (sessionId: string): Promise<Message[]> =>
    ipcRenderer.invoke("message:list", sessionId),
  updateMessage: (id: string, content: string): Promise<void> =>
    ipcRenderer.invoke("message:update", id, content),
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
  onChatChunk: (sessionId: string, callback: (chunk: ChatChunk) => void): (() => void) => {
    const channel = `chat:chunk:${sessionId}`;
    const handler = (_e: IpcRendererEvent, chunk: ChatChunk) => callback(chunk);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // --- Platform ---
  platform: process.platform,

  // --- Window Controls ---
  windowMinimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("window:close"),

  // --- Debug ---
  debugScreenshot: (path: string): Promise<boolean> =>
    ipcRenderer.invoke("debug:screenshot", path),
};

contextBridge.exposeInMainWorld("electron", electronAPI);

export type ElectronAPI = typeof electronAPI;
