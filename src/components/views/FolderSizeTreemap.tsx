import React, { useMemo } from 'react';
import { IPC } from '../../lib/ipcBridge';
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
const GAP = 0.006; // fractional gap between tiles

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
      <div className="bndz-sizemap-empty">
        <span className="bndz-sizemap-empty-title">No folder sizes available yet</span>
        {onScanFolderSizes && (
          <button type="button" onClick={onScanFolderSizes} className="bndz-sizemap-scan-btn">
            Scan folder sizes
          </button>
        )}
        <span className="bndz-sizemap-empty-hint">Or wait for automatic size sync on navigation.</span>
      </div>
    );
  }

  if (!rects.length) {
    return (
      <div className="bndz-sizemap-empty">
        <span className="bndz-sizemap-empty-title">Nothing large enough to map in this folder</span>
      </div>
    );
  }

  return (
    <div className="bndz-sizemap bndz-sizemap--treemap">
      {rects.map((r, i) => {
        const isDir = r.item.type === 'directory';
        const isOther = r.item.name.endsWith(' more…');
        const hue = isOther ? 215 : isDir ? 208 : 262;
        const sat = isDir ? 58 : 42;
        const lit = 24 + Math.min(22, Math.log10(r.displaySize + 1) * 3.2);
        const showLabel = r.w > 0.07 && r.h > 0.055;
        const showSize = r.w > 0.09 && r.h > 0.08;
        const insetX = Math.min(GAP, r.w * 0.12);
        const insetY = Math.min(GAP, r.h * 0.12);
        return (
          <button
            key={`${r.item.name}-${i}`}
            type="button"
            className={`bndz-sizemap-tile${isDir ? ' bndz-sizemap-tile--dir' : ''}${isOther ? ' bndz-sizemap-tile--other' : ''}`}
            style={{
              left: `${(r.x + insetX) * 100}%`,
              top: `${(r.y + insetY) * 100}%`,
              width: `${Math.max(0, r.w - insetX * 2) * 100}%`,
              height: `${Math.max(0, r.h - insetY * 2) * 100}%`,
              ['--bndz-size-hue' as string]: String(hue),
              ['--bndz-size-sat' as string]: `${sat}%`,
              ['--bndz-size-lit' as string]: `${lit}%`,
            }}
            title={`${r.item.name} — ${formatSize(r.displaySize)}`}
            onClick={() => {
              if (isDir && r.item.path && !isOther) onNavigate(r.item.path);
            }}
            onDoubleClick={() => {
              if (!isDir && !isOther && r.item.path) {
                void IPC.executeContextMenuVerb(toWindowsPath(r.item.path), 'open');
              }
            }}
          >
            <span className="bndz-sizemap-tile-sheen" aria-hidden />
            {showLabel && (
              <span className="bndz-sizemap-tile-copy">
                <span className="bndz-sizemap-tile-name">{r.item.name}</span>
                {showSize && (
                  <span className="bndz-sizemap-tile-size">{formatSize(r.displaySize)}</span>
                )}
              </span>
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
