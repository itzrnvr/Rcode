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
  FolderIcon,
  GitForkIcon,
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
    sidebarCollapsed,
    sidePanelCollapsed,
    setHasSideChats,
    bumpSessionList,
    settings,
    setSidePanelCollapsed,
  } = useApp();
  const { messages, streamingContent, streamingReasoning, liveSteps, pendingApproval, turnUsage, respondApproval, isStreaming, error, sendMessage, sendTo, resend, setVersion, stopStream, editMessage, deleteMessage, refreshMessages } = useChat(currentSessionId);
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
    // Side chats live in the panel — main chat stays put
    setSidePanelCollapsed(false);
    window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type: "side-conversation", sideChatId: result.session.id } }));
  }, [currentSessionId, session, settings, bumpSideChats, setHasSideChats, setSidePanelCollapsed]);

  const menuItems: ContextMenuItem[] = [
    { label: "Create side chat from selection", onClick: createSideChat },
  ];

  const handleSend = useCallback(async (text: string, meta?: { mode?: string; reasoningEffort?: string }) => {
    const trimmed = text.trim();
    if (trimmed.toLowerCase() === "/compact") {
      if (!currentSessionId) return;
      try {
        await (api as unknown as { compactChat: (id: string) => Promise<{ summary: string }> }).compactChat(currentSessionId);
        await refreshMessages();
      } catch (e) {
        console.error("compact failed", e);
      }
      return;
    }
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

  const [contextInfo, setContextInfo] = useState<{ system: number; tools: number; messages: number; cacheRate: number | null } | null>(null);
  useEffect(() => {
    if (!currentSessionId) return;
    let cancelled = false;
    (api as unknown as { contextInfo: (id: string) => Promise<{ system: number; tools: number; messages: number; cacheRate: number | null }> })
      .contextInfo(currentSessionId)
      .then(info => { if (!cancelled) setContextInfo(info); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentSessionId, messages]);

  const [railHover, setRailHover] = useState<{ i: number; top: number; left: number } | null>(null);
  const [activeMsgIdx, setActiveMsgIdx] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const stripMarkers = (s: string) => s
    .replace(/\[worked:\d+s\]/g, "")
    .replace(/\[usage:[\d/]+\]/g, "")
    .replace(/<\/?think>/g, "")
    .replace(/\[tool:[\s\S]*?<\/toolresult>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Minimap-style navigator: active index derived from scroll fraction
  // (same technique as editor minimaps — deterministic, no rect queries).
  const syncActiveIdx = useCallback((el: HTMLElement) => {
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const fraction = Math.min(1, Math.max(0, el.scrollTop / max));
    setActiveMsgIdx(Math.round(fraction * Math.max(0, messages.length - 1)));
  }, [messages.length]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) syncActiveIdx(el);
  }, [messages, syncActiveIdx]);

  const handleMsgScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    syncActiveIdx(e.currentTarget);
  }, [syncActiveIdx]);

  const jumpToMsg = useCallback((i: number) => {
    const el = chatScrollRef.current;
    if (!el) return;
    const n = Math.max(1, messages.length - 1);
    el.scrollTo({ top: (i / n) * (el.scrollHeight - el.clientHeight), behavior: "smooth" });
  }, [messages.length]);

  const handleFork = useCallback(async (messageId: string) => {
    if (!currentSessionId) return;
    try {
      const fork = await (api as unknown as { forkSession: (sid: string, mid: string) => Promise<{ id: string }> }).forkSession(currentSessionId, messageId);
      bumpSessionList();
      setCurrentSessionId(fork.id);
    } catch (e) {
      console.error("fork failed", e);
    }
  }, [currentSessionId, bumpSessionList, setCurrentSessionId]);

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
            contextInfo={contextInfo}
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
        <HeaderPills />
        {session && session.depth > 0 && (
          <span className="chat-depth">depth {session.depth}</span>
        )}
        <button
          className="chat-header-toggle"
          title="Open trajectory viewer"
          onClick={() => { setSidePanelCollapsed(false); window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type: "trajectory" } })); }}
        >
          <ActivityIcon size={14} />
        </button>
        <button className="chat-header-toggle" title="More">
          <ChevronDownIcon size={14} />
        </button>
      </div>

      {/* Messages */}
      {(sidebarCollapsed || sidePanelCollapsed) && <div className="msg-rail" aria-label="Message navigator">
        {(() => {
          const userIdx = messages.map((m, i) => ({ m, i })).filter(x => x.m.role === "user");
          let focus = railHover?.i ?? 0;
          if (railHover == null) {
            for (let k = Math.min(activeMsgIdx, messages.length - 1); k >= 0; k--) {
              if (messages[k].role === "user") { focus = k; break; }
            }
          }
          return userIdx.map(({ m, i }) => {
            const d = Math.abs(i - focus);
            const w = Math.round((9 + 11 * Math.exp(-(d * d) / 3.4)) * 10) / 10;
            return (
              <button
                key={m.id}
                className={`msg-tick ${i <= activeMsgIdx ? "active" : ""} ${d === 0 ? "focus" : ""}`}
                title=""
                onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); const rail = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); setRailHover({ i, top: r.top, left: rail.right }); }}
                onMouseLeave={() => setRailHover(null)}
                onClick={() => jumpToMsg(i)}
              >
                <span className="msg-bar" style={{ width: w }} />
              </button>
            );
          });
        })()}
      </div>}
      {railHover != null && messages[railHover.i] && (() => {
        const reply = messages.slice(railHover.i + 1).find(x => x.role === "assistant");
        return (
          <div className="msg-rail-card" style={{ top: Math.max(60, railHover.top - 20), left: railHover.left + 10 }}>
            <div className="msg-rail-title">{stripMarkers(messages[railHover.i].content).slice(0, 60) || "(empty)"}</div>
            <div className="msg-rail-preview">{reply ? stripMarkers(reply.content).slice(0, 200) : "No reply yet."}</div>
          </div>
        );
      })()}
      <div className="chat-messages" ref={chatScrollRef} onContextMenu={handleContextMenu} onScroll={handleMsgScroll}>
        {messages.map((msg, i) => {
          const prevUser = msg.role === "assistant"
            ? messages.slice(0, i).reverse().find(m => m.role === "user")
            : undefined;
          const versionCount = msg.versions?.length ?? 1;
          return (
            <ChatMessage
              key={msg.id}
              mid={msg.id}
              role={msg.role}
              content={msg.content}
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
              onFork={() => handleFork(msg.id)}
              versionIndex={msg.versionIndex}
              versionCount={versionCount}
              onPrevVersion={() => setVersion(msg.id, (msg.versionIndex ?? 0) - 1)}
              onNextVersion={() => setVersion(msg.id, (msg.versionIndex ?? 0) + 1)}
            />
          );
        })}
        {isStreaming && streamingContent && (
          <ChatMessage role="assistant" content={streamingContent} reasoning={streamingReasoning || undefined} liveSteps={liveSteps} liveUsage={turnUsage} streaming />
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
        disabled={false}
        contextUsed={contextUsed}
        contextInfo={contextInfo}
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

function HeaderPills() {
  const [cwdName, setCwdName] = useState("");
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const a = api as unknown as { gitCwdName: () => Promise<string>; gitStatus: () => Promise<{ branch: string }>; gitBranches: () => Promise<string[]>; gitCheckout: (b: string) => Promise<{ ok: boolean }> };
  useEffect(() => {
    a.gitCwdName().then(setCwdName).catch(() => {});
    a.gitStatus().then(s => setBranch(s.branch)).catch(() => {});
  }, []);
  const toggle = async () => {
    if (!open) { try { setBranches(await a.gitBranches()); } catch {} }
    setOpen(o => !o);
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 10, position: "relative" }}>
      <span className="header-pill"><FolderIcon size={12} />{cwdName || "…"}</span>
      <button className="header-pill" onClick={toggle} title="Switch branch">
        <GitForkIcon size={12} />{branch || "…"}<ChevronDownIcon size={10} />
      </button>
      {open && (
        <span data-sp-menu="1" className="sp-menu" style={{ position: "absolute", top: 26, left: 0, minWidth: 160, background: "#1c1c1c", border: "1px solid #2e2e2e", borderRadius: 10, padding: 6, zIndex: 1500, boxShadow: "0 12px 32px rgba(0,0,0,.55)", display: "flex", flexDirection: "column" }}>
          {branches.map(b => (
            <button key={b} onClick={async () => { setOpen(false); try { await a.gitCheckout(b); setBranch(b); } catch {} }}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderRadius: 8, background: b === branch ? "#252525" : "transparent", border: "none", color: "#e8e8e8", fontSize: 12, textAlign: "left", cursor: "pointer" }}>
              <GitForkIcon size={11} />{b}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
