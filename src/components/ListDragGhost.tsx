import React from 'react';
import { Icons8Icon } from './Icons8Icon';

export type ListDragGhostState = {
  x: number;
  y: number;
  label: string;
  count: number;
  copy: boolean;
  isDirectory?: boolean;
};

type Props = {
  ghost: ListDragGhostState | null;
};

/** Explorer-style drag image following the cursor during internal list drags. */
export default function ListDragGhost({ ghost }: Props) {
  if (!ghost) return null;
  const iconId = ghost.isDirectory ? 'explorer' : 'file_ui';
  return (
    <div
      className="fixed z-[300] pointer-events-none"
      style={{ left: ghost.x + 14, top: ghost.y + 10 }}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--bndz-radius-md)] border border-white/15 shadow-xl backdrop-blur-md"
        style={{ background: 'rgba(22, 24, 32, 0.94)' }}
      >
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-[var(--bndz-radius-sm)] ${
            ghost.copy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/20 text-sky-300'
          }`}
        >
          <Icons8Icon id={ghost.copy ? 'copy' : iconId} size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-white/95 truncate max-w-[200px]">{ghost.label}</div>
          <div className="text-[9px] text-white/45 uppercase tracking-wide">
            {ghost.copy ? 'Copy' : 'Move'}{ghost.count > 1 ? ` · ${ghost.count} items` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
