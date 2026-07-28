import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons8Icon } from '../Icons8Icon';

export type WorkspaceMenuVariant = 'spatial' | 'automation';

type MenuItemProps = {
  label: string;
  icon?: string;
  iconVerb?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function WorkspaceMenuItem({ label, icon, danger, disabled, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`bndz-ws-menu-item${danger ? ' is-danger' : ''}`}
      onClick={e => {
        e.stopPropagation();
        if (!disabled) onClick?.();
      }}
    >
      {icon && <Icons8Icon id={icon} size={14} className="shrink-0 opacity-80" />}
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

export function WorkspaceMenuSep() {
  return <div className="bndz-ws-menu-sep" role="separator" />;
}

type Props = {
  variant: WorkspaceMenuVariant;
  x: number;
  y: number;
  children: React.ReactNode;
};

/** Workspace-specific context menu — separate from file-list Open Space menus. */
export default function WorkspaceMenuPanel({ variant, x, y, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
  }, [x, y, variant]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setReady(true);
      return;
    }
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) {
      const above = y - rect.height;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setPos({ left, top });
    setReady(true);
  }, [x, y, variant, children]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      data-bndz-workspace-menu
      className={`bndz-ws-menu bndz-ws-menu--${variant}`}
      style={{
        top: ready ? pos.top : -10000,
        left: ready ? pos.left : -10000,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
