import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { LauncherIcon } from './LauncherIcon';

type Props = {
  current: number;
  total: number;
  path?: string;
  percent?: number;
  onCancel: () => void;
};

/** Status-bar chip while folder size map / sync runs */
export default function FolderSizeSyncChip({ current, total, path, percent = 0, onCancel }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : Math.round(percent);
  const folder = path ? path.split(/[/\\]/).pop() : '';

  return (
    <span
      className="bndz-glass-chip inline-flex items-center gap-2 ml-2 pl-2 pr-1 py-0.5 max-w-[min(440px,48vw)] border border-emerald-500/20 shadow-[0_4px_18px_rgba(16,185,129,0.12)]"
      title={path || 'Building folder size map'}
      role="status"
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 ring-1 ring-emerald-400/20">
        <LauncherIcon id="folder_size_sync" size={14} className="opacity-90" />
        <Loader2 size={8} className="absolute -bottom-0.5 -right-0.5 text-emerald-300 animate-spin" />
      </span>
      <span className="truncate text-[10px] text-emerald-50/95 font-medium">
        Size map <span className="text-emerald-300/90">{current}/{total}</span>
        <span className="text-white/35 ml-1">({pct}%)</span>
        {folder ? <span className="text-white/40 ml-1">· {folder}</span> : null}
      </span>
      <span className="hidden sm:inline-flex h-1.5 w-14 rounded-full bg-black/30 overflow-hidden shrink-0">
        <span className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all" style={{ width: `${pct}%` }} />
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="shrink-0 rounded-lg p-0.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        title="Cancel folder size sync (Esc)"
        aria-label="Cancel folder size sync"
      >
        <X size={12} />
      </button>
    </span>
  );
}
