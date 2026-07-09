import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { fuzzyFilterByName } from '../lib/fuzzyFilter';

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  onRun: () => void;
  keywords?: string[];
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  actions?: PaletteAction[];
};

export default function CommandPalette({ isOpen, onClose, actions = [] }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return actions;
    const withHay = actions.map(a => ({
      ...a,
      name: [a.label, ...(a.keywords ?? []), a.hint ?? ''].join(' '),
    }));
    return fuzzyFilterByName(withHay, q) as PaletteAction[];
  }, [actions, query]);

  useEffect(() => { setSelectedIndex(0); }, [query, isOpen]);
  useEffect(() => {
    if (selectedIndex > filtered.length - 1) setSelectedIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const runAt = (idx: number) => {
    const action = filtered[idx];
    if (!action) return;
    action.onRun();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="bndz-native-scrim fixed inset-0 z-[100] flex items-start justify-center pt-[18vh]"
      onClick={onClose}
    >
      <div
        className="bndz-command-palette w-full max-w-xl rounded-[var(--bndz-radius-md)] overflow-hidden"
        data-testid="command-palette"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="bndz-command-palette-header flex items-center px-4 py-3.5">
          <Icons8Icon id="search" size={18} className="mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search commands, plugins, actions…"
            className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder-gray-500"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setSelectedIndex(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                setSelectedIndex(Math.max(0, filtered.length - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(selectedIndex);
              }
            }}
          />
          <div className="flex items-center gap-1 text-[9px] font-bold text-gray-500 uppercase tracking-widest bg-black/30 border border-white/8 px-2 py-1 rounded-md">
            <Icons8Icon id="command_ui" size={10} /> ⇧P
          </div>
        </div>
        <div ref={listRef} className="bndz-command-palette-list p-2 min-h-[150px] max-h-[320px] overflow-y-auto styled-scrollbar">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-gray-500 text-sm">No matching commands</div>
          )}
          {filtered.map((action, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={action.id}
                type="button"
                data-palette-idx={idx}
                className={`bndz-command-palette-item w-full flex items-center justify-between px-3 py-2.5 text-left group ${isSelected ? 'bndz-command-palette-item--active' : ''}`}
                onMouseMove={() => setSelectedIndex(idx)}
                onClick={() => runAt(idx)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icons8Icon id={action.icon} size={14} className="shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{action.label}</div>
                    {action.hint && <div className="text-[10px] text-gray-500 truncate">{action.hint}</div>}
                  </div>
                </div>
                <Icons8Icon
                  id="arrow_right_ui"
                  size={12}
                  className={`shrink-0 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Default FilePilot / XYplorer-style command palette entries */
export function buildDefaultPaletteActions(handlers: {
  onOpenSettings: () => void;
  onToggleDualPane: () => void;
  onOpenBatchRename: () => void;
  onOpenFind: () => void;
  onOpenIconStudio: () => void;
  onTogglePreview: () => void;
  onOpenMetadata?: () => void;
  onSaveTabset?: () => void;
  onFocusFilter?: () => void;
  onRefresh?: () => void;
  onToggleSyncScroll?: () => void;
  onNewFindingTab?: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    { id: 'settings', label: 'Open Settings', hint: 'Configuration dialog', icon: 'config', onRun: handlers.onOpenSettings, keywords: ['config', 'preferences'] },
    { id: 'dual', label: 'Toggle Dual Pane', hint: 'Side-by-side panes (XYplorer)', icon: 'toggle_dual_pane', onRun: handlers.onToggleDualPane, keywords: ['split', 'pane'] },
    { id: 'preview', label: 'Toggle Inspector', hint: 'Space / Ctrl+I preview panel', icon: 'folder_open_ui', onRun: handlers.onTogglePreview, keywords: ['quick look', 'inspector'] },
    { id: 'filter', label: 'Focus Filter Bar', hint: 'Fuzzy filter active pane', icon: 'filter_ui', onRun: handlers.onFocusFilter ?? (() => {}), keywords: ['search', 'omnibar'] },
    { id: 'rename', label: 'Batch Rename', hint: 'Rename selected files', icon: 'batch_rename', onRun: handlers.onOpenBatchRename },
    { id: 'find', label: 'Fast Search', hint: 'Global file search plugin', icon: 'search', onRun: handlers.onOpenFind, keywords: ['everything', 'search'] },
    { id: 'metadata', label: 'Metadata Inspector', hint: 'Hashes and extended properties', icon: 'metadata', onRun: handlers.onOpenMetadata ?? (() => {}), keywords: ['hash', 'properties'] },
    { id: 'icons', label: 'Icon Studio', hint: 'Customize file icons', icon: 'icon_studio', onRun: handlers.onOpenIconStudio },
    { id: 'tabset', label: 'Save Tabset', hint: 'XYplorer-style workspace snapshot', icon: 'bookmark', onRun: handlers.onSaveTabset ?? (() => {}), keywords: ['workspace', 'session'] },
    { id: 'refresh', label: 'Refresh Folder', hint: 'Reload active directory', icon: 'refresh', onRun: handlers.onRefresh ?? (() => {}) },
    { id: 'syncscroll', label: 'Toggle Sync Scroll', hint: 'Mirror scroll in dual pane', icon: 'columns_ui', onRun: handlers.onToggleSyncScroll ?? (() => {}), keywords: ['dual', 'pane'] },
    { id: 'finding', label: 'New Finding Tab', hint: 'XYplorer search-in-tab (uses filter query)', icon: 'search', onRun: handlers.onNewFindingTab ?? (() => {}), keywords: ['search', 'find'] },
  ];
  return actions.filter(a => {
    if (a.id === 'filter' && !handlers.onFocusFilter) return false;
    if (a.id === 'metadata' && !handlers.onOpenMetadata) return false;
    if (a.id === 'tabset' && !handlers.onSaveTabset) return false;
    if (a.id === 'refresh' && !handlers.onRefresh) return false;
    if (a.id === 'syncscroll' && !handlers.onToggleSyncScroll) return false;
    if (a.id === 'finding' && !handlers.onNewFindingTab) return false;
    return true;
  });
}
