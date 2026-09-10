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
      className="bndz-status-bar-chip bndz-status-bar-chip--sizemap"
      title={path || 'Building folder size map'}
      role="status"
    >
      <LauncherIcon id="folder_size_sync" size={12} className="bndz-status-bar-chip-ico shrink-0" />
      <span className="bndz-status-bar-chip-label truncate">
        Size map {current}/{total}
        <span className="bndz-status-bar-chip-muted"> ({pct}%)</span>
        {folder ? <span className="bndz-status-bar-chip-muted"> · {folder}</span> : null}
      </span>
      <span className="bndz-status-bar-chip-track hidden sm:inline-flex" aria-hidden>
        <span className="bndz-status-bar-chip-fill" style={{ width: `${pct}%` }} />
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="bndz-status-bar-chip-cancel shrink-0"
        title="Cancel folder size sync (Esc)"
        aria-label="Cancel folder size sync"
      >
        <Icons8Icon id="close" size={10} />
      </button>
    </span>
  );
}
