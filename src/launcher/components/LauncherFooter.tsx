import React from 'react';
import type { LauncherCommand } from '../types';

type Props = {
  selected: LauncherCommand | null;
};

/** Ported from SuperCmd LauncherFooter.tsx (minimal) */
export default function LauncherFooter({ selected }: Props) {
  return (
    <div className="bndz-launcher-footer px-3 py-2 flex items-center justify-between text-[0.6875rem] text-[var(--text-muted)]">
      <span>{selected ? selected.title : 'BNDZ Launcher'}</span>
      <span className="flex items-center gap-1">
        <span className="bndz-kbd">↵</span>
        <span>open</span>
        <span className="mx-1 opacity-40">·</span>
        <span className="bndz-kbd">esc</span>
        <span>hide</span>
      </span>
    </div>
  );
}
