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
import { normalizePanePath } from '../lib/pathUtils';
import { isBndzAutomationPath, isBndzCanvasPath } from '../lib/bndzVirtualViews';

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
  /** Settings → Resizable tabs — drag right edge to set width. */
  resizableTabs?: boolean;
  /** Per-path custom widths when resizableTabs is on. */
  tabCustomWidths?: Record<string, number>;
  onTabWidthChange?: (pathKey: string, widthPx: number) => void;
  makeSelectedTabBold?: boolean;
  applyColors?: boolean;
  showIconsTabs?: boolean;
  showXCloseButtonsOnTabs?: string;
  showNewTabButton?: boolean;
  showTabListButton?: boolean;
  tabFontSize?: number;
  /** Settings → Tabs button cluster side. */
  buttonsPosition?: string;
  minimumTabWidthInPixels?: number;
  maximumTabWidthInPixels?: number;
  visualStyleTabs?: string;
  getPaneTabLabel: (path: string) => string;
  onActivate: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClose: (index: number, e?: React.MouseEvent) => void;
  onContextMenu: (index: number, e: React.MouseEvent) => void;
  onMiddleClick: (index: number, e: React.MouseEvent) => void;
  onAddTab: () => void;
  scheduleTabSwitchOnFileDrag?: (index: number) => void;
  clearTabFileDragTimer?: () => void;
  tabFileDropTargetIndex?: number | null;
  newTabDropActive?: boolean;
  setNewTabDropActive?: (active: boolean) => void;
  setTabFileDropTargetIndex?: (index: number | null) => void;
  dropModifierCopy?: (copy: boolean) => void;
  /** When enabled, dropping a folder path onto empty strip chrome opens a new tab. */
  allowAddTabsViaDragDrop?: boolean;
  onDropPathAsNewTab?: (path: string) => void;
  /** Disable tab reorder while an internal pointer file-drag is active. */
  suspendTabReorder?: boolean;
  /** Pointer file-drag hover over a tab (immediate tab switch). */
  onPointerFileDragOverTab?: (index: number) => void;
};

