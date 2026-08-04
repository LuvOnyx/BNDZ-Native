import React from 'react';
import ClampedFixedMenu from './ClampedFixedMenu';
import { Icons8Icon } from './Icons8Icon';
import { TAB_ACCENT_PRESETS } from '../lib/tabColors';
import { IPC } from '../lib/ipcBridge';

interface TabContextMenuProps {
  x: number;
  y: number;
  tabLabel: string;
  isLocked: boolean;
  tabColor?: string;
  canClose: boolean;
  canCloseOthers: boolean;
  canCloseRight?: boolean;
  onLock: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight?: () => void;
  onCloseAll: () => void;
  onDuplicate: () => void;
  onTearOff?: () => void;
  onSetColor: (color: string) => void;
  onRefresh?: () => void;
  showRefresh?: boolean;
  onCloseMenu: () => void;
}

const itemClass =
  'bndz-context-menu-item w-full flex items-center gap-2.5 text-[12px] text-left disabled:opacity-40 disabled:pointer-events-none';

export type TabHostContextMenuOpts = {
  clientX: number;
  clientY: number;
  tabLabel?: string;
  isLocked: boolean;
  canClose: boolean;
  canCloseOthers: boolean;
  canCloseRight?: boolean;
  showRefresh?: boolean;
  showTearOff?: boolean;
  onLock: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight?: () => void;
  onCloseAll: () => void;
  onDuplicate: () => void;
  onTearOff?: () => void;
  onRefresh?: () => void;
  /** v1 host menu: Reset Color only (color presets stay on React menu / skipped). */
  onResetColor?: () => void;
};

/**
 * Host-owned WPF tab context menu (native). Maps selected id → callbacks.
 * Color presets are omitted in v1 — use Reset Color or the React menu when not native.
 */
export async function showTabHostContextMenu(opts: TabHostContextMenuOpts): Promise<void> {
  const items: Array<{
    id: string;
    label: string;
    separator?: boolean;
    disabled?: boolean;
    danger?: boolean;
    bold?: boolean;
  }> = [
    { id: 'lock', label: opts.isLocked ? 'Unlock Tab' : 'Lock Tab' },
    { id: 'close', label: 'Close', disabled: !opts.canClose },
    { id: 'closeOthers', label: 'Close Others', disabled: !opts.canCloseOthers },
    { id: 'closeRight', label: 'Close Tabs to the Right', disabled: !opts.canCloseRight },
    { id: 'closeAll', label: 'Close All' },
    { id: 'sep1', label: '', separator: true },
    { id: 'duplicate', label: 'Duplicate Tab' },
  ];

  if (opts.showTearOff && opts.onTearOff) {
    items.push({ id: 'tearOff', label: 'Tear Off to New Stage' });
  }
  if (opts.showRefresh && opts.onRefresh) {
    items.push({ id: 'refresh', label: 'Refresh Tab' });
  }
  if (opts.onResetColor) {
    items.push({ id: 'sep2', label: '', separator: true });
    items.push({ id: 'resetColor', label: 'Reset Color' });
  }

  const id = await IPC.showHostContextMenu({
    clientX: opts.clientX,
    clientY: opts.clientY,
    items,
  });
  if (!id) return;

  switch (id) {
    case 'lock':
      opts.onLock();
      break;
    case 'close':
      opts.onClose();
      break;
    case 'closeOthers':
      opts.onCloseOthers();
      break;
    case 'closeRight':
      opts.onCloseRight?.();
      break;
    case 'closeAll':
      opts.onCloseAll();
      break;
    case 'duplicate':
      opts.onDuplicate();
      break;
    case 'tearOff':
      opts.onTearOff?.();
      break;
    case 'refresh':
      opts.onRefresh?.();
      break;
    case 'resetColor':
      opts.onResetColor?.();
      break;
    default:
      break;
  }
}

export function TabContextMenu({
  x,
  y,
  tabLabel,
  isLocked,
  tabColor,
  canClose,
  canCloseOthers,
  canCloseRight,
  onLock,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onDuplicate,
  onTearOff,
  onSetColor,
  onRefresh,
  showRefresh,
  onCloseMenu,
}: TabContextMenuProps) {
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <ClampedFixedMenu x={x} y={y} className="min-w-[220px] select-none">
      <div
        data-bndz-tab-context-menu
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-2.5 py-1.5 mb-1 text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08] truncate">
          {tabLabel}
        </div>
        <button type="button" className={itemClass} onMouseDown={act(onLock)}>
          <Icons8Icon id={isLocked ? 'unlock_ui' : 'lock_ui'} size={14} className="shrink-0 opacity-80" />
          {isLocked ? 'Unlock Tab' : 'Lock Tab'}
        </button>
        <button type="button" className={itemClass} disabled={!canClose} onMouseDown={act(onClose)}>
          <Icons8Icon id="close" size={14} className="shrink-0 opacity-80" />
          Close
        </button>
        <button type="button" className={itemClass} disabled={!canCloseOthers} onMouseDown={act(onCloseOthers)}>
          <Icons8Icon id="dropstack" size={14} className="shrink-0 opacity-80" />
          Close Others
        </button>
        {onCloseRight && (
          <button type="button" className={itemClass} disabled={!canCloseRight} onMouseDown={act(onCloseRight)}>
            <Icons8Icon id="nav_forward" size={14} className="shrink-0 opacity-80" />
            Close Tabs to the Right
          </button>
        )}
        <button type="button" className={itemClass} onMouseDown={act(onCloseAll)}>
          <Icons8Icon id="close" size={14} className="shrink-0 opacity-80" />
          Close All
        </button>
        <div className="bndz-context-menu-sep" />
        <button type="button" className={itemClass} onMouseDown={act(onDuplicate)}>
          <Icons8Icon id="copy" size={14} className="shrink-0 opacity-80" />
          Duplicate Tab
        </button>
        {onTearOff && (
          <button type="button" className={itemClass} onMouseDown={act(onTearOff)}>
            <Icons8Icon id="external_link" size={14} className="shrink-0 opacity-80" />
            Tear Off to New Stage
          </button>
        )}
        {showRefresh && onRefresh && (
          <button type="button" className={itemClass} onMouseDown={act(onRefresh)}>
            <Icons8Icon id="refresh" size={14} className="shrink-0 opacity-80" />
            Refresh Tab
          </button>
        )}
        <div className="bndz-context-menu-sep" />
        <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted,#888)]">
          <Icons8Icon id="theme" size={11} /> Tab Color
        </div>
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {TAB_ACCENT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              className={`w-5 h-5 rounded-[5px] border-2 transition-transform hover:scale-105 ${!preset.color ? 'bg-[#333] border-[#555]' : ''} ${tabColor === preset.color ? 'ring-2 ring-white/60 scale-105' : 'border-transparent'}`}
              style={preset.color ? { backgroundColor: preset.color } : undefined}
              onMouseDown={act(() => { onSetColor(preset.color); onCloseMenu(); })}
            />
          ))}
        </div>
      </div>
    </ClampedFixedMenu>
  );
}
