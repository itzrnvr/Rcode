/*
 * PURPOSE: Chat composer — Codex CLI layout
 *
 * Layout (Codex pattern):
 *   [textarea (auto-resizing)]
 *   [+ attach] [Mode badge] ····· [model picker] [mic] [send]
 *
 * The model picker and mode badge use Radix Popover for:
 * - Keyboard navigation (Esc to close, arrows inside)
 * - Focus management (auto-focus on first option)
 * - ARIA listbox semantics
 * - Click-outside dismissal
 *
 * Mode badge controls agent permission level (Plan / Full access / Restricted).
 * Model picker shows provider + model + quant badge.
 *
 * Enter sends, Shift+Enter inserts newline.
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";

import { useApp } from "../../state/AppContext";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../primitives/RadixWrappers";
import {
  ArrowUpIcon,
  StopIcon,
  PlusIcon,
  MicIcon,
  ChevronDownIcon,
  PlanModeIcon,
  FullAccessModeIcon,
  RestrictedModeIcon,
  SparkleIcon,
  TrashIcon,
  MessageCircleIcon,
  ZapIcon,
} from "../common/Icons";
import { useProviders } from "../../state/useProviders";
import type { ModelEntry } from "../../models";

const SLASH_COMMANDS = [
  { name: "/compact", label: "Compact", desc: "Summarize and compact the conversation", Icon: SparkleIcon },
  { name: "/clear", label: "Clear", desc: "Clear the current chat", Icon: TrashIcon },
  { name: "/help", label: "Help", desc: "Show available commands", Icon: SparkleIcon },
  { name: "/side", label: "Side", desc: "Branch off a side conversation (fork)", Icon: MessageCircleIcon },
] as const;

type AgentMode = "plan" | "full-access" | "restricted";

interface ModeOption {
  id: AgentMode;
  label: string;
  description: string;
  Icon: React.FC<{ size?: number; className?: string }>;
}

const MODES: ModeOption[] = [
  { id: "plan", label: "Plan", description: "Read-only. Agent proposes a plan before taking action.", Icon: PlanModeIcon },
  { id: "full-access", label: "Full access", description: "Agent can read, write, and execute commands without prompts.", Icon: FullAccessModeIcon },
  { id: "restricted", label: "Restricted", description: "Every file write and shell command requires explicit approval.", Icon: RestrictedModeIcon },
];

interface ChatInputProps {
  onSend: (text: string, meta?: { mode?: string; reasoningEffort?: string }) => void;
  contextUsed?: number;
  contextInfo?: { system: number; tools: number; messages: number; cacheRate: number | null } | null;
  disabled: boolean;
  onStop?: () => void;
  streaming?: boolean;
  placeholder?: string;
  initialValue?: string;
  compact?: boolean;
}

export function ChatInput({
  onSend,
  disabled,
  onStop,
  streaming = false,
  placeholder = "Do anything",
  initialValue,
  compact = false,
  contextUsed,
  contextInfo,
}: ChatInputProps) {
  const { settings, setSetting } = useApp();
  const { allModels: providerModels } = useProviders();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AgentMode>("full-access");
  const [ctxHover, setCtxHover] = useState(false);
  const [effort, setEffort] = useState<string>(settings.reasoningEffort || "max");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialValue) setText(initialValue);
  }, [initialValue]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    setText(el.value);
  }, []);

  const showSlash = text.startsWith("/");
  const filteredSlash = showSlash
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(text.split(" ")[0].toLowerCase()))
    : [];
  const [slashIdx, setSlashIdx] = useState(0);

  useEffect(() => { setSlashIdx(0); }, [text]);

  const chooseModel = useCallback((m: ModelEntry) => {
    setSetting("model", m.id);
    setSetting("providerName", m.provider);
  }, [setSetting]);

  const liveModels = providerModels;
  const currentModel = liveModels.find(m => m.id === settings.model) ?? liveModels[0];

  // Keep selection within configured providers only
  useEffect(() => {
    if (providerModels.length > 0 && !providerModels.some(m => m.id === settings.model)) {
      chooseModel(providerModels[0]);
    }
  }, [providerModels, settings.model, chooseModel]);
  const currentMode = MODES.find(m => m.id === mode) ?? MODES[1];

  const contextMax = (() => {
    const entry = liveModels.find(m => m.id === (currentModel?.id ?? settings.model));
    const c = entry?.context;
    if (typeof c === "number") return c;
    if (typeof c === "string") {
      const m2 = /^([\d.]+)\s*([kKmM])?$/.exec(c.trim());
      if (m2) return Math.round(parseFloat(m2[1]) * (m2[2] ? (m2[2].toLowerCase() === "k" ? 1000 : 1000000) : 1));
    }
    return null;
  })();
  const fmtK = (n: number) => (n >= 1000000 ? (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + "M" : Math.round(n / 1000) + "K");

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    // Handle slash commands
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      const match = SLASH_COMMANDS.find(c => c.name === cmd);
      if (match) {
        // For now, compact just sends a system message about compacting
        // The parent can intercept and handle compaction
        if (match.name === "/compact") {
          onSend("/compact");
          setText("");
          if (ref.current) ref.current.style.height = "auto";
          return;
        }
        if (match.name === "/clear") {
          onSend("/clear");
          setText("");
          if (ref.current) ref.current.style.height = "auto";
          return;
        }
      }
    }
    onSend(trimmed, { mode, reasoningEffort: effort });
    setText("");
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.focus();
    }
  }, [text, disabled, streaming, onSend]);

  const stop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx(i => (i + 1) % filteredSlash.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx(i => (i - 1 + filteredSlash.length) % filteredSlash.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const picked = filteredSlash[slashIdx];
        if (picked) {
          setText(picked.name + " ");
          requestAnimationFrame(() => ref.current?.focus());
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send, showSlash, filteredSlash, slashIdx, text]);

  const pickSlash = useCallback((name: string) => {
    setText(name + " ");
    ref.current?.focus();
  }, []);

  return (
    <div className={`chat-input-wrap ${compact ? "compact" : ""}`}>
      <div className={`chat-input-pill ${streaming ? "streaming" : ""}`}>
        {showSlash && filteredSlash.length > 0 && (
          <div className="slash-commands">
            {filteredSlash.map((cmd, idx) => (
              <button
                key={cmd.name}
                className={`slash-command-item ${idx === slashIdx ? "active" : ""}`}
                onClick={() => pickSlash(cmd.name)}
                onMouseEnter={() => setSlashIdx(idx)}
                onMouseDown={e => e.preventDefault()}
              >
                <span className="slash-command-icon"><cmd.Icon size={14} /></span>
                <span className="slash-command-name">{cmd.name}</span>
                <span className="slash-command-desc">{cmd.desc}</span>
                <span className="slash-command-slash">/</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          className="chat-input"
          value={text}
          onChange={handleInput}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || streaming}
          rows={1}
        />

        {/* Bottom toolbar — single horizontal row */}
        <div className="chat-input-toolbar">
          <div className="chat-input-toolbar-left">
            <button
              className="chat-input-icon-btn"
              title="Attach files"
              aria-label="Attach files"
              onClick={() => {}}
            >
              <PlusIcon size={16} />
            </button>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`mode-badge`}
                  aria-label={`Mode: ${currentMode.label}. Click to change.`}
                >
                  {!compact && <span className="mode-badge-label">{currentMode.label}</span>}
                  <ChevronDownIcon size={11} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={8} style={{ minWidth: 240, maxWidth: 280 }}>
                <div className="mode-picker-header">
                  <span>Agent mode</span>
                </div>
                <div className="mode-picker-list" role="radiogroup" aria-label="Agent mode">
                  {MODES.map(m => (
                    <PopoverClose asChild key={m.id}>
                      <button
                        role="radio"
                        aria-checked={m.id === mode}
                        className={`mode-picker-item ${m.id === mode ? "active" : ""}`}
                        onClick={() => setMode(m.id)}
                      >
                      <m.Icon size={16} className="mode-picker-icon" />
                      <div className="mode-picker-info">
                        <div className="mode-picker-label">{m.label}</div>
                        <div className="mode-picker-desc">{m.description}</div>
                      </div>
                      {m.id === mode && (
                        <span className="mode-picker-check" aria-label="Selected">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                      </button>
                    </PopoverClose>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="chat-input-toolbar-right">
            {contextUsed != null && (() => {
              const total = contextInfo ? contextInfo.system + contextInfo.tools + contextInfo.messages : contextUsed;
              const pct = contextMax ? Math.min(total / contextMax, 1) : 0;
              const C = 2 * Math.PI * 6;
              const color = pct > 0.9 ? "var(--color-danger)" : pct > 0.7 ? "var(--color-warning, #e5a50a)" : "var(--color-accent)";
              const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
              return (
                <span
                  className="context-ring"
                  role="img"
                  aria-label={`Context usage ${Math.round(pct * 100)}%`}
                  onMouseEnter={() => setCtxHover(true)}
                  onMouseLeave={() => setCtxHover(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-border)" strokeWidth="2.5" />
                    <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
                      strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 8 8)" />
                  </svg>
                  {ctxHover && (
                    <span className="ctx-card" role="tooltip">
                      <span className="ctx-card-head">
                        <span>Context window</span>
                        <span>{fmtK(total)}{contextMax ? `/${fmtK(contextMax)}` : ""} ({Math.round(pct * 1000) / 10}%)</span>
                      </span>
                      <span className="ctx-card-bar"><span style={{ width: `${Math.round(pct * 100)}%`, background: color }} /></span>
                      {contextInfo && (
                        <>
                          <span className="ctx-card-row"><span>Messages</span><span>{pctOf(contextInfo.messages)}%</span></span>
                          <span className="ctx-card-row"><span>Tools</span><span>{pctOf(contextInfo.tools)}%</span></span>
                          <span className="ctx-card-row"><span>System prompt</span><span>{pctOf(contextInfo.system)}%</span></span>
                        </>
                      )}
                      {contextInfo?.cacheRate != null && (
                        <span className="ctx-card-row ctx-card-cache"><span>Cache hit rate</span><span>{Math.round(contextInfo.cacheRate * 100)}%</span></span>
                      )}
                    </span>
                  )}
                </span>
              );
            })()}
            <Popover>
              <PopoverTrigger asChild>
                <button className="effort-badge" title="Reasoning effort">
                  <ZapIcon size={12} /> {effort === "max" ? "Max" : effort[0].toUpperCase() + effort.slice(1)} <ChevronDownIcon size={10} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} style={{ minWidth: 120 }}>
                <div className="mode-picker-list" role="radiogroup" aria-label="Reasoning effort">
                  {["low", "medium", "high", "max"].map(lvl => (
                    <PopoverClose asChild key={lvl}>
                      <button
                        role="radio"
                        aria-checked={effort === lvl}
                        className={`mode-picker-item ${effort === lvl ? "active" : ""}`}
                        onClick={() => { setEffort(lvl); setSetting("reasoningEffort", lvl); }}
                      >
                        <div className="mode-picker-label">{lvl === "max" ? "Max" : lvl[0].toUpperCase() + lvl.slice(1)}</div>
                      </button>
                    </PopoverClose>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="model-pill"
                  title="Choose model"
                  aria-label={`Model: ${currentModel?.name ?? "none"}. Click to change.`}
                >
                  <span className="model-pill-name">{currentModel?.name ?? "Loading models…"}</span>
                  <ChevronDownIcon size={11} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} style={{ minWidth: 300, maxWidth: 340 }}>
                <div className="model-picker-header">
                  <span>Choose a model</span>
                  <span className="model-picker-count">{liveModels.length} available</span>
                </div>
                <div className="model-picker-list" role="listbox" aria-label="Available models">
                  {liveModels.map(m => {
                    const isActive = m.id === settings.model;
                    return (
                      <PopoverClose asChild key={m.id}>
                        <button
                          role="option"
                          aria-selected={isActive}
                          className={`model-picker-item ${isActive ? "active" : ""}`}
                          onClick={() => chooseModel(m)}
                        >
                        <div className="model-picker-info">
                          <div className="model-picker-title">
                            <span className="model-picker-name">{m.name}</span>
                          </div>
                          <div className="model-picker-desc">{m.description}</div>
                          <div className="model-picker-provider">{m.providerLabel}</div>
                        </div>
                        {isActive && (
                          <span className="model-picker-check" aria-label="Selected">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                        </button>
                      </PopoverClose>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <button
              className="chat-input-icon-btn"
              title="Voice input"
              aria-label="Voice input"
              onClick={() => {}}
            >
              <MicIcon size={16} />
            </button>

            {streaming ? (
              <button
                className="chat-input-send stop"
                onClick={stop}
                title="Stop"
                aria-label="Stop streaming"
              >
                <StopIcon size={14} />
              </button>
            ) : (
              <button
                className="chat-input-send"
                onClick={send}
                disabled={disabled || !text.trim()}
                title="Send"
                aria-label="Send message"
              >
                <ArrowUpIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!compact && (
        <div className="chat-input-meta">
          <span>{currentMode.label} mode · {text.length > 0 ? `${text.length} chars` : "Ready"}</span>
          <span>
            <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
          </span>
        </div>
      )}
    </div>
  );
}
