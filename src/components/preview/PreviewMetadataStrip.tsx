import React from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { formatFsDate } from '../../lib/pathUtils';
import { formatUiPath } from '../../lib/displayPath';

export type PreviewMetaFact = { label: string; value: string };

type Props = {
  name: string;
  path?: string | null;
  size?: number;
  modified?: number | string | Date | null;
  kindLabel?: string;
  isDirectory?: boolean;
  /** Curated EXIF / TagLib facts (camera, duration, etc.). */
  facts?: PreviewMetaFact[];
  onReveal?: () => void;
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
  if (typeof value === 'number') {
    const d = new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? '—' : formatFsDate(d);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '—' : formatFsDate(value);
  }
  return formatFsDate(String(value));
}

/** Flat metadata ribbon — single action cluster (no duplicate open/copy from tabstrip). */
export default function PreviewMetadataStrip({
  name, path, size, modified, kindLabel, isDirectory, facts, onReveal,
}: Props) {
  const shownFacts = (facts || []).filter(f => f.value).slice(0, 6);

  return (
    <div className="bndz-preview-metadata-strip shrink-0 border-b border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2">
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#f3f4f6] truncate" title={name}>{name}</div>
          {path && (
            <div className="text-[10px] text-[#9ca3af] truncate font-mono mt-0.5" title={formatUiPath(path)}>
              {formatUiPath(path)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-[#b0b8c0]">
            {kindLabel && <span className="bndz-preview-kind-pill">{kindLabel}</span>}
            {!isDirectory && size != null && <span>{formatSize(size)}</span>}
            <span>{formatModified(modified)}</span>
          </div>
          {shownFacts.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-[#9aa3ad]">
              {shownFacts.map(f => (
                <span key={`${f.label}:${f.value}`} className="min-w-0 max-w-full truncate" title={`${f.label}: ${f.value}`}>
                  <span className="text-[#6b7280]">{f.label}</span>
                  {' '}
                  <span className="text-[#d1d5db]">{f.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {onReveal && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" className="bndz-preview-action-btn" onClick={onReveal} title="Show in folder">
              <Icons8Icon id={isDirectory ? 'folder_open_ui' : 'explorer'} size={18} className="bndz-preview-action-icon" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const CURATED_FACT_KEYS: Array<{ key: string; label: string }> = [
  { key: 'Camera Model', label: 'Camera' },
  { key: 'ISO Speed', label: 'ISO' },
  { key: 'F-Stop', label: 'ƒ' },
  { key: 'Focal Length', label: 'Focal' },
  { key: 'Duration', label: 'Duration' },
  { key: 'Dimensions', label: 'Size' },
  { key: 'Artists', label: 'Artist' },
  { key: 'Artist', label: 'Artist' },
  { key: 'Album', label: 'Album' },
  { key: 'Date Taken', label: 'Taken' },
  { key: 'GPS', label: 'GPS' },
  { key: 'Vertices', label: 'Verts' },
  { key: 'Triangles', label: 'Tris' },
  { key: 'Drawable kind', label: 'RAGE' },
  { key: 'Preview format', label: 'Format' },
];

/** Pick up to 6 curated facts from extended metadata. */
export function curatedPreviewFacts(meta: Record<string, string> | null | undefined): PreviewMetaFact[] {
  if (!meta) return [];
  const out: PreviewMetaFact[] = [];
  const seen = new Set<string>();
  for (const { key, label } of CURATED_FACT_KEYS) {
    const value = meta[key];
    if (!value || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, value });
    if (out.length >= 6) break;
  }
  return out;
}
