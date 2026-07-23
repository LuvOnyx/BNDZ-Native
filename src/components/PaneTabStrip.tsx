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
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CloseGlyph } from './ChromeGlyphs';
import { Icons8Icon } from './Icons8Icon';
import { ShellNativeIcon } from './ShellNativeIcon';
import { tabAccentStyle } from '../lib/tabColors';
import type { TabState } from './tabTypes';
import { findingTabLabel, isFindingTab } from '../lib/findingTab';
import { hasBndzFileDrag } from '../lib/bndzDrag';

/** Keep reorder on the tab row — only X follows the pointer; kill Y/scale hard. */
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: transform.x,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

/** Clamp drag inside the tabstrip so vertical pointer motion cannot escape the strip. */
const restrictToTabStrip: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return { ...transform, y: 0, scaleX: 1, scaleY: 1 };
  }
  const minX = containerNodeRect.left - draggingNodeRect.left;
  const maxX = containerNodeRect.right - draggingNodeRect.right;
  const nextX = Math.min(Math.max(transform.x, minX), maxX);
  return {
    ...transform,
    x: nextX,
    y: 0,
    scaleX: 1,
    scaleY: 1,
  };
};

export type PaneTabStripProps = {
  paneId: string;
  tabs: TabState[];
  activeTabIndex: number;
  tabBarHeight?: number;
  flexibleTabWidth?: boolean;
  makeSelectedTabBold?: boolean;
  applyColors?: boolean;
  showIconsTabs?: boolean;
  showXCloseButtonsOnTabs?: string;
  showNewTabButton?: boolean;
  showTabListButton?: boolean;
  tabFontSize?: number;
  getPaneTabLabel: (path: string) => string;
  onActivate: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClose: (index: number, e?: React.MouseEvent) => void;
  onContextMenu: (index: number, e: React.MouseEvent) => void;
  onMiddleClick: (index: number, e: React.MouseEvent) => void;
  onAddTab: () => void;
  /** File / internal path drop onto a tab (navigate that tab). */
  onFileDropOnTab: (index: number, e: React.DragEvent) => void;
  /** File drop onto the + zone. */
  onFileDropOnNewTab?: (e: React.DragEvent) => void;
  scheduleTabSwitchOnFileDrag?: (index: number) => void;
  clearTabFileDragTimer?: () => void;
  tabFileDropTargetIndex?: number | null;
  newTabDropActive?: boolean;
  setNewTabDropActive?: (active: boolean) => void;
  setTabFileDropTargetIndex?: (index: number | null) => void;
  dropModifierCopy?: (copy: boolean) => void;
};

function SortablePaneTab({
  tab,
  index,
  isActive,
  label,
  flexibleTabWidth,
  makeSelectedTabBold,
  applyColors,
  showIconsTabs,
  showXClose,
  tabFontSize,
  isFileDropHover,
  onActivate,
  onClose,
  onContextMenu,
  onMiddleClick,
  onFileDragOver,
  onFileDragLeave,
  onFileDrop,
}: {
  tab: TabState;
  index: number;
  isActive: boolean;
  label: string;
  flexibleTabWidth?: boolean;
  makeSelectedTabBold?: boolean;
  applyColors?: boolean;
  showIconsTabs?: boolean;
  showXClose: boolean;
  tabFontSize?: number;
  isFileDropHover: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onFileDragOver: (e: React.DragEvent) => void;
  onFileDragLeave: (e: React.DragEvent) => void;
  onFileDrop: (e: React.DragEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !!tab.locked,
  });
  const pressRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const style: React.CSSProperties = {
    ...(applyColors
      ? {
          backgroundColor: isActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
          color: isActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
        }
      : {
          backgroundColor: isActive ? 'var(--bndz-surface-raised)' : 'var(--bndz-surface-chrome)',
          color: isActive ? '#e0f2fe' : '#94a3b8',
        }),
    ...tabAccentStyle(tab.color, isActive),
    // Force horizontal-only even if a transform frame slips past modifiers.
    transform: CSS.Translate.toString(
      transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null,
    ),
    transition: isDragging ? undefined : (transition || 'transform 90ms cubic-bezier(0.2, 0, 0, 1)'),
    zIndex: isDragging ? 40 : undefined,
    position: 'relative',
    touchAction: 'pan-x',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      data-tab-index={index}
      className={`relative bndz-tab-item flex items-center px-3 py-[4px] ml-[2px] rounded-t-[6px] z-10 -mb-[1px] cursor-pointer group border-t border-l border-r transition-[background,border-color,color,box-shadow] duration-75 ease-out ${
        flexibleTabWidth ? 'max-w-[180px]' : 'max-w-[200px]'
      } ${isActive ? 'bndz-tab-active border-[#333]' : 'border-transparent hover:border-[#333]'} ${
        makeSelectedTabBold && isActive ? 'font-bold' : 'font-semibold'
      } ${isDragging ? 'opacity-60 bndz-tab-item--dragging' : ''} ${
        isFileDropHover ? 'ring-2 ring-[#38bdf8]/70 bg-[#094771]/30' : ''
      } ${tab.locked ? 'ring-1 ring-inset ring-amber-500/50 bg-[#1a1810]' : ''}`}
      {...attributes}
      {...listeners}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-tab-close]')) return;
        pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onMouseMove={e => {
        const press = pressRef.current;
        if (!press) return;
        if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) press.moved = true;
      }}
      onClick={e => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('[data-tab-close]')) return;
        const press = pressRef.current;
        pressRef.current = null;
        if (press?.moved) return;
        onActivate();
      }}
      onAuxClick={e => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onMiddleClick(e);
      }}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      {showIconsTabs !== false && (
        <span className="mr-1.5 shrink-0 pointer-events-none">
          <ShellNativeIcon
            path={tab.path}
            isDir={tab.path !== '/' && !tab.path.match(/^\/[A-Za-z]:$/)}
            size={12}
            eager
          />
        </span>
      )}
      {tab.locked && <Icons8Icon id="lock_ui" size={10} className="mr-1 shrink-0 pointer-events-none" title="Locked" />}
      <span className="truncate pointer-events-none" style={{ fontSize: tabFontSize || 11 }}>{label}</span>
      {showXClose && (
        <span
          data-tab-close
          className="ml-2 opacity-70 hover:opacity-100 cursor-pointer"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onClose(e);
          }}
        >
          <CloseGlyph size={12} />
        </span>
      )}
    </div>
  );
}

