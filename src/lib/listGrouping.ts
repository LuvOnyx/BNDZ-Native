/** File Pilot / Finder-style list grouping for details view. */

import { isSemanticDeskActive, semanticClusterLabelForEntity } from './semanticDeskRuntime';

export type ListGroupBy = 'none' | 'type' | 'date' | 'size' | 'name' | 'semantic';

export type ListGroupHeader = {
  kind: 'group';
  id: string;
  label: string;
  count: number;
};

export type ListRowItem = Record<string, unknown> | ListGroupHeader;

export function isGroupHeaderRow(row: ListRowItem): row is ListGroupHeader {
  return !!row && (row as ListGroupHeader).kind === 'group';
}

function extensionGroup(entity: Record<string, unknown>): string {
  if (entity.type === 'directory') return 'Folders';
  let ext = String(entity.extension || '').toLowerCase().replace(/^\./, '');
  if (!ext) {
    const name = String(entity.name || '');
    const dot = name.lastIndexOf('.');
    if (dot > 0 && dot < name.length - 1) ext = name.slice(dot + 1).toLowerCase();
  }
  if (!ext) return 'No extension';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff'].includes(ext)) return 'Images';
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)) return 'Video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'Audio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archives';
  if (['doc', 'docx', 'pdf', 'txt', 'md', 'rtf', 'odt'].includes(ext)) return 'Documents';
  if (['exe', 'msi', 'dll', 'bat', 'cmd', 'ps1'].includes(ext)) return 'Programs';
  return ext.toUpperCase();
}

function dateGroup(entity: Record<string, unknown>): string {
  const raw = entity.modified || entity.created;
  const t = raw ? new Date(String(raw)).getTime() : 0;
  if (!t || Number.isNaN(t)) return 'Unknown date';
  const now = Date.now();
  const day = 86400000;
  const diff = now - t;
  if (diff < day) return 'Today';
  if (diff < day * 7) return 'This week';
  if (diff < day * 31) return 'This month';
  if (diff < day * 365) return 'This year';
  return 'Older';
}

function sizeGroup(entity: Record<string, unknown>): string {
  if (entity.type === 'directory') return 'Folders';
  const n = Number(entity.size) || 0;
  if (n === 0) return 'Empty';
  if (n < 1024 * 1024) return 'Small (< 1 MB)';
  if (n < 50 * 1024 * 1024) return 'Medium (1–50 MB)';
  if (n < 1024 * 1024 * 1024) return 'Large (50 MB – 1 GB)';
  return 'Very large (> 1 GB)';
}

function nameGroup(entity: Record<string, unknown>): string {
  const name = String(entity.name || '?');
  const ch = name.charAt(0).toUpperCase();
  if (/[A-Z]/.test(ch)) return ch;
  if (/[0-9]/.test(ch)) return '0–9';
  return '#';
}

function groupKey(entity: Record<string, unknown>, groupBy: ListGroupBy, panePath?: string): string {
  switch (groupBy) {
    case 'type': return extensionGroup(entity);
    case 'date': return dateGroup(entity);
    case 'size': return sizeGroup(entity);
    case 'name': return nameGroup(entity);
    case 'semantic': return panePath ? semanticClusterLabelForEntity(entity, panePath) : 'Unclustered';
    default: return '';
  }
}

const GROUP_ORDER: Record<ListGroupBy, string[] | null> = {
  none: null,
  type: ['Folders', 'Images', 'Video', 'Audio', 'Documents', 'Archives', 'Programs'],
  date: ['Today', 'This week', 'This month', 'This year', 'Older', 'Unknown date'],
  size: ['Folders', 'Empty', 'Small (< 1 MB)', 'Medium (1–50 MB)', 'Large (50 MB – 1 GB)', 'Very large (> 1 GB)'],
  name: ['#', '0–9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')],
};

function sortGroupKeys(keys: string[], groupBy: ListGroupBy): string[] {
  const order = GROUP_ORDER[groupBy];
  if (!order) return keys.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i >= 0 ? i : order.length + 1;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Flatten sorted entities into rows with sticky group headers. */
export function flattenGroupedList(
  items: Record<string, unknown>[],
  groupBy: ListGroupBy,
  panePath?: string,
): ListRowItem[] {
  if (groupBy === 'none' || !items.length) return items;
  if (groupBy === 'semantic' && !isSemanticDeskActive()) return items;

  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = groupKey(item, groupBy, panePath);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const result: ListRowItem[] = [];
  for (const key of sortGroupKeys([...buckets.keys()], groupBy)) {
    const groupItems = buckets.get(key)!;
    result.push({
      kind: 'group',
      id: `group-${groupBy}-${key}`,
      label: key,
      count: groupItems.length,
    });
    result.push(...groupItems);
  }
  return result;
}

export const LIST_GROUP_BY_OPTIONS: { value: ListGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'type', label: 'Type' },
  { value: 'date', label: 'Date modified' },
  { value: 'size', label: 'Size' },
  { value: 'name', label: 'Name' },
  { value: 'semantic', label: 'Semantic Desk' },
];

/** Active sticky group for a scroll position (uniform row height virtualizer). */
export function resolveStickyGroupHeader(
  rows: ListRowItem[] | null | undefined,
  scrollTop: number,
  rowHeight: number,
): { header: ListGroupHeader; index: number } | null {
  if (!rows?.length || rowHeight <= 0) return null;
  let active: { header: ListGroupHeader; index: number } | null = null;
  const top = Math.max(0, scrollTop);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isGroupHeaderRow(row)) continue;
    if (i * rowHeight <= top + 0.5) {
      active = { header: row, index: i };
    } else {
      break;
    }
  }
  return active;
}
