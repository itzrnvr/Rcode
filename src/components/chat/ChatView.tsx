/*
 * PURPOSE: Center panel — message thread + composer with streaming
 *
 * Design inspirations: depth indicators, breadcrumb, plus local model picker
 * (mascot welcome screen, tool-call transparency panels, quick prompts).
 *
 * Features:
 *   - Welcome screen with mascot + greeting + quick-prompt cards
 *   - Right-click on selected text → "Create side chat" context menu
 *   - Tool-call transparency panels (e.g. "Used tool: Searched X")
 *   - Back button on side chats (depth > 0) navigates to parent
 *   - Auto-scroll to bottom during streaming
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import { useApp } from "../../state/AppContext";
import { useChat } from "../../state/useChat";
import { api } from "../../api/client";
import { pendingAutosend } from "../sidepanel/SideChatThread";

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
  ActivityIcon,
} from "../common/Icons";

const QUICK_PROMPTS = [
  {
    icon: CompassIcon,
    title: "Explore an idea",
    prompt: "Help me explore an idea about distributed systems...",
  },
  {
    icon: CodeIcon,
    title: "Refactor code",
    prompt: "Review this code and suggest improvements:",
  },
  {
    icon: BeakerIcon,
    title: "Debug an issue",
    prompt: "I'm getting an error. Here's the stack trace:",
  },
  {
    icon: SparkleIcon,
    title: "Brainstorm",
    prompt: "Brainstorm 10 creative names for a project that...",
  },
];

export function ChatView() {
  const {
    currentSessionId,
    setCurrentSessionId,
    bumpSideChats,
    setHasSideChats,
    bumpSessionList,
    settings,
    setSidePanelCollapsed,
  } = useApp();
  const { messages, streamingContent, streamingReasoning, liveSteps, pendingApproval, turnUsage, respondApproval, isStreaming, error, sendMessage, sendTo, resend, setVersion, stopStream, editMessage, deleteMessage } = useChat(currentSessionId);
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
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const createSideChat = useCallback(async () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel || !currentSessionId || !session) return;
    const result = await api.createSideChat({ parentSessionId: currentSessionId, title: sel.slice(0, 40), model: settings.model, provider: settings.providerName });
    bumpSideChats();
    setHasSideChats(true);
    setMenu(null);
    setCurrentSessionId(result.session.id);
  }, [currentSessionId, session, settings, bumpSideChats, setHasSideChats, setCurrentSessionId]);

  const menuItems: ContextMenuItem[] = [
    { label: "Create side chat from selection", onClick: createSideChat },
  ];

  const handleSend = useCallback(async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
    const trimmed = text.trim();
    if (trimmed.toLowerCase().startsWith("/side")) {
      if (!currentSessionId) {
        // No session to branch from — create a new main session first
        return sendMessage(text, meta);
      }
      const rest = trimmed.slice(5).trim();
      const title = rest ? rest.slice(0, 40) : `Side: ${session?.title?.slice(0, 24) ?? "branch"}`;
      try {
        const result = await api.createSideChat({ parentSessionId: currentSessionId, title, model: settings.model, provider: settings.providerName });
        bumpSideChats();
        setHasSideChats(true);
        await setSidePanelCollapsed(false);
        // Activate the new side-chat pill directly (not whatever tab was open)
        window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type: "side-conversation", sideChatId: result.session.id } }));
        if (rest) pendingAutosend.set(result.session.id, rest);
        // Branch created — stays in main, side panel pill appears via sync
      } catch (e) {
        console.error("side branch failed", e);
      }
      return;
    }
    return sendMessage(text, meta);
  }, [currentSessionId, session, settings, bumpSideChats, setHasSideChats, setSidePanelCollapsed, sendMessage]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ cmd: string }>;
      if (ce.detail?.cmd) handleSend(ce.detail.cmd);
  };
    window.addEventListener("chat:slash", handler as EventListener);
    return () => window.removeEventListener("chat:slash", handler as EventListener);
  }, [handleSend]);

  const useQuickPrompt = (prompt: string) => {
    setDraftPrompt(prompt);
  };

  const handleWelcomeSend = useCallback(async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
    if (!text.trim()) return;
    const session = await api.createSession({ model: settings.model, provider: settings.providerName, title: text.slice(0, 40) });
    setCurrentSessionId(session.id);
    bumpSessionList();
    // Use sendTo which correctly subscribes to onChatChunk before sendChat and reloads from DB
    await sendTo(session.id, text, meta);
    bumpSessionList();
  }, [settings.model, settings.providerName, setCurrentSessionId, bumpSessionList, sendTo]);

  const contextUsed = useMemo(() => Math.round((messages.reduce((a, m) => a + m.content.length, 0) + streamingContent.length) / 4), [messages, streamingContent]);

  // Welcome screen
  if (!currentSessionId) {
    return (
      <div className="panel-chat">
        <div className="chat-welcome">
          <div className="chat-mascot">
            <div className="mascot-glow" />
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" style={{filter: 'drop-shadow(0 3px 12px color-mix(in srgb, currentColor 42%, transparent))'}}>
              <g strokeLinecap="square" strokeLinejoin="miter">
                <path d="M7 3.8 V20.2" strokeWidth="2.8" />
                <path d="M6.2 3.8 H7.8" strokeWidth="2.8" />
                <path d="M6.2 20.2 H7.8" strokeWidth="2.8" />
              </g>
              <g strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3.8 H13.1 C15.3 3.8, 17.2 5.4, 17.2 8 C17.2 10.6, 15.3 12.2, 13.1 12.2 H7" strokeWidth="1.95" />
                <path d="M11.8 12.2 C13.4 14.8, 15.2 17.6, 16.8 19.4 C17.9 20.6, 19.4 21.6, 20.2 20.6 C20.5 20.2, 20.3 19.4, 19.7 18.2" strokeWidth="1.95" />
                <path d="M7 8.2 H12.6" opacity="0.28" strokeWidth="1.15" />
              </g>
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
              onSend={handleWelcomeSend}
              disabled={false}
              placeholder="Do anything"
              initialValue={draftPrompt}
            contextUsed={contextUsed}
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
        <button
          className="chat-header-toggle"
          title="Open trajectory viewer"
          onClick={() => window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type: "trajectory" } }))}
        >
          <ActivityIcon size={14} />
        </button>
        <button className="chat-header-toggle" title="More">
          <ChevronDownIcon size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages" onContextMenu={handleContextMenu}>
        {messages.map((msg, i) => {
          const prevUser = msg.role === "assistant"
            ? messages.slice(0, i).reverse().find(m => m.role === "user")
            : undefined;
          const versionCount = msg.versions?.length ?? 1;
          return (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              model={msg.role === "assistant" ? session?.model : undefined}
              onEdit={newContent => {
                // Editing a user prompt re-sends the turn; assistant edits just save.
                if (msg.role === "user") {
                  editMessage(msg.id, newContent).then(() => resend(msg.id));
                } else {
                  editMessage(msg.id, newContent);
                }
              }}
              onDelete={() => deleteMessage(msg.id)}
              onRetry={msg.role === "assistant" && prevUser ? () => resend(prevUser.id) : undefined}
              versionIndex={msg.versionIndex}
              versionCount={versionCount}
              onPrevVersion={() => setVersion(msg.id, (msg.versionIndex ?? 0) - 1)}
              onNextVersion={() => setVersion(msg.id, (msg.versionIndex ?? 0) + 1)}
            />
          );
        })}
        {isStreaming && streamingContent && (
          <ChatMessage role="assistant" content={streamingContent} reasoning={streamingReasoning || undefined} liveSteps={liveSteps} liveUsage={turnUsage} streaming model={session?.model} />
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
        onSend={handleSend}
        onStop={stopStream}
        streaming={isStreaming}
        disabled={isStreaming}
        contextUsed={contextUsed}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {pendingApproval && (
        <div className="approval-dialog">
          <div className="approval-card">
            <div style={{ fontSize: 14, fontWeight: 700 }}>Run this command?</div>
            <pre className="approval-cmd">{pendingApproval.command}</pre>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="ms-btn" onClick={() => respondApproval(false)}>Deny</button>
              <button className="ms-btn primary" onClick={() => respondApproval(true)}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
