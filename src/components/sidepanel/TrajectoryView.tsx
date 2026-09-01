/*
 * PURPOSE: Trajectory viewer — 1:1 with dsh web's timeline view.
 *
 * Toolbar: Duration/Turns/Calls chips + Search + session-log download.
 * Timeline: Input/Model/Tools swim lanes with hairline guides; green input
 * ticks, dense purple model bars, orange tool bars (gray = no outcome,
 * blue = selected); a vertical dashed blue selection line spans all lanes.
 * Event list: lane-colored bullet dots (filled when selected), role pills
 * (ASSISTANT/TOOL/USER/SYSTEM/THINK/CONTEXT/MODEL), mono tool rows
 * `name {args} → result` with pink TOOL_OUTCOME_UNKNOWN, red-dot Turn N
 * divider rows. Clicking a row or bar selects: moves the dashed line,
 * fills the bullet, scrolls the row into view, opens the inspector
 * (Summary/Preview/Raw, "ROLE Turn X · Step N", tokens + request timing).
 * Footer: dsh-format stats groups separated by pipes.
 *
 * Data: JSONL trace via trace:list IPC, auto-refresh 3s.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { RefreshIcon, SearchIcon, ClockIcon, ListIcon, LayoutGridIcon, DownloadIcon } from "../common/Icons";

interface TraceEntry {
  ts: string;
  kind: string;
  turn?: number;
  round?: number | string;
  [k: string]: unknown;
}

const BADGE: Record<string, string> = {
  turn_start: "SYSTEM",
  user: "USER",
  system: "SYSTEM",
  request: "CONTEXT",
  reasoning: "THINK",
  tool_call: "TOOL",
  tool_result: "TOOL",
  content: "ASSISTANT",
  response: "MODEL",
  turn_end: "SYSTEM",
};

const BADGE_COLOR: Record<string, string> = {
  SYSTEM: "#8a8a92",
  USER: "#3b82f6",
  CONTEXT: "#3fa14b",
  THINK: "#b07fd8",
  TOOL: "#d89a3f",
  ASSISTANT: "#9a7fd8",
  MODEL: "#5a8ad8",
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

interface UsageInfo { prompt: number; completion: number; cached: number; reasoning: number }

// Trace entries arrive over IPC as untyped JSON; narrow once at the boundary.
function readUsage(raw: unknown): UsageInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const details = (u.completion_tokens_details ?? u.prompt_tokens_details) as Record<string, unknown> | undefined;
  const pd = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  return {
    prompt: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
    completion: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    cached: typeof pd.cached_tokens === "number" ? pd.cached_tokens : 0,
    reasoning: typeof (u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens === "number" ? (u.completion_tokens_details as Record<string, unknown>).reasoning_tokens as number : 0,
  };
  void details;
}

function fmtTok(n: number): string {
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

interface Row {
  key: number;
  badge: string;
  text: string;
  t: number;
  e: TraceEntry;
  e2?: TraceEntry;
  turnStart?: number;
  outcomeUnknown?: boolean;
}

export function TrajectoryView({ sessionId }: { sessionId: string | null }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [view, setView] = useState<"duration" | "turns" | "calls">("duration");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [selKey, setSelKey] = useState<number | null>(null);
  const [selTab, setSelTab] = useState<"summary" | "preview" | "raw">("summary");
  const [reload, setReload] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      // preload exposes traceList; the shared api type doesn't declare it.
      const trajApi = api as unknown as { traceList: (id: string) => Promise<TraceEntry[]> };
      const list = (await trajApi.traceList(sessionId)) || [];
      if (!cancelled) setEntries(list);
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, reload]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let key = 0;
    const seenTurns = new Set<number>();
    const t0 = entries.length ? new Date(entries[0].ts).getTime() : 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const turnStart = e.turn != null && !seenTurns.has(e.turn) ? e.turn : undefined;
      if (turnStart != null) seenTurns.add(turnStart);
      if (e.kind === "tool_result") continue;
      let text = "";
      let e2: TraceEntry | undefined;
      let outcomeUnknown = false;
      switch (e.kind) {
        case "turn_start": text = `Turn ${e.turn} · ${e.model} · ${e.mode} · effort ${e.effort}`; break;
        case "user": text = String(e.text ?? ""); break;
        case "system": text = String(e.text ?? ""); break;
        case "request": text = `request r${e.round} · ${(e.messages as unknown[])?.length ?? 0} messages`; break;
        case "response": text = `model r${e.round} · ${e.status} · TTFT ${e.firstChunkMs ?? "—"}ms · ${fmtMs(Number(e.totalMs ?? 0))}`; break;
        case "reasoning": text = String(e.text ?? ""); break;
        case "tool_call": {
          const res = entries.find(x => x.kind === "tool_result" && x.round === e.round && x.name === e.name);
          e2 = res;
          outcomeUnknown = !res;
          text = `${e.name} ${JSON.stringify(e.args ?? {}).slice(0, 80)}${res ? ` → ${String(res.result ?? "").replace(/\n/g, " ").slice(0, 100)}` : ""}`;
          break;
        }
        case "content": text = String(e.text ?? ""); break;
        case "turn_end": text = e.error ? `ended · ERROR ${e.error}` : `ended · ${e.secs}s`; break;
        default: text = e.kind;
      }
      out.push({ key: key++, badge: BADGE[e.kind] ?? "SYSTEM", text, t: new Date(e.ts).getTime() - t0, e, e2, turnStart, outcomeUnknown });
    }
    return out;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter(r => r.text.toLowerCase().includes(q) || r.badge.toLowerCase().includes(q));
  }, [rows, query]);

  const selRow = selKey != null ? rows.find(r => r.key === selKey) ?? null : null;

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
      const u = readUsage(r.usage);
      if (!u) continue;
      inTok += u.prompt;
      outTok += u.completion;
      cached += u.cached;
      prompt += u.prompt;
    }
    const tps = llmMs > 0 ? (outTok / llmMs) * 1000 : 0;
    return { turns, steps: calls.length, llmMs, toolMs, ttft, tps, cache: prompt ? cached / prompt : 0, inTok, outTok };
  }, [entries]);

  const timeline = useMemo(() => {
    if (rows.length === 0) return null;
    const span = Math.max(1, rows[rows.length - 1].t);
    const at = (t: number) => (t / span) * 100;
    const inputTicks = rows.filter(r => r.e.kind === "user" || r.e.kind === "turn_start").map(r => ({ left: at(r.t), key: r.key }));
    const modelBars = rows.filter(r => ["request", "response", "reasoning", "content"].includes(r.e.kind)).map(r => ({ left: at(r.t), key: r.key, wide: r.e.kind === "response" }));
    const toolBars = rows.filter(r => r.e.kind === "tool_call").map(r => {
      const end = r.e2 ? new Date(r.e2.ts).getTime() - (rows[0].t + (rows[0].t ? 0 : 0)) : null;
      const endT = r.e2 ? new Date(r.e2.ts).getTime() - new Date(entries[0].ts).getTime() : r.t;
      void end;
      return { left: at(r.t), width: Math.max(0.5, at(Math.max(endT, r.t + 1)) - at(r.t)), key: r.key, unknown: r.outcomeUnknown };
    });
    const selLeft = selRow ? at(selRow.t) : null;
    return { inputTicks, modelBars, toolBars, selLeft };
  }, [rows, selRow, entries]);

  const select = (key: number, fromTimeline = false) => {
    setSelKey(key);
    setSelTab("summary");
    if (fromTimeline) {
      requestAnimationFrame(() => {
        listRef.current?.querySelector(`[data-rowkey="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  };

  const downloadLog = () => {
    const blob = new Blob([entries.map(e => JSON.stringify(e)).join("\n")], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `session-log-${sessionId?.slice(0, 8)}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!sessionId) return <div style={{ color: "var(--color-muted)", padding: 20, fontSize: 12 }}>Open a session to see its trajectory.</div>;

  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, position: "relative" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px", borderBottom: "1px solid var(--color-border)" }}>
        {(["duration", "turns", "calls"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: view === v ? "#242428" : "#1a1a1d",
              color: view === v ? "#e8e8ea" : "#8a8a92",
              border: "1px solid #2a2a2e",
              textTransform: "capitalize",
            }}
          >
            {v === "duration" ? <ClockIcon size={12} /> : v === "turns" ? <ListIcon size={12} /> : <LayoutGridIcon size={12} />}
            {v}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#161618", border: "1px solid #26262a", borderRadius: 8, padding: "4px 8px" }}>
          <SearchIcon size={11} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" style={{ background: "transparent", border: "none", outline: "none", color: "#e8e8ea", fontSize: 11, width: 90 }} />
        </div>
        <button className="ms-iconbtn" title="Session log" onClick={downloadLog}><DownloadIcon size={13} /></button>
        <button className="ms-iconbtn" title="Refresh" onClick={() => setReload(r => r + 1)}><RefreshIcon size={13} /></button>
      </div>

      {/* Timeline */}
      {view === "duration" && timeline && (
        <div style={{ padding: "10px 8px 6px", borderBottom: "1px solid var(--color-border)", position: "relative" }}>
          {(["Input", "Model", "Tools"] as const).map(lane => (
            <div key={lane} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 38, fontSize: 9, color: "#6a6a72", fontFamily: mono }}>{lane}</span>
              <div style={{ flex: 1, position: "relative", height: 10, borderBottom: "1px solid #1c1c20" }}>
                {lane === "Input" && timeline.inputTicks.map(b => (
                  <span key={b.key} onClick={() => select(b.key, true)} style={{ position: "absolute", left: `${b.left}%`, top: 2, width: 3, height: 6, background: "#3fa14b", borderRadius: 1, cursor: "pointer" }} />
                ))}
                {lane === "Model" && timeline.modelBars.map(b => (
                  <span key={b.key} onClick={() => select(b.key, true)} style={{ position: "absolute", left: `${b.left}%`, top: b.wide ? 1 : 3, width: b.wide ? 3 : 2, height: b.wide ? 8 : 5, background: selKey === b.key ? "#5a8ad8" : "#b07fd8", borderRadius: 1, cursor: "pointer" }} />
                ))}
                {lane === "Tools" && timeline.toolBars.map(b => (
                  <span key={b.key} onClick={() => select(b.key, true)} style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 2, height: 6, background: selKey === b.key ? "#5a8ad8" : b.unknown ? "#8a8a92" : "#d89a3f", borderRadius: 2, cursor: "pointer" }} />
                ))}
              </div>
            </div>
          ))}
          {/* dashed selection line across lanes */}
          {timeline.selLeft != null && (
            <span style={{ position: "absolute", top: 8, bottom: 8, left: `calc(${38 + 8}px + (100% - ${38 + 8 + 8}px) * ${timeline.selLeft / 100})`, borderLeft: "1px dashed #5a8ad8", pointerEvents: "none" }} />
          )}
        </div>
      )}

      {/* Event list */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
        {rows.length === 0 && <div style={{ color: "var(--color-muted)", fontSize: 12, padding: 12 }}>No trace yet — send a message to start recording.</div>}

        {view !== "turns" && filtered.map(r => (
          <div key={r.key}>
            {r.turnStart != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 2px 4px" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "#e04343" }} />
                <span style={{ fontSize: 10, color: "#8a8a92", fontWeight: 700 }}>Turn {r.turnStart}</span>
              </div>
            )}
            <div
              data-rowkey={r.key}
              onClick={() => select(r.key)}
              style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 4px", cursor: "pointer", background: selKey === r.key ? "#1c1c22" : "transparent", borderRadius: 6 }}
            >
              <span style={{
                flex: "none", width: 7, height: 7, borderRadius: 999, marginTop: 5,
                background: selKey === r.key ? BADGE_COLOR[r.badge] : "transparent",
                border: `1.5px solid ${BADGE_COLOR[r.badge]}`,
              }} />
              <span style={{
                flex: "none", width: 64, textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4,
                color: BADGE_COLOR[r.badge], background: "#1b1b1f", border: "1px solid #28282c",
                borderRadius: 5, padding: "2px 0", marginTop: 2,
              }}>{r.badge}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {r.e.kind === "tool_call" ? (
                  <span style={{ fontFamily: mono, fontSize: 11, color: "#c8c8cc", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {String(r.e.name ?? "")} <span style={{ color: "#7a7a82" }}>{JSON.stringify(r.e.args ?? {}).slice(0, 60)}</span>
                    {r.e2
                      ? <span> → <span style={{ color: "#9a9aa2" }}>{String(r.e2.result ?? "").replace(/\n/g, " ").slice(0, 90)}…</span></span>
                      : <span style={{ color: "#e0608a" }}> TOOL_OUTCOME_UNKNOWN</span>}
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#c8c8cc", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.text}</span>
                )}
                {open.has(r.key) && (
                  <pre className="tool-result" style={{ maxHeight: 220, margin: "6px 0 4px", whiteSpace: "pre-wrap" }}>
                    {r.e.kind === "request"
                      ? JSON.stringify({ messages: r.e.messages, toolNames: r.e.toolNames }, null, 2)
                      : r.e.kind === "tool_call"
                        ? `args: ${JSON.stringify(r.e.args ?? {}, null, 2)}\n\nresult: ${String(r.e2?.result ?? "(none)")}`
                        : String(r.e.text ?? r.e.result ?? JSON.stringify(r.e, null, 2))}
                  </pre>
                )}
              </div>
              <button onClick={e => { e.stopPropagation(); setOpen(prev => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; }); }} style={{ background: "transparent", border: "none", color: "#6a6a72", cursor: "pointer", padding: 2 }}>{open.has(r.key) ? "−" : "+"}</button>
            </div>
          </div>
        ))}

        {view === "turns" && (() => {
          const map = new Map<number, Row[]>();
          for (const r of rows) { const t = r.e.turn ?? 0; if (!map.has(t)) map.set(t, []); map.get(t)!.push(r); }
          return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([turn, rs]) => (
            <div key={turn} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, margin: "8px 2px", background: "var(--color-surface)" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "#e04343" }} />
                <span style={{ fontWeight: 700, fontSize: 12 }}>Turn {turn}</span>
                {rs.filter(r => r.e.kind === "response").map((r, i) => (
                  <span key={i} style={{ fontSize: 10, color: "var(--color-muted)", fontFamily: mono }}>r{String(r.e.round)} {fmtMs(Number(r.e.totalMs ?? 0))}</span>
                ))}
              </div>
              {rs.filter(r => ["reasoning", "tool_call", "content", "user"].includes(r.e.kind)).map(r => (
                <div key={r.key} style={{ marginTop: 6 }}>
                  <button onClick={() => select(r.key)} style={{ display: "flex", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: BADGE_COLOR[r.badge] }}>{r.badge}</span>
                    <span style={{ fontSize: 11, color: "#c8c8c8" }}>{r.text.slice(0, 90)}</span>
                  </button>
                </div>
              ))}
            </div>
          ));
        })()}
      </div>

      {/* Inspector — dsh style */}
      {selRow && (() => {
        const isTool = selRow.e.kind === "tool_call";
        const roundEntries = entries.filter(e => isTool
          ? (e.kind === "tool_call" || e.kind === "tool_result") && e.round === selRow.e.round && e.name === selRow.e.name
          : (e.round === selRow.e.round && ["request", "response", "reasoning", "content", "tool_call"].includes(e.kind)));
        const req = roundEntries.find(e => e.kind === "request");
        const resp = roundEntries.find(e => e.kind === "response");
        const think = roundEntries.filter(e => e.kind === "reasoning").map(e => String(e.text ?? "")).join("\n");
        const contents = roundEntries.filter(e => e.kind === "content").map(e => String(e.text ?? "")).join("\n");
        const tools = roundEntries.filter(e => e.kind === "tool_call");
        const u = readUsage(resp?.usage);
        const total = Number(resp?.totalMs ?? 0);
        const ttft = Number(resp?.firstChunkMs ?? 0);
        return (
          <div style={{ position: "absolute", top: 44, right: 8, bottom: 36, width: "min(400px, 94%)", background: "#141416", border: "1px solid #333338", borderRadius: 12, zIndex: 1600, display: "flex", flexDirection: "column", boxShadow: "0 12px 32px rgba(0,0,0,.55)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid #26262a" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: BADGE_COLOR[selRow.badge], background: "#1d1d21", border: "1px solid #2a2a2e", borderRadius: 4, padding: "2px 6px" }}>{isTool ? "TOOL" : selRow.badge}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, flex: 1 }}>
                {isTool ? `${String(selRow.e.name ?? "")} · Turn ${String(selRow.e.turn ?? "")} · Step ${selRow.key}` : `${selRow.badge === "ASSISTANT" || selRow.badge === "MODEL" ? "ASSISTANT" : selRow.badge} Turn ${String(selRow.e.turn ?? "")} · Step ${selRow.key}`}
              </span>
              <button onClick={() => setSelKey(null)} style={{ background: "transparent", border: "none", color: "#8a8a92", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 14, padding: "7px 12px", borderBottom: "1px solid #26262a" }}>
              {(["summary", "preview", "raw"] as const).map(tb => (
                <button key={tb} onClick={() => setSelTab(tb)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "2px 0", color: selTab === tb ? "#e8e8ea" : "#8a8a92", borderBottom: selTab === tb ? "2px solid #5a8ad8" : "2px solid transparent", textTransform: "capitalize" }}>{tb}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {selTab === "summary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 11.5 }}>
                  {!isTool && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Source</span><span>Request #{String(selRow.e.round ?? 0)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Status</span><span style={{ color: "#3fa14b" }}>{String(resp?.status ?? "—") === "ok" ? "Completed" : String(resp?.status ?? "—")}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Tokens</span><span>{u ? fmtTok(u.completion) : "—"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 14 }}><span style={{ color: "#8a8a92" }}>Reasoning</span><span>{fmtTok(u?.reasoning ?? 0)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 14 }}><span style={{ color: "#8a8a92" }}>Content</span><span>{u ? fmtTok(u.completion - u.reasoning) : "—"}</span></div>
                      <div style={{ marginTop: 8, fontWeight: 700, fontSize: 10, color: "#8a8a92", letterSpacing: 0.5 }}>REQUEST TIMING</div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Started</span><span style={{ fontFamily: mono }}>{req?.ts ? new Date(String(req.ts)).toLocaleTimeString() : "—"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Total duration</span><span style={{ fontFamily: mono }}>{(total / 1000).toFixed(1)}s</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>TTFT</span><span style={{ fontFamily: mono }}>{(ttft / 1000).toFixed(2)}s</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Generation</span><span style={{ fontFamily: mono }}>{((total - ttft) / 1000).toFixed(1)}s</span></div>
                    </>
                  )}
                  {isTool && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Tool</span><span style={{ fontFamily: mono }}>{String(selRow.e.name ?? "")}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Status</span><span style={{ color: selRow.e2 ? "#3fa14b" : "#e0608a" }}>{selRow.e2 ? "Completed" : "Unknown"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a92" }}>Duration</span><span style={{ fontFamily: mono }}>{selRow.e2?.ms != null ? `${selRow.e2.ms}ms` : "—"}</span></div>
                    </>
                  )}
                </div>
              )}
              {selTab === "preview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
                  {isTool ? (
                    <>
                      <div style={{ fontWeight: 700, color: "#8a8a92", fontSize: 10 }}>ARGS</div>
                      <pre className="tool-result" style={{ maxHeight: 140 }}>{JSON.stringify(selRow.e.args ?? {}, null, 2)}</pre>
                      <div style={{ fontWeight: 700, color: "#8a8a92", fontSize: 10 }}>RESULT</div>
                      <pre className="tool-result" style={{ maxHeight: 200 }}>{String(selRow.e2?.result ?? "(none)")}</pre>
                    </>
                  ) : (
                    <>
                      {think && (<><div style={{ fontWeight: 700, color: "#b07fd8", fontSize: 10 }}>[thinking]</div><pre className="tool-result" style={{ maxHeight: 180 }}>{think}</pre></>)}
                      {contents && (<><div style={{ fontWeight: 700, color: "#8a8a92", fontSize: 10 }}>CONTENT</div><pre className="tool-result" style={{ maxHeight: 180 }}>{contents}</pre></>)}
                      {tools.length > 0 && (<><div style={{ fontWeight: 700, color: "#d89a3f", fontSize: 10 }}>TOOL CALLS</div>{tools.map((tl, i) => <pre key={i} className="tool-result" style={{ maxHeight: 100 }}>{String(tl.name ?? "")} {String(tl.args ?? "")}</pre>)}</>)}
                    </>
                  )}
                </div>
              )}
              {selTab === "raw" && <pre className="tool-result" style={{ maxHeight: "100%" }}>{JSON.stringify(roundEntries, null, 2)}</pre>}
            </div>
          </div>
        );
      })()}

      {/* Footer stats — dsh format */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "7px 10px", borderTop: "1px solid var(--color-border)", fontSize: 10, color: "#8a8a92" }}>
        <span>{stats.turns} turns · {stats.steps} steps</span>
        <span style={{ color: "#3a3a3e" }}>|</span>
        <span>LLM {fmtMs(stats.llmMs)} · Tool call {fmtMs(stats.toolMs)}</span>
        <span style={{ color: "#3a3a3e" }}>|</span>
        <span>TTFT avg {fmtMs(stats.ttft)} · {Math.round(stats.tps)} tok/s</span>
        <span style={{ color: "#3a3a3e" }}>|</span>
        <span>Cache hit {Math.round(stats.cache * 100)}%</span>
        <span style={{ color: "#3a3a3e" }}>|</span>
        <span>Input {fmtTok(stats.inTok)} tok · Output {fmtTok(stats.outTok)} tok</span>
      </div>
    </div>
  );
}
