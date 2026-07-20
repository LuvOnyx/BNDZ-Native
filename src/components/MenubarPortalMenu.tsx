import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface MenubarPortalMenuProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  minWidth?: number;
  children: React.ReactNode;
}

/** Menubar dropdown portaled to document.body so parent overflow/contain cannot clip it. */
export function MenubarPortalMenu({ open, anchorEl, minWidth = 200, children }: MenubarPortalMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom;
    setPos({ top, left });

    // Measure once after paint — avoid re-clamping on every children identity change.
    const id = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const m = menu.getBoundingClientRect();
      if (left + m.width > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - m.width - pad);
      }
      if (top + m.height > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - m.height - pad);
      }
      if (left < pad) left = pad;
      if (top < pad) top = pad;
      setPos({ top, left });
    });
    return () => cancelAnimationFrame(id);
  }, [open, anchorEl]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      data-bndz-menubar-menu
      data-open="true"
      className="fixed z-[500] bndz-menubar-menu bndz-context-menu bndz-scrollbar"
      style={{
        top: pos.top,
        left: pos.left,
        minWidth,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'visible',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
