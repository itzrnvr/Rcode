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
}

export function AppShell({ titleBar, sessions, chat, sidePanel, sidebarCollapsed, sidebarWidth, onSidebarWidthChange }: AppShellProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
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

  return (
    <div className="app-shell">
      {titleBar}
      <div className="app-body">
        {sessions}
        {!sidebarCollapsed && (
          <div
            className="sidebar-resizer"
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
          />
        )}
        {chat}
        {sidePanel}
      </div>
    </div>
  );
}