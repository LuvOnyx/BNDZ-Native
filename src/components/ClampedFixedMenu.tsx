import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IPC } from '../lib/ipcBridge';

export type HostMenuItem = {
  id: string;
  label: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  bold?: boolean;
};

interface ClampedFixedMenuProps {
  x: number;
  y: number;
  className?: string;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  /**
   * When the React menu would clip at the WebView edge, show these items as a
   * host-owned WPF menu that can paint outside the BNDZ window.
   */
  hostOverflowItems?: HostMenuItem[];
  onHostCommand?: (id: string) => void;
  onClose?: () => void;
}

/** Portal + clamp; escalates to host WPF menu when content won't fit in the WebView. */
export default function ClampedFixedMenu({
  x, y, className = '', children, onMouseDown, onClick,
  hostOverflowItems, onHostCommand, onClose,
}: ClampedFixedMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [phase, setPhase] = useState<'measure' | 'dom' | 'host'>('measure');
  const hostStarted = useRef(false);

  useLayoutEffect(() => {
    hostStarted.current = false;
    setPhase('measure');
  }, [x, y, hostOverflowItems]);

  useLayoutEffect(() => {
    if (phase !== 'measure') return;
    const el = ref.current;
    if (!el) {
      setPhase('dom');
      return;
    }

    const pad = 8;
    const rect = el.getBoundingClientRect();
    const overflowsBottom = y + rect.height > window.innerHeight - pad;
    const tallerThanWindow = rect.height > window.innerHeight - pad * 2;
    // Any bottom clip → host menu (WPF can paint past the app frame onto the desktop).
    const needsHost = tallerThanWindow || overflowsBottom;

    if (
      needsHost
      && IPC.isNative
      && hostOverflowItems
      && hostOverflowItems.length > 0
      && !hostStarted.current
    ) {
      hostStarted.current = true;
      setPhase('host');
      void IPC.showHostContextMenu({
        clientX: x,
        clientY: y,
        items: hostOverflowItems,
      }).then(cmd => {
        if (cmd) onHostCommand?.(cmd);
        onClose?.();
      }).catch(() => {
        hostStarted.current = false;
        setPhase('dom');
      });
      return;
    }

    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, y - rect.height);
      if (top + rect.height > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - rect.height - pad);
      }
    }
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
    setPhase('dom');
  }, [phase, x, y, hostOverflowItems, onHostCommand, onClose]);

  if (typeof document === 'undefined') return null;
  if (phase === 'host') return null;

  const style: React.CSSProperties = phase === 'measure'
    ? { top: -10000, left: -10000, visibility: 'hidden', maxHeight: 'none', overflow: 'visible' }
    : {
        top: pos.top,
        left: pos.left,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        overflowX: 'visible',
      };

  return createPortal(
    <div
      ref={ref}
      data-bndz-context-menu
      className={`fixed z-[400] bndz-context-menu bndz-scrollbar ${className}`}
      style={style}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {children}
    </div>,
    document.body
  );
}
