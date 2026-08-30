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
  onSend: (text: string) => void;
  disabled: boolean;
  onStop?: () => void;
  streaming?: boolean;
  placeholder?: string;
  initialValue?: string;
}

export function ChatInput({
  onSend,
  disabled,
  onStop,
  streaming = false,
  placeholder = "Do anything",
  initialValue,
}: ChatInputProps) {
  const { settings, setSetting } = useApp();
  const { allModels: providerModels } = useProviders();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AgentMode>("full-access");
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

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || streaming) return;
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
    onSend(trimmed);
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
      if (e.key === "Enter" && !e.shiftKey) {
        // If slash menu is open, Enter executes the selected command
        const picked = filteredSlash[slashIdx];
        if (picked && text.trim().toLowerCase() !== picked.name) {
          // If user hasn't fully typed the command, complete it first
          e.preventDefault();
          setText(picked.name + " ");
          return;
        }
        // Otherwise let send() handle it (will execute /side, /compact, etc.)
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

  const pickAndSend = useCallback((name: string) => {
    // For Enter on a slash item: set text and immediately send if it is a full command
    setText(name + " ");
    // Let the next tick send - or just call onSend directly for slash commands that fork
    setTimeout(() => {
      const el = ref.current;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    }, 0);
  }, []);

  return (
    <div className="chat-input-wrap">
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
                  <span className="mode-badge-label">{currentMode.label}</span>
                  <ChevronDownIcon size={11} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={8} style={{ minWidth: 360 }}>
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
              <PopoverContent align="end" sideOffset={8} style={{ minWidth: 440 }}>
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

      <div className="chat-input-meta">
        <span>{currentMode.label} mode · {text.length > 0 ? `${text.length} chars` : "Ready"}</span>
        <span>
          <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
        </span>
      </div>
    </div>
  );
}
