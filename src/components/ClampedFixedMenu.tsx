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
 * Always renders the React menu — flip upward and scroll internally; never swap to host WPF.
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

    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - Math.min(rect.width, availW) - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, y - Math.min(rect.height, availH));
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - Math.min(rect.height, availH) - pad);
    }
    if (left < pad) left = pad;
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
