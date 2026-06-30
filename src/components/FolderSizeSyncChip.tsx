import React from 'react';
import { X, Loader2 } from 'lucide-react';

type Props = {
  current: number;
  total: number;
  path?: string;
  percent?: number;
  onCancel: () => void;
};

/** macOS-style glass sync status chip for the status bar */
export default function FolderSizeSyncChip({ current, total, path, percent = 0, onCancel }: Props) {
  const pct = total > 0 ? Math.round((current / total) * 100) : Math.round(percent);
  const folder = path ? path.split(/[/\\]/).pop() : '';

  return (
    <span
      className="bndz-glass-chip inline-flex items-center gap-2 ml-2 pl-2.5 pr-1 py-0.5 max-w-[min(420px,45vw)]"
      title={path || 'Syncing folder sizes'}
      role="status"
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <circle
            cx="8" cy="8" r="6.5" fill="none"
            stroke="rgba(244,114,182,0.9)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 40.8} 40.8`}
          />
        </svg>
        <Loader2 size={9} className="text-pink-300/90 animate-spin" />
      </span>
      <span className="truncate text-[10px] text-pink-100/90 font-medium">
        Syncing sizes <span className="text-pink-300/80">{current}/{total}</span>
        {folder ? <span className="text-white/40 ml-1">· {folder}</span> : null}
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
