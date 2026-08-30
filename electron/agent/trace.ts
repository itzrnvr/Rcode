/*
 * PURPOSE: Complete, immutable req/res trace for every agent turn.
 *
 * One JSONL file per session at <userData>/traces/<sessionId>.jsonl.
 * Entries (append-only, never rewritten):
 *   turn_start  {turn, model, baseUrl, mode, effort, userMessage}
 *   request     {turn, round, messages, toolNames}        full request payload
 *   response    {turn, round, status, firstChunkMs, totalMs, chunks, error?}
 *   reasoning   {turn, round, text}                       full reasoning text
 *   tool_call   {turn, round, name, args}
 *   tool_result {turn, round, name, ms, result}           full (capped 200KB) result
 *   content     {turn, round, text}                       final answer text
 *   turn_end    {turn, secs, error?}
 *
 * The renderer's Trajectory view folds these into turns → groups → cells,
 * mirroring dsh's ui-trajectory hierarchy.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";

const CAP = 200 * 1024;

function cap(s: string): string {
  if (typeof s !== "string") return s;
  return s.length <= CAP ? s : s.slice(0, CAP) + `\n… [truncated ${s.length - CAP} more chars]`;
}

export function tracesDir(): string {
  return join(app.getPath("userData"), "traces");
}

export function logTrace(sessionId: string, entry: Record<string, unknown>): void {
  try {
    const dir = tracesDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), sid: sessionId, ...entry });
    appendFileSync(join(dir, `${sessionId}.jsonl`), line + "\n");
  } catch {
    // tracing must never break the chat
  }
}

export interface TraceEntry extends Record<string, unknown> {
  ts: string;
  sid: string;
  kind: string;
  turn?: number;
  round?: number;
}

export function readTrace(sessionId: string): TraceEntry[] {
  const file = join(tracesDir(), `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  try {
    const text = readFileSync(file, "utf8");
    return text
      .split("\n")
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l) as TraceEntry; } catch { return null; }
      })
      .filter((e): e is TraceEntry => e != null);
  } catch {
    return [];
  }
}
