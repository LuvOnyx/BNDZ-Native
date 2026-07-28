import React, { memo } from 'react';
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
};

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
}: Props) {
  return (
    <div
      data-spatial-card={item.id}
      className={`bndz-spatial-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{ left: item.x, top: item.y, width: cardW, minHeight: cardH }}
      onPointerDown={e => onPointerDown(e, item)}
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={e => onContextMenu(e, item)}
    >
      <div className="bndz-spatial-card-glow" aria-hidden />
      <div className="bndz-spatial-card-accent" aria-hidden />
      <div className="bndz-spatial-card-icon">
        <ShellNativeIcon path={item.path} isDir={!item.path.split(/[/\\]/).pop()?.includes('.')} size={40} />
      </div>
      <div className="bndz-spatial-card-body">
        <div className="bndz-spatial-card-name" title={item.name}>{item.name}</div>
        <div className="bndz-spatial-card-path" title={item.path}>{item.path}</div>
        {editingNote ? (
          <input
            className="bndz-spatial-card-note-input"
            autoFocus
            defaultValue={item.note || ''}
            placeholder="Add a note…"
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
      {item.note && !editingNote && (
        <span className="bndz-spatial-card-note-badge" title="Has note">
          <Icons8Icon id="notepad" size={10} />
        </span>
      )}
    </div>
  );
}

const SpatialCanvasCard = memo(SpatialCanvasCardInner);
export default SpatialCanvasCard;
