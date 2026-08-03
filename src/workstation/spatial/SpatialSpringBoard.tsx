import React, { useCallback } from 'react';
import type { CanvasItem } from '../../lib/spatialCanvasStore';
import SpatialCanvasCard from '../../components/workspace/SpatialCanvasCard';
import BezierWireLayer from './BezierWireLayer';
import type { PinRelation } from '../../lib/workspace/spatialCanvasUtils';
import type { IntelligenceMap } from '../../lib/workspace/useSpatialIntelligence';

function readLiveCardPosition(id: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const el = document.querySelector(`[data-spatial-card="${id}"]`) as HTMLElement | null;
  if (!el) return fallback;
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  const baseX = Number.isFinite(left) ? left : fallback.x;
  const baseY = Number.isFinite(top) ? top : fallback.y;
  const transform = el.style.transform || '';
  const match = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(transform);
  const dx = match ? parseFloat(match[1]) : 0;
  const dy = match ? parseFloat(match[2]) : 0;
  return { x: baseX + dx, y: baseY + dy };
}

type Props = {
  items: CanvasItem[];
  relations: PinRelation[];
  selectedSet: Set<string>;
  draggingId: string | null;
  editingNoteId: string | null;
  cardW: number;
  cardH: number;
  intelligenceMap?: IntelligenceMap;
  onPointerDown: (e: React.PointerEvent, item: CanvasItem) => void;
  onClick?: (e: React.MouseEvent, item: CanvasItem) => void;
  onDoubleClick: (item: CanvasItem) => void;
  onContextMenu: (e: React.MouseEvent, item: CanvasItem) => void;
  onNoteBlur: (id: string, value: string) => void;
  onNoteCancel: () => void;
  onReveal?: (item: CanvasItem) => void;
  onAutomate?: (item: CanvasItem) => void;
  onAddStickyBeside?: (item: CanvasItem) => void;
};

/** Spatial v2 board — same glass constellation cards as v1 (`SpatialCanvasCard`). */
export default function SpatialSpringBoard({
  items,
  relations,
  selectedSet,
  draggingId,
  editingNoteId,
  cardW,
  cardH,
  intelligenceMap,
  onPointerDown,
  onClick,
  onDoubleClick,
  onContextMenu,
  onNoteBlur,
  onNoteCancel,
  onReveal,
  onAutomate,
  onAddStickyBeside,
}: Props) {
  const getItemPosition = useCallback((id: string) => {
    const item = items.find(it => it.id === id);
    const fallback = item ? { x: item.x, y: item.y } : { x: 0, y: 0 };
    if (!draggingId) return fallback;
    return readLiveCardPosition(id, fallback);
  }, [items, draggingId]);

  return (
    <>
      <BezierWireLayer
        items={items}
        relations={relations}
        cardW={cardW}
        cardH={cardH}
        getItemPosition={getItemPosition}
      />
      {items.map(item => (
        <SpatialCanvasCard
          key={item.id}
          item={item}
          selected={selectedSet.has(item.id)}
          dragging={draggingId === item.id}
          editingNote={editingNoteId === item.id}
          cardW={cardW}
          cardH={cardH}
          intelligence={intelligenceMap?.get(item.path)}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onNoteBlur={onNoteBlur}
          onNoteCancel={onNoteCancel}
          onReveal={onReveal}
          onAutomate={onAutomate}
          onAddStickyBeside={onAddStickyBeside}
        />
      ))}
    </>
  );
}