function SortablePaneTab({
  tab,
  index,
  isActive,
  label,
  flexibleTabWidth,
  resizableTabs,
  customWidth,
  minWidth,
  maxWidth,
  makeSelectedTabBold,
  applyColors,
  showIconsTabs,
  showXClose,
  tabFontSize,
  isFileDropHover,
  suspendTabReorder,
  onActivate,
  onClose,
  onContextMenu,
  onMiddleClick,
  onWidthChange,
}: {
  tab: TabState;
  index: number;
  isActive: boolean;
  label: string;
  flexibleTabWidth?: boolean;
  resizableTabs?: boolean;
  customWidth?: number;
  minWidth: number;
  maxWidth: number;
  makeSelectedTabBold?: boolean;
  applyColors?: boolean;
  showIconsTabs?: boolean;
  showXClose: boolean;
  tabFontSize?: number;
  isFileDropHover: boolean;
  suspendTabReorder?: boolean;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onWidthChange?: (widthPx: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    disabled: !!tab.locked || !!suspendTabReorder,
  });
  const pressRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [liveWidth, setLiveWidth] = React.useState<number | null>(null);
  const effectiveWidth = liveWidth ?? customWidth;
  const useCustom = !flexibleTabWidth && resizableTabs && typeof effectiveWidth === 'number' && effectiveWidth > 0;

  const style: React.CSSProperties = {
    ...(applyColors
      ? {
          background: isActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
          color: isActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
        }
      : {
          background: isActive ? 'var(--tab-active-bg, var(--bndz-surface-raised))' : 'var(--tab-inactive-bg, var(--bndz-surface-chrome))',
          color: isActive ? 'var(--tab-active-text, #e0f2fe)' : 'var(--tab-inactive-text, #94a3b8)',
        }),
    ...tabAccentStyle(tab.color, isActive),
    transform: CSS.Translate.toString(
      transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null,
    ),
    transition: isDragging || liveWidth != null
      ? undefined
      : (transition || 'transform 90ms cubic-bezier(0.2, 0, 0, 1)'),
    zIndex: isDragging ? 40 : undefined,
    position: 'relative',
    touchAction: 'pan-x',
    ...(useCustom
      ? { ['--bndz-tab-custom-width' as string]: `${effectiveWidth}px` }
      : {}),
  };

  const startResize = (e: React.PointerEvent) => {
    if (!resizableTabs || !onWidthChange) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('.bndz-tab-item') as HTMLElement | null;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    let last = Math.round(startW);
    setLiveWidth(last);

    const onMove = (ev: PointerEvent) => {
      last = Math.round(Math.max(minWidth, Math.min(maxWidth, startW + (ev.clientX - startX))));
      setLiveWidth(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveWidth(null);
      onWidthChange(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-tab-id={tab.id}
      data-tab-index={index}
      className={`relative bndz-tab-item flex items-center px-3 py-[6px] ml-[2px] rounded-t-[6px] z-10 -mb-[1px] cursor-default group border-t border-l border-r transition-[background,border-color,color,box-shadow] duration-75 ease-out ${
        flexibleTabWidth
          ? 'bndz-tab-item--flexible'
          : useCustom
            ? 'bndz-tab-item--custom-width'
            : 'bndz-tab-item--fixed'
      } ${isActive ? 'bndz-tab-active border-[#333]' : 'border-transparent hover:border-[#333]'} ${
        makeSelectedTabBold && isActive ? 'font-bold' : 'font-semibold'
      } ${isDragging ? 'opacity-60 bndz-tab-item--dragging' : ''} ${
        isFileDropHover ? 'bndz-tab-item--file-drop' : ''
      } ${tab.locked ? 'ring-1 ring-inset ring-amber-500/50 bg-[#1a1810]' : ''} ${
        isBndzCanvasPath(tab.path) ? 'bndz-tab-item--workspace bndz-tab-item--spatial' : ''
      } ${
        isBndzAutomationPath(tab.path) ? 'bndz-tab-item--workspace bndz-tab-item--automation' : ''
      }`}
      data-workspace-tab={isBndzCanvasPath(tab.path) ? 'spatial' : isBndzAutomationPath(tab.path) ? 'automation' : undefined}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={-1}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-tab-close],[data-tab-resize]')) return;
        pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
        try { (e.currentTarget as HTMLElement).blur?.(); } catch { /* ignore */ }
      }}
      onMouseMove={e => {
        const press = pressRef.current;
        if (!press) return;
        if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) press.moved = true;
      }}
      onClick={e => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('[data-tab-close],[data-tab-resize]')) return;
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
      <span className="truncate pointer-events-none bndz-tab-label" style={{ fontSize: 'var(--bndz-font-tabs-size, 11px)' }}>{label}</span>
      {showXClose && (
        <span
          data-tab-close
          className="bndz-tab-close ml-2"
          title="Close tab"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onClose(e);
          }}
        >
          <CloseGlyph size={12} />
        </span>
      )}
      {resizableTabs && !flexibleTabWidth && (
        <span
          data-tab-resize
          className="bndz-tab-resize-handle"
          title="Drag to resize tab"
          onPointerDown={startResize}
        />
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
    resizableTabs,
    tabCustomWidths,
    onTabWidthChange,
    makeSelectedTabBold,
    applyColors,
    showIconsTabs,
    showXCloseButtonsOnTabs = 'Active tab',
    showNewTabButton,
    showTabListButton,
    tabFontSize,
    buttonsPosition,
    minimumTabWidthInPixels,
    maximumTabWidthInPixels,
    getPaneTabLabel,
    onActivate,
    onReorder,
    onClose,
    onContextMenu,
    onMiddleClick,
  onAddTab,
  scheduleTabSwitchOnFileDrag,
    clearTabFileDragTimer,
    tabFileDropTargetIndex,
    newTabDropActive,
    setNewTabDropActive,
    setTabFileDropTargetIndex,
    dropModifierCopy,
    allowAddTabsViaDragDrop,
    onDropPathAsNewTab,
    suspendTabReorder,
    onPointerFileDragOverTab,
  } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: suspendTabReorder ? 99999 : 6 },
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const ids = useMemo(() => tabs.map(t => t.id), [tabs]);
  const minWidth = Math.max(48, Number(minimumTabWidthInPixels) || 72);
  const maxWidth = Math.max(minWidth, Number(maximumTabWidthInPixels) || 200);

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

  return (
    <div
      data-tabstrip
      data-pane-id={paneId}
      className={`bndz-chrome-tabstrip flex pt-1 px-1 pb-0.5 shrink-0 overflow-x-auto overflow-y-hidden border-b border-[#333] items-end scrollbar-hidden ${activeId ? 'bndz-tabstrip--reordering' : ''} ${
        String(buttonsPosition || '').toLowerCase() === 'right' ? 'flex-row-reverse' : ''
      }`}
      style={{
        minHeight: Math.max(tabBarHeight || 28, 32),
        background: 'var(--bndz-surface-chrome)',
        overscrollBehavior: 'contain',
        touchAction: 'pan-x',
        ['--bndz-tab-min-width' as string]: `${minWidth}px`,
        ['--bndz-tab-max-width' as string]: `${maxWidth}px`,
      }}
      onPointerMove={(e) => {
        if (!suspendTabReorder) return;
        const tabEl = (e.target as HTMLElement).closest('[data-tab-id]') as HTMLElement | null;
        if (!tabEl) return;
        const idx = parseInt(tabEl.getAttribute('data-tab-index') || '-1', 10);
        if (idx >= 0) onPointerFileDragOverTab?.(idx);
      }}
      onDragOver={(e) => {
        if (!allowAddTabsViaDragDrop) return;
        const types = Array.from(e.dataTransfer?.types || []);
        if (!types.includes('Files') && !types.includes('text/uri-list') && !types.includes('text/plain')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setNewTabDropActive?.(true);
      }}
      onDragLeave={() => setNewTabDropActive?.(false)}
      onDrop={(e) => {
        if (!allowAddTabsViaDragDrop || !onDropPathAsNewTab) return;
        e.preventDefault();
        setNewTabDropActive?.(false);
        const file = e.dataTransfer?.files?.[0];
        if (file && (file as any).path) {
          onDropPathAsNewTab(String((file as any).path));
          return;
        }
        const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
        const line = uri.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
        if (line) {
          const cleaned = line.replace(/^file:\/\//i, '').replace(/\//g, '\\');
          onDropPathAsNewTab(decodeURIComponent(cleaned));
        }
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
            const isWorkspaceTool = isBndzCanvasPath(tab.path) || isBndzAutomationPath(tab.path);
            const showXClose =
              showXCloseButtonsOnTabs !== 'None'
              && (tabs.length > 1 || isWorkspaceTool)
              && (showXCloseButtonsOnTabs === 'All tabs' || isActive || isWorkspaceTool);
            const pathKey = normalizePanePath(tab.path);
            const customWidth = tabCustomWidths?.[pathKey] ?? tabCustomWidths?.[tab.path];

            return (
              <SortablePaneTab
                key={tab.id}
                tab={tab}
                index={idx}
                isActive={isActive}
                label={name}
                flexibleTabWidth={flexibleTabWidth}
                resizableTabs={resizableTabs}
                customWidth={customWidth}
                minWidth={minWidth}
                maxWidth={maxWidth}
                makeSelectedTabBold={makeSelectedTabBold}
                applyColors={applyColors}
                showIconsTabs={showIconsTabs}
                showXClose={showXClose}
                tabFontSize={tabFontSize}
                isFileDropHover={tabFileDropTargetIndex === idx}
                suspendTabReorder={suspendTabReorder}
                onActivate={() => onActivate(idx)}
                onClose={e => onClose(idx, e)}
                onContextMenu={e => onContextMenu(idx, e)}
                onMiddleClick={e => onMiddleClick(idx, e)}
                onWidthChange={w => onTabWidthChange?.(pathKey, w)}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {showNewTabButton !== false && (
        <div
          className={`ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-default text-gray-400 font-bold transition-colors ${
            newTabDropActive ? 'ring-1 ring-inset ring-[#38bdf8]/60 bg-[#333]' : ''
          }`}
          data-new-tab-zone={paneId}
          title="New tab · Drop a folder here to open it in a new tab"
          onClick={e => {
            e.stopPropagation();
            onAddTab();
          }}
        >
          <span className="text-[14px] leading-tight">+</span>
        </div>
      )}
      {showTabListButton && (
        <div className="ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-default text-gray-400">
          <Icons8Icon id="layers_ui" size={12} />
        </div>
      )}
    </div>
  );
}
