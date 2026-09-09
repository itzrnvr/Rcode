/*
 * PURPOSE: Chat state hook — loads messages, streams agent turns.
 *
 * Accumulates from chat:chunk events:
 *   content    → response event
 *   reasoning  → reasoning event
 *   tool_call  → tool_call event
 *   tool_result→ tool_result event
 *   done       → turnSecs (+reload messages from DB)
 *
 * CONSUMERS: components/chat/ChatView.tsx, sidepanel/SideChatThread.tsx
 */

import { useState, useEffect, useCallback, useRef } from "react";

import { api } from "../api/client";
import { useApp } from "./AppContext";

import type { Message, ChatChunk } from "../types";
import type { LiveStep } from "../components/chat/AgentTurn";

export interface SendMeta {
  mode?: string;
  reasoningEffort?: string;
  model?: string;
}

export function useChat(sessionId: string | null) {
  const { settings } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [turnUsage, setTurnUsage] = useState<{ prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number; cached_tokens?: number } | null>(null);
  const [turnSecs, setTurnSecs] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load messages when session changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api.getMessages(sessionId).then(msgs => {
      if (!cancelled) setMessages(msgs);
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleChunk = useCallback((chunk: ChatChunk) => {
    if (chunk.done) {
      if (chunk.secs != null) setTurnSecs(chunk.secs);
      if (chunk.usage) {
        setTurnUsage({ prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens, reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens, cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens });
      }
      return;
    }
    if (chunk.kind === "tool_call") {
      setLiveSteps(p => [...p, { kind: "tool_call", name: chunk.tool?.name ?? "tool", args: chunk.tool?.args, status: "running" }]);
      return;
    }
    if (chunk.kind === "tool_result") {
      setLiveSteps(p => [...p, { kind: "tool_result", name: chunk.tool?.name ?? "tool", result: chunk.tool?.result, status: "done" }]);
      return;
    }
    const reasoningDelta = chunk.reasoning;
    if (reasoningDelta) {
      setStreamingReasoning(prev => prev + reasoningDelta);
      setLiveSteps(p => {
        const last = p[p.length - 1];
        if (last?.kind === "reasoning") {
          const next = [...p];
          next[next.length - 1] = { ...last, text: last.text + reasoningDelta };
          return next;
        }
        return [...p, { kind: "reasoning", text: reasoningDelta, bornAt: Date.now() }];
      });
      return;
    }
    const contentDelta = chunk.content;
    if (contentDelta) {
      if (contentDelta.trim().length === 0) return;
      setStreamingContent(prev => prev + contentDelta);
      setLiveSteps(p => {
        const last = p[p.length - 1];
        if (last?.kind === "response") {
          const next = [...p];
          next[next.length - 1] = { ...last, text: last.text + contentDelta };
          return next;
        }
        return [...p, { kind: "response", text: contentDelta }];
      });
    }
  }, []);

  const beginTurn = useCallback(() => {
    setError(null);
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
    setTurnSecs(null);
    setTurnUsage(null);
  }, []);

  const endTurn = useCallback(async (sid: string, removeListener: () => void) => {
    removeListener();
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
    const msgs = await api.getMessages(sid);
    setMessages(msgs);
  }, []);

  const isStreamingRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const sendMessage = useCallback(async (text: string, meta?: SendMeta) => {
    if (!sessionId || !text.trim()) return;
    const sid = sessionId;
    if (isStreamingRef.current) {
      const temp: Message = { id: `temp-q-${Date.now()}`, sessionId: sid, role: "user", content: text, createdAt: Date.now() };
      setMessages(prev => [...prev, temp]);
      await (api as unknown as { queueMessage: (id: string, t: string) => Promise<{ queued: number }> }).queueMessage(sid, text);
      return;
    }

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: sid,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const removeListener = api.onChatChunk(sid, handleChunk);
    beginTurn();
    try {
      await api.sendChat({ sessionId: sid, userMessage: text, model: meta?.model ?? settings.model, mode: meta?.mode, reasoningEffort: meta?.reasoningEffort });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(sid, removeListener);
    }
  }, [sessionId, settings.model, handleChunk, beginTurn, endTurn]);

  // For welcome → new session: send to a specific id not yet in the hook's closure
  const sendTo = useCallback(async (targetId: string, text: string, meta?: SendMeta) => {
    if (!text.trim()) return;
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: targetId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    const removeListener = api.onChatChunk(targetId, handleChunk);
    beginTurn();
    try {
      await api.sendChat({ sessionId: targetId, userMessage: text, model: meta?.model ?? settings.model, mode: meta?.mode, reasoningEffort: meta?.reasoningEffort });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(targetId, removeListener);
    }
  }, [settings.model, handleChunk, beginTurn, endTurn]);

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  const resend = useCallback(async (anchorUserMessageId: string, meta?: SendMeta) => {
    if (!sessionId) return;
    const sid = sessionId;
    const removeListener = api.onChatChunk(sid, handleChunk);
    beginTurn();
    try {
      await api.resendChat({ sessionId: sid, anchorUserMessageId, model: meta?.model ?? settings.model });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(sid, removeListener);
    }
  }, [sessionId, settings.model, handleChunk, beginTurn, endTurn]);

  const setVersion = useCallback(async (messageId: string, index: number) => {
    if (!sessionId) return;
    await api.setMessageVersion(messageId, index);
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  // Stop the local streaming state. The actual main-process stream may
  // continue in the background until the upstream model finishes or times out;
  // we just hide it from the UI immediately so the user can keep typing.
  const stopStream = useCallback(() => {
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
  }, []);

  const editMessage = useCallback(async (id: string, newContent: string) => {
    await api.updateMessage(id, newContent);
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  const deleteMessage = useCallback(async (id: string) => {
    await api.deleteMessage(id);
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  const refreshMessages = useCallback(async () => {
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  return {
    messages, streamingContent, streamingReasoning, liveSteps, turnUsage,
    turnSecs, isStreaming, error,
    sendMessage, sendTo, resend, setVersion, stopStream, editMessage, deleteMessage, refreshMessages,
  };
}
