import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface MenubarPortalMenuProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  minWidth?: number;
  children: React.ReactNode;
}

/** Menubar dropdown portaled to document.body so parent overflow/contain cannot clip it. */
export function MenubarPortalMenu({ open, anchorEl, minWidth = 200, children }: MenubarPortalMenuProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom;
    setPos({ top, left });
    requestAnimationFrame(() => {
      const menu = document.querySelector('[data-bndz-menubar-menu][data-open="true"]') as HTMLElement | null;
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
  }, [open, anchorEl, children]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-bndz-menubar-menu
      data-open="true"
      className="fixed z-[500] bndz-menubar-menu border border-[#454545] shadow-lg py-1 min-w-[200px] bndz-scrollbar"
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
