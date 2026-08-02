import React, { memo, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import type { SpatialSticky } from '../../lib/spatialCanvasStore';
import { SPATIAL_STICKY_H, SPATIAL_STICKY_W } from '../../lib/spatialCanvasStore';

type Props = {
  sticky: SpatialSticky;
  selected: boolean;
  dragging: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent, sticky: SpatialSticky) => void;
  onContextMenu: (e: React.MouseEvent, sticky: SpatialSticky) => void;
  onBeginEdit: (id: string) => void;
  onCommitText: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
};

function SpatialStickyNoteInner({
  sticky,
  selected,
  dragging,
  editing,
  onPointerDown,
  onContextMenu,
  onBeginEdit,
  onCommitText,
  onCancelEdit,
  onDelete,
}: Props) {
  const w = sticky.w ?? SPATIAL_STICKY_W;
  const h = sticky.h ?? SPATIAL_STICKY_H;
  const color = sticky.color || '#f5e6a8';
  const rotation = sticky.rotation ?? 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(sticky.text);

  useEffect(() => {
    if (editing) {
      setDraft(sticky.text);
      const t = window.setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [editing, sticky.text]);

  return (
    <article
      data-spatial-sticky={sticky.id}
      role="note"
      tabIndex={0}
      aria-label={sticky.text ? `Sticky note: ${sticky.text.slice(0, 80)}` : 'Empty sticky note'}
      aria-pressed={selected}
      className={`bndz-spatial-sticky${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${sticky.tetherToId ? ' is-tethered' : ''}`}
      style={{
        left: sticky.x,
        top: sticky.y,
        width: w,
        minHeight: h,
        ['--sticky-paper' as string]: color,
        ['--sticky-rot' as string]: `${rotation}deg`,
      }}
      onPointerDown={e => onPointerDown(e, sticky)}
      onDoubleClick={e => {
        e.stopPropagation();
        onBeginEdit(sticky.id);
      }}
      onContextMenu={e => onContextMenu(e, sticky)}
      onKeyDown={e => {
        if (editing) return;
        if (e.key === 'Enter' || e.key === 'F2') {
          e.preventDefault();
          onBeginEdit(sticky.id);
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onDelete(sticky.id);
        }
      }}
    >
      <div className="bndz-spatial-sticky-tape" aria-hidden />
      <div className="bndz-spatial-sticky-paper" aria-hidden />
      <div className="bndz-spatial-sticky-fold" aria-hidden />
      {sticky.tetherToId && (
        <span className="bndz-spatial-sticky-tether-badge" title="Tethered to a pin" aria-hidden>
          <Icons8Icon id="link" size={10} />
        </span>
      )}
      <button
        type="button"
        className="bndz-spatial-sticky-delete"
        title="Delete sticky"
        aria-label="Delete sticky note"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          onDelete(sticky.id);
        }}
      >
        <Icons8Icon id="delete" size={11} />
      </button>
      {editing ? (
        <textarea
          ref={textareaRef}
          className="bndz-spatial-sticky-input"
          value={draft}
          aria-label="Sticky note text"
          placeholder="Write a note…"
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onCommitText(sticky.id, draft)}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancelEdit();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              onCommitText(sticky.id, draft);
            }
          }}
        />
      ) : (
        <div className={`bndz-spatial-sticky-text${sticky.text ? '' : ' is-empty'}`}>
          {sticky.text || 'Double-click to write…'}
        </div>
      )}
      <div className="bndz-spatial-sticky-chip" style={{ background: color }} aria-hidden />
    </article>
  );
}

const SpatialStickyNote = memo(SpatialStickyNoteInner);
export default SpatialStickyNote;
