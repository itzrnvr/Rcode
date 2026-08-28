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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{filter: 'drop-shadow(0 0 7px color-mix(in srgb, currentColor 38%, transparent))'}}>
            <path d="M7 3.8 V20.2 M7 3.8 H13 C15 3.8, 17 5.8, 17 8 C17 10.2, 15 12.2, 13 12.2 H7" />
            <path d="M11.5 12.2 C12.8 14.5, 14.2 16.8, 15.5 18.5 L17.8 20.8" strokeLinecap="round" />
            <path d="M7 8.2 H12.8" opacity="0.32" strokeWidth="1.05" />
            <path d="M7 3.8 H7" strokeWidth="3.2" strokeLinecap="square" opacity="0.95" />
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