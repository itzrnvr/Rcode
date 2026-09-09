/*
 * PURPOSE: Ordered, typed agent-turn widgets.
 *
 * A turn is a list of reasoning / response / tool_call / tool_result events.
 * New messages carry this structure directly from the API response body;
 * legacy flattened messages are parsed only for backwards compatibility.
 */

import { useEffect, useState, type ReactNode } from "react";

import { ChevronDownIcon, ClockIcon, FileTextIcon, FolderIcon, SearchIcon, TerminalSquareIcon, WrenchIcon } from "../common/Icons";

import type { AgentTurn, TurnUsage } from "../../types";

export type LiveStep =
  | { kind: "reasoning"; text: string; bornAt?: number; secs?: number }
  | { kind: "response"; text: string }
  | { kind: "tool_call"; name: string; args?: string; status?: "running" | "done" }
  | { kind: "tool_result"; name: string; result?: string; isError?: boolean; status?: "running" | "done" };

export function parseTurn(content: string): AgentTurn {
  let rest = content;
  let secs = 0;
  let usage: TurnUsage | undefined;

  const workedMatch = /^\[worked:(\d+)s\]\s*/.exec(rest);
  if (workedMatch) {
    secs = parseInt(workedMatch[1], 10);
    rest = rest.slice(workedMatch[0].length);
  }

  const usageMatch = /^\[usage:(\d+)\/(\d+)\/(\d+)\/(\d+)\]\s*/.exec(rest);
  if (usageMatch) {
    usage = {
      prompt_tokens: Number(usageMatch[1]),
      completion_tokens: Number(usageMatch[2]),
      reasoning_tokens: Number(usageMatch[3]),
      cached_tokens: Number(usageMatch[4]),
    };
    rest = rest.slice(usageMatch[0].length);
  }

  const events: AgentTurn["events"] = [];
  const re = /<(think|thinking)>([\s\S]*?)<\/\1>|\[tool:([a-zA-Z_]+)(\([\s\S]*?\))?\]\s*<toolresult>([\s\S]*?)<\/toolresult>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(rest))) {
    const segment = rest.slice(last, match.index).trim();
    if (segment) events.push({ kind: "response", text: segment });

    if (match[1]) {
      events.push({ kind: "reasoning", text: (match[2] ?? "").trim() });
    } else {
      const name = match[3] ?? "tool";
      const args = (match[4] ?? "").replace(/^\(|\)$/g, "");
      const result = (match[5] ?? "").trim();
      events.push({ kind: "tool_call", name, args });
      events.push({ kind: "tool_result", name, result });
    }
    last = match.index + match[0].length;
  }

  const tail = rest.slice(last).trim();
  if (tail) events.push({ kind: "response", text: tail });

  const responses = events.filter(event => event.kind === "response");
  const finalContent = responses.length > 0 ? responses[responses.length - 1].text : content;
  return { secs, usage, events, finalContent };
}

function toolIcon(name?: string) {
  if (name === "read_file" || name === "read") return <FileTextIcon size={13} />;
  if (name === "list_dir" || name === "ls") return <FolderIcon size={13} />;
  if (name === "search" || name === "grep" || name === "find") return <SearchIcon size={13} />;
  if (name === "run_command" || name === "bash") return <TerminalSquareIcon size={13} />;
  return <WrenchIcon size={13} />;
}

function toolDisplayName(name?: string) {
  return name === "run_command" || name === "bash" ? "Terminal" : name ?? "tool";
}

function argsSummary(args?: string) {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const value = parsed.path ?? parsed.pattern ?? parsed.command;
    if (typeof value === "string") return value.length > 72 ? `${value.slice(0, 72)}…` : value;
  } catch {}
  return args.length > 72 ? `${args.slice(0, 72)}…` : args;
}

export function ReasoningWidget({ text, defaultOpen = false, meta = "", delayMs }: {
  text: string;
  defaultOpen?: boolean;
  meta?: string;
  delayMs?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`trace-widget reasoning-widget ${open ? "open" : ""}`} style={delayMs != null ? { animationDelay: `${delayMs}ms` } : undefined}>
      <button className="trace-widget-head" onClick={() => setOpen(open => !open)} aria-expanded={open}>
        <ChevronDownIcon size={12} className={`trace-chevron ${open ? "rotate-180" : ""}`} />
        <span className="trace-widget-kind">Reasoning</span>
        {meta && <span className="trace-widget-meta">{meta}</span>}
      </button>
      {open && <div className="trace-widget-body reasoning-body">{text}</div>}
    </section>
  );
}

