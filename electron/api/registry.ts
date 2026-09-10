/*
 * Shared IPC/API registry.
 *
 * Electron IPC and the browser web bridge use the same handlers. This avoids
 * maintaining two backend implementations.
 */

export interface ApiEventSender {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface ApiEvent {
  sender: ApiEventSender;
}

type ApiHandler = (event: any, ...args: any[]) => unknown;
type IpcEventSink = (channel: string, args: unknown[]) => void;

const handlers = new Map<string, ApiHandler>();
const eventSinks = new Set<IpcEventSink>();

import { ipcMain } from "electron";

export function registerApiHandler(channel: string, handler: ApiHandler): void {
  if (handlers.has(channel)) {
    throw new Error(`API handler already registered: ${channel}`);
  }
  handlers.set(channel, handler);
  ipcMain.handle(channel, (event, ...args) => handler(event, ...args));
}

export function getApiHandler(channel: string): ApiHandler | undefined {
  return handlers.get(channel);
}

export function listApiHandlers(): string[] {
  return [...handlers.keys()].sort();
}

export async function invokeApiHandler(
  channel: string,
  args: unknown[],
  event: ApiEvent,
): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Unknown API handler: ${channel}`);
  return await handler(event, ...args);
}

export function emitApiEvent(channel: string, ...args: unknown[]): void {
  const values = [...args];
  for (const sink of eventSinks) {
    try {
      sink(channel, values);
    } catch {
      // A disconnected browser sink is removed by its request handler.
    }
  }
}

export function onApiEvent(sink: IpcEventSink): () => void {
  eventSinks.add(sink);
  return () => eventSinks.delete(sink);
}
