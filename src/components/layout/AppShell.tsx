/*
 * PURPOSE: Layout shell — 2-panel or 3-panel depending on side panel
 *
 * Panel widths (configurable via CSS):
 *   - titlebar: 44px tall
 *   - sessions: 280px expanded, 0px collapsed
 *   - chat: flex 1
 *   - sidePanel: 300px when present, 0 when null
 */

import { type ReactNode } from "react";

interface AppShellProps {
  titleBar: ReactNode;
  sessions: ReactNode;
  chat: ReactNode;
  sidePanel: ReactNode | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  onSidebarWidthChange?: (w: number) => void;
  sidePanelCollapsed?: boolean;
  sidePanelWidth?: number;
  onSidePanelWidthChange?: (w: number) => void;
  onToggleSidePanel?: () => void;
}

export function AppShell({ titleBar, sessions, chat, sidePanel, sidebarCollapsed, sidebarWidth, onSidebarWidthChange, sidePanelCollapsed, sidePanelWidth, onSidePanelWidthChange, onToggleSidePanel }: AppShellProps) {
  const handleLeftMouseDown = (e: React.MouseEvent) => {
    if (sidebarCollapsed) return;
    const startX = e.clientX;
    const startW = sidebarWidth ?? 280;
    const el = document.querySelector(".panel-sessions") as HTMLElement | null;
    const prevTransition = el?.style.transition;
    if (el) el.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.min(480, Math.max(200, startW + delta));
      // Direct DOM update for smooth 60fps without React re-render per pixel
      if (el) {
        el.style.width = `${next}px`;
        el.style.minWidth = `${next}px`;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (el) el.style.transition = prevTransition ?? "";
      const delta = ev.clientX - startX;
      const finalW = Math.min(480, Math.max(200, startW + delta));
      onSidebarWidthChange?.(finalW);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleRightMouseDown = (e: React.MouseEvent) => {
    if (sidePanelCollapsed) return;
    const startX = e.clientX;
    const startW = sidePanelWidth ?? 380;
    const el = document.querySelector(".panel-side") as HTMLElement | null;
    const prevTransition = el?.style.transition;
    if (el) el.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // drag left to increase width
      const next = Math.min(600, Math.max(240, startW + delta));
      if (el) {
        el.style.width = `${next}px`;
        el.style.minWidth = `${next}px`;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (el) el.style.transition = prevTransition ?? "";
      const delta = startX - ev.clientX;
      const finalW = Math.min(600, Math.max(240, startW + delta));
      // Collapse if dragged very narrow
      if (finalW < 260 && onToggleSidePanel) {
        // keep width for next expand, just collapse
        onToggleSidePanel();
      } else {
        onSidePanelWidthChange?.(finalW);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="app-shell">
      {titleBar}
      <div className="app-body">
        {sessions}
        {!sidebarCollapsed && (
          <div
            className="sidebar-resizer"
            onMouseDown={handleLeftMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
          />
        )}
        {chat}
        {!sidePanelCollapsed && sidePanel && (
          <div
            className="sidebar-resizer sidepanel-resizer"
            onMouseDown={handleRightMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            title="Drag to resize side panel"
            style={{ cursor: "col-resize" }}
          />
        )}
        {!sidePanelCollapsed && sidePanel}
        {sidePanelCollapsed && (
          <button
            onClick={onToggleSidePanel}
            title="Expand side panel"
            aria-label="Expand side panel"
            style={{
              width: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--color-bg-secondary)",
              borderLeft: "1px solid var(--color-border)",
              cursor: "pointer",
              color: "var(--color-muted)",
              writingMode: "vertical-rl",
              fontSize: 11,
              letterSpacing: 1,
            }}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}