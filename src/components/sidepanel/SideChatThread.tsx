/*
 * PURPOSE: Side-chat thread rendered INSIDE the right side panel.
 *
 * Split-screen layout: main chat stays in the center panel untouched; each
 * side conversation gets its own message list + composer here. Side chats are
 * children of the current main session (they never appear in the left session
 * list — listMainSessions filters task_type='main').
 *
 * Reuses useChat (streaming/persistence) + ChatMessage + ChatInput so behavior
 * matches the main chat exactly.
 */

import { useEffect, useRef } from "react";

import { useChat } from "../../state/useChat";
import { ChatMessage } from "../chat/ChatMessage";
import { ChatInput } from "../chat/ChatInput";

interface SideChatThreadProps {
  sessionId: string;
  title: string;
}

export function SideChatThread({ sessionId, title }: SideChatThreadProps) {
  const {
    messages,
    streamingContent,
    isStreaming,
    error,
    sendMessage,
    stopStream,
    editMessage,
    deleteMessage,
  } = useChat(sessionId);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: "1px solid #1f1f1f" }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#e8e8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ fontSize: 11, color: "#8a8a8a" }}>side chat</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 12, minHeight: 0 }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{ color: "#8a8a8a", fontSize: 12, textAlign: "center", marginTop: 24 }}>No messages yet — ask a follow-up.</div>
        )}
        {messages.map(msg => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            onEdit={c => editMessage(msg.id, c)}
            onDelete={() => deleteMessage(msg.id)}
          />
        ))}
        {isStreaming && streamingContent && (
          <ChatMessage role="assistant" content={streamingContent} streaming />
        )}
        {isStreaming && !streamingContent && <div className="message-assistant stream-cursor" />}
        {error && <div className="chat-error">Error: {error}</div>}
        <div ref={endRef} />
      </div>

      <ChatInput
        onSend={sendMessage}
        onStop={stopStream}
        streaming={isStreaming}
        disabled={isStreaming}
        placeholder="Message this side chat"
        compact
      />
    </div>
  );
}
