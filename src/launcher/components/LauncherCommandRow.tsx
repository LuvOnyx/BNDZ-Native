import React from 'react';
import type { LauncherCommand } from '../types';

type Props = {
  command: LauncherCommand;
  selected: boolean;
  onClick: () => void;
  itemRef?: (el: HTMLDivElement | null) => void;
};

/** Ported layout from SuperCmd LauncherCommandRow.tsx */
export default function LauncherCommandRow({ command, selected, onClick, itemRef }: Props) {
  return (
    <div
      ref={itemRef}
      className={`command-item px-3 py-2 rounded-lg cursor-pointer ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-5 h-5 flex items-center justify-center shrink-0 text-sm">
          {command.iconUrl ? (
            <img src={command.iconUrl} alt="" className="w-5 h-5 object-contain" />
          ) : (
            <span>{command.iconGlyph || '⌘'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <div className="text-[var(--text-primary)] text-[0.8125rem] font-medium truncate tracking-[0.004em]">
            {command.title}
          </div>
          {command.subtitle ? (
            <div className="text-[var(--text-muted)] text-[0.6875rem] font-medium truncate">
              {command.subtitle}
            </div>
          ) : null}
          {command.alias ? <span className="bndz-chip">{command.alias}</span> : null}
        </div>
        {command.hotkey ? (
          <span className="bndz-kbd shrink-0">{command.hotkey}</span>
        ) : null}
      </div>
    </div>
  );
}
