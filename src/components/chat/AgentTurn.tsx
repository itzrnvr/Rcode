/*
 * PURPOSE: ZCode-style agent turn bits.
 *
 * parseTurn() splits a persisted assistant message into:
 *   workedSecs  — from a leading [worked:NNs] marker
 *   tools       — [tool:name(args)] + <toolresult>…</toolresult> pairs
 *   rest        — the markdown/think content rendered as before
 *
 * ToolRow renders one tool call: icon + name + args summary, expandable to a
 * scrollable <pre> of the (capped) result. Live steps from the stream use the
 * same row with a spinner while status==='running'.
 */

import { useState, useEffect } from "react";
import { WrenchIcon, ChevronDownIcon, SearchIcon, FileTextIcon, FolderIcon, TerminalSquareIcon, ClockIcon } from "../common/Icons";

export interface ToolStep {
  name: string;
  args?: string;
  result?: string;
  status?: "running" | "done";
}

export interface LiveStep {
  kind: "thought" | "tool" | "say";
  text?: string;
  name?: string;
  args?: string;
  result?: string;
  status?: "running" | "done";
  secs?: number;
  bornAt?: number;
}

export interface TurnUsage { prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number; cached_tokens?: number }

export function parseTurn(content: string): { workedSecs: number | null; steps: LiveStep[]; rest: string; usage: TurnUsage | null } {
  let workedSecs: number | null = null;
  let usage: TurnUsage | null = null;
  let rest = content;
  const workedMatch = /^\[worked:(\d+)s\]\s*/.exec(rest);
  if (workedMatch) {
    workedSecs = parseInt(workedMatch[1], 10);
    rest = rest.slice(workedMatch[0].length);
  }

  const usageMatch = /^\[usage:(\d+)\/(\d+)\/(\d+)\/(\d+)\]\s*/.exec(rest);
  if (usageMatch) {
    usage = { prompt_tokens: +usageMatch[1], completion_tokens: +usageMatch[2], reasoning_tokens: +usageMatch[3], cached_tokens: +usageMatch[4] };
    rest = rest.slice(usageMatch[0].length);
  }

  // Walk the persisted turn in arrival order: text segments between think/tool
  // markers become "say" steps so narration renders where it happened, not at the end.
  const steps: LiveStep[] = [];
  const re = /<(think|thinking)>([\s\S]*?)<\/\1>|\[tool:([a-zA-Z_]+)(\([\s\S]*?\))?\]\s*<toolresult>([\s\S]*?)<\/toolresult>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const seg = rest.slice(last, m.index).trim();
    if (seg) steps.push({ kind: "say", text: seg });
    if (m[1]) steps.push({ kind: "thought", text: (m[2] ?? "").trim() });
    else steps.push({ kind: "tool", name: m[3], args: (m[4] ?? "").replace(/^\(|\)$/g, ""), result: (m[5] ?? "").trim(), status: "done" });
    last = m.index + m[0].length;
  }
  const tail = rest.slice(last).trim();
  if (tail) steps.push({ kind: "say", text: tail });

  return { workedSecs, steps, rest: "", usage };
}

function toolIcon(name?: string) {
  if (name === "read_file") return <FileTextIcon size={13} />;
  if (name === "list_dir") return <FolderIcon size={13} />;
  if (name === "search") return <SearchIcon size={13} />;
  if (name === "run_command") return <TerminalSquareIcon size={13} />;
  return <WrenchIcon size={13} />;
}

function argsSummary(args?: string): string {
  if (!args) return "";
  try {
    const o = JSON.parse(args);
    const v = o.path ?? o.pattern ?? o.command;
    if (typeof v === "string") return v.length > 64 ? v.slice(0, 64) + "…" : v;
  } catch {}
  return args.length > 64 ? args.slice(0, 64) + "…" : args;
}

export function ToolRow({ step, delayMs }: { step: ToolStep | LiveStep; delayMs?: number }) {
  const [open, setOpen] = useState(false);
  const isShell = step.name === "run_command";
  let cmd = "";
  if (isShell) {
    try { cmd = String((JSON.parse(step.args || "{}") as Record<string, unknown>).command ?? ""); } catch { cmd = ""; }
  }
  return (
    <div className="tool-row" style={delayMs != null ? { animationDelay: `${delayMs}ms` } : undefined}>
      <button className="tool-row-head" onClick={() => (step.result != null || isShell) && setOpen(o => !o)}>
        {toolIcon(step.name)}
        <span className="tool-row-name">{isShell ? "Terminal" : step.name}</span>
        <span className="tool-row-args">{isShell ? (cmd.length > 90 ? cmd.slice(0, 90) + "…" : cmd) : argsSummary(step.args)}</span>
        {step.status === "running" ? (
          <span className="tool-row-spinner" />
        ) : (
          <ChevronDownIcon size={12} className={open ? "rotate-180" : ""} />
        )}
      </button>
      {open && (
        <div className="tool-card">
          {isShell
            ? cmd && <div className="tool-cmdline">$ {cmd}</div>
            : step.args && <div className="tool-cmdline">{step.name} {step.args}</div>}
          {step.result != null && <pre className="tool-out">{step.result}</pre>}
        </div>
      )}
    </div>
  );
}

function fmtSecs(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : String(n);
}

export function TurnHeader({ secs, live, usage, collapsible, collapsed, onToggle }: { secs: number | null; live?: boolean; usage?: TurnUsage | null; collapsible?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live]);
  const shown = live ? elapsed : secs ?? 0;
  const inner = (
    <>
      {collapsible && <ChevronDownIcon size={12} className={collapsed ? "" : "rotate-180"} />}
      <ClockIcon size={13} />
      <span>{live ? `Working for ${fmtSecs(shown)}` : `Worked for ${fmtSecs(shown)}`}</span>
      {usage && (
        <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>
          · {fmtTok(usage.prompt_tokens ?? 0)} in / {fmtTok(usage.completion_tokens ?? 0)} out
          {(usage.reasoning_tokens ?? 0) > 0 ? ` · ${fmtTok(usage.reasoning_tokens ?? 0)} think` : ""}
          {(usage.cached_tokens ?? 0) > 0 ? ` · ${fmtTok(usage.cached_tokens ?? 0)} cached` : ""}
        </span>
      )}
    </>
  );
  if (!collapsible) return <div className="turn-header">{inner}</div>;
  return (
    <button className="turn-header" onClick={onToggle} style={{ cursor: "pointer", background: "transparent", border: "none", width: "100%", textAlign: "left" }}>
      {inner}
    </button>
  );
}
