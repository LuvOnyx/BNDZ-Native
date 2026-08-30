import React from 'react';
import { entityHasTag } from '../../lib/tagUtils';
import { isArchiveExt } from '../../lib/archiveTypes';
import { isImageExt, isModelExt, isVideoExt } from '../../lib/mediaTypes';

export type ListKindFilter = 'all' | 'folders' | 'images' | 'videos' | 'documents' | 'models' | 'archives' | 'large';

const LARGE_BYTES = 50 * 1024 * 1024;
const DOC_EXT = /\.(docx?|pdf|txt|rtf|odt|xlsx?|pptx?|csv|md)$/i;

const CHIPS: Array<{ id: ListKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'folders', label: 'Folders' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'models', label: '3D' },
  { id: 'archives', label: 'Archives' },
  { id: 'documents', label: 'Docs' },
  { id: 'large', label: 'Large' },
];

type Props = {
  value: ListKindFilter;
  onChange: (v: ListKindFilter) => void;
  /** Right-click empty chrome → folder background menu (New / Paste / shell). */
  onFolderContextMenu?: (e: React.MouseEvent) => void;
};

/** Secondary kind filters — soft squircle chips with per-kind accent colors. */
export default function ListFilterChips({ value, onChange, onFolderContextMenu }: Props) {
  return (
    <div
      className="bndz-list-filter-bar flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.06] bg-black/20 shrink-0 flex-wrap"
      title="Right-click for folder menu (New, Paste, Windows shell)"
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (!onFolderContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onFolderContextMenu(e);
      }}
    >
      <div className="flex items-center gap-1 mr-1">
        {CHIPS.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            data-kind={c.id}
            className={`bndz-list-filter-chip ${value === c.id ? 'bndz-list-filter-chip--active' : ''}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-[22px] min-w-[48px]" aria-hidden />
    </div>
  );
}

export function matchesListKindFilter(item: { type?: string; name?: string; size?: number; extension?: string }, filter: ListKindFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'folders') return item.type === 'directory';
  const ext = (item.extension || item.name?.match(/\.([^.]+)$/)?.[1] || '').toLowerCase().replace(/^\./, '');
  if (filter === 'images') return item.type !== 'directory' && isImageExt(ext);
  if (filter === 'videos') return item.type !== 'directory' && isVideoExt(ext);
  if (filter === 'models') return item.type !== 'directory' && isModelExt(ext);
  if (filter === 'archives') return item.type !== 'directory' && isArchiveExt(ext);
  if (filter === 'documents') return item.type !== 'directory' && DOC_EXT.test(item.name || '');
  if (filter === 'large') return (item.size || 0) >= LARGE_BYTES;
  return true;
}

export function matchesTagFilter(item: { tags?: string[] }, tagId: string | null): boolean {
  if (!tagId) return true;
  return entityHasTag(item.tags, tagId);
}
