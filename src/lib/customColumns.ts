/** XYplorer-style custom / special-property columns for the details list. */

export type CustomColumnDef = {
  id: string;
  label: string;
  /** Metadata key from GET_EXTENDED_METADATA (or `md5` for lazy hash). */
  propertyKey: string;
  /** Semicolon-separated patterns: *.png, {Photo}, {Media}, *.* */
  pattern: string;
  enabled: boolean;
  widthPx?: number;
};

const PHOTO_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'cur', 'tif', 'tiff', 'heic', 'heif', 'raw', 'cr2', 'nef', 'arw', 'dng']);
const MEDIA_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv']);

/** Metadata columns — hidden until user enables them in Choose Columns. */
export const DEFAULT_CUSTOM_COLUMNS: CustomColumnDef[] = [
  { id: 'dimensions', label: 'Dimensions', propertyKey: 'Dimensions', pattern: 'png;gif;bmp;webp;ico;cur;{Photo};ink', enabled: false, widthPx: 110 },
  { id: 'aspect_ratio', label: 'Aspect Ratio', propertyKey: 'Aspect Ratio', pattern: 'png;gif;bmp;webp;ico;cur;{Photo};ink', enabled: false, widthPx: 90 },
  { id: 'date_taken', label: 'Date Taken', propertyKey: 'Date Taken', pattern: '{Photo}', enabled: false, widthPx: 140 },
  { id: 'camera_model', label: 'Camera Model', propertyKey: 'Camera Model', pattern: '{Photo}', enabled: false, widthPx: 140 },
  { id: 'f_stop', label: 'F-Stop', propertyKey: 'F-Stop', pattern: '{Photo}', enabled: false, widthPx: 72 },
  { id: 'exposure_time', label: 'Exposure Time', propertyKey: 'Exposure Time', pattern: '{Photo}', enabled: false, widthPx: 100 },
  { id: 'length', label: 'Length', propertyKey: 'Duration', pattern: '{Media}', enabled: false, widthPx: 90 },
  { id: 'sample_rate', label: 'Sample Rate', propertyKey: 'Sample Rate', pattern: '{Media}', enabled: false, widthPx: 100 },
  { id: 'bit_depth', label: 'Bit Depth', propertyKey: 'Bit Depth', pattern: '{Media}', enabled: false, widthPx: 80 },
  { id: 'bit_rate', label: 'Bit Rate', propertyKey: 'Audio Bitrate', pattern: '{Media}', enabled: false, widthPx: 90 },
  { id: 'channels', label: 'Channels', propertyKey: 'Channels', pattern: '{Media}', enabled: false, widthPx: 80 },
  { id: 'focal_length', label: 'Focal Length', propertyKey: 'Focal Length', pattern: '{Photo}', enabled: false, widthPx: 100 },
  { id: 'iso_speed', label: 'ISO Speed', propertyKey: 'ISO Speed', pattern: '{Photo}', enabled: false, widthPx: 80 },
  { id: 'version', label: 'Version', propertyKey: 'File Version', pattern: 'exe;dll', enabled: false, widthPx: 100 },
  { id: 'md5', label: 'MD5', propertyKey: 'md5', pattern: '*.*', enabled: false, widthPx: 220 },
];

export function resolveCustomColumns(config?: { customColumns?: CustomColumnDef[] } | null): CustomColumnDef[] {
  const saved = config?.customColumns;
  if (!Array.isArray(saved) || saved.length === 0) return DEFAULT_CUSTOM_COLUMNS.map(c => ({ ...c }));
  const byId = new Map(saved.map(c => [c.id, c]));
  const merged = DEFAULT_CUSTOM_COLUMNS.map(def => ({ ...def, ...byId.get(def.id) }));
  for (const row of saved) {
    if (!merged.some(m => m.id === row.id)) merged.push({ ...row });
  }
  return merged;
}

export function setCustomColumnEnabled(
  config: { customColumns?: CustomColumnDef[] } | null | undefined,
  columnId: string,
  enabled: boolean,
): CustomColumnDef[] {
  return resolveCustomColumns(config).map(c => (c.id === columnId ? { ...c, enabled } : c));
}

export function customColumnListId(id: string): string {
  return `custom:${id}`;
}

export function parseCustomColumnListId(colId: string): string | null {
  return colId.startsWith('custom:') ? colId.slice(7) : null;
}

function isPhotoEntity(ext: string): boolean {
  return PHOTO_EXTS.has(ext);
}

function isMediaEntity(ext: string): boolean {
  return MEDIA_EXTS.has(ext) || PHOTO_EXTS.has(ext);
}

export function matchesColumnPattern(pattern: string, entity: { extension?: string; type?: string }): boolean {
  if (!pattern || pattern === '*.*' || pattern === '*') return entity.type !== 'directory';
  const ext = String(entity.extension || '').toLowerCase();
  const tokens = pattern.split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
  for (const token of tokens) {
    if (token === '{photo}' && isPhotoEntity(ext)) return true;
    if (token === '{media}' && isMediaEntity(ext)) return true;
    if (token.startsWith('*.') && ext === token.slice(2)) return true;
    if (!token.startsWith('{') && !token.startsWith('*') && ext === token) return true;
  }
  return false;
}

export function pickCustomColumnForEntity(
  columns: CustomColumnDef[],
  entity: { extension?: string; type?: string },
): CustomColumnDef | null {
  for (const col of columns) {
    if (!col.enabled) continue;
    if (matchesColumnPattern(col.pattern, entity)) return col;
  }
  return null;
}

export function createCustomColumnRow(existing: CustomColumnDef[]): CustomColumnDef {
  const n = existing.length + 1;
  return {
    id: `user_${Date.now()}`,
    label: `Custom ${n}`,
    propertyKey: 'Dimensions',
    pattern: '*.*',
    enabled: false,
    widthPx: 120,
  };
}

export function moveCustomColumnRow(rows: CustomColumnDef[], index: number, direction: -1 | 1): CustomColumnDef[] {
  const next = [...rows];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

export const CUSTOM_COLUMN_PROPERTY_OPTIONS = [
  'Dimensions', 'Aspect Ratio', 'Date Taken', 'Camera Model', 'F-Stop', 'Exposure Time',
  'Focal Length', 'ISO Speed', 'Duration', 'Sample Rate', 'Bit Depth', 'Audio Bitrate',
  'Channels', 'File Version', 'Authors', 'Owner', 'ACL Rule', 'md5',
] as const;
