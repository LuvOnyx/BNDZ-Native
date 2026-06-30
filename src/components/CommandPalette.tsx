import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Command, ArrowRight, FolderOpen, Settings, Replace, LayoutGrid, Sparkles,
  Database, Bookmark, Filter, ScrollText, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
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
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(a =>
      a.label.toLowerCase().includes(q)
      || a.hint?.toLowerCase().includes(q)
      || a.keywords?.some(k => k.toLowerCase().includes(q))
    );
  }, [actions, query]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh] bg-black/55 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: -12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.98, opacity: 0, y: -8 }}
          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="bndz-command-palette w-full max-w-xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <div className="flex items-center px-4 py-3.5 border-b border-white/8 bg-gradient-to-r from-[#1a1a22]/98 to-[#14141a]/98">
            <Search size={18} className="text-sky-400/70 mr-3 shrink-0" />
            <input
              type="text"
              autoFocus
              placeholder="Search commands, plugins, actions…"
              className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder-gray-500"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && filtered[0]) {
                  e.preventDefault();
                  filtered[0].onRun();
                  onClose();
                }
              }}
            />
            <div className="flex items-center gap-1 text-[9px] font-bold text-gray-500 uppercase tracking-widest bg-black/30 border border-white/8 px-2 py-1 rounded-md">
              <Command size={10} /> ⇧P
            </div>
          </div>
          <div className="p-2 min-h-[150px] max-h-[320px] overflow-y-auto styled-scrollbar bg-gradient-to-b from-[#121218]/98 to-[#0e0e14]/98">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-gray-500 text-sm">No matching commands</div>
            )}
            {filtered.map(action => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-sky-500/10 rounded-lg text-left text-gray-300 transition-colors group border border-transparent hover:border-sky-500/20"
                  onClick={() => { action.onRun(); onClose(); }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={14} className="text-gray-600 group-hover:text-sky-400 transition-colors shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm truncate">{action.label}</div>
                      {action.hint && <div className="text-[10px] text-gray-500 truncate">{action.hint}</div>}
                    </div>
                  </div>
                  <ArrowRight size={12} className="text-gray-600 opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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
  onOpenLauncher: () => void;
  onOpenMetadata?: () => void;
  onSaveTabset?: () => void;
  onFocusFilter?: () => void;
  onRefresh?: () => void;
  onToggleSyncScroll?: () => void;
  onNewFindingTab?: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    { id: 'settings', label: 'Open Settings', hint: 'Configuration dialog', icon: Settings, onRun: handlers.onOpenSettings, keywords: ['config', 'preferences'] },
    { id: 'dual', label: 'Toggle Dual Pane', hint: 'Side-by-side panes (XYplorer)', icon: LayoutGrid, onRun: handlers.onToggleDualPane, keywords: ['split', 'pane'] },
    { id: 'preview', label: 'Toggle Inspector', hint: 'Space / Ctrl+I preview panel', icon: FolderOpen, onRun: handlers.onTogglePreview, keywords: ['quick look', 'inspector'] },
    { id: 'filter', label: 'Focus Filter Bar', hint: 'Fuzzy filter active pane', icon: Filter, onRun: handlers.onFocusFilter ?? (() => {}), keywords: ['search', 'omnibar'] },
    { id: 'rename', label: 'Batch Rename', hint: 'Rename selected files', icon: Replace, onRun: handlers.onOpenBatchRename },
    { id: 'find', label: 'Fast Search', hint: 'Global file search plugin', icon: Search, onRun: handlers.onOpenFind, keywords: ['everything', 'search'] },
    { id: 'metadata', label: 'Metadata Inspector', hint: 'Hashes and extended properties', icon: Database, onRun: handlers.onOpenMetadata ?? (() => {}), keywords: ['hash', 'properties'] },
    { id: 'icons', label: 'Icon Studio', hint: 'Customize file icons', icon: Sparkles, onRun: handlers.onOpenIconStudio },
    { id: 'tabset', label: 'Save Tabset', hint: 'XYplorer-style workspace snapshot', icon: Bookmark, onRun: handlers.onSaveTabset ?? (() => {}), keywords: ['workspace', 'session'] },
    { id: 'refresh', label: 'Refresh Folder', hint: 'Reload active directory', icon: RefreshCw, onRun: handlers.onRefresh ?? (() => {}) },
    { id: 'syncscroll', label: 'Toggle Sync Scroll', hint: 'Mirror scroll in dual pane', icon: ScrollText, onRun: handlers.onToggleSyncScroll ?? (() => {}), keywords: ['dual', 'pane'] },
    { id: 'finding', label: 'New Finding Tab', hint: 'XYplorer search-in-tab (uses filter query)', icon: Search, onRun: handlers.onNewFindingTab ?? (() => {}), keywords: ['search', 'find'] },
    { id: 'launcher', label: 'BNDZ Launcher', hint: 'Alt+Space command palette', icon: Command, onRun: handlers.onOpenLauncher, keywords: ['raycast', 'flow'] },
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
