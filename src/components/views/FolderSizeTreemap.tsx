import React, { useMemo } from 'react';
import { toWindowsPath } from '../../lib/pathUtils';

type Item = { name: string; type?: string; size?: number; path?: string };

type Props = {
  items: Item[];
  onNavigate: (path: string) => void;
  onScanFolderSizes?: () => void;
};

type Rect = { x: number; y: number; w: number; h: number; item: Item; size: number; displaySize: number };

const MAX_TILES = 24;
const MIN_FILE_BYTES = 512 * 1024;

/** Squarified treemap — folders-first, top-N by size, sqrt weighting so one huge file cannot eat the view. */
export default function FolderSizeTreemap({ items, onNavigate, onScanFolderSizes }: Props) {
  const prepared = useMemo(() => {
    const dirs = items.filter(i => i.type === 'directory');
    const files = items.filter(i => i.type !== 'directory' && (i.size || 0) >= MIN_FILE_BYTES);
    return dirs.length > 0 ? dirs : files;
  }, [items]);

  const rects = useMemo(() => layoutTreemap(prepared), [prepared]);

  const formatSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  };

  if (!prepared.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-[11px] text-gray-500 gap-2 px-4 text-center">
        <span>No folder sizes available yet.</span>
        {onScanFolderSizes && (
          <button
            type="button"
            onClick={onScanFolderSizes}
            className="mt-1 px-3 py-1.5 text-[11px] bg-[#094771] hover:bg-[#0a5a8c] text-white"
          >
            Scan folder sizes
          </button>
        )}
        <span className="text-[10px] text-gray-600">Or wait for automatic size sync on navigation.</span>
      </div>
    );
  }

  if (!rects.length) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-[11px] text-gray-500">
        Nothing large enough to map in this folder.
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[280px] bg-[#1e1e1e] border border-[#3a3a3a]">
      {rects.map((r, i) => {
        const isDir = r.item.type === 'directory';
        const isOther = r.item.name.endsWith(' more…');
        const hue = isOther ? 220 : isDir ? 38 : 200;
        const sat = isDir ? 50 : 55;
        const lit = 26 + Math.min(24, Math.log10(r.displaySize + 1) * 3.5);
        return (
          <button
            key={`${r.item.name}-${i}`}
            type="button"
            className="absolute overflow-hidden border border-[#1a1a1a] text-left p-1 hover:brightness-125 transition-[filter] focus:outline-none focus:ring-1 focus:ring-[#094771]"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              minWidth: r.w > 0.04 ? undefined : '4%',
              minHeight: r.h > 0.04 ? undefined : '4%',
              background: `hsl(${hue} ${sat}% ${lit}%)`,
            }}
            title={`${r.item.name} — ${formatSize(r.displaySize)}`}
            onClick={() => {
              if (isDir && r.item.path && !isOther) onNavigate(r.item.path);
            }}
            onDoubleClick={() => {
              if (!isDir && !isOther && r.item.path) {
                import('../../lib/ipcBridge').then(({ IPC }) => {
                  IPC.executeContextMenuVerb(toWindowsPath(r.item.path!), 'open');
                });
              }
            }}
          >
            {r.w > 0.06 && r.h > 0.05 && (
              <>
                <span className="block text-[10px] text-white/90 font-medium truncate leading-tight">{r.item.name}</span>
                <span className="block text-[9px] text-white/60">{formatSize(r.displaySize)}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function layoutTreemap(items: Item[]): Rect[] {
  const dirs = items.filter(i => i.type === 'directory');
  const pool = (dirs.length > 0 ? dirs : items.filter(i => (i.size || 0) >= MIN_FILE_BYTES))
    .map(it => ({
      item: it,
      displaySize: Math.max(it.type === 'directory' ? 4096 : 1, it.size || 1),
    }))
    .sort((a, b) => b.displaySize - a.displaySize);

  let sized = pool;
  if (pool.length > MAX_TILES) {
    const top = pool.slice(0, MAX_TILES - 1);
    const rest = pool.slice(MAX_TILES - 1);
    const restSum = rest.reduce((s, x) => s + x.displaySize, 0);
    top.push({
      item: { name: `${rest.length} more…`, type: 'file' },
      displaySize: restSum,
    });
    sized = top;
  }

  const weighted = sized.map(s => ({
    ...s,
    size: Math.sqrt(s.displaySize),
  }));

  const total = weighted.reduce((s, x) => s + x.size, 0);
  if (total <= 0) return [];

  const rects: Rect[] = [];
  squarify(weighted, { x: 0, y: 0, w: 1, h: 1 }, rects, total);
  return rects;
}

type Box = { x: number; y: number; w: number; h: number };

function squarify(
  items: { item: Item; size: number; displaySize: number }[],
  box: Box,
  out: Rect[],
  total: number,
) {
  if (!items.length) return;
  if (items.length === 1) {
    out.push({ ...box, item: items[0].item, size: items[0].size, displaySize: items[0].displaySize });
    return;
  }

  const row: typeof items = [];
  let i = 0;
  const horizontal = box.w >= box.h;

  while (i < items.length) {
    row.push(items[i]);
    const rowSum = row.reduce((s, x) => s + x.size, 0);
    const next = i + 1 < items.length ? [...row, items[i + 1]] : row;
    const curRatio = worst(row, rowSum, box, horizontal);
    const nextSum = next.reduce((s, x) => s + x.size, 0);
    const nextRatio = worst(next, nextSum, box, horizontal);

    if (next.length > row.length && nextRatio <= curRatio) {
      i++;
      continue;
    }

    placeRow(row, rowSum, total, box, out, horizontal);
    const used = rowSum / total;
    const nextBox = horizontal
      ? { x: box.x + box.w * used, y: box.y, w: box.w * (1 - used), h: box.h }
      : { x: box.x, y: box.y + box.h * used, w: box.w, h: box.h * (1 - used) };
    squarify(items.slice(i + 1), nextBox, out, total - rowSum);
    return;
  }
}

function worst(row: { size: number }[], rowSum: number, box: Box, horizontal: boolean) {
  const side = horizontal ? box.h : box.w;
  const len = (horizontal ? box.w : box.h) * (rowSum / row.reduce((s, x) => s + x.size, 0));
  if (len <= 0 || side <= 0) return Infinity;
  let max = 0;
  for (const r of row) {
    const area = (r.size / rowSum) * len * side;
    const ratio = Math.max(area / (side * side), (side * side) / area);
    max = Math.max(max, ratio);
  }
  return max;
}

function placeRow(
  row: { item: Item; size: number; displaySize: number }[],
  rowSum: number,
  total: number,
  box: Box,
  out: Rect[],
  horizontal: boolean,
) {
  let offset = 0;
  const frac = rowSum / total;
  const main = horizontal ? box.w * frac : box.h * frac;
  for (const r of row) {
    const share = r.size / rowSum;
    if (horizontal) {
      out.push({
        x: box.x,
        y: box.y + offset * box.h,
        w: main,
        h: box.h * share,
        item: r.item,
        size: r.size,
        displaySize: r.displaySize,
      });
    } else {
      out.push({
        x: box.x + offset * box.w,
        y: box.y,
        w: box.w * share,
        h: main,
        item: r.item,
        size: r.size,
        displaySize: r.displaySize,
      });
    }
    offset += share;
  }
}
