import React, { useMemo, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { Icons8Icon } from '../Icons8Icon';

type Item = { name: string; type?: string; size?: number; path?: string };

type Props = {
  items: Item[];
  onNavigate: (path: string) => void;
  onScanFolderSizes?: () => void;
  folderLabel?: string;
};

type SizeCategory = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other';

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
  item: Item;
  bytes: number;
  category: SizeCategory;
};

type Box = { x: number; y: number; w: number; h: number };

const MAX_TILES = 96;
const MIN_LABEL_W = 0.048;
const MIN_LABEL_H = 0.042;
const MIN_ICON_W = 0.07;
const MIN_ICON_H = 0.065;
const GAP = 0.0012;

const CATEGORY_META: Record<SizeCategory, { label: string; hue: number; sat: number; lit: number }> = {
  folder: { label: 'Folders', hue: 208, sat: 54, lit: 33 },
  image: { label: 'Images', hue: 286, sat: 50, lit: 35 },
  video: { label: 'Video', hue: 340, sat: 56, lit: 33 },
  audio: { label: 'Audio', hue: 158, sat: 50, lit: 31 },
  document: { label: 'Documents', hue: 38, sat: 56, lit: 35 },
  archive: { label: 'Archives', hue: 24, sat: 52, lit: 33 },
  code: { label: 'Code', hue: 178, sat: 44, lit: 31 },
  other: { label: 'Other', hue: 220, sat: 16, lit: 29 },
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

function categorize(item: Item): SizeCategory {
  if (item.type === 'directory') return 'folder';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic', 'avif', 'bmp', 'tif', 'tiff', 'psd', 'raw', 'cr2', 'nef'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'm4v', 'mpg', 'mpeg', 'flv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff', 'aif'].includes(ext)) return 'audio';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'odt'].includes(ext)) return 'document';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab'].includes(ext)) return 'archive';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'cs', 'cpp', 'c', 'h', 'java', 'go', 'rs', 'rb', 'php', 'css', 'html', 'json', 'xml', 'yml', 'yaml', 'toml', 'sql'].includes(ext)) return 'code';
  return 'other';
}

function parentPathOf(path?: string): string | null {
  if (!path) return null;
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return null;
  if (/^[A-Za-z]:$/.test(norm.slice(0, idx))) return `${norm.slice(0, idx)}/`;
  return norm.slice(0, idx);
}

function crumbParts(label?: string): string[] {
  if (!label) return [];
  return label.replace(/\\/g, '/').split('/').filter(Boolean);
}

/**
 * Size Map — WinDirStat-class disk map.
 * Cell area is linear in bytes. Full-bleed canvas — not a bar list.
 */
