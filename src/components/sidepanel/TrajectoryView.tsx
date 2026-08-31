/*
 * PURPOSE: Trajectory viewer at dsh-web parity.
 *
 * Toolbar: Duration / Turns / Calls icon toggles + Search + Session log download.
 * Duration view: activity sparkline strip + Input/Model/Tools swim lanes,
 * then the event table — bullet dot gutter, role badges (SYSTEM/USER/CONTEXT/
 * ASSISTANT/THINK/TOOL/MODEL), "Turn N" gutter markers at turn boundaries,
 * merged TOOL rows (`name {args} → result`), click-to-expand full content,
 * click to open the Summary/Preview/Raw inspector.
 * Stats footer mirrors dsh: turns · steps | LLM · Tool call | TTFT avg ·
 * tok/s | Cache hit % | Input · Output tok, pipe-separated groups.
 *
 * Data source: JSONL trace (trace:list IPC), auto-refresh 3s.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { RefreshIcon, ChevronDownIcon, SearchIcon, ClockIcon, ListIcon, LayoutGridIcon, DownloadIcon } from "../common/Icons";

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
  SYSTEM: "#8a8a8a",
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

function fmtTok(n: number): string {
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

interface Row {
  key: number;
  badge: string;
  text: string;
  e: TraceEntry;
  e2?: TraceEntry;
  turnStart?: number;
}

export function TrajectoryView({ sessionId }: { sessionId: string | null }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [view, setView] = useState<"duration" | "turns" | "calls">("duration");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sel, setSel] = useState<{ type: "model" | "tool"; round: number | string; name?: string } | null>(null);
  const [selTab, setSelTab] = useState<"summary" | "preview" | "raw">("summary");
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

  // Fold trace into display rows: merge tool_call+tool_result, mark turn starts.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let key = 0;
    const seenTurns = new Set<number>();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const turnStart = e.turn != null && !seenTurns.has(e.turn) ? e.turn : undefined;
      if (turnStart != null) seenTurns.add(turnStart);
      if (e.kind === "tool_result") continue; // merged into its tool_call row
      let text = "";
      let e2: TraceEntry | undefined;
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
          text = `${e.name} ${JSON.stringify(e.args ?? {}).slice(0, 90)}${res ? ` → ${String(res.result ?? "").replace(/\n/g, " ").slice(0, 90)}` : ""}`;
          break;
        }
        case "content": text = String(e.text ?? ""); break;
        case "turn_end": text = e.error ? `ended · ERROR ${e.error}` : `ended · ${e.secs}s`; break;
        default: text = e.kind;
      }
      out.push({ key: key++, badge: BADGE[e.kind] ?? "SYSTEM", text, e, e2, turnStart });
    }
    return out;
  }, [entries]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter(r => r.text.toLowerCase().includes(q) || r.badge.toLowerCase().includes(q));
  }, [rows, query]);

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
    const at = (ts: string) => ((new Date(ts).getTime() - t0) / span) * 100;
    const modelBars: Array<{ left: number; width: number; round: number | string }> = [];
    const toolBars: Array<{ left: number; width: number; round: number | string; name?: string }> = [];
    const inputTicks: Array<{ left: number }> = [];
    const spark: Array<{ left: number; color: string; h: number }> = [];
    let lastReq: number | null = null;
    for (const e of entries) {
      const left = at(e.ts);
      if (e.kind === "user" || e.kind === "turn_start") inputTicks.push({ left });
      if (e.kind === "request") lastReq = left;
      if (e.kind === "response" && lastReq != null) {
        modelBars.push({ left: lastReq, width: Math.max(0.4, left - lastReq), round: e.round ?? 0 });
        lastReq = null;
      }
      if (e.kind === "tool_call") {
        const res = entries.find(x => x.kind === "tool_result" && x.round === e.round && x.name === e.name);
        const end = res ? at(res.ts) : left + 0.4;
        toolBars.push({ left, width: Math.max(0.4, end - left), round: e.round ?? 0, name: e.name as string | undefined });
      }
      const color = e.kind === "tool_call" || e.kind === "tool_result" ? "#d89a3f" : e.kind === "response" ? "#b07fd8" : e.kind === "user" ? "#3fa14b" : e.kind === "reasoning" ? "#7a5fa8" : "#3a3a3a";
      spark.push({ left, color, h: e.kind === "response" ? 8 : e.kind === "tool_call" ? 6 : 4 });
    }
    return { modelBars, toolBars, inputTicks, spark };
  }, [entries]);

  const downloadLog = () => {
    const blob = new Blob([entries.map(e => JSON.stringify(e)).join("\n")], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `session-log-${sessionId?.slice(0, 8)}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!sessionId) return <div style={{ color: "var(--color-muted)", padding: 20, fontSize: 12 }}>Open a session to see its trajectory.</div>;

  const toggle = (i: number) => setOpen(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const select = (r: Row) => {
    if (r.e.kind === "tool_call" || r.e.kind === "tool_result") setSel({ type: "tool", round: r.e.round ?? 0, name: r.e.name as string | undefined });
    else if (r.e.kind !== "turn_start" && r.e.kind !== "user" && r.e.kind !== "system") setSel({ type: "model", round: r.e.round ?? 0 });
    else return;
    setSelTab("summary");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, position: "relative" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 6px", borderBottom: "1px solid var(--color-border)" }}>
        {(["duration", "turns", "calls"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            title={v[0].toUpperCase() + v.slice(1)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: view === v ? "#242424" : "transparent",
              color: view === v ? "#e8e8e8" : "#8a8a8a",
              border: "1px solid " + (view === v ? "#3a3a3a" : "transparent"),
              textTransform: "capitalize",
            }}
          >
            {v === "duration" ? <ClockIcon size={12} /> : v === "turns" ? <ListIcon size={12} /> : <LayoutGridIcon size={12} />}
            {v}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#161616", border: "1px solid #262626", borderRadius: 7, padding: "3px 7px" }}>
          <SearchIcon size={11} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" style={{ background: "transparent", border: "none", outline: "none", color: "#e8e8e8", fontSize: 11, width: 80 }} />
        </div>
        <button className="ms-iconbtn" title="Session log" onClick={downloadLog}><DownloadIcon size={13} /></button>
        <button className="ms-iconbtn" title="Refresh" onClick={() => setReload(r => r + 1)}><RefreshIcon size={13} /></button>
      </div>

      {/* Timeline */}
      {view === "duration" && timeline && (
        <div style={{ padding: "8px 6px", borderBottom: "1px solid var(--color-border)" }}>
          {/* activity sparkline */}
          <div style={{ position: "relative", height: 10, marginBottom: 4 }}>
            {timeline.spark.map((s, i) => (
              <span key={i} style={{ position: "absolute", left: `${s.left}%`, bottom: 0, width: 2, height: s.h, background: s.color, borderRadius: 1 }} />
            ))}
          </div>
          {(["Input", "Model", "Tools"] as const).map(lane => (
            <div key={lane} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{ width: 38, fontSize: 9, color: "#8a8a8a" }}>{lane}</span>
              <div style={{ flex: 1, position: "relative", height: 7 }}>
                {lane === "Input" && timeline.inputTicks.map((t, i) => (
                  <span key={i} style={{ position: "absolute", left: `${t.left}%`, top: 0, width: 2, height: 7, background: "#3fa14b" }} />
                ))}
                {lane === "Model" && timeline.modelBars.map((b, i) => (
                  <span key={i} onClick={() => { setSel({ type: "model", round: b.round }); setSelTab("summary"); }}
                    style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 0, height: 7, background: "#b07fd8", borderRadius: 2, cursor: "pointer", outline: sel?.type === "model" && sel.round === b.round ? "2px solid #5a8ad8" : "none" }} />
                ))}
                {lane === "Tools" && timeline.toolBars.map((b, i) => (
                  <span key={i} onClick={() => { setSel({ type: "tool", round: b.round, name: b.name }); setSelTab("summary"); }}
                    style={{ position: "absolute", left: `${b.left}%`, width: `${b.width}%`, top: 0, height: 7, background: "#d89a3f", borderRadius: 2, cursor: "pointer", outline: sel?.type === "tool" && sel.round === b.round && sel.name === b.name ? "2px solid #5a8ad8" : "none" }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Event table */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px" }}>
        {rows.length === 0 && <div style={{ color: "var(--color-muted)", fontSize: 12, padding: 12 }}>No trace yet — send a message to start recording.</div>}

        {view !== "turns" && filtered.map(r => {
          if (view === "calls" && r.badge !== "TOOL") return null;
          return (
            <div key={r.key}>
              {r.turnStart != null && (
                <div style={{ fontSize: 9.5, color: "#6a6a6a", padding: "8px 2px 2px", fontWeight: 700 }}>▸ Turn {r.turnStart}</div>
              )}
              <div style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "3px 2px", borderBottom: "1px solid #171717" }}>
                <span style={{ flex: "none", width: 5, height: 5, borderRadius: 999, background: r.badge === "TOOL" && r.e2 ? "#d89a3f" : r.badge === "ASSISTANT" ? "#9a7fd8" : "#4a4a4a", marginTop: 6 }} />
                <span style={{
                  flex: "none", width: 62, textAlign: "center", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4,
                  color: BADGE_COLOR[r.badge] ?? "#8a8a8a", background: "#1b1b1b", border: "1px solid #282828",
                  borderRadius: 4, padding: "2px 0", marginTop: 1,
                }}>{r.badge}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button onClick={() => { toggle(r.key); select(r); }} style={{ display: "flex", gap: 6, alignItems: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
                    <span style={{ fontSize: 11, color: "#c8c8c8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.text}</span>
                    <ChevronDownIcon size={10} className={open.has(r.key) ? "rotate-180" : ""} />
                  </button>
                  {open.has(r.key) && (
                    <pre className="tool-result" style={{ maxHeight: 220, margin: "4px 0 8px" }}>
                      {r.e.kind === "request"
                        ? JSON.stringify({ messages: r.e.messages, toolNames: r.e.toolNames }, null, 2)
                        : r.e.kind === "tool_call"
                          ? `args: ${JSON.stringify(r.e.args ?? {}, null, 2)}\n\nresult: ${String(r.e2?.result ?? "")}`
                          : String(r.e.text ?? r.e.result ?? JSON.stringify(r.e, null, 2))}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {view === "turns" && (() => {
          const map = new Map<number, Row[]>();
          for (const r of rows) { const t = r.e.turn ?? 0; if (!map.has(t)) map.set(t, []); map.get(t)!.push(r); }
          return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([turn, rs]) => (
            <div key={turn} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, margin: "8px 2px", background: "var(--color-surface)" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>Turn {turn}</span>
                {rs.filter(r => r.e.kind === "response").map((r, i) => (
                  <span key={i} style={{ fontSize: 10, color: "var(--color-muted)" }}>r{String(r.e.round)} {fmtMs(Number(r.e.totalMs ?? 0))}</span>
                ))}
              </div>
              {rs.filter(r => ["reasoning", "tool_call", "content", "user"].includes(r.e.kind)).map((r, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <button onClick={() => toggle(r.key + turn * 1000)} style={{ display: "flex", gap: 6, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: BADGE_COLOR[r.badge] }}>{r.badge}</span>
                    <span style={{ fontSize: 11, color: "#c8c8c8" }}>{r.text.slice(0, 90)}</span>
                  </button>
                  {open.has(r.key + turn * 1000) && (
                    <pre className="tool-result" style={{ maxHeight: 180, margin: "4px 0" }}>
                      {r.e.kind === "tool_call" ? `args: ${JSON.stringify(r.e.args ?? {}, null, 2)}\n\nresult: ${String(r.e2?.result ?? "")}` : String(r.e.text ?? "")}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          ));
        })()}
      </div>

      {/* Inspector */}
      {sel && (() => {
        const roundEntries = entries.filter(e => sel.type === "tool"
          ? (e.kind === "tool_call" || e.kind === "tool_result") && e.round === sel.round && (sel.name ? e.name === sel.name : true)
          : (e.round === sel.round && ["request", "response", "reasoning", "content", "tool_call"].includes(e.kind)));
        const req = roundEntries.find(e => e.kind === "request");
        const resp = roundEntries.find(e => e.kind === "response");
        const think = roundEntries.filter(e => e.kind === "reasoning").map(e => String(e.text ?? "")).join("\n");
        const contents = roundEntries.filter(e => e.kind === "content").map(e => String(e.text ?? "")).join("\n");
        const tools = roundEntries.filter(e => e.kind === "tool_call");
        const u = resp?.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
        const total = Number(resp?.totalMs ?? 0);
        const ttft = Number(resp?.firstChunkMs ?? 0);
        const tool = sel.type === "tool" ? roundEntries.find(e => e.kind === "tool_call") : undefined;
        const toolRes = roundEntries.find(e => e.kind === "tool_result");
        return (
          <div style={{ position: "absolute", top: 40, right: 6, bottom: 34, width: "min(400px, 92%)", background: "#141414", border: "1px solid #333", borderRadius: 10, zIndex: 1600, display: "flex", flexDirection: "column", boxShadow: "0 12px 32px rgba(0,0,0,.5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #262626" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: sel.type === "tool" ? "#d89a3f" : "#9a7fd8", background: "#1d1d1d", border: "1px solid #2a2a2a", borderRadius: 4, padding: "2px 6px" }}>{sel.type === "tool" ? "TOOL" : "ASSISTANT"}</span>
              <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>{sel.type === "tool" ? `${String(tool?.name ?? "")} · round ${String(sel.round)}` : `Request #${String(sel.round)}`}</span>
              <button onClick={() => setSel(null)} style={{ background: "transparent", border: "none", color: "#8a8a8a", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 12, padding: "6px 10px", borderBottom: "1px solid #262626" }}>
              {(["summary", "preview", "raw"] as const).map(tb => (
                <button key={tb} onClick={() => setSelTab(tb)} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "2px 0", color: selTab === tb ? "#e8e8e8" : "#8a8a8a", borderBottom: selTab === tb ? "2px solid #5a8ad8" : "2px solid transparent", textTransform: "capitalize" }}>{tb}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
              {selTab === "summary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                  {sel.type === "model" ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Source</span><span>Request #{String(sel.round)}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Status</span><span>{String(resp?.status ?? "—")}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Tokens</span><span>{u ? `${fmtTok(u.completion_tokens ?? 0)} tok` : "—"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 12 }}><span style={{ color: "#8a8a8a" }}>Reasoning</span><span>{fmtTok(u?.completion_tokens_details?.reasoning_tokens ?? 0)} tok</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 12 }}><span style={{ color: "#8a8a8a" }}>Content</span><span>{u ? `${fmtTok((u.completion_tokens ?? 0) - (u.completion_tokens_details?.reasoning_tokens ?? 0))} tok` : "—"}</span></div>
                      <div style={{ marginTop: 6, fontWeight: 700, fontSize: 10, color: "#8a8a8a" }}>REQUEST TIMING</div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Started</span><span>{req?.ts ? new Date(String(req.ts)).toLocaleTimeString() : "—"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Total duration</span><span>{(total / 1000).toFixed(1)}s</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>TTFT</span><span>{(ttft / 1000).toFixed(2)}s</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Generation</span><span>{((total - ttft) / 1000).toFixed(1)}s</span></div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Tool</span><span>{String(tool?.name ?? "")}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Status</span><span>{toolRes ? "Completed" : "Running"}</span></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8a8a8a" }}>Duration</span><span>{toolRes?.ms != null ? `${toolRes.ms}ms` : "—"}</span></div>
                    </>
                  )}
                </div>
              )}
              {selTab === "preview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
                  {sel.type === "tool" ? (
                    <>
                      <div style={{ fontWeight: 700, color: "#8a8a8a", fontSize: 10 }}>ARGS</div>
                      <pre className="tool-result" style={{ maxHeight: 140 }}>{JSON.stringify(tool?.args ?? {}, null, 2)}</pre>
                      <div style={{ fontWeight: 700, color: "#8a8a8a", fontSize: 10 }}>RESULT</div>
                      <pre className="tool-result" style={{ maxHeight: 200 }}>{String(toolRes?.result ?? "")}</pre>
                    </>
                  ) : (
                    <>
                      {think && (<><div style={{ fontWeight: 700, color: "#b07fd8", fontSize: 10 }}>THINKING</div><pre className="tool-result" style={{ maxHeight: 180 }}>{think}</pre></>)}
                      {contents && (<><div style={{ fontWeight: 700, color: "#8a8a8a", fontSize: 10 }}>CONTENT</div><pre className="tool-result" style={{ maxHeight: 180 }}>{contents}</pre></>)}
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

      {/* Stats footer — dsh format */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "6px 8px", borderTop: "1px solid var(--color-border)", fontSize: 10, color: "#9a9a9a" }}>
        <span>{stats.turns} turns · {stats.steps} steps</span>
        <span style={{ color: "#3a3a3a" }}>|</span>
        <span>LLM {fmtMs(stats.llmMs)} · Tool call {fmtMs(stats.toolMs)}</span>
        <span style={{ color: "#3a3a3a" }}>|</span>
        <span>TTFT avg {fmtMs(stats.ttft)} · {Math.round(stats.tps)} tok/s</span>
        <span style={{ color: "#3a3a3a" }}>|</span>
        <span>Cache hit {Math.round(stats.cache * 100)}%</span>
        <span style={{ color: "#3a3a3a" }}>|</span>
        <span>Input {fmtTok(stats.inTok)} tok · Output {fmtTok(stats.outTok)} tok</span>
      </div>
    </div>
  );
}
