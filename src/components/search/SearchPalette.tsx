/*
 * PURPOSE: Command palette — Search chats, sessions, settings, slash, new tabs
 *
 * Triggered by left sidebar Search button or ⌘K / Ctrl+K.
 * Matches the screenshot: centered overlay with "Search chats" input, sections for
 * Chats (with Ctrl+1..9), Quick actions (New chat, Open folder), and new tabs
 * that open from the left in the sidepanel.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "../../state/AppContext";
import { useSessions } from "../../state/useSessions";
import { useProviders } from "../../state/useProviders";
import { api } from "../../api/client";
import {
  SearchIcon,
  PlusIcon,
  SettingsIcon,
  MessageCircleIcon,
  TerminalSquareIcon,
  Code2Icon,
  GlobeIcon,
  SparkleIcon,
  FolderIcon,
} from "../common/Icons";

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const { setCurrentSessionId, setShowSettings, bumpSessionList, settings } = useApp();
  const { sessions } = useSessions(0);
  const { allModels } = useProviders();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) {
          // Trigger open via custom event
          window.dispatchEvent(new CustomEvent("open-search-palette"));
        } else {
          onClose();
        }
      }
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredChats = useMemo(() => {
    if (!query.trim()) return sessions.slice(0, 9);
    const q = query.toLowerCase();
    return sessions.filter(s => s.title.toLowerCase().includes(q)).slice(0, 9);
  }, [sessions, query]);

  const filteredModels = useMemo(() => {
    if (!query.trim()) return allModels.slice(0, 5);
    const q = query.toLowerCase();
    return allModels.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 5);
  }, [allModels, query]);

  const handleSelectChat = (id: string) => {
    setCurrentSessionId(id);
    onClose();
  };

  const handleNewChat = async () => {
    setCurrentSessionId(null);
    onClose();
  };

  const handleNewTab = async (type: "terminal" | "side-conversation" | "review" | "browser") => {
    // Dispatch event for SidePanel to create tab from left
    window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type } }));
    onClose();
  };

  const handleSlash = (cmd: string) => {
    // Dispatch to ChatView to handle slash
    window.dispatchEvent(new CustomEvent("chat:slash", { detail: { cmd } }));
    onClose();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: "70vh",
          background: "#1a1a1a",
          border: "1px solid #262626",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #262626" }}>
          <span style={{ color: "#8a8a8a", display: "flex" }}><SearchIcon size={16} /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e8e8e8", fontSize: 15 }}
          />
          <span style={{ fontSize: 11, color: "#52525b", border: "1px solid #262626", borderRadius: 4, padding: "2px 6px" }}>ESC</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 12px" }}>
          {/* Chats */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "8px 8px 4px" }}>Chats</div>
          {filteredChats.length === 0 ? (
            <div style={{ padding: "8px 12px", color: "#52525b", fontSize: 13 }}>No chats found</div>
          ) : (
            filteredChats.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => handleSelectChat(s.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  color: "#e8e8e8",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ opacity: 0.6, display: "flex" }}><MessageCircleIcon size={14} /></span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                <span style={{ fontSize: 11, color: "#52525b", border: "1px solid #262626", borderRadius: 4, padding: "1px 5px" }}>Ctrl+{idx + 1}</span>
              </button>
            ))
          )}

          {/* Quick actions */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "12px 8px 4px" }}>Quick actions</div>
          <button
            onClick={handleNewChat}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#e8e8e8", textAlign: "left", cursor: "pointer", fontSize: 13 }}
            onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <PlusIcon size={14} />
            <span style={{ flex: 1 }}>New chat</span>
            <span style={{ fontSize: 11, color: "#52525b", border: "1px solid #262626", borderRadius: 4, padding: "1px 5px" }}>Ctrl+N</span>
          </button>
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent("open-folder")); onClose(); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#e8e8e8", textAlign: "left", cursor: "pointer", fontSize: 13 }}
            onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <FolderIcon size={14} />
            <span style={{ flex: 1 }}>Open folder</span>
            <span style={{ fontSize: 11, color: "#52525b", border: "1px solid #262626", borderRadius: 4, padding: "1px 5px" }}>Ctrl+O</span>
          </button>

          {/* Slash commands */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "12px 8px 4px" }}>Slash commands</div>
          {[
            { cmd: "/side", desc: "Fork a side conversation (branch)", Icon: MessageCircleIcon },
            { cmd: "/compact", desc: "Summarize and compact", Icon: SparkleIcon },
            { cmd: "/clear", desc: "Clear the current chat", Icon: SearchIcon },
            { cmd: "/help", desc: "Show available commands", Icon: SparkleIcon },
          ]
            .filter(c => !query || c.cmd.includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.cmd}
                onClick={() => handleSlash(c.cmd)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#e8e8e8", textAlign: "left", cursor: "pointer", fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <c.Icon size={14} />
                <span style={{ flex: 1 }}>{c.cmd}</span>
                <span style={{ fontSize: 12, color: "#8a8a8a" }}>{c.desc}</span>
              </button>
            ))}

          {/* Settings shortcuts */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "12px 8px 4px" }}>Settings</div>
          {[
            { label: "API Settings", Icon: SettingsIcon, action: () => { setShowSettings(true); onClose(); } },
            { label: "Theme", Icon: SettingsIcon, action: () => { setShowSettings(true); onClose(); } },
            { label: "Model Settings", Icon: SettingsIcon, action: () => { setShowSettings(true); onClose(); } },
          ]
            .filter(c => !query || c.label.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.label}
                onClick={c.action}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#e8e8e8", textAlign: "left", cursor: "pointer", fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <c.Icon size={14} />
                <span>{c.label}</span>
              </button>
            ))}

          {/* New tabs - from the left in sidepanel */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8a8a8a", textTransform: "uppercase", letterSpacing: 0.6, padding: "12px 8px 4px" }}>New tabs</div>
          {[
            { type: "terminal" as const, label: "Terminal", Icon: TerminalSquareIcon },
            { type: "side-conversation" as const, label: "Side conversation", Icon: MessageCircleIcon },
            { type: "review" as const, label: "Review", Icon: Code2Icon },
            { type: "browser" as const, label: "Browser", Icon: GlobeIcon },
          ]
            .filter(c => !query || c.label.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.type}
                onClick={() => handleNewTab(c.type)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#e8e8e8", textAlign: "left", cursor: "pointer", fontSize: 13 }}
                onMouseEnter={e => (e.currentTarget.style.background = "#262626")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <c.Icon size={14} />
                <span>{c.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#52525b" }}>sidepanel</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
