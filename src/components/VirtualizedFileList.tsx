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
  className = 'flex flex-col w-full',
  renderItem,
  emptyState,
}: VirtualizedFileListProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
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

  const estimateSize = () => (mode === 'grid' && useVirtual ? gridRowHeight : rowHeight);

  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollEl,
    estimateSize,
    overscan: mode === 'grid' ? 4 : 16,
    enabled: useVirtual && !!scrollEl,
  });

  useLayoutEffect(() => {
    if (scrollEl && useVirtual) {
      virtualizer.measure();
    }
  }, [scrollEl, useVirtual, items.length, virtualCount]);

  if (!items.length) {
    return <>{emptyState ?? null}</>;
  }

  const renderBody = () => {
    if (!useVirtual || !scrollEl) {
      if (mode === 'grid') {
        return (
          <div
            className="grid gap-2 w-full"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMinItemWidth}px, 1fr))` }}
          >
            {items.map((item, i) => (
              <div key={i}>{renderItem(item, i)}</div>
            ))}
          </div>
        );
      }
      return <div className={className}>{items.map((item, i) => renderItem(item, i))}</div>;
    }

    if (mode === 'grid') {
      return (
        <div
          className={className}
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
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
                }}
              >
                <div
                  className="grid gap-2 w-full"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                >
                  {rowItems.map((item, i) => (
                    <div key={startIdx + i}>{renderItem(item, startIdx + i)}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div
        className={className}
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
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
            }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    );
  };

  return <div ref={hostRef} className="w-full min-h-0">{renderBody()}</div>;
}
