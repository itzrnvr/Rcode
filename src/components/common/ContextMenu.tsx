/*
 * PURPOSE: Right-click context menu — positioned at (x,y), closes on outside click/escape
 *
 * Items support: danger styling (red text) and separators (horizontal line).
 * Clicking an item calls its onClick then closes the menu.
 *
 * CONSUMERS: sessions/SessionList.tsx, sidepanel/SidePanel.tsx
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, Math.floor(window.innerWidth - rect.width) - 8));
    const top = Math.max(8, Math.min(y, Math.floor(window.innerHeight - rect.height) - 8));
    setPosition({ left, top, ready: true });
    element.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }, [x, y, items]);

  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    const escapeHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", clickHandler);
    document.addEventListener("keydown", escapeHandler);
    return () => {
      document.removeEventListener("mousedown", clickHandler);
      document.removeEventListener("keydown", escapeHandler);
    };
  }, [onClose]);

  // Portal to body: fixed-position menus must escape ancestors whose
  // backdrop-filter/transform creates a containing block (e.g. the sidebar).
  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Session actions"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            type="button"
            role="menuitem"
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
    ,
    document.body
  );
}
