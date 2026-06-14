import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortaledDropdownProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
}

/** Renders dropdown menus in a portal with viewport clamping + scroll */
export default function PortaledDropdown({ open, anchorEl, className = '', children, onMouseDown }: PortaledDropdownProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    const el = panelRef.current;
    const pad = 8;
    let top = anchor.bottom;
    let left = anchor.left;

    if (el) {
      const rect = el.getBoundingClientRect();
      if (left + rect.width > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - rect.width - pad);
      }
      if (top + rect.height > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - rect.height - pad);
      }
      if (left < pad) left = pad;
      if (top < pad) top = pad;
    }

    setPos({ top, left });
  }, [open, anchorEl, children]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`fixed z-[300] ${className}`}
      style={{
        top: pos.top,
        left: pos.left,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>,
    document.body
  );
}
