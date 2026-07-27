import React from 'react';
import { Icons8Icon } from './Icons8Icon';

export type ListDragGhostState = {
  x: number;
  y: number;
  label: string;
  count: number;
  copy: boolean;
  isDirectory?: boolean;
  previewPath?: string;
  dropHint?: string;
};

/** Metadata only — position is updated imperatively via ghostRef. */
export type ListDragGhostMeta = Omit<ListDragGhostState, 'x' | 'y'>;

type Props = {
  ghost: ListDragGhostMeta | null;
  ghostRef: React.RefObject<HTMLDivElement | null>;
};

/** Explorer-style drag image following the cursor during internal list drags. */
export default function ListDragGhost({ ghost, ghostRef }: Props) {
  return (
    <div
      ref={ghostRef}
      className="fixed z-[300] pointer-events-none left-0 top-0 will-change-transform"
      style={{
        transform: 'translate3d(0, 0, 0)',
        display: ghost ? 'block' : 'none',
      }}
      aria-hidden={!ghost}
    >
      {ghost ? (
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--bndz-radius-md)] border border-[#454545] shadow-lg"
          style={{ background: 'rgba(37, 37, 38, 0.96)' }}
        >
          <div className="relative flex items-center justify-center w-7 h-7 rounded-[var(--bndz-radius-sm)] bg-black/20">
            <Icons8Icon id={ghost.isDirectory ? 'explorer' : 'file_ui'} size={16} />
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
            {ghost.dropHint ? (
              <div className="text-[9px] text-white/35 normal-case tracking-normal mt-0.5">{ghost.dropHint}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
