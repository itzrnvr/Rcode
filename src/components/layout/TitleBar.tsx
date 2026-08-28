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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{filter: 'drop-shadow(0 0 6px color-mix(in srgb, currentColor 35%, transparent))'}}>
            <path d="M7 3.5 H13.8 C15.8 3.5, 17.8 5.5, 17.8 8 C17.8 10.5, 15.8 12.5, 13.8 12.5 H7 V20.5 M11.2 12.5 L17.8 20.5" />
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