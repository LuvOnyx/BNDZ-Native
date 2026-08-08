import React, { memo, useRef } from 'react';
import type { CanvasItem } from '../../lib/spatialCanvasStore';
import { ShellNativeIcon } from '../../components/ShellNativeIcon';
import { Icons8Icon } from '../../components/Icons8Icon';
import { formatPathLeafName, formatUiPath, isRawShellDisplayName } from '../../lib/displayPath';

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

function isDirectoryPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || '';
  return !base || !base.includes('.');
}

/** Spatial v2 pin — same glass constellation DNA as SpatialCanvasCard (not Automation rack). */
function SpatialPipCardInner({
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
  const isDir = isDirectoryPath(item.path);
  const kind = isDir ? 'Folder' : 'File';
  const accent = isDir ? '#c4a35a' : '#7eb8e8';
  const title = isRawShellDisplayName(item.name) ? (formatPathLeafName(item.path) || item.name) : item.name;
  const pathLabel = formatUiPath(item.path) || item.path;

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
      aria-label={`${kind}: ${title}. Click to select · double-click to open.`}
      aria-pressed={selected}
      className={`bndz-spatial-card bndz-pin-module bndz-spatial-pip-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${isDir ? ' is-folder' : ' is-file'}`}
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
          <div className="bndz-pin-title" title={title}>{title}</div>
          <div className="bndz-pin-path" title={pathLabel}>{pathLabel}</div>
          {editingNote ? (
            <input
              className="bndz-spatial-card-note-input"
              defaultValue={item.note || ''}
              autoFocus
              aria-label={`Note for ${title}`}
              onBlur={e => onNoteBlur(item.id, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') onNoteCancel();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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
    </article>
  );
}

export const SpatialPipCard = memo(SpatialPipCardInner);
export default SpatialPipCard;