export default function FolderSizeTreemap({ items, onNavigate, onScanFolderSizes, folderLabel }: Props) {
  const [hover, setHover] = useState<Rect | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [pinned, setPinned] = useState<Rect | null>(null);

  const totalBytes = useMemo(
    () => items.reduce((s, i) => s + Math.max(0, i.size || 0), 0),
    [items],
  );

  const rects = useMemo(() => layoutSizeMap(items), [items]);

  const legend = useMemo(() => {
    const tallies = new Map<SizeCategory, number>();
    for (const r of rects) tallies.set(r.category, (tallies.get(r.category) || 0) + r.bytes);
    return (Object.keys(CATEGORY_META) as SizeCategory[])
      .filter(c => (tallies.get(c) || 0) > 0)
      .map(c => ({ cat: c, bytes: tallies.get(c) || 0 }));
  }, [rects]);

  const unknownSizes = items.length > 0 && items.every(i => !i.size || i.size <= 4096);
  const active = pinned || (focusIdx != null ? rects[focusIdx] : null) || hover;
  const parentPath = parentPathOf(folderLabel);
  const crumbs = crumbParts(folderLabel);

  if (!items.length) {
    return (
      <div className="bndz-diskmap bndz-diskmap--empty">
        <div className="bndz-diskmap-empty-card">
          <Icons8Icon id="hard_drive_ui" size={28} />
          <span className="bndz-diskmap-empty-title">This folder is empty</span>
          <span className="bndz-diskmap-empty-hint">Nothing to map by size yet.</span>
        </div>
      </div>
    );
  }

  if (!rects.length) {
    return (
      <div className="bndz-diskmap bndz-diskmap--empty">
        <div className="bndz-diskmap-empty-card">
          <Icons8Icon id="piechart_ui" size={28} />
          <span className="bndz-diskmap-empty-title">No sizes to map</span>
          {onScanFolderSizes && (
            <button type="button" onClick={onScanFolderSizes} className="bndz-diskmap-scan-btn">
              Scan folder sizes
            </button>
          )}
          <span className="bndz-diskmap-empty-hint">Scan this folder — tiles fill by byte weight, like WinDirStat.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bndz-diskmap">
      <header className="bndz-diskmap-chrome">
        <div className="bndz-diskmap-chrome-lead">
          <div className="bndz-diskmap-brand">
            <Icons8Icon id="piechart_ui" size={14} />
            <span className="bndz-diskmap-kicker">Size map</span>
          </div>
          <nav className="bndz-diskmap-crumbs" aria-label="Folder path">
            {parentPath && (
              <button
                type="button"
                className="bndz-diskmap-up"
                title="Up one level"
                onClick={() => onNavigate(parentPath)}
              >
                ↑
              </button>
            )}
            {crumbs.length === 0 ? (
              <span className="bndz-diskmap-folder">{folderLabel || 'Current folder'}</span>
            ) : (
              crumbs.map((part, i) => {
                const isLast = i === crumbs.length - 1;
                const path = /^[A-Za-z]:$/.test(crumbs[0])
                  ? (i === 0 ? `${crumbs[0]}/` : `${crumbs[0]}/${crumbs.slice(1, i + 1).join('/')}`)
                  : crumbs.slice(0, i + 1).join('/');
                return (
                  <React.Fragment key={`${part}-${i}`}>
                    {i > 0 && <span className="bndz-diskmap-crumb-sep">/</span>}
                    {isLast ? (
                      <span className="bndz-diskmap-folder">{part}</span>
                    ) : (
                      <button type="button" className="bndz-diskmap-crumb" onClick={() => onNavigate(path)}>
                        {part}
                      </button>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </nav>
        </div>
        <div className="bndz-diskmap-chrome-trail">
          <div className="bndz-diskmap-total">
            <strong>{formatBytes(totalBytes)}</strong>
            <span>{rects.length} tiles · {items.length} items</span>
          </div>
          {onScanFolderSizes && (
            <button type="button" className="bndz-diskmap-scan-btn" onClick={onScanFolderSizes}>
              <Icons8Icon id="refresh" size={12} />
              {unknownSizes ? 'Scan sizes' : 'Rescan'}
            </button>
          )}
        </div>
      </header>

      {unknownSizes && onScanFolderSizes && (
        <div className="bndz-diskmap-banner">
          <span>Sizes look incomplete — run a scan so area matches bytes.</span>
          <button type="button" onClick={onScanFolderSizes} className="bndz-diskmap-scan-btn bndz-diskmap-scan-btn--ghost">
            Scan now
          </button>
        </div>
      )}

      <div className="bndz-diskmap-stage">
        <div
          className="bndz-diskmap-canvas"
          onMouseLeave={() => setHover(null)}
          onClick={e => {
            if (e.target === e.currentTarget) setPinned(null);
          }}
        >
          {rects.map((r, i) => {
            const meta = CATEGORY_META[r.category];
            const lit = meta.lit + Math.min(16, Math.log10(r.bytes + 1) * 2.6);
            const showLabel = r.w > MIN_LABEL_W && r.h > MIN_LABEL_H;
            const showSize = r.w > 0.075 && r.h > 0.068;
            const showIcon = r.w > MIN_ICON_W && r.h > MIN_ICON_H && !!r.item.path;
            const isDir = r.item.type === 'directory';
            const isOther = r.item.name.endsWith(' more…');
            const isHot = !!active
              && active.item.name === r.item.name
              && (active.item.path || '') === (r.item.path || '');
            const insetX = Math.min(GAP, r.w * 0.07);
            const insetY = Math.min(GAP, r.h * 0.07);
            const pct = totalBytes > 0 ? (r.bytes / totalBytes) * 100 : 0;
            return (
              <button
                key={`${r.item.path || r.item.name}-${i}`}
                type="button"
                className={`bndz-diskmap-cell cat-${r.category}${isDir ? ' is-dir' : ''}${isOther ? ' is-other' : ''}${isHot ? ' is-hot' : ''}`}
                style={{
                  left: `${(r.x + insetX) * 100}%`,
                  top: `${(r.y + insetY) * 100}%`,
                  width: `${Math.max(0, r.w - insetX * 2) * 100}%`,
                  height: `${Math.max(0, r.h - insetY * 2) * 100}%`,
                  ['--cell-h' as string]: String(meta.hue),
                  ['--cell-s' as string]: `${meta.sat}%`,
                  ['--cell-l' as string]: `${lit}%`,
                }}
                title={`${r.item.name} — ${formatBytes(r.bytes)} (${pct.toFixed(1)}%)`}
                onMouseEnter={() => setHover(r)}
                onFocus={() => setFocusIdx(i)}
                onBlur={() => setFocusIdx(null)}
                onClick={e => {
                  e.stopPropagation();
                  setPinned(r);
                }}
                onDoubleClick={() => {
                  if (isOther) return;
                  if (isDir && r.item.path) onNavigate(r.item.path);
                  else if (r.item.path) void IPC.executeContextMenuVerb(toWindowsPath(r.item.path), 'open');
                }}
              >
                {showIcon && (
                  <span className="bndz-diskmap-cell-icon" aria-hidden>
                    <ShellNativeIcon path={r.item.path} isDir={isDir} size={14} eager />
                  </span>
                )}
                {showLabel && (
                  <span className="bndz-diskmap-cell-copy">
                    <span className="bndz-diskmap-cell-name">{r.item.name}</span>
                    {showSize && (
                      <span className="bndz-diskmap-cell-size">
                        {formatBytes(r.bytes)}
                        <em>{pct.toFixed(pct >= 10 ? 0 : 1)}%</em>
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}

          <div className="bndz-diskmap-legend" aria-label="Category legend">
            {legend.map(({ cat, bytes }) => (
              <span key={cat} className="bndz-diskmap-legend-item">
                <i
                  style={{
                    background: `hsl(${CATEGORY_META[cat].hue} ${CATEGORY_META[cat].sat}% ${CATEGORY_META[cat].lit}%)`,
                  }}
                />
                <span>{CATEGORY_META[cat].label}</span>
                <b>{formatBytes(bytes)}</b>
              </span>
            ))}
          </div>
        </div>

        <aside className={`bndz-diskmap-dock${active ? ' is-live' : ''}`} aria-live="polite">
          {active ? (
            <>
              <div className="bndz-diskmap-dock-icon">
                <ShellNativeIcon
                  path={active.item.path || active.item.name}
                  isDir={active.item.type === 'directory'}
                  size={28}
                  eager
                />
              </div>
              <div className="bndz-diskmap-dock-copy">
                <div className="bndz-diskmap-dock-name">{active.item.name}</div>
                <div className="bndz-diskmap-dock-meta">
                  <span>{formatBytes(active.bytes)}</span>
                  <span>{totalBytes > 0 ? `${((active.bytes / totalBytes) * 100).toFixed(1)}% of folder` : '—'}</span>
                  <span>{CATEGORY_META[active.category].label}</span>
                </div>
                {active.item.path && (
                  <div className="bndz-diskmap-dock-path" title={active.item.path}>{active.item.path}</div>
                )}
              </div>
              <div className="bndz-diskmap-dock-actions">
                {active.item.type === 'directory' && active.item.path && !active.item.name.endsWith(' more…') && (
                  <button type="button" className="bndz-diskmap-dock-btn" onClick={() => onNavigate(active.item.path!)}>
                    Open folder
                  </button>
                )}
                {active.item.type !== 'directory' && active.item.path && !active.item.name.endsWith(' more…') && (
                  <button
                    type="button"
                    className="bndz-diskmap-dock-btn"
                    onClick={() => void IPC.executeContextMenuVerb(toWindowsPath(active.item.path!), 'open')}
                  >
                    Open
                  </button>
                )}
                <button type="button" className="bndz-diskmap-dock-btn bndz-diskmap-dock-btn--ghost" onClick={() => setPinned(null)}>
                  Clear
                </button>
              </div>
            </>
          ) : (
            <div className="bndz-diskmap-dock-idle">
              <strong>{formatBytes(totalBytes)}</strong>
              <span>Hover a tile — area is proportional to size. Double-click to open.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function layoutSizeMap(items: Item[]): Rect[] {
  const pool = items
    .map(it => ({
      item: it,
      bytes: Math.max(it.type === 'directory' ? 4096 : 1, it.size || 0),
      category: categorize(it),
    }))
    .filter(x => x.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  if (!pool.length) return [];

  let sized = pool;
  if (pool.length > MAX_TILES) {
    const top = pool.slice(0, MAX_TILES - 1);
    const rest = pool.slice(MAX_TILES - 1);
    const restSum = rest.reduce((s, x) => s + x.bytes, 0);
    top.push({
      item: { name: `${rest.length} more…`, type: 'file' },
      bytes: restSum,
      category: 'other' as SizeCategory,
    });
    sized = top;
  }

  // Linear area ∝ bytes — true size map (WinDirStat / TreeSize), not flattened sqrt.
  const total = sized.reduce((s, x) => s + x.bytes, 0);
  if (total <= 0) return [];

  const weighted = sized.map(s => ({ ...s, size: s.bytes }));
  const rects: Rect[] = [];
  squarify(weighted, { x: 0, y: 0, w: 1, h: 1 }, rects, total);
  return rects;
}

function squarify(
  items: { item: Item; size: number; bytes: number; category: SizeCategory }[],
  box: Box,
  out: Rect[],
  total: number,
) {
  if (!items.length) return;
  if (items.length === 1) {
    out.push({
      ...box,
      item: items[0].item,
      bytes: items[0].bytes,
      category: items[0].category,
    });
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
  const len = (horizontal ? box.w : box.h) * (rowSum / Math.max(rowSum, 1));
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
  row: { item: Item; size: number; bytes: number; category: SizeCategory }[],
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
        bytes: r.bytes,
        category: r.category,
      });
    } else {
      out.push({
        x: box.x + offset * box.w,
        y: box.y,
        w: box.w * share,
        h: main,
        item: r.item,
        bytes: r.bytes,
        category: r.category,
      });
    }
    offset += share;
  }
}
