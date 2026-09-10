/*
 * PURPOSE: Chat turns driven by the pi engine (pi-coding-agent worker).
 *
 * pi is Rcode's only agent core: it owns the tool loop, context, compaction
 * and streaming; this module persists the user message, maps pi chunks onto
 * the renderer's ChatChunk stream, and persists the finished turn in Rcode's
 * SQLite as ordered typed events: reasoning, response, tool_call, and
 * tool_result. The API's dedicated reasoning field is never folded into the
 * final response; `content` remains the final answer. The pi engine keeps its
 * own durable session files so agent context survives restarts.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { getSession } from "../db/sessions";
import { getMessages, addMessage, appendAssistantVersion, archiveTail } from "../db/messages";
import { getSettings } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { logTrace, readTrace } from "../agent/trace";
import { runPiTurn, resetPiSessionToUser, runPiCompact, type PiAssistantBlock } from "../agent/pi-bridge";
import { homedir } from "os";

import type { AgentTurn, AgentTurnEvent, ChatRequest, ChatChunk, Settings, TurnUsage } from "../../src/types";

/**
 * Stream one pi turn into the renderer and collect the persistable turn.
 * persist() runs BEFORE the done chunk so a post-done message refetch sees it.
 */
async function runTurn(
  event: IpcMainInvokeEvent,
  request: ChatRequest,
  settings: Settings,
  opts: { promptText: string; persist: (turn: AgentTurn) => void },
): Promise<void> {
  const sid = request.sessionId;
  const session = getSession(sid);
  const sendChunk = (chunk: ChatChunk) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`chat:chunk:${sid}`, chunk);
    }
  };
  const startedAt = Date.now();
  let finalContent = "";
  const events: AgentTurnEvent[] = [];
  let usageIn = 0;
  let usageOut = 0;
  // Keep tool results as turn-segment boundaries. At each pi assistant message
  // end we replace only the latest raw delta segment with pi's canonical blocks.
  // This repairs fragmented provider streams without changing earlier traces or
  // assuming that all text/reasoning deltas arrive as one contiguous run.
  const reconcileAssistantSegment = (blocks: PiAssistantBlock[]) => {
    const boundary = events.findLastIndex(item => item.kind === "tool_result");
    const segmentStart = boundary + 1;
    const canonical = blocks.flatMap(block => {
      const kind = block.type === "thinking" ? "reasoning" : "response";
      if (!block.text.trim()) return [];
      return [{ kind, text: block.text } as AgentTurnEvent];
    });

    events.splice(segmentStart, events.length - segmentStart, ...canonical);
    const lastResponse = canonical.findLast(item => item.kind === "response");
    if (lastResponse && lastResponse.kind === "response") {
      finalContent = lastResponse.text;
    }
  };
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
          // OpenAI-compatible providers may emit a whitespace-only text delta
          // before tool calls. It is not a meaningful response event.
          if (c.delta.trim().length === 0) return;
          const last = events[events.length - 1];
          if (last?.kind === "response") {
            last.text += c.delta;
            finalContent = last.text;
          } else {
            events.push({ kind: "response", text: c.delta });
            finalContent = c.delta;
          }
          sendChunk({ content: c.delta, done: false });
        } else if (c.kind === "reasoning" && c.delta) {
          const last = events[events.length - 1];
          if (last?.kind === "reasoning") last.text += c.delta;
          else events.push({ kind: "reasoning", text: c.delta });
          sendChunk({ content: "", reasoning: c.delta, done: false });
        } else if (c.kind === "tool_start") {
          events.push({ kind: "tool_call", name: c.toolName ?? "tool", args: c.args });
          logTrace(sid, { kind: "tool_call", turn, name: c.toolName ?? "tool", args: c.args });
          sendChunk({ content: "", done: false, kind: "tool_call", tool: { name: c.toolName ?? "tool", args: c.args } });
        } else if (c.kind === "tool_end") {
          events.push({ kind: "tool_result", name: c.toolName ?? "tool", result: c.result, isError: Boolean(c.isError) });
          logTrace(sid, { kind: "tool_result", turn, name: c.toolName ?? "tool", result: c.result });
          sendChunk({ content: "", done: false, kind: "tool_result", tool: { name: c.toolName ?? "tool", result: c.result } });
        } else if (c.kind === "usage" && c.usage) {
          usageIn += c.usage.input;
          usageOut += c.usage.output;
        } else if (c.kind === "assistant_end" && c.blocks) {
          reconcileAssistantSegment(c.blocks);
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

  const usage: TurnUsage | undefined = usageIn || usageOut
    ? { prompt_tokens: usageIn, completion_tokens: usageOut, reasoning_tokens: 0, cached_tokens: 0 }
    : undefined;
  opts.persist({
    secs,
    usage,
    events,
    finalContent: finalContent || "(no response)",
  });
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
      persist: turn => addMessage(request.sessionId, "assistant", turn.finalContent, turn),
    });
  });

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  ipcMain.handle("chat:resend", async (event: IpcMainInvokeEvent, request: { sessionId: string; anchorUserMessageId: string; model?: string }) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const anchor = history.find(m => m.id === request.anchorUserMessageId && m.role === "user");
    if (!anchor) throw new Error("Anchor user message not found");

    // Retry must move pi's durable conversation tree back to the anchor user
    // message. Dropping only the in-memory session is not enough: rebuilding it
    // would otherwise resume the old branch, including the abandoned answer.
    const anchorIdx = history.indexOf(anchor);
    const anchorOccurrence = history
      .slice(0, anchorIdx + 1)
      .filter(m => m.role === "user" && m.content === anchor.content).length;
    await resetPiSessionToUser(
      request.sessionId,
      anchor.content,
      anchorOccurrence,
      homedir(),
    );
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
      persist: turn => {
        if (target) appendAssistantVersion(target.id, turn.finalContent, turn);
        else addMessage(request.sessionId, "assistant", turn.finalContent, turn);
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
