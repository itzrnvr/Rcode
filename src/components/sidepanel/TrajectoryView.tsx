/*
 * PURPOSE: Detailed trajectory viewer — mirrors dsh's ui-trajectory hierarchy.
 *
 * Folds the session's JSONL trace (trace:list IPC) into:
 *   Turn N header (model · mode · effort · Xs · error)
 *     ├ request  — full message list (expandable) + tool names
 *     ├ response — status / first-chunk ms / total ms / chunk count per round
 *     ├ reasoning cells (collapsible)
 *     ├ tool rows (args + capped result, expandable, with ms)
 *     └ content  — final answer (expandable)
 *
 * Refresh button re-reads the trace; auto-refresh every 3s while mounted so a
 * live turn shows up as it streams.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { RefreshIcon, ChevronDownIcon } from "../common/Icons";
import { ThinkingBlock } from "../chat/ChatMessage";

interface TraceEntry {
  ts: string;
  kind: string;
  turn?: number;
  round?: number | string;
  [k: string]: unknown;
}

function Collapsible({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ margin: "4px 0" }}>
      <button className="tool-row-head" onClick={() => setOpen(o => !o)} style={{ background: "transparent" }}>
        <ChevronDownIcon size={12} className={open ? "rotate-180" : ""} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
      </button>
      {open && <div style={{ padding: "6px 4px 6px 22px" }}>{children}</div>}
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return <pre className="tool-result" style={{ maxHeight: 200 }}>{text}</pre>;
}

export function TrajectoryView({ sessionId }: { sessionId: string | null }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
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

  const turns = useMemo(() => {
    const map = new Map<number, TraceEntry[]>();
    for (const e of entries) {
      const t = e.turn ?? 0;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(e);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [entries]);

  if (!sessionId) return <div style={{ color: "var(--color-muted)", padding: 20, fontSize: 12 }}>Open a session to see its trajectory.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Trajectory</span>
        <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{entries.length} events</span>
        <button className="ms-iconbtn" title="Refresh" onClick={() => setReload(r => r + 1)}><RefreshIcon size={13} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px" }}>
        {turns.length === 0 && <div style={{ color: "var(--color-muted)", fontSize: 12, padding: 12 }}>No trace yet — send a message to start recording.</div>}
        {turns.map(([turn, evts]) => {
          const start = evts.find(e => e.kind === "turn_start");
          const end = evts.find(e => e.kind === "turn_end");
          const reqs = evts.filter(e => e.kind === "request");
          const resps = evts.filter(e => e.kind === "response");
          const reasons = evts.filter(e => e.kind === "reasoning");
          const calls = evts.filter(e => e.kind === "tool_call");
          const results = evts.filter(e => e.kind === "tool_result");
          const contents = evts.filter(e => e.kind === "content");
          return (
            <div key={turn} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, margin: "8px 0", background: "var(--color-surface)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>Turn {turn}</span>
                {start && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{String(start.model)}</span>}
                {start && <span className="ms-badge">{String(start.mode)}</span>}
                {start?.effort != null && <span className="ms-badge">{String(start.effort)}</span>}
                {end && <span className="ms-badge">{String(end.secs)}s</span>}
                {end?.error != null && <span className="ms-badge" style={{ color: "var(--color-danger)" }}>{String(end.error).slice(0, 60)}</span>}
              </div>

              {start && (
                <Collapsible label={`request · ${String(start.userMessage ?? "").slice(0, 60)}`}>
                  <Pre text={JSON.stringify({ model: start.model, baseUrl: start.baseUrl, effort: start.effort, mode: start.mode, tools: reqs[0]?.toolNames }, null, 2)} />
                  {(reqs[0]?.messages as Array<{ role?: string; content?: string }> | undefined)?.map((m, i) => (
                    <Collapsible key={i} label={`${m.role ?? "?"} · ${(m.content ?? "").slice(0, 50)}`}>
                      <Pre text={String(m.content ?? "")} />
                    </Collapsible>
                  ))}
                </Collapsible>
              )}

              {resps.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--color-muted)", margin: "4px 0" }}>
                  response r{String(r.round)} · {String(r.status)} · first {r.firstChunkMs != null ? `${String(r.firstChunkMs)}ms` : "—"} · total {String(r.totalMs)}ms · {String(r.chunks)} chunks{r.usage ? ` · ${(r.usage as {prompt_tokens?:number}).prompt_tokens ?? 0}↑ ${(r.usage as {completion_tokens?:number}).completion_tokens ?? 0}↓` : ""}
                  {r.error != null && <span style={{ color: "var(--color-danger)" }}> · {String(r.error)}</span>}
                </div>
              ))}

              {reasons.map((r, i) => (
                <ThinkingBlock key={`r${i}`} content={String(r.text ?? "")} />
              ))}

              {calls.map((c, i) => {
                const res = results[i];
                return (
                  <div key={i} className="tool-row">
                    <ToolRowInner name={String(c.name)} args={JSON.stringify(c.args ?? {})} result={res ? String(res.result ?? "") : undefined} ms={res?.ms != null ? Number(res.ms) : undefined} />
                  </div>
                );
              })}

              {contents.map((c, i) => (
                <Collapsible key={`c${i}`} label="final answer">
                  <Pre text={String(c.text ?? "")} />
                </Collapsible>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolRowInner({ name, args, result, ms }: { name: string; args: string; result?: string; ms?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="tool-row-head" onClick={() => setOpen(o => !o)}>
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span className="tool-row-args">{args.slice(0, 80)}</span>
        {ms != null && <span className="ms-badge">{ms}ms</span>}
        <ChevronDownIcon size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <>
          <Collapsible label="args" defaultOpen><Pre text={args} /></Collapsible>
          {result != null && <Collapsible label="result" defaultOpen><Pre text={result} /></Collapsible>}
        </>
      )}
    </div>
  );
}