export function ToolCallWidget({ step, delayMs }: { step: Extract<LiveStep, { kind: "tool_call" }>; delayMs?: number }) {
  const [open, setOpen] = useState(false);
  const isShell = step.name === "run_command" || step.name === "bash";
  let command = "";
  if (isShell) {
    try {
      command = String((JSON.parse(step.args || "{}") as Record<string, unknown>).command ?? "");
    } catch {}
  }

  return (
    <section className="trace-widget tool-call-widget" style={delayMs != null ? { animationDelay: `${delayMs}ms` } : undefined}>
      <button className="trace-widget-head" onClick={() => step.args && setOpen(open => !open)} aria-expanded={open}>
        {toolIcon(step.name)}
        <span className="trace-widget-kind">Tool call</span>
        <span className="trace-widget-name">{toolDisplayName(step.name)}</span>
        <span className="trace-widget-summary">{isShell ? command : argsSummary(step.args)}</span>
        {step.status === "running" ? <span className="trace-spinner" /> : <ChevronDownIcon size={12} className={`trace-chevron ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && step.args && (
        <div className="trace-widget-body">
          {isShell && command ? <div className="tool-cmdline">$ {command}</div> : <div className="tool-cmdline">{step.name} {step.args}</div>}
        </div>
      )}
    </section>
  );
}

export function ToolResultWidget({ step, delayMs }: { step: Extract<LiveStep, { kind: "tool_result" }>; delayMs?: number }) {
  const [open, setOpen] = useState(false);
  const lineCount = step.result ? step.result.split("\n").length : 0;
  return (
    <section className={`trace-widget tool-result-widget ${step.isError ? "error" : ""}`} style={delayMs != null ? { animationDelay: `${delayMs}ms` } : undefined}>
      <button className="trace-widget-head" onClick={() => step.result != null && setOpen(open => !open)} aria-expanded={open}>
        {toolIcon(step.name)}
        <span className="trace-widget-kind">Tool result</span>
        <span className="trace-widget-name">{toolDisplayName(step.name)}</span>
        <span className="trace-widget-summary">{step.result ? `${lineCount} line${lineCount === 1 ? "" : "s"}` : "Pending"}</span>
        <ChevronDownIcon size={12} className={`trace-chevron ${open ? "rotate-180" : ""}`} />
      </button>
      {open && step.result != null && (
        <div className="trace-widget-body">
          <pre className="tool-out">{step.result}</pre>
        </div>
      )}
    </section>
  );
}

function fmtSecs(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function fmtTok(value = 0) {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K` : String(value);
}

function TurnHeader({ secs, live, usage }: { secs: number; live?: boolean; usage?: TurnUsage | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) return;
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live]);

  const shown = live ? elapsed : secs;
  return (
    <span className="turn-header">
      <ClockIcon size={13} />
      <span>{live ? "Working" : "Worked"} for {fmtSecs(shown)}</span>
      {usage && (
        <span className="turn-usage">
          · {fmtTok(usage.prompt_tokens)} in / {fmtTok(usage.completion_tokens)} out
          {usage.reasoning_tokens ? ` · ${fmtTok(usage.reasoning_tokens)} think` : ""}
          {usage.cached_tokens ? ` · ${fmtTok(usage.cached_tokens)} cached` : ""}
        </span>
      )}
    </span>
  );
}

export function WorkedWidget({ secs, live, usage, collapsed, onToggle, children }: {
  secs: number;
  live?: boolean;
  usage?: TurnUsage | null;
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className={`worked-widget ${collapsed ? "collapsed" : "open"}`}>
      <button className="worked-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        <ChevronDownIcon size={12} className={`trace-chevron ${collapsed ? "" : "rotate-180"}`} />
        <TurnHeader secs={secs} live={live} usage={usage} />
      </button>
      {!collapsed && <div className="worked-content">{children}</div>}
    </section>
  );
}
