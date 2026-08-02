import React, { memo, useRef } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { ShellNativeIcon } from '../ShellNativeIcon';
import type { CanvasItem } from '../../lib/spatialCanvasStore';

type Props = {
  item: CanvasItem;
  selected: boolean;
  dragging: boolean;
  editingNote: boolean;
  cardW: number;
  cardH: number;
  onPointerDown: (e: React.PointerEvent, item: CanvasItem) => void;
  onDoubleClick: (item: CanvasItem) => void;
  onContextMenu: (e: React.MouseEvent, item: CanvasItem) => void;
  onNoteBlur: (id: string, value: string) => void;
  onNoteCancel: () => void;
  onReveal?: (item: CanvasItem) => void;
  onAutomate?: (item: CanvasItem) => void;
  onAddStickyBeside?: (item: CanvasItem) => void;
};

function looksLikeDirectory(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || '';
  return !base.includes('.');
}

/** Spatial pin — glass constellation (WorkspaceLaunchCard DNA), distinct from Automation rack. */
function SpatialCanvasCardInner({
  item,
  selected,
  dragging,
  editingNote,
  cardW,
  cardH,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onNoteBlur,
  onNoteCancel,
  onReveal,
  onAutomate,
  onAddStickyBeside,
}: Props) {
  const cardRef = useRef<HTMLElement>(null);
  const isDir = looksLikeDirectory(item.path);
  const kind = isDir ? 'Folder' : 'File';
  const accent = isDir ? '#c4a35a' : '#7eb8e8';

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const card = cardRef.current;
    if (!card || dragging) return;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', `${x}%`);
    card.style.setProperty('--mouse-y', `${y}%`);
  };

  return (
    <article
      ref={cardRef}
      data-spatial-card={item.id}
      role="button"
      tabIndex={0}
      aria-label={`${kind}: ${item.name}. Click to select · double-click to open.`}
      aria-pressed={selected}
      className={`bndz-spatial-card bndz-pin-module${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${isDir ? ' is-folder' : ' is-file'}`}
      style={{ left: item.x, top: item.y, width: cardW, minHeight: cardH, ['--ws-accent' as string]: accent }}
      onPointerDown={e => onPointerDown(e, item)}
      onPointerMove={handlePointerMove}
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={e => onContextMenu(e, item)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDoubleClick(item);
        }
      }}
    >
      <span className="bndz-pin-bloom" aria-hidden />
      <span className="bndz-pin-mesh" aria-hidden />
      <span className="bndz-pin-spotlight" aria-hidden />
      <span className="bndz-pin-topline" aria-hidden />
      <span className="bndz-pin-shimmer" aria-hidden />
      <span className="bndz-pin-edge" aria-hidden />

      <div className="bndz-pin-main">
        <span className="bndz-pin-medallion" aria-hidden>
          <span className="bndz-pin-medallion-ring" />
          <span className="bndz-pin-medallion-glow" />
          <span className="bndz-pin-medallion-icon">
            <ShellNativeIcon path={item.path} isDir={isDir} size={40} preferThumbnail eager stableSrc />
          </span>
        </span>
        <div className="bndz-pin-body">
          <div className="bndz-pin-kicker">{kind} pin</div>
          <div className="bndz-pin-title" title={item.name}>{item.name}</div>
          <div className="bndz-pin-path" title={item.path}>{item.path}</div>
          {editingNote ? (
            <input
              className="bndz-spatial-card-note-input"
              autoFocus
              defaultValue={item.note || ''}
              placeholder="Add a note…"
              aria-label={`Note for ${item.name}`}
              onBlur={e => onNoteBlur(item.id, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onNoteBlur(item.id, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') onNoteCancel();
              }}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            />
          ) : item.note ? (
            <div className="bndz-spatial-card-note" title={item.note}>{item.note}</div>
          ) : null}
        </div>
      </div>

      <div className="bndz-pin-actions">
        {onAddStickyBeside && (
          <button type="button" className="bndz-pin-chip" title="Add sticky beside" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onAddStickyBeside(item); }}>
            <Icons8Icon id="notepad" size={11} /> Note
          </button>
        )}
        {onAutomate && (
          <button type="button" className="bndz-pin-chip" title="Send to automation" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onAutomate(item); }}>
            <Icons8Icon id="zap_ui" size={11} /> Auto
          </button>
        )}
        {onReveal && (
          <button type="button" className="bndz-pin-chip" title="Reveal in Explorer" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onReveal(item); }}>
            <Icons8Icon id="explorer" size={11} /> Reveal
          </button>
        )}
        <button type="button" className="bndz-pin-chip is-primary" title={isDir ? 'Open folder' : 'Open file'} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDoubleClick(item); }}>
          <Icons8Icon id="folder_open_ui" size={11} /> Open
        </button>
      </div>

      {item.note && !editingNote && (
        <span className="bndz-spatial-card-note-badge" title="Has note" aria-hidden>
          <Icons8Icon id="notepad" size={10} />
        </span>
      )}
    </article>
  );
}

export const SpatialCanvasCard = memo(SpatialCanvasCardInner);
export default SpatialCanvasCard;
