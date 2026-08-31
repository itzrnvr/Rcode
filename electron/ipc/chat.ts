/*
 * PURPOSE: Chat streaming + client-side agent loop.
 *
 * chat:send now runs an agentic loop: the request includes a minimal toolset
 * (read_file/list_dir/search/run_command). When the model returns tool_calls
 * we execute them (mode-gated; restricted asks the renderer for approval),
 * feed tool results back, and continue until a final answer arrives.
 *
 * Events streamed on chat:chunk:<sessionId> (ChatChunk):
 *   { content }            answer text delta
 *   { reasoning }          reasoning delta
 *   { kind:'tool_call',  tool:{name,args} }    a tool is about to run
 *   { kind:'tool_result',tool:{name,result} }  its (capped) output
 *   { done, secs }         turn finished (+total seconds)
 *
 * Persisted assistant content embeds markers so reloads can rebuild the turn:
 *   [worked:NNs] header, <think>…</think>, [tool:name(args)] +
 *   <toolresult>…</toolresult> blocks, then the final answer.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { app } from "electron";

import { getSession } from "../db/sessions";
import { getMessages, addMessage, appendAssistantVersion, archiveTail } from "../db/messages";
import { getSettings, setSetting, getSetting } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { sseLines, parseSSEData } from "../chat/streamClient";
import { TOOL_DEFS, executeTool, type AgentMode } from "../agent/tools";
import { logTrace, readTrace } from "../agent/trace";

import type { ChatRequest, ChatChunk, Session, Settings } from "../../src/types";

const MAX_TOOL_ROUNDS = 24;

interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function resolveEndpoint(session: Session, settings: Settings, preferred?: string): Endpoint {
  const providerRow = getProvider(session.provider) || getProvider(settings.providerName);
  const baseUrl = providerRow?.baseUrl || settings.apiBase;
  const apiKey = providerRow?.apiKey || settings.apiKey;

  let modelList: string[] = [];
  if (providerRow) {
    try {
      const raw = providerRow.modelList as unknown;
      modelList = Array.isArray(raw)
        ? (raw as Array<{ id: string }>).map(m => m.id)
        : typeof raw === "string"
          ? (JSON.parse(raw) as Array<{ id: string }>).map(m => m.id)
          : [];
    } catch {}
  }
  const inList = (m: string | undefined): m is string => !!m && modelList.includes(m);
  const model = inList(preferred)
    ? preferred
    : inList(settings.model)
      ? settings.model
      : inList(session.model)
        ? session.model
        : modelList[0] ?? session.model ?? settings.model;
  return { baseUrl, apiKey, model };
}

interface ToolCallAcc { id: string; name: string; arguments: string }

// Walk a persisted assistant turn into ordered steps (mirror of renderer parseTurn).
function parsePersistedTurn(content: string): TurnStep[] {
  const steps: TurnStep[] = [];
  const body = content.replace(/^\[worked:(\d+)s\]\s*/, "");
  const re = /<(think|thinking)>([\s\S]*?)<\/\1>|\[tool:([a-zA-Z_]+)(\([\s\S]*?\))?\]\s*<toolresult>([\s\S]*?)<\/toolresult>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const seg = body.slice(last, m.index).trim();
    if (seg) steps.push({ kind: "say", text: seg });
    if (m[1]) steps.push({ kind: "thought", text: (m[2] ?? "").trim() });
    else steps.push({ kind: "tool", name: m[3], args: (m[4] ?? "").replace(/^\(|\)$/g, ""), result: (m[5] ?? "").trim() });
    last = m.index + m[0].length;
  }
  const tail = body.slice(last).trim();
  if (tail) steps.push({ kind: "say", text: tail });
  return steps;
}

