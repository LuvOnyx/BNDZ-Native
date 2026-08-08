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
      <div className="bndz-sizemap-empty">
        <span className="bndz-sizemap-empty-title">This folder is empty</span>
      </div>
    );
  }

  const unknownSizes = sorted.every(i => !i.size || i.size <= 4096);

  return (
    <div className="bndz-sizemap bndz-sizemap--list flex flex-col h-full min-h-0">
      {unknownSizes && onScanFolderSizes && (
        <div className="bndz-sizemap-banner">
          <span>Folder sizes not scanned yet — bars show relative placeholders.</span>
          <button type="button" onClick={onScanFolderSizes} className="bndz-sizemap-scan-btn">
            Scan sizes
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bndz-scrollbar px-2 py-2"
        onScroll={e => { scrollTopRef.current = e.currentTarget.scrollTop; }}
      >
        <div className="bndz-sizemap-list-head">
          <span>Name</span>
          <span>Relative size</span>
          <span className="text-right">Size</span>
        </div>
        <div className="bndz-sizemap-list-body">
          {sorted.map(item => {
            const isDir = item.type === 'directory';
            const pct = Math.max(2, Math.round(((item.size || 0) / maxSize) * 100));
            return (
              <button
                key={item.path || item.name}
                type="button"
                className="bndz-sizemap-list-row"
                onClick={() => { if (isDir && item.path) onNavigate(item.path); }}
                onDoubleClick={() => {
                  if (!item.path) return;
                  if (isDir) onNavigate(item.path);
                  else onOpen?.(item.path);
                }}
              >
                <span className="bndz-sizemap-list-name">
                  <span className="bndz-sizemap-list-icon">
                    <ShellNativeIcon path={item.path || item.name} isDir={isDir} size={16} />
                  </span>
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="bndz-sizemap-list-bar">
                  <SizeBar percent={pct} isDir={isDir} style={barStyle} widthClass="w-full" />
                </span>
                <span className="bndz-sizemap-list-bytes">{formatBytes(item.size || 0)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
