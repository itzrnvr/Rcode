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
} from "../common/Icons";

import type { AgentMode } from "../../types";

const MODELS: ModelEntry[] = [
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    provider: "z-ai",
    providerLabel: "Z.AI",
    description: "Strong multilingual, fast, 128K context",
  },
  {
    id: "glm-4.5",
    name: "GLM-4.5",
    provider: "z-ai",
    providerLabel: "Z.AI",
    description: "Previous gen, stable",
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    provider: "kimi",
    providerLabel: "KIMI",
    description: "1T MoE, strong reasoning + coding",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    provider: "deepseek",
    providerLabel: "DEEPSEEK",
    description: "Sparse MoE, fast inference, code-focused",
  },
  {
    id: "qwen3.6-27b-mtp",
    name: "Qwen3.6-27B-MTP",
    provider: "unsloth",
    providerLabel: "UNSLOTH",
    description: "Alibaba Qwen3.6 with speculative MTP",
  },
  {
    id: "minimax-h3",
    name: "MiniMax-H3",
    provider: "unsloth",
    providerLabel: "UNSLOTH",
    description: "H3 hybrid SSM+attention, fast long-context",
  },
  {
    id: "muse-glimmer-30b",
    name: "Muse-Glimmer-30B",
    provider: "unsloth",
    providerLabel: "UNSLOTH",
    description: "Creative writing + roleplay tuned",
  },
];

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  description: string;
}

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

  const chooseModel = useCallback((m: ModelEntry) => {
    setSetting("model", m.id);
    setSetting("providerName", m.provider);
  }, [setSetting]);

  const currentModel = MODELS.find(m => m.id === settings.model) ?? MODELS[0];
  const currentMode = MODES.find(m => m.id === mode) ?? MODES[1];

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || streaming) return;
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  return (
    <div className="chat-input-wrap">
      <div className={`chat-input-pill ${streaming ? "streaming" : ""}`}>
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
                  aria-label={`Model: ${currentModel.name}. Click to change.`}
                >
                  <span className="model-pill-name">{currentModel.name}</span>
                  <ChevronDownIcon size={11} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={8} style={{ minWidth: 440 }}>
                <div className="model-picker-header">
                  <span>Choose a model</span>
                  <span className="model-picker-count">{MODELS.length} available</span>
                </div>
                <div className="model-picker-list" role="listbox" aria-label="Available models">
                  {MODELS.map(m => {
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
