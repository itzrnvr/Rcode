/*
 * PURPOSE: Full terminal pane via xterm.js + node-pty — VS Code style
 *
 * No separate input widget — the xterm itself handles all key handling,
 * cursor, selection, copy/paste, and renders ANSI. The shell is a real PTY
 * (conpty on Windows) via main process, so vim, htop, etc. work.
 */

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { api } from "../../api/client";

interface TerminalPaneProps {
  terminalId: string;
}

export function TerminalPane({ terminalId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: "#161616",
        foreground: "#e8e8e8",
        cursor: "#e8e8e8",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      allowTransparency: false,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Defer fit to next frame so container has size
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      const dims = fit.proposeDimensions();
      if (dims) (api as unknown as { createTerminal: (id: string) => Promise<void> }).createTerminal(terminalId);
    });

    termRef.current = term;
    fitRef.current = fit;

    // Handle user input -> send to PTY
    const dataDisp = term.onData((data) => {
      (api as unknown as { sendTerminalInput: (id: string, d: string) => Promise<void> }).sendTerminalInput(terminalId, data);
    });

    // Handle data from PTY -> write to xterm
    const off = (api as unknown as { onTerminalData: (id: string, cb: (d: string) => void) => () => void }).onTerminalData(terminalId, (data) => {
      term.write(data);
    });

    // Ensure shell exists (no-op if already)
    (api as unknown as { createTerminal: (id: string) => Promise<void> }).createTerminal(terminalId);

    const onResize = () => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (d) {
          (api as unknown as { sendTerminalResize?: (id: string, cols: number, rows: number) => Promise<void> }).sendTerminalResize?.(terminalId, d.cols, d.rows);
          (window as unknown as { electron: { sendTerminalResize?: (id: string, c: number, r: number) => Promise<void> } }).electron?.sendTerminalResize?.(terminalId, d.cols, d.rows);
        }
      } catch {}
    };

    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);
    window.addEventListener("resize", onResize);

    // Focus on mount
    term.focus();

    return () => {
      dataDisp.dispose();
      off();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId]);

  // Also handle explicit resize via IPC if available
  useEffect(() => {
    const fit = fitRef.current;
    if (!fit) return;
    const t = setTimeout(() => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (d) (api as unknown as { sendTerminalResize?: (id: string, cols: number, rows: number) => Promise<void> }).sendTerminalResize?.(terminalId, d.cols, d.rows);
      } catch {}
    }, 100);
    return () => clearTimeout(t);
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 200,
        background: "#161616",
        padding: 8,
        borderRadius: 8,
        border: "1px solid #262626",
      }}
      onClick={() => termRef.current?.focus()}
    />
  );
}
