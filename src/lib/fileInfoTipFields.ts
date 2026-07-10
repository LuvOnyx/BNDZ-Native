/** Shell file-info tip field catalogs (standard + extra metadata). */

export type FileInfoTipField = {
  id: string;
  label: string;
  metadataKey: string;
  group: 'standard' | 'extra';
};

export const STANDARD_FILE_INFO_FIELDS: FileInfoTipField[] = [
  { id: 'size', label: 'Size', metadataKey: '__size__', group: 'standard' },
  { id: 'type', label: 'Type', metadataKey: '__type__', group: 'standard' },
  { id: 'modified', label: 'Modified', metadataKey: '__modified__', group: 'standard' },
  { id: 'created', label: 'Created', metadataKey: '__created__', group: 'standard' },
  { id: 'path', label: 'Path', metadataKey: '__path__', group: 'standard' },
  { id: 'tags', label: 'Tags', metadataKey: '__tags__', group: 'standard' },
  { id: 'owner', label: 'Owner', metadataKey: 'Owner', group: 'standard' },
  { id: 'acl', label: 'ACL', metadataKey: 'ACL Rule', group: 'standard' },
  { id: 'dimensions', label: 'Dimensions', metadataKey: 'Dimensions', group: 'standard' },
  { id: 'duration', label: 'Duration', metadataKey: 'Duration', group: 'standard' },
];

export const EXTRA_FILE_INFO_FIELDS: FileInfoTipField[] = [
  { id: 'date_taken', label: 'Date Taken', metadataKey: 'Date Taken', group: 'extra' },
  { id: 'camera', label: 'Camera Model', metadataKey: 'Camera Model', group: 'extra' },
  { id: 'f_stop', label: 'F-Stop', metadataKey: 'F-Stop', group: 'extra' },
  { id: 'exposure', label: 'Exposure Time', metadataKey: 'Exposure Time', group: 'extra' },
  { id: 'focal', label: 'Focal Length', metadataKey: 'Focal Length', group: 'extra' },
  { id: 'iso', label: 'ISO Speed', metadataKey: 'ISO Speed', group: 'extra' },
  { id: 'bitrate', label: 'Audio Bitrate', metadataKey: 'Audio Bitrate', group: 'extra' },
  { id: 'sample_rate', label: 'Sample Rate', metadataKey: 'Sample Rate', group: 'extra' },
  { id: 'bit_depth', label: 'Bit Depth', metadataKey: 'Bit Depth', group: 'extra' },
  { id: 'channels', label: 'Channels', metadataKey: 'Channels', group: 'extra' },
  { id: 'authors', label: 'Authors', metadataKey: 'Authors', group: 'extra' },
  { id: 'version', label: 'File Version', metadataKey: 'File Version', group: 'extra' },
  { id: 'aspect', label: 'Aspect Ratio', metadataKey: 'Aspect Ratio', group: 'extra' },
];

export const DEFAULT_STANDARD_FIELD_IDS = ['size', 'modified', 'type', 'path'];
export const DEFAULT_EXTRA_FIELD_IDS: string[] = [];

export function resolveSelectedFieldIds(
  stored: string[] | undefined,
  defaults: string[],
  catalog: FileInfoTipField[],
): string[] {
  const known = new Set(catalog.map(f => f.id));
  const picked = (stored && stored.length ? stored : defaults).filter(id => known.has(id));
  return picked.length ? picked : defaults.filter(id => known.has(id));
}

export function fieldById(id: string): FileInfoTipField | undefined {
  return [...STANDARD_FILE_INFO_FIELDS, ...EXTRA_FILE_INFO_FIELDS].find(f => f.id === id);
}
