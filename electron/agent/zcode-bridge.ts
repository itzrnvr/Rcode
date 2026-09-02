/*
 * PURPOSE: zcode-cli as Rcode's agent engine (the "core").
 *
 * Spawns `node D:/zcode-cli/core/zcode.cjs app-server` — the ZCode Protocol
 * stdio server (same engine the ZCode desktop runs) — and drives it:
 *   session/create → session/subscribe (desktop-continuous) → session/send.
 * Streaming notifications are forwarded to a handler (chat.ts maps them to
 * renderer chunks) and raw-logged to the session trace for mapping/debug.
 *
 * Protocol notes (learned by probing 0.16.5):
 *  - messages are plain JSON lines: {method, params, id} client→server;
 *    {id, result|error} responses; {id:"server-N", method, params} are
 *    SERVER→client requests that MUST be answered with {id, result}.
 *  - server asks `session/requestRuntimePreferences` right after create;
 *    answer within 15s or the session dies. We answer {model, mode}.
 *  - session/create params: {workspace:{workspacePath, workspaceKey}}.
 *  - session/subscribe params: {sessionId, deliveryKind:"desktop-continuous"}.
 *  - session/send params: {sessionId, content}.
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { homedir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { logTrace } from "./trace";

const ZCODE_BUNDLE = "D:/zcode-cli/core/zcode.cjs";

export type Json = Record<string, unknown>;

let proc: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
let notificationHandler: (msg: Json) => void = () => {};
const subscriptions = new Set<string>();
const sessionMap = new Map<string, string>(); // rcode sessionId -> zcode sessionId
// The server echoes the fresh sessionId inside its requestRuntimePreferences
// request; session/create's result doesn't carry it (0.16.5).
let lastCreatedSessionId = "";
let sessionIdGate: { promise: Promise<string>; resolve: (s: string) => void } | null = null;


function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: Json;
  try { msg = JSON.parse(trimmed) as Json; } catch { return; }
  const id = msg.id;
  const method = typeof msg.method === "string" ? msg.method : null;
  if (id != null && method == null) {
    // response to one of our requests
    const p = pending.get(id as number);
    if (p) {
      pending.delete(id as number);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg);
    }
    return;
  }
  if (method && id != null) {
    // server→client request; answer immediately
    if (method === "session/requestRuntimePreferences") {
      const sid = (msg.params as Json | undefined)?.sessionId;
      if (typeof sid === "string" && sid) {
        lastCreatedSessionId = sid;
        sessionIdGate?.resolve(sid);
      }
      // Schema (0.16.5): requires nativeSearchEnhancementsEnabled; model comes
      // from the CLI's own config.json, not this response.
      respond(id, { nativeSearchEnhancementsEnabled: true });
    } else {
      respond(id, {});
    }
    return;
  }
  if (method) notificationHandler(msg);
}

function respond(id: unknown, result: Json): void {
  if (!proc?.stdin?.writable) return;
  proc.stdin.write(JSON.stringify({ id, result }) + "\n");
}

export function ensureServer(): ChildProcess {
  if (proc && proc.exitCode == null) return proc;
  proc = spawn("node", [ZCODE_BUNDLE, "app-server"], {
    cwd: "D:/zcode-cli",
    windowsHide: true,
  });
  const rl = createInterface({ input: proc.stdout! });
  rl.on("line", handleLine);
  proc.on("exit", () => { proc = null; subscriptions.clear(); });
  return proc;
}

export function setNotificationHandler(fn: (msg: Json) => void): void {
  notificationHandler = fn;
}

export function request(method: string, params: Json, timeoutMs = 20000): Promise<Json> {
  ensureServer();
  const id = nextId++;
  const { promise, resolve, reject } = Promise.withResolvers<Json>();
  pending.set(id, { resolve, reject });
  setTimeout(() => {
    if (pending.delete(id)) reject(new Error(`zcode request timeout: ${method}`));
  }, timeoutMs);
  proc!.stdin!.write(JSON.stringify({ method, params, id }) + "\n");
  return promise;
}

export async function ensureZcodeSession(rcodeSid: string, workspacePath: string): Promise<string> {
  const cached = sessionMap.get(rcodeSid);
  if (cached) return cached;
  const res = await request("session/create", {
    workspace: { workspacePath, workspaceKey: `rcode-${rcodeSid.slice(0, 8)}` },
  });
  const result = (res.result ?? res) as Json;
  let zsid = (result.sessionId ?? result.session_id ?? "") as string;
  if (!zsid) {
    const { promise, resolve } = Promise.withResolvers<string>();
    sessionIdGate = { promise, resolve };
    if (lastCreatedSessionId) resolve(lastCreatedSessionId);
    zsid = await Promise.race([
      promise,
      new Promise<string>(r => setTimeout(() => r(""), 8000)),
    ]);
    sessionIdGate = null;
  }
  if (!zsid) throw new Error("session/create returned no sessionId");
  sessionMap.set(rcodeSid, zsid);
  if (!subscriptions.has(zsid)) {
    await request("session/subscribe", { sessionId: zsid, deliveryKind: "desktop-continuous" });
    subscriptions.add(zsid);
  }
  return zsid;
}

export async function sendTurn(rcodeSid: string, content: string, workspacePath: string): Promise<string> {
  const zsid = await ensureZcodeSession(rcodeSid, workspacePath);
  await request("session/send", { sessionId: zsid, content }, 30000);
  return zsid;
}

export function forwardNotifications(rcodeSid: string, fn: (msg: Json) => void): void {
  setNotificationHandler(msg => {
    logTrace(rcodeSid, { kind: "zcode-event", method: msg.method, params: msg.params });
    fn(msg);
  });
}

export const ZCODE_PATH = ZCODE_BUNDLE;
