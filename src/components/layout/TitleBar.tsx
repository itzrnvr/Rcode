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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" style={{filter: 'drop-shadow(0 0 7px color-mix(in srgb, currentColor 38%, transparent))'}}>
            <g strokeLinecap="square" strokeLinejoin="miter">
              {/* Left half — formal straight stem with serif */}
              <path d="M7 3.8 V20.2" strokeWidth="2.8" strokeLinecap="square" />
              <path d="M6.2 3.8 H7.8" strokeWidth="2.8" />
              <path d="M6.2 20.2 H7.8" strokeWidth="2.8" />
            </g>
            <g strokeLinecap="round" strokeLinejoin="round">
              {/* Right half — sharp cursive bowl + leg */}
              <path d="M7 3.8 H13.1 C15.3 3.8, 17.2 5.4, 17.2 8 C17.2 10.6, 15.3 12.2, 13.1 12.2 H7" strokeWidth="2.6" />
              <path d="M11.8 12.2 C13 14.2, 14.6 16.5, 15.8 18.2 L17.9 20.6" strokeWidth="2.6" />
              {/* Hairline spine where halves meet — personality split */}
              <path d="M7 8.2 H12.6" opacity="0.28" strokeWidth="1.0" />
            </g>
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