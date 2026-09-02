/*
 * PURPOSE: Right-click context menu — positioned at (x,y), closes on outside click/escape
 *
 * Items support: danger styling (red text) and separators (horizontal line).
 * Clicking an item calls its onClick then closes the menu.
 *
 * CONSUMERS: sessions/SessionList.tsx, sidepanel/SidePanel.tsx
 */

import { useEffect, useRef } from "react";
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
    <div ref={ref} className="context-menu" style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <div
            key={i}
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
          </div>
        )
      )}
    </div>
    ,
    document.body
  );
}