// Long-task survival: shrink old replayed context so long sessions stay inside
// the model window. Old tool results get truncated; old reasoning is dropped.
function pruneHistory(msgs: Record<string, unknown>[]): Record<string, unknown>[] {
  let toolSeen = 0;
  let assistSeen = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "tool") {
      toolSeen++;
      if (toolSeen > 8 && typeof m.content === "string" && m.content.length > 2000) {
        m.content = m.content.slice(0, 2000) + "\n…[pruned]";
      }
    } else if (m.role === "assistant") {
      assistSeen++;
      if (assistSeen > 4 && "reasoning_content" in m) delete m.reasoning_content;
    }
  }
  return msgs;
}

// Replay a stored message into API messages per the DeepSeek tool-calls contract:
// when `tools` is present, assistant turns must carry reasoning_content and
// tool_calls, followed by role:"tool" results — otherwise the API 400s.
function replayMessage(m: { role: string; content: string }): Record<string, unknown>[] {
  if (m.role !== "assistant") return [{ role: m.role, content: m.content }];
  const steps = parsePersistedTurn(m.content);
  const tools = steps.filter(s => s.kind === "tool");
  const says = steps.filter(s => s.kind === "say").map(s => s.text ?? "");
  const thinks = steps.filter(s => s.kind === "thought").map(s => s.text ?? "");
  if (tools.length === 0) {
    return [{
      role: "assistant",
      content: says.join("\n\n") || m.content,
      ...(thinks.length ? { reasoning_content: thinks.join("\n") } : {}),
    }];
  }
  const out: Record<string, unknown>[] = [{
    role: "assistant",
    content: says.join("\n\n") || null,
    ...(thinks.length ? { reasoning_content: thinks.join("\n") } : {}),
    tool_calls: tools.map((s, i) => ({ id: `hist_${i}`, type: "function", function: { name: s.name, arguments: s.args ?? "{}" } })),
  }];
  tools.forEach((s, i) => out.push({ role: "tool", tool_call_id: `hist_${i}`, content: s.result ?? "" }));
  return out;
}
interface TurnStep { kind: "thought" | "tool" | "say"; text?: string; name?: string; args?: string; result?: string }

interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCallAcc[];
  firstChunkMs: number | null;
  totalMs: number;
  chunks: number;
  usage?: ChatChunk["usage"];
}

