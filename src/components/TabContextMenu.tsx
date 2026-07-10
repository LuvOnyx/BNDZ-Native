import React from 'react';
import ClampedFixedMenu from './ClampedFixedMenu';
import { Icons8Icon } from './Icons8Icon';
import { TAB_ACCENT_PRESETS } from '../lib/tabColors';

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
  onSetColor: (color: string) => void;
  onRefresh?: () => void;
  showRefresh?: boolean;
  onCloseMenu: () => void;
}

const itemClass =
  'bndz-context-menu-item w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none';

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
    <ClampedFixedMenu x={x} y={y}>
      <div
        data-bndz-tab-context-menu
        className="bndz-context-menu min-w-[220px] py-1 select-none"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider bndz-context-menu-icon border-b border-[var(--menu-border,rgba(255,255,255,0.1))] truncate">
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
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${!preset.color ? 'bg-[#333] border-[#555]' : ''} ${tabColor === preset.color ? 'ring-2 ring-white/60 scale-110' : 'border-transparent'}`}
              style={preset.color ? { backgroundColor: preset.color } : undefined}
              onMouseDown={act(() => { onSetColor(preset.color); onCloseMenu(); })}
            />
          ))}
        </div>
      </div>
    </ClampedFixedMenu>
  );
}
