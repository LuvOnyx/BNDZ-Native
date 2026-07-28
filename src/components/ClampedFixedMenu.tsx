import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ClampedFixedMenuProps {
  x: number;
  y: number;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onClose?: () => void;
}

/**
 * Portal + clamp for BNDZ context menus.
 * Anchors at the cursor; flips above only when the menu would leave the viewport.
 */
export default function ClampedFixedMenu({
  x, y, className = '', children, onMouseDown, onClick,
}: ClampedFixedMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
  }, [x, y]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setReady(true);
      return;
    }

    const pad = 8;
    const rect = el.getBoundingClientRect();
    const availH = window.innerHeight - pad * 2;
    const availW = window.innerWidth - pad * 2;
    const menuH = Math.min(rect.height, availH);
    const menuW = Math.min(rect.width, availW);

    let left = x;
    let top = y;

    if (left + menuW > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - menuW - pad);
    }
    if (left < pad) left = pad;

    // Prefer below cursor; flip above only when needed (avoid jumping to y=pad for tall menus).
    if (top + menuH > window.innerHeight - pad) {
      const above = y - menuH;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - menuH - pad);
    }
    if (top < pad) top = pad;

    setPos({ left, top });
    setReady(true);
  }, [x, y, children]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      data-bndz-context-menu
      className={`bndz-context-menu fixed z-[400] ${className}`}
      style={{
        top: ready ? pos.top : -10000,
        left: ready ? pos.left : -10000,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </div>,
    document.body,
  );
}
