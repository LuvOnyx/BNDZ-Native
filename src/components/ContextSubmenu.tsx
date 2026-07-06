import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, LucideIcon } from 'lucide-react';
import { ContextMenuIcon } from './ContextMenuIcon';

export const menuItemClass =
  'bndz-context-menu-item px-2 py-[3px] flex items-center gap-2 cursor-default text-[12px] select-none leading-[22px]';

export const submenuPanelClass =
  'bndz-context-submenu absolute top-0 py-[2px] min-w-[196px] z-[500] max-h-[calc(100vh-24px)] overflow-visible';

/** Wrap a menu item action so it stops event propagation after firing. */
export function runMenuAction(handler: (e: React.MouseEvent) => void | Promise<void>) {
  return (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    void Promise.resolve(handler(e));
  };
}

interface ContextSubmenuProps {
  label: string;
  icon?: LucideIcon;
  iconVerb?: string;
  groupClass?: string;
  children: React.ReactNode;
  showChevron?: boolean;
  onOpen?: () => void;
}

/** Hover-open submenu — CSS group-hover is unreliable in WebView2. */
export function ContextSubmenu({
  label,
  icon: Icon,
  iconVerb,
  children,
  showChevron = true,
  onOpen,
}: ContextSubmenuProps) {
  const [open, setOpen] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({ left: '100%', marginLeft: 2 });
  const rowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open || !rowRef.current || !panelRef.current) return;
    const row = rowRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const pad = 8;
    let left = row.right + 2;
    let top = row.top;
    if (left + panel.width > window.innerWidth - pad) {
      left = row.left - panel.width - 2;
    }
    if (top + panel.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - panel.height - pad);
    }
    if (top < pad) top = pad;
    setFlyoutStyle({
      position: 'fixed',
      top,
      left,
      marginLeft: 0,
      zIndex: 500,
    });
  }, [open]);

  const keepOpen = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(prev => {
      if (!prev) onOpen?.();
      return true;
    });
  };

  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className={`${menuItemClass} justify-between ${open ? 'bndz-context-menu-item-active' : ''}`}>
        <span className="flex items-center gap-2.5">
          {Icon ? <Icon size={14} className="shrink-0 bndz-context-menu-icon" /> : iconVerb ? <ContextMenuIcon verb={iconVerb} /> : null}
          {label}
        </span>
        {showChevron && <ChevronRight size={14} className={`opacity-60 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </div>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-bndz-submenu-flyout
          className={submenuPanelClass}
          style={flyoutStyle}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          onMouseDown={e => e.stopPropagation()}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}

interface ContextMenuItemProps {
  label: string;
  verb?: string;
  icon?: LucideIcon;
  iconVerb?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  disabled?: boolean;
}

export const ContextMenuItem = React.memo(function ContextMenuItem({
  label,
  verb,
  icon: Icon,
  iconVerb,
  onClick,
  className = '',
  disabled,
}: ContextMenuItemProps) {
  return (
    <div
      role="menuitem"
      className={`${menuItemClass} ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
      onClick={disabled || !onClick ? undefined : runMenuAction(onClick)}
    >
      {Icon ? <Icon size={14} className="shrink-0" /> : <ContextMenuIcon verb={iconVerb || verb} />}
      <span className="flex-1">{label}</span>
    </div>
  );
});

/** Nested flyout — opens to the right/left so it does not cover items below in the parent menu. */
export function ContextNestedSubmenu({
  label,
  iconVerb,
  children,
  panelClassName = 'min-w-[160px]',
  onOpen,
}: {
  label: React.ReactNode;
  iconVerb?: string;
  children: React.ReactNode;
  panelClassName?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({ left: '100%', marginLeft: 2 });
  const rowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open || !rowRef.current || !panelRef.current) return;
    const row = rowRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const pad = 8;
    let left = row.right + 2;
    let top = row.top;
    if (left + panel.width > window.innerWidth - pad) {
      left = row.left - panel.width - 2;
    }
    if (top + panel.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - panel.height - pad);
    }
    if (top < pad) top = pad;
    setFlyoutStyle({
      position: 'fixed',
      top,
      left,
      marginLeft: 0,
      zIndex: 560,
    });
  }, [open]);

  const keepOpen = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(prev => {
      if (!prev) onOpen?.();
      return true;
    });
  };
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      ref={rowRef}
      className="relative"
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleClose}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className={`${menuItemClass} justify-between ${open ? 'bndz-context-menu-item-active' : ''}`}>
        <span className="flex items-center gap-2.5">
          {iconVerb ? <ContextMenuIcon verb={iconVerb} /> : null}
          {label}
        </span>
        <ChevronRight size={14} className="opacity-60 shrink-0" />
      </div>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          data-bndz-submenu-flyout
          className={`${submenuPanelClass} ${panelClassName}`}
          style={flyoutStyle}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          onMouseDown={e => e.stopPropagation()}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}
