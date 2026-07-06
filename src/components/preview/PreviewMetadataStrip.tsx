import React from 'react';
import { Copy, ExternalLink, FolderOpen, HardDrive } from 'lucide-react';
import { formatFsDate } from '../../lib/pathUtils';

type Props = {
  name: string;
  path?: string | null;
  size?: number;
  modified?: number | string | Date | null;
  kindLabel?: string;
  isDirectory?: boolean;
  onOpen?: () => void;
  onReveal?: () => void;
  onCopyPath?: () => void;
};

function formatSize(bytes: number) {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatModified(value: Props['modified']) {
  if (value == null) return '—';
  if (typeof value === 'number') return formatFsDate(new Date(value * 1000).toISOString());
  if (value instanceof Date) return formatFsDate(value.toISOString());
  return formatFsDate(String(value));
}

/** Flat metadata ribbon — adapted from Spacedrive inspector header patterns, BNDZ-native. */
export default function PreviewMetadataStrip({
  name, path, size, modified, kindLabel, isDirectory, onOpen, onReveal, onCopyPath,
}: Props) {
  return (
    <div className="bndz-preview-metadata-strip shrink-0 border-b border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2">
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#f3f4f6] truncate" title={name}>{name}</div>
          {path && (
            <div className="text-[10px] text-[#9ca3af] truncate font-mono mt-0.5" title={path}>{path}</div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-[#b0b8c0]">
            {kindLabel && <span className="bndz-preview-kind-pill">{kindLabel}</span>}
            {!isDirectory && size != null && <span>{formatSize(size)}</span>}
            <span>{formatModified(modified)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpen && (
            <button type="button" className="bndz-preview-action-btn" onClick={onOpen} title="Open">
              <ExternalLink size={13} />
            </button>
          )}
          {onReveal && (
            <button type="button" className="bndz-preview-action-btn" onClick={onReveal} title="Show in folder">
              {isDirectory ? <FolderOpen size={13} /> : <HardDrive size={13} />}
            </button>
          )}
          {onCopyPath && path && (
            <button type="button" className="bndz-preview-action-btn" onClick={onCopyPath} title="Copy path">
              <Copy size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
