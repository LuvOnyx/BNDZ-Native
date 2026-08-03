import React, { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragHandleGlyph } from './Icons8Icon';
import {
  getColumnStyle,
  type ListColumnDef,
  type ListColumnId,
  type SortColumnId,
} from '../lib/listColumns';

type Props = {
  columns: ListColumnDef[];
  sortColumn: SortColumnId | string | null | undefined;
  sortDirection: 'asc' | 'desc' | undefined;
  onReorder: (nextVisibleOrder: ListColumnId[]) => void;
  onToggleSort: (colId: SortColumnId) => void;
  onStartResize: (colId: ListColumnId, clientX: number, headerEl: HTMLElement) => void;
};

/** Keep reorder on the header row — only X follows the pointer. */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

function SortableColumnHeader({
  col,
  isActiveSort,
  sortDirection,
  onToggleSort,
  onStartResize,
  lockedWidth,
}: {
  col: ListColumnDef;
  isActiveSort: boolean;
  sortDirection: 'asc' | 'desc' | undefined;
  onToggleSort: (colId: SortColumnId) => void;
  onStartResize: (colId: ListColumnId, clientX: number, headerEl: HTMLElement) => void;
  /** Pixel width locked for the whole reorder so %/flex columns don't squash. */
  lockedWidth?: number;
}) {
  // Activator = grip only. Spreading listeners on the whole header steals column resize.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: col.id,
  });
  const pressRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Translate only — never scale. Scale is what made the bars look deformed.
  const style: React.CSSProperties = {
    ...getColumnStyle(col),
    ...(lockedWidth
      ? {
          width: lockedWidth,
          minWidth: lockedWidth,
          maxWidth: lockedWidth,
          flex: '0 0 auto',
          flexShrink: 0,
          flexGrow: 0,
        }
      : null),
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : (transition || 'transform 90ms cubic-bezier(0.2, 0, 0, 1)'),
    zIndex: isDragging ? 40 : undefined,
    position: 'relative',
  };

  const beginResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const header = e.currentTarget.parentElement as HTMLElement;
    if (!header) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    onStartResize(col.id, e.clientX, header);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bndz-list-col-header group/col ${lockedWidth ? 'shrink-0' : (col.widthClass || 'shrink-0')} ${col.sortable ? 'bndz-list-col-header--sortable' : ''} ${isActiveSort ? 'bndz-list-col-header--active' : ''} ${col.align === 'right' ? 'bndz-list-col-header--right' : ''} ${isDragging ? 'bndz-list-col-header--dragging' : ''}`}
      data-col-id={col.id}
      {...attributes}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('.bndz-col-resize-handle')) return;
        if ((e.target as HTMLElement).closest('.bndz-col-reorder-grip')) return;
        pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onMouseMove={e => {
        const press = pressRef.current;
        if (!press) return;
        if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) press.moved = true;
      }}
      onClick={() => {
        if (!col.sortable) return;
        const press = pressRef.current;
        pressRef.current = null;
        if (press?.moved) return;
        onToggleSort(col.id as SortColumnId);
      }}
    >
      <div
        ref={setActivatorNodeRef}
        className="bndz-col-reorder-grip"
        title="Drag to reorder column"
        {...listeners}
      >
        <DragHandleGlyph size={10} />
      </div>
      <span className="bndz-list-col-header-label">{col.label}</span>
      {isActiveSort && (
        <span
          className={`bndz-list-sort-caret ${sortDirection === 'asc' ? 'bndz-list-sort-caret--asc' : 'bndz-list-sort-caret--desc'}`}
          aria-hidden
        />
      )}
      <div
        draggable={false}
        className="bndz-col-resize-handle"
        onPointerDown={beginResize}
        onMouseDown={e => {
          // Belt-and-suspenders: block any parent handlers / HTML5 drag.
          e.preventDefault();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

/** Details-view column headers — in-place horizontal slide reorder (no portal ghost). */
export default function ListColumnHeaderStrip({
  columns,
  sortColumn,
  sortDirection,
  onReorder,
  onToggleSort,
  onStartResize,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [activeId, setActiveId] = useState<ListColumnId | null>(null);
  const [lockedWidths, setLockedWidths] = useState<Partial<Record<ListColumnId, number>> | null>(null);
  const ids = useMemo(() => columns.map(c => c.id), [columns]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id) as ListColumnId);
    // Freeze every header to its current pixel width so % columns don't reshape mid-drag.
    const next: Partial<Record<ListColumnId, number>> = {};
    for (const col of columns) {
      const el = document.querySelector(`[data-col-id="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(col.id) : col.id}"]`) as HTMLElement | null;
      if (el) next[col.id] = Math.round(el.getBoundingClientRect().width);
    }
    setLockedWidths(next);
  };

  const clearDrag = () => {
    setActiveId(null);
    setLockedWidths(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    clearDrag();
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id) as ListColumnId);
    const newIndex = ids.indexOf(String(over.id) as ListColumnId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDrag}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <div className={`flex-1 flex items-center min-w-0 bndz-list-columns ${activeId ? 'bndz-list-columns--reordering' : ''}`}>
          {columns.map((col, colIdx) => (
            <React.Fragment key={col.id}>
              {colIdx > 0 && (
                <div className="bndz-list-col-gutter shrink-0 self-stretch min-h-[20px]" aria-hidden />
              )}
              <SortableColumnHeader
                col={col}
                isActiveSort={!!col.sortable && sortColumn === col.id}
                sortDirection={sortDirection}
                onToggleSort={onToggleSort}
                onStartResize={onStartResize}
                lockedWidth={lockedWidths?.[col.id]}
              />
            </React.Fragment>
          ))}
          <div className="bndz-list-marquee-trail" aria-hidden />
        </div>
      </SortableContext>
    </DndContext>
  );
}
