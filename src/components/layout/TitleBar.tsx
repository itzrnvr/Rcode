/*
 * PURPOSE: Custom title bar — logo, sidebar toggle, window controls
 *
 * Layout (left to right):
 *   - Toggle sidebar icon
 *   - Logo + App Name
 *   - Drag region
 *   - macOS traffic lights (close, min, max)
 *
 * The model picker was moved into ChatInput.
 */

import { api } from "../../api/client";
import { PanelLeftIcon } from "../common/Icons";

interface TitleBarProps {
  onToggleSidebar: () => void;
}

export function TitleBar({ onToggleSidebar }: TitleBarProps) {
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <button
          className="titlebar-sidebar-toggle"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <PanelLeftIcon size={16} />
        </button>

        <div className="titlebar-logo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4 H14 A4 4 0 0 1 14 12 H6 V20 M10 12 L14 20" />
          </svg>
        </div>
        <span className="titlebar-name">Rcode</span>
      </div>

      <div className="titlebar-right">
        <div className="traffic-group">
          <button
            className="traffic-light traffic-close"
            onClick={() => api.windowClose()}
            title="Close"
            aria-label="Close window"
          />
          <button
            className="traffic-light traffic-min"
            onClick={() => api.windowMinimize()}
            title="Minimize"
            aria-label="Minimize window"
          />
          <button
            className="traffic-light traffic-max"
            onClick={() => api.windowMaximize()}
            title="Maximize"
            aria-label="Maximize window"
          />
        </div>
      </div>
    </div>
  );
}