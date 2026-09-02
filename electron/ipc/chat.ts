/*
 * PURPOSE: Chat turns driven by the pi engine (pi-coding-agent worker).
 *
 * pi is Rcode's only agent core: it owns the tool loop, context, compaction
 * and streaming; this module persists the user message, maps pi chunks onto
 * the renderer's ChatChunk stream, and persists the finished turn in Rcode's
 * SQLite (the UI source of truth) using rebuildable markers:
 *   [worked:NNs] + [usage:in/out/reasoning/cached] headers,
 *   </think>
` blocks, `[tool:name(args)]<toolresult>` markers, and the answer.
 * The persisted format mirrors the renderer's parseTurn so reloads rebuild
 * the same turn view; the pi engine additionally keeps its own durable
 * session files (see pi-worker.mjs) so agent context survives restarts.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { getSession } from "../db/sessions";
import { getMessages, addMessage, appendAssistantVersion, archiveTail } from "../db/messages";
import { getSettings } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { logTrace, readTrace } from "../agent/trace";
import { runPiTurn, dropPiSession, runPiCompact } from "../agent/pi-bridge";
import { homedir } from "os";

import type { ChatRequest, ChatChunk, Settings } from "../../src/types";

interface TurnStep {
  kind: "thought" | "tool" | "say";
  text?: string;
  name?: string;
  args?: string;
  result?: string;
  status?: "running" | "done";
}

interface PersistedTurn {
  parts: string[];
  secs: number;
}

/**
 * Stream one pi turn into the renderer and collect the persistable turn.
 * persist() runs BEFORE the done chunk so a post-done message refetch sees it.
 */
