import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ClampedFixedMenuProps {
  x: number;
  y: number;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

/** Portal + viewport clamp + scroll for context menus */
export default function ClampedFixedMenu({ x, y, className = '', children, onMouseDown, onClick }: ClampedFixedMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [x, y]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      data-bndz-context-menu
      className={`fixed z-[400] border border-[#454545] bg-[#2b2b2b] shadow-[0_2px_8px_rgba(0,0,0,0.35)] py-1.5 bndz-scrollbar ${className}`}
      style={{
        top: pos.top,
        left: pos.left,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'visible',
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </div>,
    document.body
  );
}