async function streamOnce(
  sender: WebContents,
  sessionId: string,
  endpoint: Endpoint,
  apiMessages: unknown[],
  effort: string | undefined,
): Promise<StreamResult> {
  const response = await fetch(`${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: apiMessages,
      stream: true, stream_options: { include_usage: true },
      tools: TOOL_DEFS,
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  let content = "";
  let reasoning = "";
  const calls = new Map<number, ToolCallAcc>();
  const t0 = Date.now();
  let firstChunkMs: number | null = null;
  let chunks = 0;
  let usage: StreamResult["usage"];

  for await (const data of sseLines(reader)) {
    try {
      const parsed = parseSSEData(data);
      const delta = parsed.choices?.[0]?.delta as
        | { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }
        | undefined;
      if ((parsed as { usage?: unknown }).usage && typeof (parsed as { usage?: unknown }).usage === "object") usage = (parsed as { usage?: StreamResult["usage"] }).usage;
      if (!delta) continue;
      const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        if (firstChunkMs == null) firstChunkMs = Date.now() - t0;
        chunks++;
        sender.send(`chat:chunk:${sessionId}`, { content: "", reasoning: reasoningDelta, done: false } satisfies ChatChunk);
      }
      if (delta.content) {
        content += delta.content;
        if (firstChunkMs == null) firstChunkMs = Date.now() - t0;
        chunks++;
        sender.send(`chat:chunk:${sessionId}`, { content: delta.content, done: false } satisfies ChatChunk);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = calls.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: "", arguments: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        calls.set(idx, acc);
      }
    } catch {
      // Partial JSON — skip; sseLines handles line boundaries
    }
  }

  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v).filter(c => c.name);
  return { content, reasoning, toolCalls, firstChunkMs, totalMs: Date.now() - t0, chunks, usage };
}

ipcMain.handle("chat:compact", async (_e, sessionId: string) => {
  const settings = getSettings();
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  const history = getMessages(sessionId);
  if (history.length < 4) throw new Error("Nothing to compact yet");
  const transcript = history.map(m => `${m.role}: ${m.content}`).join("\n\n").slice(-60000);
  const endpoint = resolveEndpoint(session, settings);
  const silent = { send: () => undefined } as unknown as import("electron").WebContents;
  const res = await streamOnce(silent, sessionId, endpoint, [
    { role: "system", content: "Summarize this conversation concisely for continuing the work later: goals, decisions, file paths, commands run, important tool results, and the current state. Bullet points, no preamble." },
    { role: "user", content: transcript },
  ], "low");
  setSetting(`compact:${sessionId}`, res.content);
  addMessage(sessionId, "system", `Conversation compacted: ${history.length} messages folded into a summary. New turns replay from summary + last 6 messages.`);
  return { summary: res.content };
});

ipcMain.handle("chat:contextInfo", (_e, sessionId: string) => {
  const settings = getSettings();
  const session = getSession(sessionId);
  const est = (s: string) => Math.round(s.length / 4);
  const system = est(buildSystemPrompt(settings.globalInstructions, session?.customInstructions ?? null));
  const tools = est(JSON.stringify(TOOL_DEFS));
  const messages = getMessages(sessionId).reduce((a, m) => a + est(m.content), 0);
  let cacheRate: number | null = null;
  const evts = readTrace(sessionId);
  for (let i = evts.length - 1; i >= 0; i--) {
    const u = (evts[i] as { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
    if (u?.prompt_tokens) { cacheRate = (u.prompt_tokens_details?.cached_tokens ?? 0) / u.prompt_tokens; break; }
  }
  return { system, tools, messages, cacheRate };
});

// Mid-turn steering: messages queued while the agent loop is running get
// injected as user messages between tool rounds (dsh-style queue).
const steeringQueues = new Map<string, string[]>();

export function registerChatHandler(): void {
  // renderer approval round-trip for restricted mode
  const pendingApprovals = new Map<string, (ok: boolean) => void>();
  ipcMain.handle("chat:queue", (_e, sessionId: string, text: string) => {
    const q = steeringQueues.get(sessionId) ?? [];
    q.push(text);
    steeringQueues.set(sessionId, q);
    return { queued: q.length };
  });

  ipcMain.handle("chat:approvalResponse", (_e, approvalId: string, ok: boolean) => {
    const fn = pendingApprovals.get(approvalId);
    if (fn) {
      pendingApprovals.delete(approvalId);
      fn(ok);
    }
  });

  ipcMain.handle("chat:send", async (event: IpcMainInvokeEvent, request: ChatRequest) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const systemPrompt = buildSystemPrompt(settings.globalInstructions, session.customInstructions);

    const compactSummary = getSetting(`compact:${request.sessionId}`);
    const apiMessages: unknown[] = [
      { role: "system", content: systemPrompt },
      ...(compactSummary
        ? [
            { role: "system", content: `Summary of the earlier conversation (compacted):\n${compactSummary}` },
            ...pruneHistory(history.slice(-6).flatMap(m => replayMessage(m))),
          ]
        : pruneHistory(history.flatMap(m => replayMessage(m)))),
      { role: "user", content: request.userMessage },
    ];

    addMessage(request.sessionId, "user", request.userMessage);

    const endpoint = resolveEndpoint(session, settings, request.model);
    const mode: AgentMode = (request.mode as AgentMode) || "full-access";
    const effort = request.reasoningEffort || (settings as Settings & { reasoningEffort?: string }).reasoningEffort;
    const cwd = app.getPath("home");

    const sendChunk = (chunk: ChatChunk) => event.sender.send(`chat:chunk:${request.sessionId}`, chunk);

    const askApproval = (command: string) =>
      new Promise<boolean>(resolvePromise => {
        const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingApprovals.set(approvalId, resolvePromise);
        sendChunk({ content: "", done: false, kind: "approval", tool: { name: command }, approvalId });
        // timeout auto-deny after 60s
        setTimeout(() => {
          if (pendingApprovals.has(approvalId)) {
            pendingApprovals.delete(approvalId);
            resolvePromise(false);
          }
        }, 60_000);
      });

    const startedAt = Date.now();
    let secs = 0;
    const steps: TurnStep[] = [];
    let finalContent = "";
    let finalReasoning = "";
    let turnUsage: ChatChunk["usage"];
    const sid = request.sessionId;
    const turn = readTrace(sid).filter(e => e.kind === "turn_start").length + 1;
    const capStr = (s: unknown) => (typeof s === "string" && s.length > 100_000 ? s.slice(0, 100_000) + "…[traced-truncated]" : s);
    logTrace(sid, { kind: "turn_start", turn, model: endpoint.model, baseUrl: endpoint.baseUrl, mode, effort: effort ?? null, userMessage: request.userMessage });
    logTrace(sid, { kind: "user", turn, text: request.userMessage });
    logTrace(sid, { kind: "system", turn, text: `System prompt · ${TOOL_DEFS.length} tools · mode ${mode}` });
    try {

    const drainSteering = () => {
      const q = steeringQueues.get(sid) ?? [];
      if (q.length === 0) return;
      steeringQueues.set(sid, []);
      for (const msg of q) {
        addMessage(sid, "user", msg);
        apiMessages.push({ role: "user", content: msg });
        logTrace(sid, { kind: "user", turn, round: "inject", text: msg });
      }
    };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      drainSteering();
      logTrace(sid, { kind: "request", turn, round, messages: apiMessages.map(m => ({ ...m as Record<string, unknown>, content: capStr((m as { content?: string }).content) })), toolNames: TOOL_DEFS.map(d => d.function.name) });
      const res = await streamOnce(event.sender, sid, endpoint, apiMessages, effort);
      logTrace(sid, { kind: "response", turn, round, status: "ok", firstChunkMs: res.firstChunkMs, totalMs: res.totalMs, chunks: res.chunks, usage: res.usage ?? null });
      if (res.usage) {
        turnUsage = {
          prompt_tokens: (turnUsage?.prompt_tokens ?? 0) + (res.usage.prompt_tokens ?? 0),
          completion_tokens: (turnUsage?.completion_tokens ?? 0) + (res.usage.completion_tokens ?? 0),
          prompt_tokens_details: { cached_tokens: (turnUsage?.prompt_tokens_details?.cached_tokens ?? 0) + (res.usage.prompt_tokens_details?.cached_tokens ?? 0) },
          completion_tokens_details: { reasoning_tokens: (turnUsage?.completion_tokens_details?.reasoning_tokens ?? 0) + (res.usage.completion_tokens_details?.reasoning_tokens ?? 0) },
        };
      }

      if (res.reasoning) {
        finalReasoning += (finalReasoning ? "\n" : "") + res.reasoning;
        steps.push({ kind: "thought", text: res.reasoning });
        logTrace(sid, { kind: "reasoning", turn, round, text: res.reasoning });
      }
      if (res.content) {
        steps.push({ kind: "say", text: res.content });
        logTrace(sid, { kind: "content", turn, round, text: res.content });
      }

      if (res.toolCalls.length === 0) {
        if ((steeringQueues.get(sid) ?? []).length === 0) break;
      }

      // assistant message with tool_calls, then tool results, then next round
      apiMessages.push({
        role: "assistant",
        content: res.content || null,
        ...(res.reasoning ? { reasoning_content: res.reasoning } : {}),
        tool_calls: res.toolCalls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });

      for (const c of res.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.arguments || "{}"); } catch {}
        sendChunk({ content: "", done: false, kind: "tool_call", tool: { name: c.name, args: c.arguments } });
        logTrace(sid, { kind: "tool_call", turn, round, name: c.name, args });
        const tTool = Date.now();
        const result = await executeTool(c.name, args, { mode, cwd, askApproval });
        logTrace(sid, { kind: "tool_result", turn, round, name: c.name, ms: Date.now() - tTool, result });
        sendChunk({ content: "", done: false, kind: "tool_result", tool: { name: c.name, result } });
        steps.push({ kind: "tool", name: c.name, args: c.arguments, result });
        apiMessages.push({ role: "tool", tool_call_id: c.id, content: result });
      }

      // content emitted mid-loop is progress narration; keep it but separate rounds
      if (res.content) finalContent += "\n";
    }

    secs = Math.round((Date.now() - startedAt) / 1000);
    finalContent = steps.filter(s => s.kind === "say").map(s => s.text ?? "").join("\n\n");
    if (finalContent) logTrace(sid, { kind: "content", turn, round: "final", text: finalContent });
    logTrace(sid, { kind: "turn_end", turn, secs });
    } catch (err) {
      logTrace(sid, { kind: "turn_end", turn, secs: Math.round((Date.now() - startedAt) / 1000), error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    // persist with markers so reloads rebuild the turn view
    const parts: string[] = [];
    if (secs > 0 || steps.some(s => s.kind === "tool")) parts.push(`[worked:${secs}s]`);
    if (turnUsage) parts.push(`[usage:${turnUsage.prompt_tokens ?? 0}/${turnUsage.completion_tokens ?? 0}/${turnUsage.completion_tokens_details?.reasoning_tokens ?? 0}/${turnUsage.prompt_tokens_details?.cached_tokens ?? 0}]`);
    for (const s of steps) {
      if (s.kind === "thought" && s.text) parts.push(`<think>\n${s.text}\n</think>`);
      else if (s.kind === "tool") parts.push(`[tool:${s.name}(${s.args ?? "{}"})]\n<toolresult>\n${s.result ?? ""}\n</toolresult>`);
      else if (s.kind === "say" && s.text) parts.push(s.text);
    }
    if (finalReasoning && !steps.some(s => s.kind === "thought")) parts.push(`<think>\n${finalReasoning}\n</think>`);
    addMessage(request.sessionId, "assistant", parts.join("\n\n"));

    sendChunk({ content: "", done: true, secs, usage: turnUsage });
  });

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  ipcMain.handle("chat:resend", async (event: IpcMainInvokeEvent, request: { sessionId: string; anchorUserMessageId: string; model?: string }) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const anchorIdx = history.findIndex(m => m.id === request.anchorUserMessageId && m.role === "user");
    if (anchorIdx === -1) throw new Error("Anchor user message not found");

    const systemPrompt = buildSystemPrompt(settings.globalInstructions, session.customInstructions);
    const apiMessages: unknown[] = [
      { role: "system", content: systemPrompt },
      ...history.slice(0, anchorIdx + 1).flatMap(m => replayMessage(m)),
    ];

    const target = history.slice(anchorIdx + 1).find(m => m.role === "assistant");
    // Retry = new branch: archive everything after the target under its current
    // version so the tail disappears; version arrows restore it later.
    if (target) archiveTail(target.id, target.versionIndex ?? 0);
    const endpoint = resolveEndpoint(session, settings, request.model);

    const res = await streamOnce(event.sender, request.sessionId, endpoint, apiMessages, (settings as Settings & { reasoningEffort?: string }).reasoningEffort);
    const full = res.reasoning ? `<think>\n${res.reasoning}\n</think>\n\n${res.content}` : res.content;

    if (target) {
      appendAssistantVersion(target.id, full);
    } else {
      addMessage(request.sessionId, "assistant", full);
    }
    event.sender.send(`chat:chunk:${request.sessionId}`, { content: "", done: true } satisfies ChatChunk);
  });
}
