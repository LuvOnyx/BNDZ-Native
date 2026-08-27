/** Hover box item-type and context filters. */

export type HoverBoxItemType =
  | 'files'
  | 'folders'
  | 'images'
  | 'videos'
  | 'audio'
  | 'archives'
  | 'models'
  | 'executables'
  | 'documents';

export type HoverBoxContext = 'list' | 'tree' | 'preview' | 'search';

export const HOVER_BOX_ITEM_TYPES: Array<{ id: HoverBoxItemType; label: string }> = [
  { id: 'files', label: 'Files' },
  { id: 'folders', label: 'Folders' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'archives', label: 'Archives' },
  { id: 'models', label: '3D / RAGE' },
  { id: 'executables', label: 'Executables' },
  { id: 'documents', label: 'Documents' },
];

export const HOVER_BOX_CONTEXTS: Array<{ id: HoverBoxContext; label: string }> = [
  { id: 'list', label: 'File list' },
  { id: 'tree', label: 'Folder tree' },
  { id: 'preview', label: 'Preview panel' },
  { id: 'search', label: 'Search results' },
];

export const DEFAULT_HOVER_BOX_ITEM_TYPES: HoverBoxItemType[] = HOVER_BOX_ITEM_TYPES.map(t => t.id);
export const DEFAULT_HOVER_BOX_CONTEXTS: HoverBoxContext[] = ['list', 'tree'];

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic', 'heif']);
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v', 'wmv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'rpf', 'iso', 'cab']);
const MODEL_EXTS = new Set(['glb', 'gltf', 'obj', 'stl', 'fbx', 'dae', 'ply', 'ydr', 'yft', 'ydd', 'ybn']);
const DOC_EXTS = new Set(['txt', 'md', 'doc', 'docx', 'pdf', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx']);

export function entityHoverBoxTypes(entity: { type?: string; extension?: string }): HoverBoxItemType[] {
  const types: HoverBoxItemType[] = [];
  const isDir = entity.type === 'directory';
  const ext = String(entity.extension || '').toLowerCase().replace(/^\./, '');
  if (isDir) types.push('folders');
  else types.push('files');
  if (IMAGE_EXTS.has(ext)) types.push('images');
  if (VIDEO_EXTS.has(ext)) types.push('videos');
  if (AUDIO_EXTS.has(ext)) types.push('audio');
  if (ARCHIVE_EXTS.has(ext)) types.push('archives');
  if (MODEL_EXTS.has(ext)) types.push('models');
  if (ext === 'exe' || ext === 'msi' || ext === 'bat' || ext === 'cmd' || ext === 'lnk') types.push('executables');
  if (DOC_EXTS.has(ext)) types.push('documents');
  return types;
}

export function hoverBoxAllowsEntity(
  entity: { type?: string; extension?: string },
  allowedTypes: HoverBoxItemType[] | undefined,
): boolean {
  const allowed = allowedTypes?.length ? allowedTypes : DEFAULT_HOVER_BOX_ITEM_TYPES;
  const entityTypes = entityHoverBoxTypes(entity);
  return entityTypes.some(t => allowed.includes(t));
}

export function hoverBoxAllowsContext(
  context: HoverBoxContext,
  allowedContexts: HoverBoxContext[] | undefined,
): boolean {
  const allowed = allowedContexts?.length ? allowedContexts : DEFAULT_HOVER_BOX_CONTEXTS;
  return allowed.includes(context);
}

export function togglePickerSelection<T extends string>(current: T[], id: T, checked: boolean): T[] {
  const set = new Set(current);
  if (checked) set.add(id);
  else set.delete(id);
  return [...set];
}
