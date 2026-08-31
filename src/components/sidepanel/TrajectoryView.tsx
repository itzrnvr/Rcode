/*
 * PURPOSE: Trajectory viewer modeled on dsh's ui-trajectory.
 *
 * Three views (toolbar toggle like dsh's Duration / Turns / Calls):
 *  - Duration: Gantt timeline (Input / Model / Tools lanes) + role-badged event
 *    rows (SYSTEM/USER/CONTEXT/ASSISTANT/THINK/TOOL) in arrival order, grouped
 *    by turn; rows expand to full content; search filters rows.
 *  - Turns: per-turn cards (request payload, response meta, reasoning, tools).
 *  - Calls: tool calls only, with args/result/ms.
 *
 * Stats footer mirrors dsh: turns · steps | LLM time · tool time | TTFT avg ·
 * tok/s | cache hit % | input/output tokens — all folded from the JSONL trace.
 *
 * Auto-refreshes every 3s so a live turn streams in.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { RefreshIcon, ChevronDownIcon, SearchIcon } from "../common/Icons";

interface TraceEntry {
  ts: string;
  kind: string;
  turn?: number;
  round?: number | string;
  [k: string]: unknown;
}

const BADGE: Record<string, string> = {
  turn_start: "SYSTEM",
  request: "CONTEXT",
  reasoning: "THINK",
  tool_call: "TOOL",
  tool_result: "TOOL",
  content: "ASSISTANT",
  response: "MODEL",
  turn_end: "SYSTEM",
};

const BADGE_COLOR: Record<string, string> = {
  SYSTEM: "#8a8a8a",
  CONTEXT: "#3fa14b",
  THINK: "#b07fd8",
  TOOL: "#d89a3f",
  ASSISTANT: "#7a7fd8",
  MODEL: "#5a8ad8",
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function rowText(e: TraceEntry): string {
  switch (e.kind) {
    case "turn_start": return `Turn ${e.turn} · ${e.model} · ${e.mode} · effort ${e.effort} · "${String(e.userMessage ?? "").slice(0, 80)}"`;
    case "request": return `request r${e.round} · ${(e.messages as unknown[])?.length ?? 0} messages · tools: ${(e.toolNames as string[])?.join(", ")}`;
    case "response": return `model r${e.round} · ${e.status} · TTFT ${e.firstChunkMs ?? "—"}ms · ${fmtMs(Number(e.totalMs ?? 0))} · ${e.chunks} chunks`;
    case "reasoning": return String(e.text ?? "");
    case "tool_call": return `${e.name} ${JSON.stringify(e.args ?? {}).slice(0, 120)}`;
    case "tool_result": return `↳ ${String(e.result ?? "").replace(/\n/g, " ").slice(0, 160)}`;
    case "content": return String(e.text ?? "");
    case "turn_end": return e.error ? `turn ${e.turn} ended · ERROR ${e.error}` : `turn ${e.turn} ended · ${e.secs}s`;
    default: return e.kind;
  }
}

function Expandable({ e }: { e: TraceEntry }) {
  const full = e.kind === "request"
    ? JSON.stringify({ model: (e as unknown as { model?: string }).model, messages: e.messages, toolNames: e.toolNames }, null, 2)
    : String(e.text ?? e.result ?? JSON.stringify(e, null, 2));
  return <pre className="tool-result" style={{ maxHeight: 220, margin: "4px 0 8px" }}>{full}</pre>;
}

export function TrajectoryView({ sessionId }: { sessionId: string | null }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [view, setView] = useState<"duration" | "turns" | "calls">("duration");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      const list = (await (api as unknown as { traceList: (id: string) => Promise<TraceEntry[]> }).traceList(sessionId)) || [];
      if (!cancelled) setEntries(list);
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, reload]);

  const stats = useMemo(() => {
    const resps = entries.filter(e => e.kind === "response");
    const tools = entries.filter(e => e.kind === "tool_result");
    const calls = entries.filter(e => e.kind === "tool_call");
    const turns = entries.filter(e => e.kind === "turn_start").length;
    const llmMs = resps.reduce((a, r) => a + Number(r.totalMs ?? 0), 0);
    const toolMs = tools.reduce((a, r) => a + Number(r.ms ?? 0), 0);
    const ttft = resps.length ? resps.reduce((a, r) => a + Number(r.firstChunkMs ?? 0), 0) / resps.length : 0;
    let inTok = 0, outTok = 0, cached = 0, prompt = 0;
    for (const r of resps) {
      const u = r.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
      inTok += u?.prompt_tokens ?? 0;
      outTok += u?.completion_tokens ?? 0;
      cached += u?.prompt_tokens_details?.cached_tokens ?? 0;
      prompt += u?.prompt_tokens ?? 0;
    }
    const tps = llmMs > 0 ? (outTok / llmMs) * 1000 : 0;
    return { turns, steps: calls.length, llmMs, toolMs, ttft, tps, cache: prompt ? cached / prompt : 0, inTok, outTok };
  }, [entries]);

  const timeline = useMemo(() => {
    if (entries.length === 0) return null;
    const t0 = new Date(entries[0].ts).getTime();
    const t1 = Math.max(t0 + 1, new Date(entries[entries.length - 1].ts).getTime());
    const span = t1 - t0;
    const modelBars: Array<{ left: number; width: number }> = [];
    const toolBars: Array<{ left: number; width: number }> = [];
    const inputTicks: Array<{ left: number }> = [];
    let lastModelStart: number | null = null;
    for (const e of entries) {
      const t = new Date(e.ts).getTime();
      const left = ((t - t0) / span) * 100;
      if (e.kind === "turn_start") inputTicks.push({ left });
      if (e.kind === "request") lastModelStart = left;
      if (e.kind === "response" && lastModelStart != null) {
        modelBars.push({ left: lastModelStart, width: Math.max(0.4, left - lastModelStart) });
        lastModelStart = null;
      }
      if (e.kind === "tool_call") {
        const res = entries.find(x => x.kind === "tool_result" && x.round === e.round && x.name === e.name);
        const end = res ? ((new Date(res.ts).getTime() - t0) / span) * 100 : left + 0.4;
        toolBars.push({ left, width: Math.max(0.4, end - left) });
      }
    }
    return { modelBars, toolBars, inputTicks };
  }, [entries]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries.map((e, i) => ({ e, i }));
    const q = query.toLowerCase();
    return entries.map((e, i) => ({ e, i })).filter(({ e }) => rowText(e).toLowerCase().includes(q));
  }, [entries, query]);

  if (!sessionId) return <div style={{ color: "var(--color-muted)", padding: 20, fontSize: 12 }}>Open a session to see its trajectory.</div>;

  const toggle = (i: number) => setOpen(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
        {(["duration", "turns", "calls"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: view === v ? "#2a2a2a" : "transparent",
              color: view === v ? "#e8e8e8" : "#8a8a8a",
              border: "1px solid " + (view === v ? "#3a3a3a" : "transparent"),
              textTransform: "capitalize",
            }}
          >{v}</button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#1a1a1a", border: "1px solid #262626", borderRadius: 6, padding: "2px 6px" }}>
          <SearchIcon size={11} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" style={{ background: "transparent", border: "none", outline: "none", color: "#e8e8e8", fontSize: 11, width: 90 }} />
        </div>
        <button className="ms-iconbtn" title="Refresh" onClick={() => setReload(r => r + 1)}><RefreshIcon size={13} /></button>
      </div>

      {/* Timeline */}
      {view === "duration" && timeline && (
        <div style={{ padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ width: 40, fontSize: 9, color: "#8a8a8a" }}>Input</span>
            <div style={{ flex: 1, position: "relative", height: 6 }}>
              {timeline.inputTicks.map((t, i) => (
                <span key={i} style={{ position: "absolute", left: `${t.left}%`, top: 0, width: 2, height: 6, background: "#3fa14b" }} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ width: 40, fontSize: 9, color: "#8a8a8a" }}>Model</span>
            <div style={{ flex: 1, position: "relative", height: 7 }}>
              {timeline.modelBars.map((b, i) => (
                <span key={i} style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 0, height: 7, background: "#b07fd8", borderRadius: 2 }} />
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 40, fontSize: 9, color: "#8a8a8a" }}>Tools</span>
            <div style={{ flex: 1, position: "relative", height: 7 }}>
              {timeline.toolBars.map((b, i) => (
                <span key={i} style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 0, height: 7, background: "#d89a3f", borderRadius: 2 }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px" }}>
        {entries.length === 0 && <div style={{ color: "var(--color-muted)", fontSize: 12, padding: 12 }}>No trace yet — send a message to start recording.</div>}

        {view !== "turns" && filtered.map(({ e, i }) => {
          if (view === "calls" && e.kind !== "tool_call" && e.kind !== "tool_result") return null;
          const badge = BADGE[e.kind] ?? "SYSTEM";
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 2px", borderBottom: "1px solid #191919" }}>
              <span style={{
                flex: "none", width: 62, textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4,
                color: BADGE_COLOR[badge] ?? "#8a8a8a", background: "#1d1d1d", border: "1px solid #2a2a2a",
                borderRadius: 4, padding: "2px 0", marginTop: 1,
              }}>{badge}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button onClick={() => toggle(i)} style={{ display: "flex", gap: 6, alignItems: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
                  <span style={{ fontSize: 11, color: "#c8c8c8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{rowText(e)}</span>
                  <ChevronDownIcon size={10} className={open.has(i) ? "rotate-180" : ""} />
                </button>
                {open.has(i) && <Expandable e={e} />}
              </div>
            </div>
          );
        })}

        {view === "turns" && (() => {
          const map = new Map<number, TraceEntry[]>();
          for (const e of entries) { const t = e.turn ?? 0; if (!map.has(t)) map.set(t, []); map.get(t)!.push(e); }
          return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([turn, evts]) => (
            <div key={turn} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, margin: "8px 0", background: "var(--color-surface)" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>Turn {turn}</span>
                {evts.filter(e => e.kind === "response").map((r, i) => (
                  <span key={i} style={{ fontSize: 10, color: "var(--color-muted)" }}>r{String(r.round)} {fmtMs(Number(r.totalMs ?? 0))}</span>
                ))}
              </div>
              {evts.filter(e => e.kind === "reasoning" || e.kind === "tool_call" || e.kind === "content").map((e, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <button onClick={() => toggle(i + turn * 1000)} style={{ display: "flex", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: BADGE_COLOR[BADGE[e.kind]] }}>{BADGE[e.kind]}</span>
                    <span style={{ fontSize: 11, color: "#c8c8c8" }}>{rowText(e).slice(0, 90)}</span>
                  </button>
                  {open.has(i + turn * 1000) && <Expandable e={e} />}
                </div>
              ))}
            </div>
          ));
        })()}
      </div>

      {/* Stats footer — mirrors dsh's bottom bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "6px 6px", borderTop: "1px solid var(--color-border)", fontSize: 10, color: "#9a9a9a" }}>
        <span>{stats.turns} turns · {stats.steps} steps</span>
        <span>LLM {fmtMs(stats.llmMs)} · Tool {fmtMs(stats.toolMs)}</span>
        <span>TTFT avg {fmtMs(stats.ttft)} · {Math.round(stats.tps)} tok/s</span>
        <span>Cache hit {Math.round(stats.cache * 100)}%</span>
        <span>In {fmtK(stats.inTok)} · Out {fmtK(stats.outTok)} tok</span>
      </div>
    </div>
  );
}