/** Pane list tabs — horizontal slide reorder via @dnd-kit (same pattern as column headers). */
export default function PaneTabStrip(props: PaneTabStripProps) {
  const {
    paneId,
    tabs,
    activeTabIndex,
    tabBarHeight,
    flexibleTabWidth,
    makeSelectedTabBold,
    applyColors,
    showIconsTabs,
    showXCloseButtonsOnTabs = 'Active tab',
    showNewTabButton,
    showTabListButton,
    tabFontSize,
    getPaneTabLabel,
    onActivate,
    onReorder,
    onClose,
    onContextMenu,
    onMiddleClick,
    onAddTab,
    onFileDropOnTab,
    onFileDropOnNewTab,
    scheduleTabSwitchOnFileDrag,
    clearTabFileDragTimer,
    tabFileDropTargetIndex,
    newTabDropActive,
    setNewTabDropActive,
    setTabFileDropTargetIndex,
    dropModifierCopy,
  } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = useMemo(() => tabs.map(t => t.id), [tabs]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const clearDrag = () => setActiveId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    clearDrag();
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    onReorder(oldIndex, newIndex);
  };

  const isFileDrag = (e: React.DragEvent) =>
    hasBndzFileDrag(e) || (e.dataTransfer.files?.length ?? 0) > 0;

  return (
    <div
      className={`bndz-chrome-tabstrip flex pt-1 px-1 shrink-0 overflow-x-auto overflow-y-hidden border-b border-[#333] items-end scrollbar-hidden ${activeId ? 'bndz-tabstrip--reordering' : ''}`}
      style={{
        minHeight: tabBarHeight || 28,
        background: 'var(--bndz-surface-chrome)',
        overscrollBehavior: 'contain',
        touchAction: 'pan-x',
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToTabStrip]}
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDrag}
      >
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, idx) => {
            const isActive = idx === activeTabIndex;
            const name = isFindingTab(tab) ? findingTabLabel(tab) : getPaneTabLabel(tab.path);
            const showXClose =
              showXCloseButtonsOnTabs !== 'None'
              && tabs.length > 1
              && (showXCloseButtonsOnTabs === 'All tabs' || isActive);

            return (
              <SortablePaneTab
                key={tab.id}
                tab={tab}
                index={idx}
                isActive={isActive}
                label={name}
                flexibleTabWidth={flexibleTabWidth}
                makeSelectedTabBold={makeSelectedTabBold}
                applyColors={applyColors}
                showIconsTabs={showIconsTabs}
                showXClose={showXClose}
                tabFontSize={tabFontSize}
                isFileDropHover={tabFileDropTargetIndex === idx}
                onActivate={() => onActivate(idx)}
                onClose={e => onClose(idx, e)}
                onContextMenu={e => onContextMenu(idx, e)}
                onMiddleClick={e => onMiddleClick(idx, e)}
                onFileDragOver={e => {
                  if (!isFileDrag(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const copy = e.ctrlKey || e.altKey;
                  dropModifierCopy?.(copy);
                  e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
                  setTabFileDropTargetIndex?.(idx);
                  scheduleTabSwitchOnFileDrag?.(idx);
                }}
                onFileDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (tabFileDropTargetIndex === idx) setTabFileDropTargetIndex?.(null);
                    clearTabFileDragTimer?.();
                  }
                }}
                onFileDrop={e => {
                  if (!isFileDrag(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  clearTabFileDragTimer?.();
                  setTabFileDropTargetIndex?.(null);
                  onFileDropOnTab(idx, e);
                }}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {showNewTabButton !== false && (
        <div
          className={`ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-pointer text-gray-400 font-bold transition-colors ${
            newTabDropActive ? 'ring-1 ring-inset ring-[#38bdf8]/60 bg-[#333]' : ''
          }`}
          data-new-tab-zone={paneId}
          title="New tab · Drop a folder here to open it in a new tab"
          onClick={e => {
            e.stopPropagation();
            onAddTab();
          }}
          onDragOver={e => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            setNewTabDropActive?.(true);
          }}
          onDragLeave={() => setNewTabDropActive?.(false)}
          onDrop={e => {
            e.preventDefault();
            e.stopPropagation();
            setNewTabDropActive?.(false);
            onFileDropOnNewTab?.(e);
          }}
        >
          <span className="text-[14px] leading-tight">+</span>
        </div>
      )}
      {showTabListButton && (
        <div className="ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-pointer text-gray-400">
          <Icons8Icon id="layers_ui" size={12} />
        </div>
      )}
    </div>
  );
}

