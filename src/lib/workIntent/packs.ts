/** Work Intent packs — chrome compiler (no omnibar strip). */

export type WorkIntentId =
  | 'browse'
  | 'ingest'
  | 'archive'
  | 'produce'
  | 'clean';

export type ConfirmStrictness = 'relaxed' | 'normal' | 'strict';

export type PreviewModeHint = 'auto' | 'media' | 'metadata' | 'lineage';

export interface WorkIntentPack {
  id: WorkIntentId;
  label: string;
  description: string;
  /** Column visibility overlay (name always forced on). */
  columns: Partial<Record<string, boolean>>;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  /** Bottom plugin ids to prefer / open first. */
  preferredPlugins: string[];
  previewMode: PreviewModeHint;
  confirmStrictness: ConfirmStrictness;
  /** Optional Automation graph id seed. */
  defaultAutomationGraphId?: string;
}

export const WORK_INTENT_PACKS: Record<WorkIntentId, WorkIntentPack> = {
  browse: {
    id: 'browse',
    label: 'Browse',
    description: 'General navigation — name, size, modified, tags.',
    columns: {
      name: true, type: true, size: true, modified: true, tags: true,
      created: false, attributes: false, label: false, comment: false, path: false,
      ghostState: false, coldTarget: false, ramZone: false,
    },
    sortColumn: 'name',
    sortDirection: 'asc',
    preferredPlugins: ['properties', 'metadata'],
    previewMode: 'auto',
    confirmStrictness: 'normal',
  },
  ingest: {
    id: 'ingest',
    label: 'Ingest',
    description: 'Capture arrivals — Inbound, path, recent pressure.',
    columns: {
      name: true, type: true, size: true, modified: true, path: true, tags: true,
      created: true, attributes: false, label: false, comment: false,
      ghostState: false, coldTarget: false, ramZone: false,
    },
    sortColumn: 'modified',
    sortDirection: 'desc',
    preferredPlugins: ['inbound-volume', 'library-health'],
    previewMode: 'metadata',
    confirmStrictness: 'normal',
    defaultAutomationGraphId: 'inbound-capture',
  },
  archive: {
    id: 'archive',
    label: 'Archive',
    description: 'Cold storage mindset — Ghost state, confirm strict.',
    columns: {
      name: true, type: true, size: true, modified: true, ghostState: true, coldTarget: true,
      created: false, attributes: true, tags: false, label: false, comment: false, path: false,
      ramZone: false,
    },
    sortColumn: 'size',
    sortDirection: 'desc',
    preferredPlugins: ['ghost-link', 'capacity-solver', 'storage-cleanup'],
    previewMode: 'lineage',
    confirmStrictness: 'strict',
    defaultAutomationGraphId: 'archive-cold',
  },
  produce: {
    id: 'produce',
    label: 'Produce',
    description: 'Producer desk — media-first columns + RAM staging.',
    columns: {
      name: true, type: true, size: true, modified: true, ramZone: true, tags: true,
      created: false, attributes: false, label: false, comment: false, path: false,
      ghostState: false, coldTarget: false,
    },
    sortColumn: 'modified',
    sortDirection: 'desc',
    preferredPlugins: ['ram-staging', 'metadata', 'transcode-rack'],
    previewMode: 'media',
    confirmStrictness: 'relaxed',
    defaultAutomationGraphId: 'producer-desk',
  },
  clean: {
    id: 'clean',
    label: 'Clean',
    description: 'Capacity + Health — large files, problems, strict deletes.',
    columns: {
      name: true, type: true, size: true, modified: true, path: true, attributes: true,
      created: false, tags: false, label: false, comment: false,
      ghostState: true, coldTarget: false, ramZone: false,
    },
    sortColumn: 'size',
    sortDirection: 'desc',
    preferredPlugins: ['capacity-solver', 'library-health', 'storage-cleanup', 'find'],
    previewMode: 'metadata',
    confirmStrictness: 'strict',
  },
};

export const WORK_INTENT_ORDER: WorkIntentId[] = ['browse', 'ingest', 'archive', 'produce', 'clean'];

export function isWorkIntentId(v: unknown): v is WorkIntentId {
  return typeof v === 'string' && v in WORK_INTENT_PACKS;
}

export function getWorkIntentPack(id: WorkIntentId | string | undefined | null): WorkIntentPack {
  if (id && isWorkIntentId(id)) return WORK_INTENT_PACKS[id];
  return WORK_INTENT_PACKS.browse;
}
