/*
 * PURPOSE: Functional terminal pane for SidePanel — simple shell via IPC
 *
 * Uses the main-process shell (powershell/cmd on Windows) via terminal:create/input.
 * No xterm.js to keep bundle small; renders output in <pre> and an input line.
 * Supports basic line editing, history (↑/↓), and Ctrl+C.
 */

import { useEffect, useRef, useState, useCallback } from "react";

import { api } from "../../api/client";

interface TerminalPaneProps {
  terminalId: string;
}

export function TerminalPane({ terminalId }: TerminalPaneProps) {
  const [output, setOutput] = useState<string>("Rcode Terminal — type a command and press Enter\r\n$ ");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as unknown as { createTerminal: (id: string) => Promise<void> }).createTerminal(terminalId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const off = (api as unknown as { onTerminalData: (id: string, cb: (d: string) => void) => () => void }).onTerminalData(terminalId, (data: string) => {
      setOutput(prev => prev + data);
    });
    return () => {
      off();
    };
  }, [terminalId]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [output]);

  const send = useCallback(() => {
    const cmd = input;
    if (cmd === "") {
      setOutput(o => o + "\r\n$ ");
      return;
    }
    setHistory(h => [...h, cmd]);
    setHistIdx(-1);
    setOutput(o => o + cmd + "\r\n");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as unknown as { sendTerminalInput: (id: string, d: string) => Promise<void> }).sendTerminalInput(terminalId, cmd + "\r\n");
    setInput("");
  }, [input, terminalId]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(nextIdx);
      setInput(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === -1) return;
      const nextIdx = histIdx + 1;
      if (nextIdx >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(nextIdx);
        setInput(history[nextIdx]);
      }
    } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+C
      e.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api as unknown as { sendTerminalInput: (id: string, d: string) => Promise<void> }).sendTerminalInput(terminalId, "\x03");
      setOutput(o => o + "^C\r\n$ ");
      setInput("");
    }
  }, [send, history, histIdx, terminalId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0f0f0f", border: "1px solid #262626", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "6px 10px", fontSize: 11, color: "#8a8a8a", borderBottom: "1px solid #1f1f1f", display: "flex", justifyContent: "space-between" }}>
        <span>Terminal — {terminalId}</span>
        <span style={{ opacity: 0.6 }}>pwsh</span>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#e8e8e8" }}>
        {output}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid #1f1f1f", background: "#0a0a0a" }}>
        <span style={{ color: "#22c55e", fontFamily: "monospace", fontSize: 12 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          autoFocus
          spellCheck={false}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e8e8e8", fontFamily: "monospace", fontSize: 12 }}
        />
      </div>
    </div>
  );
}
