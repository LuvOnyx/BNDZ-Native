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

/** Premium floating drag card following the cursor during internal list drags. */
export default function ListDragGhost({ ghost, ghostRef }: Props) {
  return (
    <div
      ref={ghostRef}
      className="bndz-drag-ghost-root"
      style={{ display: ghost ? 'block' : 'none' }}
      aria-hidden={!ghost}
    >
      {ghost ? (
        <div className="bndz-drag-ghost-card">
          {/* Glow orb */}
          <span className="bndz-drag-ghost-glow" aria-hidden />

          {/* Icon well */}
          <span className="bndz-drag-ghost-icon-well">
            <Icons8Icon
              id={ghost.count > 1 ? 'copy' : (ghost.isDirectory ? 'explorer' : 'file_ui')}
              size={18}
            />
            {ghost.copy && (
              <span className="bndz-drag-ghost-op-badge bndz-drag-ghost-op-copy" aria-label="Copy">
                +
              </span>
            )}
            {!ghost.copy && (
              <span className="bndz-drag-ghost-op-badge bndz-drag-ghost-op-move" aria-label="Move">
                ↗
              </span>
            )}
          </span>

          {/* Text */}
          <span className="bndz-drag-ghost-text">
            <span className="bndz-drag-ghost-label">{ghost.label}</span>
            <span className="bndz-drag-ghost-meta">
              {ghost.copy ? 'Copy' : 'Move'}
              {ghost.count > 1 ? ` · ${ghost.count} items` : ''}
            </span>
            {ghost.dropHint && (
              <span className="bndz-drag-ghost-hint">{ghost.dropHint}</span>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}
