/*
 * PURPOSE: Chat streaming IPC handler — orchestrates the full chat turn:
 *          build system prompt → fetch API → stream SSE chunks → save messages
 *
 * KEY DECISIONS:
 * - System prompt built from global + per-session instructions (chat/systemPrompt.ts)
 * - SSE parsing handled by chat/streamClient.ts (handles partial JSON across chunks)
 * - Chunks forwarded to renderer via event.sender.send with session-scoped channel
 * - User + assistant messages persisted to DB after streaming completes
 * - chat:resend re-runs a turn anchored at a user message; the new assistant
 *   response is stored as an extra VERSION on the existing assistant message
 *   (versions[] + version_index) so the user can flip between answers.
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";

import { getSession } from "../db/sessions";
import { getMessages, addMessage, appendAssistantVersion } from "../db/messages";
import { getSettings } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { sseLines, parseSSEData } from "../chat/streamClient";
import { runDshTask } from "../agent/dsh-bridge";

import type { ChatRequest, ChatChunk, Message, Settings, Session } from "../../src/types";

const USE_DSH = process.env.RCODE_USE_DSH === "1"; // opt-in only; default = real model streaming

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

async function streamCompletion(
  sender: WebContents,
  sessionId: string,
  endpoint: Endpoint,
  apiMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  if (USE_DSH) {
    let fullContent = "";
    const prompt = apiMessages.map(m => `${m.role}: ${m.content}`).join("\n\n");
    for await (const chunk of runDshTask(prompt)) {
      if (!chunk.done && chunk.content) {
        fullContent += chunk.content;
        sender.send(`chat:chunk:${sessionId}`, { content: chunk.content, done: false } satisfies ChatChunk);
      }
      if (chunk.done) break;
    }
    return fullContent;
  }

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
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  let fullContent = "";
  let fullReasoning = "";
  for await (const data of sseLines(reader)) {
    try {
      const parsed = parseSSEData(data);
      const delta = parsed.choices?.[0]?.delta as { content?: string; reasoning_content?: string; reasoning?: string } | undefined;
      const contentDelta = delta?.content;
      const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoningDelta) {
        fullReasoning += reasoningDelta;
        sender.send(`chat:chunk:${sessionId}`, { content: "", reasoning: reasoningDelta, done: false } satisfies ChatChunk);
      }
      if (contentDelta) {
        fullContent += contentDelta;
        sender.send(`chat:chunk:${sessionId}`, { content: contentDelta, done: false } satisfies ChatChunk);
      }
    } catch {
      // Partial JSON — skip; sseLines handles line boundaries
    }
  }
  return fullReasoning ? "<think>\n" + fullReasoning + "\n</think>\n\n" + fullContent : fullContent;
}

export function registerChatHandler(): void {
  ipcMain.handle("chat:send", async (event: IpcMainInvokeEvent, request: ChatRequest) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const systemPrompt = buildSystemPrompt(settings.globalInstructions, session.customInstructions);

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role as string, content: m.content })),
      { role: "user", content: request.userMessage },
    ];

    // Persist user message
    addMessage(request.sessionId, "user", request.userMessage);

    const endpoint = resolveEndpoint(session, settings, request.model);
    const fullContent = await streamCompletion(event.sender, request.sessionId, endpoint, apiMessages);

    addMessage(request.sessionId, "assistant", fullContent);
    event.sender.send(`chat:chunk:${request.sessionId}`, { content: "", done: true } satisfies ChatChunk);
  });

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  // The new answer becomes an extra version on the next assistant message.
  ipcMain.handle("chat:resend", async (event: IpcMainInvokeEvent, request: { sessionId: string; anchorUserMessageId: string; model?: string }) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const anchorIdx = history.findIndex(m => m.id === request.anchorUserMessageId && m.role === "user");
    if (anchorIdx === -1) throw new Error("Anchor user message not found");

    const systemPrompt = buildSystemPrompt(settings.globalInstructions, session.customInstructions);
    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...history.slice(0, anchorIdx + 1).map(m => ({ role: m.role as string, content: m.content })),
    ];

    const target: Message | undefined = history.slice(anchorIdx + 1).find(m => m.role === "assistant");

    const endpoint = resolveEndpoint(session, settings, request.model);
    const fullContent = await streamCompletion(event.sender, request.sessionId, endpoint, apiMessages);

    if (target) {
      appendAssistantVersion(target.id, fullContent);
    } else {
      addMessage(request.sessionId, "assistant", fullContent);
    }
    event.sender.send(`chat:chunk:${request.sessionId}`, { content: "", done: true } satisfies ChatChunk);
  });
}
