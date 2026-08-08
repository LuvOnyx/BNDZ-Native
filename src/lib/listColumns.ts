import type React from 'react';
import type { AppConfig } from '../data/configContext';
import { customColumnListId, resolveCustomColumns } from './customColumns';
import { isRecycleBinPath } from './pathUtils';

export type BuiltinListColumnId =
  | 'name' | 'type' | 'size' | 'modified' | 'created' | 'attributes' | 'tags' | 'label' | 'comment' | 'path'
  | 'originalLocation' | 'originalPath'
  | 'ghostState' | 'coldTarget' | 'ramZone';
export type ListColumnId = BuiltinListColumnId | `custom:${string}`;
export type SortColumnId = 'name' | 'type' | 'size' | 'modified' | 'created' | 'tags' | 'ghostState' | 'ramZone';

export interface ListColumnDef {
  id: ListColumnId;
  label: string;
  widthClass: string;
  widthPx?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
  /** When true, this column takes all remaining space (flex-fill); widthPx becomes min-width. */
  flexFill?: boolean;
}

export const LIST_COLUMN_DEFS: ListColumnDef[] = [
  // Fixed pixel widths so column resize actually sticks (flex-fill fought live resize).
  { id: 'name', label: 'Name', widthClass: 'shrink-0', widthPx: 280, sortable: true },
  { id: 'type', label: 'Type', widthClass: 'shrink-0', widthPx: 100, sortable: true },
  { id: 'size', label: 'Size', widthClass: 'shrink-0', widthPx: 90, align: 'right', sortable: true },
  { id: 'modified', label: 'Modified', widthClass: 'shrink-0', widthPx: 150, sortable: true },
  { id: 'created', label: 'Created', widthClass: 'shrink-0', widthPx: 150, sortable: true },
  { id: 'attributes', label: 'Attributes', widthClass: 'shrink-0', widthPx: 100 },
  { id: 'tags', label: 'Tags', widthClass: 'shrink-0', widthPx: 120, sortable: true },
  { id: 'label', label: 'Label', widthClass: 'shrink-0', widthPx: 120 },
  { id: 'comment', label: 'Comment', widthClass: 'shrink-0', widthPx: 160 },
  { id: 'path', label: 'Path', widthClass: 'shrink-0', widthPx: 240 },
  { id: 'originalLocation', label: 'Original location', widthClass: 'shrink-0', widthPx: 220 },
  { id: 'originalPath', label: 'Original path', widthClass: 'shrink-0', widthPx: 280 },
  { id: 'ghostState', label: 'Ghost', widthClass: 'shrink-0', widthPx: 90, sortable: true },
  { id: 'coldTarget', label: 'Cold target', widthClass: 'shrink-0', widthPx: 180 },
  { id: 'ramZone', label: 'RAM zone', widthClass: 'shrink-0', widthPx: 120, sortable: true },
];

export const DEFAULT_LIST_COLUMN_PX: Record<BuiltinListColumnId, number> = {
  name: 280,
  type: 100,
  size: 90,
  modified: 150,
  created: 150,
  attributes: 100,
  tags: 120,
  label: 120,
  comment: 160,
  path: 240,
  originalLocation: 220,
  originalPath: 280,
  ghostState: 90,
  coldTarget: 180,
  ramZone: 120,
};

export const DEFAULT_LIST_COLUMN_VISIBILITY: Record<ListColumnId, boolean> = {
  name: true,
  type: true,
  size: true,
  modified: true,
  created: false,
  attributes: false,
  tags: true,
  label: false,
  comment: false,
  path: false,
  originalLocation: false,
  originalPath: false,
  ghostState: false,
  coldTarget: false,
  ramZone: false,
};

export function resolveListColumnVisibility(
  config: AppConfig,
  options?: { isGlobalSearch?: boolean; folderPath?: string },
): Record<ListColumnId, boolean> {
  const stored = (config.listColumnVisibility || {}) as Partial<Record<ListColumnId, boolean>>;
  const merged = { ...DEFAULT_LIST_COLUMN_VISIBILITY, ...stored };
  merged.name = true;
  // Search results normally force a Path column; inherit current columns keeps the folder layout.
  if (options?.isGlobalSearch && !config.searchResultsInheritCurrentColumns) merged.path = true;
  // Recycle Bin: surface original location/path (and path) even when hidden by default.
  if (isRecycleBinPath(options?.folderPath)) {
    merged.originalLocation = true;
    merged.originalPath = true;
    merged.path = true;
  }
  return merged;
}

