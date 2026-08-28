/*
 * PURPOSE: Chat streaming IPC handler — orchestrates the full chat turn:
 *          build system prompt → fetch API → stream SSE chunks → save messages
 *
 * KEY DECISIONS:
 * - System prompt built from global + per-session instructions (chat/systemPrompt.ts)
 * - SSE parsing handled by chat/streamClient.ts (handles partial JSON across chunks)
 * - Chunks forwarded to renderer via event.sender.send with session-scoped channel
 * - User + assistant messages persisted to DB after streaming completes
 *
 * CONSUMERS: ipc/index.ts (registration)
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { getSession } from "../db/sessions";
import { getMessages, addMessage } from "../db/messages";
import { getSettings } from "../db/settings";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { sseLines, parseSSEData } from "../chat/streamClient";
import { runDshTask } from "../agent/dsh-bridge";

import type { ChatRequest, ChatChunk } from "../../src/types";

const USE_DSH = process.env.RCODE_USE_DSH === "1" || true; // park Rcode loop, DSH is core

export function registerChatHandler(): void {
  ipcMain.handle("chat:send", async (event: IpcMainInvokeEvent, request: ChatRequest) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const systemPrompt = buildSystemPrompt(settings.globalInstructions, session.customInstructions);

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: request.userMessage },
    ];

    // Persist user message
    addMessage(request.sessionId, "user", request.userMessage);

    // Parked Rcode loop — delegate to DSH headless when enabled
    if (USE_DSH) {
      const sendChunk = (chunk: ChatChunk) => {
        event.sender.send(`chat:chunk:${request.sessionId}`, chunk);
      };
      let fullContent = "";
      const prompt = apiMessages.map(m => `${m.role}: ${m.content}`).join("\n\n");
      for await (const chunk of runDshTask(prompt)) {
        if (!chunk.done && chunk.content) {
          fullContent += chunk.content;
          sendChunk({ content: chunk.content, done: false });
        }
        if (chunk.done) break;
      }
      addMessage(request.sessionId, "assistant", fullContent);
      sendChunk({ content: "", done: true });
      return;
    }

    const response = await fetch(`${settings.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: session.model || settings.model,
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

    const sendChunk = (chunk: ChatChunk) => {
      event.sender.send(`chat:chunk:${request.sessionId}`, chunk);
    };

    let fullContent = "";

    for await (const data of sseLines(reader)) {
      try {
        const parsed = parseSSEData(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          sendChunk({ content: delta, done: false });
        }
      } catch {
        // Partial JSON — skip; sseLines handles line boundaries
      }
    }

    // Persist assistant response
    addMessage(request.sessionId, "assistant", fullContent);

    // Signal completion
    sendChunk({ content: "", done: true });
  });
}
