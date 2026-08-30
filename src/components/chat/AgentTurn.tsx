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
  kind: "thought" | "tool";
  text?: string;
  name?: string;
  args?: string;
  result?: string;
  status?: "running" | "done";
}

export function parseTurn(content: string): { workedSecs: number | null; tools: ToolStep[]; rest: string } {
  let workedSecs: number | null = null;
  const tools: ToolStep[] = [];
  let rest = content;

  const workedMatch = /^\[worked:(\d+)s\]\s*/.exec(rest);
  if (workedMatch) {
    workedSecs = parseInt(workedMatch[1], 10);
    rest = rest.slice(workedMatch[0].length);
  }

  const toolRegex = /\[tool:([a-zA-Z_]+)(\([\s\S]*?\))?\]\s*<toolresult>([\s\S]*?)<\/toolresult>/g;
  rest = rest.replace(toolRegex, (_m, name: string, args: string, result: string) => {
    tools.push({ name, args: (args ?? "").replace(/^\(|\)$/g, ""), result: result.trim(), status: "done" });
    return "";
  });

  return { workedSecs, tools, rest: rest.trim() };
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

export function TurnHeader({ secs, live }: { secs: number | null; live?: boolean }) {
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
    </div>
  );
}