async function runTurn(
  event: IpcMainInvokeEvent,
  request: ChatRequest,
  settings: Settings,
  opts: { promptText: string; persist: (full: string) => void },
): Promise<void> {
  const sid = request.sessionId;
  const session = getSession(sid);
  const sendChunk = (chunk: ChatChunk) => event.sender.send(`chat:chunk:${sid}`, chunk);
  const startedAt = Date.now();
  let finalContent = "";
  const steps: TurnStep[] = [];
  let usageIn = 0;
  let usageOut = 0;
  const providerRow = getProvider(settings.providerName);
  const turn = readTrace(sid).filter(e => e.kind === "turn_start").length + 1;
  logTrace(sid, {
    kind: "turn_start", turn, model: request.model ?? settings.model,
    baseUrl: providerRow?.baseUrl ?? settings.apiBase, engine: "pi", userMessage: opts.promptText,
  });
  try {
    await runPiTurn(sid, opts.promptText, {
      providerId: settings.providerName,
      baseUrl: providerRow?.baseUrl || settings.apiBase,
      apiKey: providerRow?.apiKey || "",
      modelId: request.model ?? settings.model,
      modelList: providerRow?.modelList.map(m => m.id),
      cwd: homedir(),
      systemPrompt: buildSystemPrompt(settings.globalInstructions, session?.customInstructions ?? null),
      mode: (request.mode as string) || "full-access",
      effort: request.reasoningEffort || (settings as Settings & { reasoningEffort?: string }).reasoningEffort,
      onChunk: c => {
        if (c.kind === "text" && c.delta) {
          finalContent += c.delta;
          const last = steps[steps.length - 1];
          if (last?.kind === "say") last.text = (last.text ?? "") + c.delta;
          else steps.push({ kind: "say", text: c.delta });
          sendChunk({ content: c.delta, done: false });
        } else if (c.kind === "reasoning" && c.delta) {
          const last = steps[steps.length - 1];
          if (last?.kind === "thought") last.text = (last.text ?? "") + c.delta;
          else steps.push({ kind: "thought", text: c.delta });
          sendChunk({ content: "", reasoning: c.delta, done: false });
        } else if (c.kind === "tool_start") {
          steps.push({ kind: "tool", name: c.toolName, args: c.args, status: "running" });
          logTrace(sid, { kind: "tool_call", turn, name: c.toolName ?? "tool", args: c.args });
          sendChunk({ content: "", done: false, kind: "tool_call", tool: { name: c.toolName ?? "tool", args: c.args } });
        } else if (c.kind === "tool_end") {
          const running = [...steps].reverse().find(s => s.kind === "tool" && s.name === c.toolName && s.status === "running");
          if (running) { running.status = "done"; running.result = c.result; }
          logTrace(sid, { kind: "tool_result", turn, name: c.toolName ?? "tool", result: c.result });
          sendChunk({ content: "", done: false, kind: "tool_result", tool: { name: c.toolName ?? "tool", result: c.result } });
        } else if (c.kind === "usage" && c.usage) {
          usageIn += c.usage.input;
          usageOut += c.usage.output;
        }
      },
    });
  } catch (e) {
    logTrace(sid, { kind: "turn_end", turn, secs: Math.round((Date.now() - startedAt) / 1000), error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  const secs = Math.round((Date.now() - startedAt) / 1000);
  logTrace(sid, { kind: "content", turn, round: "final", text: finalContent });
  logTrace(sid, { kind: "turn_end", turn, secs });

  const parts: string[] = [];
  if (secs > 0 || steps.some(s => s.kind === "tool")) parts.push("[worked:" + secs + "s]");
  if (usageIn > 0 || usageOut > 0) parts.push("[usage:" + usageIn + "/" + usageOut + "/0/0]");
  for (const s of steps) {
    if (s.kind === "thought" && s.text) parts.push("<think>\n" + s.text + "\n</think>");
    else if (s.kind === "tool") parts.push("[tool:" + s.name + "(" + (s.args ?? "{}") + ")]\n<toolresult>\n" + (s.result ?? "") + "\n</toolresult>");
    else if (s.kind === "say" && s.text) parts.push(s.text);
  }
  opts.persist(parts.join("\n\n") || finalContent || "(no response)");
  sendChunk({
    content: "", done: true, secs,
    usage: usageIn || usageOut ? {
      prompt_tokens: usageIn,
      completion_tokens: usageOut,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    } : undefined,
  });
}

export function registerChatHandler(): void {
  ipcMain.handle("chat:send", async (event: IpcMainInvokeEvent, request: ChatRequest) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");
    addMessage(request.sessionId, "user", request.userMessage);
    await runTurn(event, request, settings, {
      promptText: request.userMessage,
      persist: full => addMessage(request.sessionId, "assistant", full),
    });
  });

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  ipcMain.handle("chat:resend", async (event: IpcMainInvokeEvent, request: { sessionId: string; anchorUserMessageId: string; model?: string }) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    // History is about to be rewritten from Rcode's truth; the engine must not
    // keep the invalidated turn in context.
    dropPiSession(request.sessionId);

    const history = getMessages(request.sessionId);
    const anchor = history.find(m => m.id === request.anchorUserMessageId && m.role === "user");
    if (!anchor) throw new Error("Anchor user message not found");
    const anchorIdx = history.indexOf(anchor);
    const target = history.slice(anchorIdx + 1).find(m => m.role === "assistant");
    // Retry = new branch: archive everything after the target under its current
    // version so the tail disappears; version arrows restore it later.
    if (target) archiveTail(target.id, target.versionIndex ?? 0);

    const chatRequest: ChatRequest = {
      sessionId: request.sessionId,
      userMessage: anchor.content,
      model: request.model,
    };
    await runTurn(event, chatRequest, settings, {
      promptText: anchor.content,
      persist: full => {
        if (target) appendAssistantVersion(target.id, full);
        else addMessage(request.sessionId, "assistant", full);
      },
    });
  });

  // Compact the pi session's context (pi does the summarization in-engine).
  ipcMain.handle("chat:compact", async (_e, sessionId: string) => {
    const summary = await runPiCompact(sessionId);
    return { summary };
  });

  // Context usage estimate for the composer pill. Tool schemas live in pi;
  // a fixed estimate keeps the pill meaningful without reaching into the worker.
  ipcMain.handle("chat:contextInfo", (_e, sessionId: string) => {
    const settings = getSettings();
    const session = getSession(sessionId);
    const est = (s: string) => Math.round(s.length / 4);
    const system = est(buildSystemPrompt(settings.globalInstructions, session?.customInstructions ?? null));
    const tools = 1800;
    const messages = getMessages(sessionId).reduce((a, m) => a + est(m.content), 0);
    let cacheRate: number | null = null;
    const evts = readTrace(sessionId);
    for (let i = evts.length - 1; i >= 0; i--) {
      const u = (evts[i] as { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
      if (u?.prompt_tokens) { cacheRate = (u.prompt_tokens_details?.cached_tokens ?? 0) / u.prompt_tokens; break; }
    }
    return { system, tools, messages, cacheRate };
  });
}
