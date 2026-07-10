/** XYplorer-style “Select Items…” visibility categories for tree and list. */

export type TreeListItemType =
  | 'folders'
  | 'files'
  | 'junctions'
  | 'symbolic_links'
  | 'shortcuts'
  | 'desktop_ini'
  | 'dotfiles';

export const TREE_LIST_ITEM_TYPES: Array<{ id: TreeListItemType; label: string; hint?: string }> = [
  { id: 'folders', label: 'Folders' },
  { id: 'files', label: 'Files' },
  { id: 'junctions', label: 'NTFS junctions', hint: 'Reparse-point directories' },
  { id: 'symbolic_links', label: 'Symbolic links', hint: 'Reparse-point files' },
  { id: 'shortcuts', label: 'Shortcuts', hint: '.lnk files' },
  { id: 'desktop_ini', label: 'Desktop.ini' },
  { id: 'dotfiles', label: 'Unix-style dot files', hint: 'Names starting with .' },
];

export const DEFAULT_TREE_LIST_VISIBLE_ITEM_TYPES: TreeListItemType[] = [
  'folders',
  'files',
  'junctions',
  'symbolic_links',
  'shortcuts',
];

type FsEntity = {
  name?: string;
  type?: string;
  extension?: string;
  attributes?: string[];
  linkType?: string;
};

export function classifyTreeListItemTypes(entity: FsEntity): TreeListItemType[] {
  const types: TreeListItemType[] = [];
  const name = String(entity.name || '');
  const lower = name.toLowerCase();
  const ext = String(entity.extension || '').toLowerCase();
  const attrs = entity.attributes || [];
  const isDir = entity.type === 'directory';
  const isReparse = attrs.includes('reparse');

  if (isDir) types.push('folders');
  else types.push('files');

  if (isReparse) {
    if (isDir || entity.linkType === 'junction') types.push('junctions');
    else types.push('symbolic_links');
  }
  if (ext === 'lnk') types.push('shortcuts');
  if (lower === 'desktop.ini') types.push('desktop_ini');
  if (name.startsWith('.') && name !== '..') types.push('dotfiles');

  return types;
}

export function resolveTreeListVisibleTypes(
  config?: { treeListVisibleItemTypes?: TreeListItemType[] } | null,
): TreeListItemType[] {
  const saved = config?.treeListVisibleItemTypes;
  if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_TREE_LIST_VISIBLE_ITEM_TYPES];
  return saved;
}

/** Whether an entity should appear in tree/list. */
export function isTreeListItemVisible(
  entity: FsEntity,
  config: {
    treeListVisibleItemTypes?: TreeListItemType[];
    showHiddenSystemFoldersInTree?: boolean;
  },
): boolean {
  const name = String(entity.name || '');
  const attrs = entity.attributes || [];
  const showHidden = !!config.showHiddenSystemFoldersInTree;

  if (!showHidden) {
    if (attrs.includes('hidden') || attrs.includes('system')) return false;
    if (name.startsWith('.') && name !== '..') return false;
  }

  const allowed = new Set(resolveTreeListVisibleTypes(config));
  const itemTypes = classifyTreeListItemTypes(entity);
  const primary = entity.type === 'directory' ? 'folders' : 'files';
  if (!allowed.has(primary)) return false;

  const specialties = itemTypes.filter(t => t !== 'folders' && t !== 'files');
  return specialties.every(t => allowed.has(t));
}

export function filterTreeListEntities<T extends FsEntity>(items: T[], config: Parameters<typeof isTreeListItemVisible>[1]): T[] {
  return items.filter(item => isTreeListItemVisible(item, config));
}
