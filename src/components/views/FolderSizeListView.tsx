import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { SizeBar, type SizeBarStyle } from '../SizeBar';
import { useAppConfig } from '../../data/configContext';

export type FolderSizeListItem = {
  name: string;
  type?: string;
  size?: number;
  path?: string;
};

type Props = {
  items: FolderSizeListItem[];
  onNavigate: (path: string) => void;
  onOpen?: (path: string) => void;
  onScanFolderSizes?: () => void;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Explorer-style size view — sorted rows with proportional bars (no treemap sitemap). */
export default function FolderSizeListView({ items, onNavigate, onOpen, onScanFolderSizes }: Props) {
  const { config } = useAppConfig();
  const barStyle = (config.folderSizeBarStyle || 'bar') as SizeBarStyle;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.size || 0) - (a.size || 0)),
    [items],
  );
  const maxSize = Math.max(...sorted.map(i => i.size || 0), 1);

  // Keep viewport position when folder sizes stream in and rows re-order.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - scrollTopRef.current) > 1) {
      el.scrollTop = scrollTopRef.current;
    }
  }, [sorted]);

  if (!sorted.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-[11px] text-gray-500 gap-2 px-4 text-center">
        <span>This folder is empty.</span>
      </div>
    );
  }

  const unknownSizes = sorted.every(i => !i.size || i.size <= 4096);

  return (
    <div className="flex flex-col h-full min-h-0">
      {unknownSizes && onScanFolderSizes && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.06] bg-[#1a1a1f]/80 text-[11px] text-gray-400">
          <span>Folder sizes not scanned yet — bars show relative placeholders.</span>
          <button
            type="button"
            onClick={onScanFolderSizes}
            className="shrink-0 px-2.5 py-1 rounded-[var(--bndz-radius-sm)] bg-[#094771]/50 text-[#99c9f0] hover:bg-[#094771]/55 border border-[#0078d4]/25"
          >
            Scan sizes
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bndz-scrollbar p-1"
        onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }}
      >
        <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,2fr)_88px] gap-x-3 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 border-b border-white/[0.06] mb-1">
          <span>Name</span>
          <span>Relative size</span>
          <span className="text-right">Size</span>
        </div>
        {sorted.map(item => {
          const isDir = item.type === 'directory';
          const pct = Math.max(2, Math.round(((item.size || 0) / maxSize) * 100));
          return (
            <button
              key={item.path || item.name}
              type="button"
              className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,2fr)_88px] gap-x-3 items-center w-full px-2 py-1.5 rounded-[var(--bndz-radius-sm)] hover:bg-white/[0.05] text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4]/40"
              onClick={() => { if (isDir && item.path) onNavigate(item.path); }}
              onDoubleClick={() => {
                if (!item.path) return;
                if (isDir) onNavigate(item.path);
                else onOpen?.(item.path);
              }}
            >
              <span className="flex items-center gap-1.5 min-w-0 text-[12px] text-white/90">
                <ShellNativeIcon path={item.path || item.name} isDir={isDir} size={16} />
                <span className="truncate">{item.name}</span>
              </span>
              <SizeBar percent={pct} isDir={isDir} style={barStyle} widthClass="w-full" />
              <span className="text-[11px] text-gray-400 text-right tabular-nums">{formatBytes(item.size || 0)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
