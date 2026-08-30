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
import { getMessages, addMessage, appendAssistantVersion } from "../db/messages";
import { getSettings } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { sseLines, parseSSEData } from "../chat/streamClient";
import { TOOL_DEFS, executeTool, type AgentMode } from "../agent/tools";

import type { ChatRequest, ChatChunk, Session, Settings } from "../../src/types";

const MAX_TOOL_ROUNDS = 6;

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
interface TurnStep { kind: "thought" | "tool"; text?: string; name?: string; args?: string; result?: string }

interface StreamResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCallAcc[];
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
      stream: true,
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

  for await (const data of sseLines(reader)) {
    try {
      const parsed = parseSSEData(data);
      const delta = parsed.choices?.[0]?.delta as
        | { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }
        | undefined;
      if (!delta) continue;
      const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        sender.send(`chat:chunk:${sessionId}`, { content: "", reasoning: reasoningDelta, done: false } satisfies ChatChunk);
      }
      if (delta.content) {
        content += delta.content;
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
  return { content, reasoning, toolCalls };
}

export function registerChatHandler(): void {
  // renderer approval round-trip for restricted mode
  const pendingApprovals = new Map<string, (ok: boolean) => void>();
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

    const apiMessages: unknown[] = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
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
    const steps: TurnStep[] = [];
    let finalContent = "";
    let finalReasoning = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await streamOnce(event.sender, request.sessionId, endpoint, apiMessages, effort);

      if (res.reasoning) {
        finalReasoning += (finalReasoning ? "\n" : "") + res.reasoning;
        steps.push({ kind: "thought", text: res.reasoning });
      }
      if (res.content) {
        finalContent += res.content;
      }

      if (res.toolCalls.length === 0) break;

      // assistant message with tool_calls, then tool results, then next round
      apiMessages.push({
        role: "assistant",
        content: res.content || null,
        tool_calls: res.toolCalls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });

      for (const c of res.toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.arguments || "{}"); } catch {}
        sendChunk({ content: "", done: false, kind: "tool_call", tool: { name: c.name, args: c.arguments } });
        const result = await executeTool(c.name, args, { mode, cwd, askApproval });
        sendChunk({ content: "", done: false, kind: "tool_result", tool: { name: c.name, result } });
        steps.push({ kind: "tool", name: c.name, args: c.arguments, result });
        apiMessages.push({ role: "tool", tool_call_id: c.id, content: result });
      }

      // content emitted mid-loop is progress narration; keep it but separate rounds
      if (res.content) finalContent += "\n";
    }

    const secs = Math.round((Date.now() - startedAt) / 1000);

    // persist with markers so reloads rebuild the turn view
    const parts: string[] = [];
    if (secs > 0 || steps.some(s => s.kind === "tool")) parts.push(`[worked:${secs}s]`);
    for (const s of steps) {
      if (s.kind === "thought" && s.text) parts.push(`<think>\n${s.text}\n</think>`);
      if (s.kind === "tool") parts.push(`[tool:${s.name}(${s.args ?? "{}"})]\n<toolresult>\n${s.result ?? ""}\n</toolresult>`);
    }
    if (finalReasoning && !steps.some(s => s.kind === "thought")) parts.push(`<think>\n${finalReasoning}\n</think>`);
    parts.push(finalContent);
    addMessage(request.sessionId, "assistant", parts.join("\n\n"));

    sendChunk({ content: "", done: true, secs });
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
      ...history.slice(0, anchorIdx + 1).map(m => ({ role: m.role, content: m.content })),
    ];

    const target = history.slice(anchorIdx + 1).find(m => m.role === "assistant");
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
