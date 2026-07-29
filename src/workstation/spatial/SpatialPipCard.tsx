import React, { memo, useEffect, useState } from 'react';
import type { CanvasItem } from '../../lib/spatialCanvasStore';
import { ShellNativeIcon } from '../../components/ShellNativeIcon';
import { getPipThumbCached, requestPipThumb } from './pipThumbnailPipeline';

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

function isDirectoryPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || '';
  return !base || !base.includes('.');
}

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
}: Props) {
  const isDir = isDirectoryPath(item.path);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => getPipThumbCached(item.path));

  useEffect(() => {
    const cached = getPipThumbCached(item.path);
    if (cached) {
      setThumbUrl(cached);
      return;
    }
    let active = true;
    requestPipThumb(item.path, isDir).then(url => {
      if (active && url) setThumbUrl(url);
    });
    return () => { active = false; };
  }, [item.path, isDir]);

  return (
    <div
      data-spatial-card={item.id}
      className={`bndz-spatial-card bndz-spatial-pip-card${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{ left: item.x, top: item.y, width: cardW, minHeight: cardH }}
      onPointerDown={e => onPointerDown(e, item)}
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={e => onContextMenu(e, item)}
    >
      <div className="bndz-spatial-card-glow" aria-hidden />
      <div className="bndz-spatial-card-accent" aria-hidden />
      <div className="bndz-spatial-card-icon">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="bndz-spatial-pip-thumb" draggable={false} />
        ) : (
          <ShellNativeIcon path={item.path} isDir={isDir} size={48} preferThumbnail eager />
        )}
      </div>
      <div className="bndz-spatial-card-body">
        <div className="bndz-spatial-card-name" title={item.name}>{item.name}</div>
        <div className="bndz-spatial-card-path" title={item.path}>{item.path}</div>
        {editingNote ? (
          <input
            className="bndz-spatial-card-note-input"
            defaultValue={item.note || ''}
            autoFocus
            onBlur={e => onNoteBlur(item.id, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onNoteCancel();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onClick={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          />
        ) : item.note ? (
          <div className="bndz-spatial-card-note">{item.note}</div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(SpatialPipCardInner);
