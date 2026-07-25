import React from 'react';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';

export type ListDragGhostState = {
  x: number;
  y: number;
  label: string;
  count: number;
  copy: boolean;
  isDirectory?: boolean;
  /** Windows path for shell icon preview */
  previewPath?: string;
};

type Props = {
  ghost: ListDragGhostState | null;
};

/** Explorer-style drag image following the cursor during internal list drags. */
export default function ListDragGhost({ ghost }: Props) {
  if (!ghost) return null;
  return (
    <div
      className="fixed z-[300] pointer-events-none"
      style={{ left: ghost.x + 12, top: ghost.y + 8, transform: 'translate3d(0,0,0)' }}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--bndz-radius-md)] border border-[#454545] shadow-lg"
        style={{ background: 'rgba(37, 37, 38, 0.96)' }}
      >
        <div className="relative flex items-center justify-center w-7 h-7 rounded-[var(--bndz-radius-sm)] bg-black/20">
          {ghost.previewPath ? (
            <ShellNativeIcon path={ghost.previewPath} size={22} preferThumbnail eager />
          ) : (
            <Icons8Icon id={ghost.isDirectory ? 'explorer' : 'file_ui'} size={14} />
          )}
          {ghost.copy && (
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-600/90 flex items-center justify-center ring-1 ring-black/40">
              <Icons8Icon id="copy" size={8} />
            </span>
          )}
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
