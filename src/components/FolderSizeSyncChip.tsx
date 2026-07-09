import React from 'react';
import { Icons8Icon } from './Icons8Icon';
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
      className="bndz-status-bar-chip"
      title={path || 'Building folder size map'}
      role="status"
    >
      <LauncherIcon id="folder_size_sync" size={12} className="shrink-0 opacity-85" />
      <span className="truncate">
        Size map {current}/{total}
        <span className="text-[#888] ml-1">({pct}%)</span>
        {folder ? <span className="text-[#888] ml-1">· {folder}</span> : null}
      </span>
      <span className="hidden sm:inline-flex h-1 w-12 rounded-sm bg-[#1a1a1a] overflow-hidden shrink-0 border border-[#454545]">
        <span className="h-full bg-[var(--accent,#0078d4)] transition-all" style={{ width: `${pct}%` }} />
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="shrink-0 p-0.5 text-[#888] hover:text-white transition-colors"
        title="Cancel folder size sync (Esc)"
        aria-label="Cancel folder size sync"
      >
        <Icons8Icon id="close" size={10} />
      </button>
    </span>
  );
}
