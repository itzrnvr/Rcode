/*
 * PURPOSE: Chat state hook — loads messages, sends with streaming, accumulates chunks
 *
 * Flow: user sends → api.sendChat (async) → chunk events accumulate in
 * streamingContent → sendChat resolves → reload messages from DB.
 *
 * The streaming content is displayed as a live-updating assistant message
 * while isStreaming is true. After completion, the DB has the full message.
 *
 * CONSUMERS: components/chat/ChatView.tsx
 */

import { useState, useEffect, useCallback } from "react";

import { api } from "../api/client";
import { useApp } from "./AppContext";

import type { Message } from "../types";

export function useChat(sessionId: string | null) {
  const { settings } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
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

  const sendMessage = useCallback(async (text: string) => {
    if (!sessionId || !text.trim()) return;

    setError(null);

    // Optimistic: add user message to local state
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    // Set up chunk listener before sending
    const removeListener = api.onChatChunk(sessionId, (chunk) => {
      if (chunk.done) return;
      setStreamingContent(prev => prev + chunk.content);
    });

    setIsStreaming(true);
    setStreamingContent("");

    try {
      await api.sendChat({ sessionId, userMessage: text, model: settings.model });

      // After sendChat resolves, the assistant message is in the DB
      const msgs = await api.getMessages(sessionId);
      setMessages(msgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      removeListener();
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [sessionId, settings.model]);

  // For welcome → new session: send to a specific id not yet in the hook's closure
  const sendTo = useCallback(async (targetId: string, text: string) => {
    if (!text.trim()) return;
    setError(null);
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: targetId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    const removeListener = api.onChatChunk(targetId, (chunk) => {
      if (chunk.done) return;
      setStreamingContent(prev => prev + chunk.content);
    });
    setIsStreaming(true);
    setStreamingContent("");
    try {
      await api.sendChat({ sessionId: targetId, userMessage: text, model: settings.model });
      const msgs = await api.getMessages(targetId);
      setMessages(msgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      removeListener();
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [settings.model]);

  // Re-run the turn anchored at a user message (retry / edit-and-resend).
  // The new answer lands as an extra version on the existing assistant message.
  const resend = useCallback(async (anchorUserMessageId: string) => {
    if (!sessionId) return;
    setError(null);
    const removeListener = api.onChatChunk(sessionId, (chunk) => {
      if (chunk.done) return;
      setStreamingContent(prev => prev + chunk.content);
    });
    setIsStreaming(true);
    setStreamingContent("");
    try {
      await api.resendChat({ sessionId, anchorUserMessageId, model: settings.model });
      const msgs = await api.getMessages(sessionId);
      setMessages(msgs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      removeListener();
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [sessionId, settings.model]);

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

  return { messages, streamingContent, isStreaming, error, sendMessage, sendTo, resend, setVersion, stopStream, editMessage, deleteMessage };
}
