/*
 * PURPOSE: pi-coding-agent as Rcode's clean open-source engine ("pi" engine).
 *
 * ARCHITECTURE: pi's ESM dist requires Node 24+ APIs (webidl.util.
 * markAsUncloneable) that Electron 41's embedded Node lacks, so the SDK cannot
 * load in-process in the Electron main. Instead we spawn SYSTEM node running
 * electron/agent/pi-worker.mjs and speak JSON lines over stdio. The worker
 * holds one pi AgentSession per Rcode session (context continuity), and this
 * bridge keeps the same exported API chat.ts already uses:
 *   runPiTurn / dropPiSession / piAvailable.
 *
 * Worker protocol: see pi-worker.mjs header. Line-delimited JSON; each prompt
 * gets an id; chunks carry that id; "end"|"error" resolve the turn.
 */

import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { createInterface } from "readline";

// dist/electron/agent -> repo root -> source electron/agent (dev layout:
// the app runs via `npx electron .` from the repo, so the source tree is
// the runtime tree).
const WORKER = join(__dirname, "..", "..", "..", "electron", "agent", "pi-worker.mjs");

export interface PiChunk {
  kind: "text" | "reasoning" | "tool_start" | "tool_end" | "usage" | "error";
  delta?: string;
  toolName?: string;
  args?: string;
  result?: string;
  isError?: boolean;
  usage?: { input: number; output: number };
}

export interface PiRunOptions {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelList?: string[];
  cwd: string;
  systemPrompt: string;
  /** composer mode: full-access | restricted | plan (tool gating) */
  mode?: string;
  /** reasoning effort: minimal | low | medium | high | max */
  effort?: string;
  onChunk: (c: PiChunk) => void;
}

interface Pending {
  onChunk: (c: PiChunk) => void;
  resolve: () => void;
  reject: (e: Error) => void;
}

let child: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let workerReady: Promise<void> | null = null;
let available: boolean | null = null;

function startWorker(): Promise<void> {
  if (workerReady) return workerReady;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  workerReady = promise;
  try {
    child = spawn("node", [WORKER], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } catch (e) {
    reject(e instanceof Error ? e : new Error(String(e)));
    return promise;
  }
  let buf = "";
  const timer = setTimeout(() => reject(new Error("pi worker: ready timeout")), 10000);
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (msg.kind === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        const id = Number(msg.id);
        const p = pending.get(id);
        if (!p) {
          // Never drop silently: unknown ids mean a turn's events lost their
          // request routing (seen once via a stolen currentId in the worker).
          // eslint-disable-next-line no-console
          console.error("[pi-bridge] chunk with unknown id dropped:", JSON.stringify(msg).slice(0, 200));
          continue;
        }
        const kind = String(msg.kind);
        if (kind === "end") {
          pending.delete(id);
          p.resolve();
        } else if (kind === "error") {
          pending.delete(id);
          p.reject(new Error(String(msg.message ?? "pi worker error")));
        } else {
          p.onChunk(msg as unknown as PiChunk);
        }
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => {
      console.error("[pi-worker]", d.trim().slice(0, 300));
    });
    child.on("exit", () => {
      const err = new Error("pi worker exited");
      for (const [, p] of pending) p.reject(err);
      pending.clear();
      child = null;
      workerReady = null;
      available = null;
    });
  return promise;
}

function send(obj: Record<string, unknown>): void {
  if (!child || !child.stdin || child.killed) throw new Error("pi worker not running");
  child.stdin.write(JSON.stringify(obj) + "\n");
}

export async function piAvailable(): Promise<boolean> {
  if (available != null) return available;
  try {
    await startWorker();
    const { promise: pong, resolve, reject } = Promise.withResolvers<void>();
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("ping timeout")); }, 5000);
    pending.set(id, { onChunk: () => {}, resolve: () => { clearTimeout(timer); resolve(); }, reject });
    send({ id, op: "ping" });
    await pong;
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function dropPiSession(rcodeSid: string): void {
  try { send({ op: "drop", sid: rcodeSid }); } catch { /* worker down: nothing to drop */ }
}

export async function runPiTurn(rcodeSid: string, prompt: string, o: PiRunOptions): Promise<void> {
  await startWorker();
  const id = nextId++;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  pending.set(id, { onChunk: o.onChunk, resolve, reject });
  send({
    id,
    op: "prompt",
    sid: rcodeSid,
    prompt,
    provider: { id: o.providerId, baseUrl: o.baseUrl, apiKey: o.apiKey },
    modelId: o.modelId,
    modelList: o.modelList ?? [],
    cwd: o.cwd,
    systemPrompt: o.systemPrompt,
    mode: o.mode,
    effort: o.effort,
  });
  await promise;
}

export async function runPiCompact(rcodeSid: string): Promise<string> {
  await startWorker();
  const id = nextId++;
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let text = "";
  pending.set(id, {
    onChunk: c => {
      if (c.kind === "text" && c.delta) text += c.delta;
    },
    resolve: () => resolve(text || "Compacted."),
    reject,
  });
  send({ id, op: "compact", sid: rcodeSid });
  return promise;
}
