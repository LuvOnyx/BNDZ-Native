import React from 'react';
import { createPortal } from 'react-dom';
import { Icons8Icon } from './Icons8Icon';

export type DragGhostPortalMeta = {
  label: string;
  count: number;
  preparing?: boolean;
  copy?: boolean;
  isDirectory?: boolean;
  dropHint?: string;
  iconId?: string;
};

type Props = {
  ghost: DragGhostPortalMeta | null;
  ghostRef: React.RefObject<HTMLDivElement | null>;
};

/** Portaled drag ghost — immune to preview panel overflow clipping. */
export default function DragGhostPortal({ ghost, ghostRef }: Props) {
  return createPortal(
    <div
      ref={ghostRef}
      className="fixed z-[9999] pointer-events-none left-0 top-0 will-change-transform"
      style={{
        transform: 'translate3d(0, 0, 0)',
        visibility: ghost ? 'visible' : 'hidden',
        opacity: ghost ? 1 : 0,
      }}
      aria-hidden={!ghost}
    >
      {ghost ? (
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--bndz-radius-md)] border border-[#454545] shadow-lg"
          style={{ background: 'rgba(37, 37, 38, 0.96)' }}
        >
          <Icons8Icon
            id={ghost.preparing ? 'loading' : (ghost.iconId || (ghost.isDirectory ? 'explorer' : 'compress'))}
            size={16}
            spin={!!ghost.preparing}
          />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-white/95 truncate max-w-[200px]">{ghost.label}</div>
            <div className="text-[9px] text-white/45 uppercase tracking-wide">
              {ghost.preparing
                ? 'Preparing extract…'
                : `${ghost.copy ? 'Copy' : 'Extract'}${ghost.count > 1 ? ` · ${ghost.count} items` : ''}`}
            </div>
            {ghost.dropHint ? (
              <div className="text-[9px] text-white/35 normal-case tracking-normal mt-0.5">{ghost.dropHint}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
