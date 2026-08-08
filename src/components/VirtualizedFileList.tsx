import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { packGridTracks } from '../lib/viewModeMetrics';

/** Trailing empty canvas so deselect / marquee / folder context stay reachable when the list is full. */
export const LIST_FOLDER_CONTEXT_PAD_PX = 140;

interface VirtualizedFileListProps<T> {
  items: T[];
  enabled?: boolean;
  threshold?: number;
  rowHeight?: number;
  mode?: 'list' | 'grid';
  gridMinItemWidth?: number;
  gridRowHeight?: number;
  gap?: number;
  className?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
  emptyState?: React.ReactNode;
  /** Visible (+overscan) item index range for icon/thumb warm — no UI change. */
  onVisibleRangeChange?: (range: { startIndex: number; endIndex: number }) => void;
}

function contentBoxWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(0, el.clientWidth - padX);
}

export function VirtualizedFileList<T>({
  items,
  enabled = true,
  threshold = 1,
  rowHeight = 26,
  mode = 'list',
  gridMinItemWidth = 108,
  gridRowHeight = 108,
  gap = 8,
  className = 'flex flex-col w-full',
  renderItem,
  emptyState,
  onVisibleRangeChange,
}: VirtualizedFileListProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollMinHeight, setScrollMinHeight] = useState<number | undefined>(undefined);
  const [gridPack, setGridPack] = useState(() => ({
    cols: 1,
    tileWidth: Math.max(1, gridMinItemWidth),
  }));
  const useVirtual = enabled && items.length >= threshold;

  // Discover the overflow scroll parent once — never use setState in parent ref callbacks.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const parent = host.parentElement;
    if (parent instanceof HTMLDivElement) {
      setScrollEl(prev => (prev === parent ? prev : parent));
    }
  }, []);

  useEffect(() => {
    if (!scrollEl) return;
    const syncMinHeight = () => {
      const style = getComputedStyle(scrollEl);
      const padY =
        (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      // Content box only — matching clientHeight would always overflow by padding
      // and leave the scrollbar active on short lists.
      const h = Math.max(0, scrollEl.clientHeight - padY);
      if (h > 0) setScrollMinHeight(prev => (prev === h ? prev : h));
    };
    syncMinHeight();
    const ro = new ResizeObserver(syncMinHeight);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  useEffect(() => {
    if (mode !== 'grid' || !scrollEl) return;
    const syncPack = () => {
      const next = packGridTracks(contentBoxWidth(scrollEl), gridMinItemWidth, gap);
      setGridPack(prev => (
        prev.cols === next.cols && prev.tileWidth === next.tileWidth ? prev : next
      ));
    };
    syncPack();
    const ro = new ResizeObserver(syncPack);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [mode, scrollEl, gridMinItemWidth, gap]);

  const gridCols = gridPack.cols;
  const trackWidth = gridPack.tileWidth;

  const virtualCount = mode === 'grid' && useVirtual
    ? Math.ceil(items.length / gridCols)
    : items.length;

  // Non-virtual CSS grids already apply `gap` between rows.
  // Virtual rows need stride (tile + gap) because each virtual item is one row.
  const estimateSize = () => (mode === 'grid' && useVirtual ? gridRowHeight : rowHeight);

  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollEl,
    estimateSize,
    /** Extra rows hide recycle flash during fast wheel/trackpad flings. */
    overscan: mode === 'grid' ? 6 : 18,
    enabled: useVirtual && !!scrollEl,
  });

  const rangeNotifyRef = useRef(onVisibleRangeChange);
  rangeNotifyRef.current = onVisibleRangeChange;
  const lastRangeKeyRef = useRef('');

  useEffect(() => {
    const notify = rangeNotifyRef.current;
    if (!notify || !items.length) return;
    if (!useVirtual || !scrollEl) {
      const key = `full:0:${Math.max(0, items.length - 1)}`;
      if (key === lastRangeKeyRef.current) return;
      lastRangeKeyRef.current = key;
      notify({ startIndex: 0, endIndex: Math.max(0, items.length - 1) });
      return;
    }
    const vis = virtualizer.getVirtualItems();
    if (!vis.length) return;
    const first = vis[0];
    const last = vis[vis.length - 1];
    let startIndex: number;
    let endIndex: number;
    if (mode === 'grid') {
      startIndex = first.index * gridCols;
      endIndex = Math.min(items.length - 1, (last.index + 1) * gridCols - 1);
    } else {
      startIndex = first.index;
      endIndex = last.index;
    }
    const key = `${startIndex}:${endIndex}:${items.length}`;
    if (key === lastRangeKeyRef.current) return;
    lastRangeKeyRef.current = key;
    notify({ startIndex, endIndex });
  }, [
    useVirtual,
    scrollEl,
    mode,
    gridCols,
    items.length,
    virtualizer.getVirtualItems().length,
    // Re-evaluate when scroll position changes via virtualizer range.
    virtualizer.range?.startIndex,
    virtualizer.range?.endIndex,
  ]);

  useLayoutEffect(() => {
    if (scrollEl && useVirtual) {
      virtualizer.measure();
    }
  }, [scrollEl, useVirtual, items.length, virtualCount, trackWidth, gridRowHeight, rowHeight, gap, gridCols]);

  if (!items.length) {
    return (
      <div ref={hostRef} className="w-full min-h-0" style={scrollMinHeight ? { minHeight: scrollMinHeight } : undefined}>
        {emptyState ?? null}
      </div>
    );
  }

  const contentMin = scrollMinHeight ?? 0;
  /**
   * Fill the viewport when the list is short (empty area stays clickable),
   * but only grow past the viewport when content actually needs the trailing
   * folder-context pad — otherwise overflow-y:auto always shows a scrollbar
   * and the list "scrolls" even when it isn't full.
   */
  const withFolderPad = (contentHeight: number) => {
    const padded = contentHeight + LIST_FOLDER_CONTEXT_PAD_PX;
    if (contentMin <= 0) return padded;
    return Math.max(padded, contentMin);
  };

  const gridTemplate = `repeat(${gridCols}, ${trackWidth}px)`;

  const renderBody = () => {
    if (!useVirtual || !scrollEl) {
      if (mode === 'grid') {
        return (
          <div
            className="grid w-full justify-start content-start"
            style={{
              gap,
              // Equal-stretch tracks from packGridTracks — no early wrap, no right clip.
              gridTemplateColumns: gridTemplate,
              minHeight: contentMin || undefined,
              paddingBottom: LIST_FOLDER_CONTEXT_PAD_PX,
            }}
          >
            {items.map((item, i) => (
              <div key={i} style={{ minWidth: 0, maxWidth: '100%' }}>{renderItem(item, i)}</div>
            ))}
          </div>
        );
      }
      return (
        <div
          className={`${className} bndz-list-body`}
          style={{
            minHeight: contentMin || undefined,
            width: '100%',
            gap: mode === 'list' ? gap : undefined,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {items.map((item, i) => renderItem(item, i))}
          <div
            className="bndz-list-empty-canvas"
            aria-hidden
            style={{ flex: '1 1 auto', minHeight: LIST_FOLDER_CONTEXT_PAD_PX, width: '100%' }}
          />
        </div>
      );
    }

    if (mode === 'grid') {
      const bodyHeight = withFolderPad(virtualizer.getTotalSize());
      const contentEnd = virtualizer.getTotalSize();
      return (
        <div
          className={className}
          style={{ height: bodyHeight, minHeight: withFolderPad(0), position: 'relative', width: '100%' }}
        >
            {virtualizer.getVirtualItems().map(vi => {
            const startIdx = vi.index * gridCols;
            const rowItems = items.slice(startIdx, startIdx + gridCols);
            return (
              <div
                key={vi.key}
                className="bndz-vlist-row"
                style={{
                  position: 'absolute',
                  top: vi.start,
                  left: 0,
                  width: '100%',
                  height: vi.size,
                  contain: 'layout style paint',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="grid w-full justify-start"
                  style={{
                    gap,
                    gridTemplateColumns: gridTemplate,
                    pointerEvents: 'none',
                  }}
                >
                  {rowItems.map((item, i) => (
                    <div key={startIdx + i} style={{ pointerEvents: 'auto', minWidth: 0, maxWidth: '100%' }}>{renderItem(item, startIdx + i)}</div>
                  ))}
                </div>
              </div>
            );
          })}
          <div
            className="bndz-list-empty-canvas"
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: contentEnd,
              bottom: 0,
              minHeight: LIST_FOLDER_CONTEXT_PAD_PX,
            }}
          />
        </div>
      );
    }

    const bodyHeight = withFolderPad(virtualizer.getTotalSize());
    const contentEnd = virtualizer.getTotalSize();
    return (
      <div
        className={`${className} bndz-list-body`}
        style={{ height: bodyHeight, minHeight: withFolderPad(0), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map(vi => (
          <div
            key={vi.key}
            data-index={vi.index}
            className="bndz-vlist-row"
            style={{
              position: 'absolute',
              top: vi.start,
              left: 0,
              width: '100%',
              height: rowHeight,
              contain: 'layout style paint',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'auto', width: '100%' }}>
              {renderItem(items[vi.index], vi.index)}
            </div>
          </div>
        ))}
        <div
          className="bndz-list-empty-canvas"
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: contentEnd,
            bottom: 0,
            minHeight: LIST_FOLDER_CONTEXT_PAD_PX,
          }}
        />
      </div>
    );
  };

  return (
    <div ref={hostRef} className="w-full min-h-0" style={{ minHeight: contentMin || undefined }}>
      {renderBody()}
    </div>
  );
}
