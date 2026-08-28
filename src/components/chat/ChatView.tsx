/*
 * PURPOSE: Center panel — message thread + composer with streaming
 *
 * Design inspirations: ZCode (depth indicators, breadcrumb) + Unsloth
 * (mascot welcome screen, tool-call transparency panels, quick prompts).
 *
 * Features:
 *   - Welcome screen with mascot + greeting + quick-prompt cards
 *   - Right-click on selected text → "Create side chat" context menu
 *   - Tool-call transparency panels (e.g. "Used tool: Searched X")
 *   - Back button on side chats (depth > 0) navigates to parent
 *   - Auto-scroll to bottom during streaming
 */

import { useState, useRef, useEffect, useCallback } from "react";

import { useApp } from "../../state/AppContext";
import { useChat } from "../../state/useChat";
import { api } from "../../api/client";

import type { Session } from "../../types";

import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import {
  ArrowLeftIcon,
  CompassIcon,
  CodeIcon,
  BeakerIcon,
  SparkleIcon,
  ChevronDownIcon,
} from "../common/Icons";

const QUICK_PROMPTS = [
  {
    icon: CompassIcon,
    title: "Explore an idea",
    prompt: "Help me explore an idea about distributed systems…",
  },
  {
    icon: CodeIcon,
    title: "Refactor code",
    prompt: "Review this code and suggest improvements: ",
  },
  {
    icon: BeakerIcon,
    title: "Debug an issue",
    prompt: "I'm getting an error. Here's the stack trace: ",
  },
  {
    icon: SparkleIcon,
    title: "Brainstorm",
    prompt: "Brainstorm 10 creative names for a project that…",
  },
];

export function ChatView() {
  const {
    currentSessionId,
    setCurrentSessionId,
    bumpSideChats,
    setHasSideChats,
    settings,
  } = useApp();
  const { messages, streamingContent, isStreaming, error, sendMessage, stopStream, editMessage, deleteMessage } = useChat(currentSessionId);
  const [session, setSession] = useState<Session | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentSessionId) { setSession(null); return; }
    api.getSession(currentSessionId).then(s => setSession(s));
  }, [currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection()?.toString();
    if (sel) {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    }
  }, []);

  const createSideChat = useCallback(async () => {
    const sel = window.getSelection()?.toString() ?? "";
    if (!currentSessionId || !session) return;
    const result = await api.createSideChat({
      parentSessionId: currentSessionId,
      selectedText: sel,
      model: settings.model,
      provider: settings.providerName,
    });
    setCurrentSessionId(result.session.id);
    setHasSideChats(true);
    bumpSideChats();
    setMenu(null);
  }, [currentSessionId, session, settings, bumpSideChats, setHasSideChats, setCurrentSessionId]);

  const menuItems: ContextMenuItem[] = [
    { label: "Create side chat from selection", onClick: createSideChat },
  ];

  const useQuickPrompt = (prompt: string) => {
    setDraftPrompt(prompt);
  };

  // Welcome screen
  if (!currentSessionId) {
    return (
      <div className="panel-chat">
        <div className="chat-welcome">
          <div className="chat-mascot">
            <div className="mascot-glow" />
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{filter: 'drop-shadow(0 3px 12px color-mix(in srgb, currentColor 42%, transparent))'}}>
              <path d="M7 3.8 V20.2 M7 3.8 H13 C15 3.8, 17 5.8, 17 8 C17 10.2, 15 12.2, 13 12.2 H7" />
              <path d="M11.5 12.2 C12.8 14.5, 14.2 16.8, 15.5 18.5 L17.8 20.8" strokeLinecap="round" />
              <path d="M7 8.2 H12.8" opacity="0.32" strokeWidth="1.15" />
              <path d="M7 3.8 H7" strokeWidth="3.4" strokeLinecap="square" opacity="0.95" />
            </svg>
          </div>
          <h1 className="chat-welcome-title">
            What's on your mind, <span className="gradient-text">{settings.providerName || "friend"}</span>?
          </h1>
          <p className="chat-welcome-subtitle">
            Ask me to write code, brainstorm, debug, explain… or anything else.
          </p>

          <div className="chat-quick-prompts">
            {QUICK_PROMPTS.map(({ icon: Icon, title, prompt }) => (
              <button
                key={title}
                className="chat-quick-prompt-card"
                onClick={() => useQuickPrompt(prompt)}
              >
                <div className="chat-quick-prompt-icon">
                  <Icon size={16} />
                </div>
                <div className="chat-quick-prompt-body">
                  <span className="chat-quick-prompt-title">{title}</span>
                  <span className="chat-quick-prompt-text">{prompt}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="chat-welcome-input">
            <ChatInput
              onSend={sendMessage}
              disabled={false}
              placeholder="Do anything"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-chat">
      {/* Breadcrumb / title */}
      <div className="chat-header">
        {session && session.depth > 0 && (
          <button
            className="chat-back-btn"
            onClick={() => session.parentId && setCurrentSessionId(session.parentId)}
            title="Back to parent"
          >
            <ArrowLeftIcon size={16} />
          </button>
        )}
        <span className="chat-title">{session?.title ?? "Loading…"}</span>
        {session && session.depth > 0 && (
          <span className="chat-depth">depth {session.depth}</span>
        )}
        <button className="chat-header-toggle" title="More">
          <ChevronDownIcon size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages" onContextMenu={handleContextMenu}>
        {messages.map(msg => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            model={msg.role === "assistant" ? session?.model : undefined}
            onEdit={newContent => editMessage(msg.id, newContent)}
            onDelete={() => deleteMessage(msg.id)}
          />
        ))}
        {isStreaming && streamingContent && (
          <ChatMessage role="assistant" content={streamingContent} streaming model={session?.model} />
        )}
        {isStreaming && !streamingContent && (
          <div className="message-assistant stream-cursor" />
        )}
        {error && (
          <div className="chat-error">Error: {error}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        onStop={stopStream}
        streaming={isStreaming}
        disabled={isStreaming}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
