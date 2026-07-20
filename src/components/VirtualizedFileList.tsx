import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

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
      const h = scrollEl.clientHeight;
      if (h > 0) setScrollMinHeight(prev => (prev === h ? prev : h));
    };
    syncMinHeight();
    const ro = new ResizeObserver(syncMinHeight);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  useEffect(() => {
    if (mode !== 'grid' || !useVirtual || !scrollEl) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width || 800;
      const next = Math.max(1, Math.floor(w / gridMinItemWidth));
      setGridCols(prev => (prev === next ? prev : next));
    });
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
    overscan: mode === 'grid' ? 3 : 8,
    enabled: useVirtual && !!scrollEl,
  });

  useLayoutEffect(() => {
    if (scrollEl && useVirtual) {
      virtualizer.measure();
    }
  }, [scrollEl, useVirtual, items.length, virtualCount]);

  if (!items.length) {
    return (
      <div ref={hostRef} className="w-full min-h-0" style={scrollMinHeight ? { minHeight: scrollMinHeight } : undefined}>
        {emptyState ?? null}
      </div>
    );
  }

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
              minHeight: scrollMinHeight,
            }}
          >
            {items.map((item, i) => (
              <div key={i}>{renderItem(item, i)}</div>
            ))}
          </div>
        );
      }
      return (
        <div className={className} style={{ minHeight: scrollMinHeight, width: '100%', gap: mode === 'list' ? gap : undefined }}>
          {items.map((item, i) => renderItem(item, i))}
        </div>
      );
    }

    if (mode === 'grid') {
      const bodyHeight = Math.max(virtualizer.getTotalSize(), scrollMinHeight ?? 0);
      return (
        <div
          className={className}
          style={{ height: bodyHeight, minHeight: scrollMinHeight, position: 'relative', width: '100%' }}
        >
          {virtualizer.getVirtualItems().map(vi => {
            const startIdx = vi.index * gridCols;
            const rowItems = items.slice(startIdx, startIdx + gridCols);
            return (
              <div
                key={vi.key}
                style={{
                  position: 'absolute',
                  top: vi.start,
                  left: 0,
                  width: '100%',
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

    const bodyHeight = Math.max(virtualizer.getTotalSize(), scrollMinHeight ?? 0);
    return (
      <div
        className={className}
        style={{ height: bodyHeight, minHeight: scrollMinHeight, position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map(vi => (
          <div
            key={vi.key}
            data-index={vi.index}
            style={{
              position: 'absolute',
              top: vi.start,
              left: 0,
              width: '100%',
              height: rowHeight,
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

  const nonVirtualMinH = scrollMinHeight ? { minHeight: scrollMinHeight } : undefined;

  return <div ref={hostRef} className="w-full min-h-0" style={nonVirtualMinH}>{renderBody()}</div>;
}
