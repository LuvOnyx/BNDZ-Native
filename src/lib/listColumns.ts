import type { AppConfig } from '../data/configContext';
import { customColumnListId, resolveCustomColumns } from './customColumns';

export type BuiltinListColumnId = 'name' | 'type' | 'size' | 'modified' | 'created' | 'attributes' | 'tags' | 'label' | 'comment' | 'path';
export type ListColumnId = BuiltinListColumnId | `custom:${string}`;
export type SortColumnId = 'name' | 'type' | 'size' | 'modified' | 'created' | 'tags';

export interface ListColumnDef {
  id: ListColumnId;
  label: string;
  widthClass: string;
  widthPx?: number;
  align?: 'left' | 'right';
  sortable?: boolean;
}

export const LIST_COLUMN_DEFS: ListColumnDef[] = [
  { id: 'name', label: 'Name', widthClass: 'w-[35%] min-w-[140px] max-w-[360px]', sortable: true },
  { id: 'type', label: 'Type', widthClass: 'w-[14%] min-w-[80px] max-w-[140px]', sortable: true },
  { id: 'size', label: 'Size', widthClass: 'w-[12%] min-w-[72px] max-w-[110px]', align: 'right', sortable: true },
  { id: 'modified', label: 'Modified', widthClass: 'w-[18%] min-w-[120px] max-w-[180px]', sortable: true },
  { id: 'created', label: 'Created', widthClass: 'w-[18%] min-w-[120px] max-w-[180px]', sortable: true },
  { id: 'attributes', label: 'Attributes', widthClass: 'w-[12%] min-w-[90px] max-w-[140px]' },
  { id: 'tags', label: 'Tags', widthClass: 'min-w-[80px] max-w-[160px]', sortable: true },
  { id: 'label', label: 'Label', widthClass: 'w-[14%] min-w-[90px] max-w-[180px]' },
  { id: 'comment', label: 'Comment', widthClass: 'flex-1 min-w-[100px]' },
  { id: 'path', label: 'Path', widthClass: 'w-[30%] min-w-[160px] max-w-[400px]' },
];

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
};

export function resolveListColumnVisibility(
  config: AppConfig,
  options?: { isGlobalSearch?: boolean },
): Record<ListColumnId, boolean> {
  const stored = (config.listColumnVisibility || {}) as Partial<Record<ListColumnId, boolean>>;
  const merged = { ...DEFAULT_LIST_COLUMN_VISIBILITY, ...stored };
  merged.name = true;
  if (options?.isGlobalSearch) merged.path = true;
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
  const vis = resolveListColumnVisibility(config, options);
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
      const px = widths[col.id];
      if (!px || px < 48) return col;
      return { ...col, widthClass: '', widthPx: px };
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

export function getColumnStyle(col: ListColumnDef): { width: number; minWidth: number; maxWidth: number; flexShrink: 0 } | undefined {
  if (!col.widthPx) return undefined;
  return { width: col.widthPx, minWidth: col.widthPx, maxWidth: col.widthPx, flexShrink: 0 };
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

export function formatFsDateTime(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
