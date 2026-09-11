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
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setReady(false);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom;

    // Measure synchronously (pre-paint) so the first clickable frame is already clamped.
    const menu = menuRef.current;
    if (menu) {
      const m = menu.getBoundingClientRect();
      if (left + m.width > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - m.width - pad);
      }
      if (top + m.height > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - m.height - pad);
      }
      if (left < pad) left = pad;
      if (top < pad) top = pad;
    }
    setPos({ top, left });
    setReady(true);
  }, [open, anchorEl, children]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      data-bndz-menubar-menu
      data-open="true"
      data-ready={ready ? '1' : '0'}
      className="fixed z-[500] bndz-menubar-menu bndz-context-menu bndz-scrollbar"
      style={{
        top: ready ? pos.top : -10000,
        left: ready ? pos.left : -10000,
        minWidth,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'visible',
        opacity: ready ? 1 : 0,
        transform: ready ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)',
        transition: 'opacity 90ms ease-out, transform 90ms ease-out',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
