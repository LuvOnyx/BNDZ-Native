import React from 'react';
import type { LauncherCommand } from '../types';
import type { LauncherAction } from './LauncherActionsOverlay';

type Props = {
  selected: LauncherCommand | null;
  resultCount?: number;
  compact?: boolean;
  selectedAction?: LauncherAction;
  onOpenActions?: () => void;
};

export default function LauncherFooter({
  selected,
  resultCount = 0,
  compact = false,
  selectedAction,
  onOpenActions,
}: Props) {
  const showBndzHint = selected?.category === 'file' || selected?.id?.startsWith('bndz-openpath-') || !!selected?.openPath;

  return (
    <div className="bndz-launcher-footer sc-launcher-footer px-3 py-2 flex items-center justify-between text-[0.6875rem] text-[var(--text-muted)] shrink-0">
      <span className="truncate max-w-[50%] text-[var(--text-secondary)]">
        {selected ? selected.title : compact ? 'BNDZ Launcher' : `${resultCount} results`}
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {selectedAction && !compact ? (
          <>
            <button type="button" className="text-[var(--text-primary)] text-xs font-semibold hover:opacity-90" onClick={() => selectedAction.run()}>
              {selectedAction.title}
            </button>
            <span className="bndz-kbd">↵</span>
            <span className="mx-1 opacity-30">|</span>
          </>
        ) : null}
        {!compact && onOpenActions ? (
          <>
            <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-xs" onClick={onOpenActions}>
              Actions
            </button>
            <span className="bndz-kbd">^K</span>
            <span className="mx-1 opacity-30">|</span>
          </>
        ) : null}
        <span className="bndz-kbd">↵</span>
        <span>open</span>
        {showBndzHint && (
          <>
            <span className="mx-1 opacity-30">·</span>
            <span className="bndz-kbd">^↵</span>
            <span>BNDZ</span>
          </>
        )}
        <span className="mx-1 opacity-30">·</span>
        <span className="bndz-kbd">esc</span>
        <span>hide</span>
        {!compact && (
          <>
            <span className="mx-1 opacity-30">·</span>
            <span className="bndz-kbd">↑↓</span>
            <span>navigate</span>
          </>
        )}
      </span>
    </div>
  );
}
