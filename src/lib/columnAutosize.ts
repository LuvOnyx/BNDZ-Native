import type { ListColumnDef, ListColumnId } from './listColumns';
import { formatAttributesLabel, formatFsDateTime } from './listColumns';

const MEASURE_FONT = '11px "Segoe UI", system-ui, sans-serif';
let measureCanvas: HTMLCanvasElement | null = null;

function measureTextWidth(text: string): number {
  if (typeof document === 'undefined') return text.length * 7;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = MEASURE_FONT;
  return ctx.measureText(text).width;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function cellText(colId: ListColumnId, item: Record<string, unknown>): string {
  switch (colId) {
    case 'name':
      return String(item.label || item.name || '');
    case 'type':
      return item.type === 'directory' ? 'Folder' : String(item.extension || item.type || '');
    case 'size':
      return item.type === 'directory' ? '' : formatBytes(Number(item.size) || 0);
    case 'modified':
      return formatFsDateTime(String(item.modified || item.modifiedAt || ''));
    case 'created':
      return formatFsDateTime(String(item.created || item.createdAt || ''));
    case 'attributes':
      return formatAttributesLabel(Array.isArray(item.attributes) ? item.attributes as string[] : undefined);
    case 'tags':
      return Array.isArray(item.tags) ? (item.tags as string[]).join(', ') : '';
    case 'label':
      return String(item.labelCaption || item.label || '');
    case 'comment':
      return String(item.comment || '');
    case 'path':
      return String(item.path || item.id || '');
    default:
      return '';
  }
}

export function computeAutosizedColumnWidths(
  items: Array<Record<string, unknown>>,
  columns: ListColumnDef[],
  options?: {
    disregardHeaders?: boolean;
    alwaysAutosizeSize?: boolean;
  },
): Partial<Record<ListColumnId, number>> {
  const widths: Partial<Record<ListColumnId, number>> = {};
  const pad = 18;
  const minW = 56;
  const maxW = 520;

  for (const col of columns) {
    if (col.id === 'size' && !options?.alwaysAutosizeSize && items.every(it => it.type === 'directory')) {
      continue;
    }
    let max = options?.disregardHeaders ? 0 : measureTextWidth(col.label) + pad;
    for (const item of items) {
      const text = cellText(col.id, item);
      if (!text) continue;
      max = Math.max(max, measureTextWidth(text) + pad);
    }
    if (max > 0) {
      widths[col.id] = Math.round(Math.max(minW, Math.min(maxW, max)));
    }
  }

  return widths;
}
