import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Trailing empty canvas so folder (New / Paste) context menu stays reachable when the list is full. */
export const LIST_FOLDER_CONTEXT_PAD_PX = 72;

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
}

export function VirtualizedFileList<T>({
  items,
  enabled = true,
  threshold = 80,
  rowHeight = 26,
  mode = 'list',
  gridMinItemWidth = 108,
  gridRowHeight = 108,
  gap = 8,
  className = 'flex flex-col w-full',
  renderItem,
  emptyState,
}: VirtualizedFileListProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [scrollMinHeight, setScrollMinHeight] = useState<number | undefined>(undefined);
  const [gridCols, setGridCols] = useState(6);
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
    if (mode !== 'grid' || !useVirtual || !scrollEl) return;
    const syncCols = () => {
      const w = scrollEl.clientWidth || 800;
      const next = Math.max(1, Math.floor(w / Math.max(1, gridMinItemWidth)));
      setGridCols(prev => (prev === next ? prev : next));
    };
    syncCols();
    const ro = new ResizeObserver(syncCols);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [mode, useVirtual, scrollEl, gridMinItemWidth]);

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
    overscan: mode === 'grid' ? 2 : 5,
    enabled: useVirtual && !!scrollEl,
  });

  useLayoutEffect(() => {
    if (scrollEl && useVirtual) {
      virtualizer.measure();
    }
  }, [scrollEl, useVirtual, items.length, virtualCount, gridMinItemWidth, gridRowHeight, rowHeight, gap, gridCols]);

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

  const renderBody = () => {
    if (!useVirtual || !scrollEl) {
      if (mode === 'grid') {
        return (
          <div
            className="grid w-full justify-start content-start"
            style={{
              gap,
              // Fixed track size — never stretch with 1fr (that caused huge empty gaps).
              gridTemplateColumns: `repeat(auto-fill, ${gridMinItemWidth}px)`,
              // Fill the content box; paddingBottom stays inside minHeight (border-box)
              // so short lists do not force a scrollbar.
              minHeight: contentMin || undefined,
              paddingBottom: LIST_FOLDER_CONTEXT_PAD_PX,
            }}
          >
            {items.map((item, i) => (
              <div key={i}>{renderItem(item, i)}</div>
            ))}
          </div>
        );
      }
      return (
        <div
          className={className}
          style={{
            minHeight: contentMin || undefined,
            width: '100%',
            gap: mode === 'list' ? gap : undefined,
            paddingBottom: LIST_FOLDER_CONTEXT_PAD_PX,
          }}
        >
          {items.map((item, i) => renderItem(item, i))}
        </div>
      );
    }

    if (mode === 'grid') {
      const bodyHeight = withFolderPad(virtualizer.getTotalSize());
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
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  contain: 'layout style',
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="grid w-full justify-start"
                  style={{
                    gap,
                    gridTemplateColumns: `repeat(${gridCols}, ${gridMinItemWidth}px)`,
                    pointerEvents: 'none',
                  }}
                >
                  {rowItems.map((item, i) => (
                    <div key={startIdx + i} style={{ pointerEvents: 'auto' }}>{renderItem(item, startIdx + i)}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    const bodyHeight = withFolderPad(virtualizer.getTotalSize());
    return (
      <div
        className={className}
        style={{ height: bodyHeight, minHeight: withFolderPad(0), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map(vi => (
          <div
            key={vi.key}
            data-index={vi.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: rowHeight,
              transform: `translateY(${vi.start}px)`,
              contain: 'layout style',
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'auto', width: '100%' }}>
              {renderItem(items[vi.index], vi.index)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Host matches the scrollport when short — do not add the folder pad here
  // (body already accounts for it without forcing overflow).
  const nonVirtualMinH = contentMin > 0 ? { minHeight: contentMin } : undefined;

  return <div ref={hostRef} className="w-full min-h-0" style={nonVirtualMinH}>{renderBody()}</div>;
}
