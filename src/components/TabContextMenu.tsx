import React from 'react';
import { Lock, Unlock, X, Copy, Layers } from 'lucide-react';
import ClampedFixedMenu from './ClampedFixedMenu';

interface TabContextMenuProps {
  x: number;
  y: number;
  tabLabel: string;
  isLocked: boolean;
  canClose: boolean;
  canCloseOthers: boolean;
  onLock: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onDuplicate: () => void;
  onCloseMenu: () => void;
}

const itemClass =
  'bndz-context-menu-item w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40 disabled:pointer-events-none';

export function TabContextMenu({
  x,
  y,
  tabLabel,
  isLocked,
  canClose,
  canCloseOthers,
  onLock,
  onClose,
  onCloseOthers,
  onCloseAll,
  onDuplicate,
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
        className="bndz-context-menu min-w-[200px] py-1 rounded-md shadow-2xl select-none"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider bndz-context-menu-icon border-b border-[var(--menu-border,rgba(255,255,255,0.1))] truncate">
          {tabLabel}
        </div>
        <button type="button" className={itemClass} onMouseDown={act(onLock)}>
          {isLocked ? <Unlock size={14} className="shrink-0 opacity-80" /> : <Lock size={14} className="shrink-0 opacity-80" />}
          {isLocked ? 'Unlock Tab' : 'Lock Tab'}
        </button>
        <button type="button" className={itemClass} disabled={!canClose} onMouseDown={act(onClose)}>
          <X size={14} className="shrink-0 opacity-80" />
          Close
        </button>
        <button type="button" className={itemClass} disabled={!canCloseOthers} onMouseDown={act(onCloseOthers)}>
          <Layers size={14} className="shrink-0 opacity-80" />
          Close Others
        </button>
        <button type="button" className={itemClass} onMouseDown={act(onCloseAll)}>
          <X size={14} className="shrink-0 opacity-80" />
          Close All
        </button>
        <div className="bndz-context-menu-sep" />
        <button type="button" className={itemClass} onMouseDown={act(onDuplicate)}>
          <Copy size={14} className="shrink-0 opacity-80" />
          Duplicate Tab
        </button>
      </div>
    </ClampedFixedMenu>
  );
}
