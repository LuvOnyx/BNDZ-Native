import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { isOleDragHandoffActive, subscribeOleDragHandoff } from '../lib/fileDragUiCleanup';

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
  const [handoff, setHandoff] = useState(isOleDragHandoffActive);
  useEffect(() => subscribeOleDragHandoff(() => setHandoff(isOleDragHandoffActive())), []);

  // Host OLE escalate sets html.bndz-ole-drag-handoff — never let React re-apply display:block
  // over the host/CSS hide (that was the stuck MOVE card under the menubar).
  const show = !!ghost && !handoff;

  return (
    <div
      ref={ghostRef}
      className="bndz-drag-ghost-root"
      // Never force display:block — host CSS !important handoff must win over React.
      style={show ? undefined : { display: 'none' }}
      aria-hidden={!show}
    >
      {show ? (
        <div className="bndz-drag-ghost-card">
          <span className="bndz-drag-ghost-glow" aria-hidden />

          <span className="bndz-drag-ghost-icon-well">
            <Icons8Icon
              id={ghost!.count > 1 ? 'copy' : (ghost!.isDirectory ? 'explorer' : 'file_ui')}
              size={18}
            />
            {ghost!.copy && (
              <span className="bndz-drag-ghost-op-badge bndz-drag-ghost-op-copy" aria-label="Copy">
                +
              </span>
            )}
            {!ghost!.copy && (
              <span className="bndz-drag-ghost-op-badge bndz-drag-ghost-op-move" aria-label="Move">
                ↗
              </span>
            )}
          </span>

          <span className="bndz-drag-ghost-text">
            <span className="bndz-drag-ghost-label">{ghost!.label}</span>
            <span className="bndz-drag-ghost-meta">
              {ghost!.copy ? 'Copy' : 'Move'}
              {ghost!.count > 1 ? ` · ${ghost!.count} items` : ''}
            </span>
            {ghost!.dropHint && (
              <span className="bndz-drag-ghost-hint">{ghost!.dropHint}</span>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}
