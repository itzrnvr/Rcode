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

export function ToolRow({ step }: { step: ToolStep | LiveStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-row">
      <button className="tool-row-head" onClick={() => step.result != null && setOpen(o => !o)}>
        {toolIcon(step.name)}
        <span className="tool-row-name">{step.name}</span>
        <span className="tool-row-args">{argsSummary(step.args)}</span>
        {step.status === "running" ? (
          <span className="tool-row-spinner" />
        ) : (
          <ChevronDownIcon size={12} className={open ? "rotate-180" : ""} />
        )}
      </button>
      {open && step.result != null && (
        <pre className="tool-result">{step.result}</pre>
      )}
    </div>
  );
}

export function TurnHeader({ secs, live, usage }: { secs: number | null; live?: boolean; usage?: TurnUsage | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live]);
  const shown = live ? elapsed : secs ?? 0;
  return (
    <div className="turn-header">
      <ClockIcon size={13} />
      <span>{live ? `Working for ${shown}s` : `Worked for ${shown}s`}</span>
      {usage && (
        <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>
          · {usage.prompt_tokens ?? 0}↑ {usage.completion_tokens ?? 0}↓
          {(usage.reasoning_tokens ?? 0) > 0 ? ` · ${usage.reasoning_tokens} think` : ""}
          {(usage.cached_tokens ?? 0) > 0 ? ` · ${usage.cached_tokens} cached` : ""}
        </span>
      )}
    </div>
  );
}