const DEFAULT_COLUMN_ORDER: ListColumnId[] = LIST_COLUMN_DEFS.map(c => c.id);

/** Resolve the user's saved column order, appending any columns missing from a stale/partial order. */
export function resolveListColumnOrder(config: AppConfig): ListColumnId[] {
  const saved = (config.listColumnOrder || []) as ListColumnId[];
  const known = new Set(DEFAULT_COLUMN_ORDER);
  const ordered = saved.filter(id => known.has(id));
  for (const id of DEFAULT_COLUMN_ORDER) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** Move `sourceId` to sit immediately before/after `targetId` in the column order — used by header drag-to-reorder. */
export function reorderListColumns(
  currentOrder: ListColumnId[],
  sourceId: ListColumnId,
  targetId: ListColumnId,
  insertAfter = false,
): ListColumnId[] {
  if (sourceId === targetId) return currentOrder;
  const next = currentOrder.filter(id => id !== sourceId);
  const targetIdx = next.indexOf(targetId);
  if (targetIdx === -1) return currentOrder;
  next.splice(insertAfter ? targetIdx + 1 : targetIdx, 0, sourceId);
  return next;
}

export function getVisibleListColumns(
  config: AppConfig,
  options?: { isGlobalSearch?: boolean; folderPath?: string },
): ListColumnDef[] {
  const vis = resolveListColumnVisibility(config, {
    isGlobalSearch: options?.isGlobalSearch,
    folderPath: options?.folderPath,
  });
  const globalWidths = (config.listColumnWidths || {}) as Partial<Record<string, number>>;
  const byPath = ((config as any).listColumnWidthsByPath || {}) as Record<string, Partial<Record<string, number>>>;
  const folderKey = (options?.folderPath || '').replace(/\\/g, '/');
  const folderWidths = folderKey ? (byPath[folderKey] || byPath[`/${folderKey}`.replace(/\/+/g, '/')] || {}) : {};
  const widths = { ...globalWidths, ...folderWidths } as Partial<Record<string, number>>;
  const order = resolveListColumnOrder(config);
  const byId = new Map(LIST_COLUMN_DEFS.map(c => [c.id, c]));
  const builtin = order
    .map(id => byId.get(id as BuiltinListColumnId))
    .filter((col): col is ListColumnDef => !!col && vis[col.id as BuiltinListColumnId])
    .map(col => {
      const saved = widths[col.id];
      const fallback = col.widthPx || DEFAULT_LIST_COLUMN_PX[col.id as BuiltinListColumnId] || 100;
      const px = saved && saved >= 48 ? saved : fallback;
      return { ...col, widthClass: 'shrink-0', widthPx: px };
    });

  const customCols = resolveCustomColumns(config)
    .filter(c => c.enabled)
    .map(c => {
      const id = customColumnListId(c.id) as ListColumnId;
      const px = c.widthPx || widths[id] || 120;
      return {
        id,
        label: c.label,
        widthClass: '',
        widthPx: px,
        align: 'left' as const,
        sortable: false,
      } satisfies ListColumnDef;
    });

  return [...builtin, ...customCols];
}

export function getColumnStyle(col: ListColumnDef): React.CSSProperties {
  const px = col.widthPx
    || (DEFAULT_LIST_COLUMN_PX[col.id as BuiltinListColumnId] ?? 100);
  // Fixed widths only — flex-fill on Name made live resize snap back after persist.
  return {
    width: px,
    minWidth: px,
    maxWidth: px,
    flexShrink: 0,
    flexGrow: 0,
    flexBasis: px,
  };
}

export function formatAttributesLabel(attrs?: string[]): string {
  if (!attrs?.length) return '';
  const short: Record<string, string> = {
    readonly: 'R',
    hidden: 'H',
    system: 'S',
    archive: 'A',
    compressed: 'C',
    encrypted: 'E',
    offline: 'O',
    temporary: 'T',
  };
  return attrs.map(a => short[a.toLowerCase()] || a.slice(0, 1).toUpperCase()).join('');
}

export function formatFsDateTime(value?: string | number): string {
  if (value == null || value === '') return '';
  let d: Date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
