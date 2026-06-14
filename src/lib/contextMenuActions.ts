import { toWindowsPath, isValidShellTarget, isRecycleBinPath, normalizePanePath, joinPanePath } from './pathUtils';
import { resolveShellPropertiesPath } from './shellPaths';

export interface ContextMenuState {
  x: number;
  y: number;
  entityId: string | null;
  path: string;
  entityName: string | null;
  isDirectory: boolean;
  nativeContextItems?: any[];
  selectedPaths?: string[];
}

function looksLikeFullPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || /^\/[A-Za-z]:/.test(value);
}

/** Resolve pane paths for context menu operations */
export function resolveContextTargetPanePaths(menu: ContextMenuState): string[] {
  const fromSelected = (menu.selectedPaths || [])
    .map(p => normalizePanePath(p))
    .filter(isValidShellTarget);
  if (fromSelected.length) return fromSelected;

  if (menu.entityId?.startsWith('drive-')) {
    return [normalizePanePath(menu.entityId.replace(/^drive-/, ''))];
  }

  if (menu.entityId && looksLikeFullPath(menu.entityId)) {
    return [normalizePanePath(menu.entityId)];
  }

  if (menu.entityId && menu.entityName) {
    const ent = { name: menu.entityName, path: looksLikeFullPath(menu.entityName) ? menu.entityName : undefined };
    return [joinPanePath(menu.path, ent)];
  }

  if (!menu.entityId && menu.entityName) {
    if (looksLikeFullPath(menu.path)) return [normalizePanePath(menu.path)];
    return [joinPanePath(menu.path, { name: menu.entityName })];
  }

  return [normalizePanePath(menu.path)];
}

/** Resolve Windows paths for cut/copy/delete shell ops */
export function resolveContextTargetPaths(menu: ContextMenuState): string[] {
  return resolveContextTargetPanePaths(menu)
    .map(p => toWindowsPath(p))
    .filter(isValidShellTarget);
}

export function resolveSingleTargetPath(menu: ContextMenuState): string {
  const panePaths = resolveContextTargetPanePaths(menu);
  const raw = panePaths[0] || menu.path;
  return resolveShellPropertiesPath(raw) || toWindowsPath(raw);
}

/** Native shell verbs already rendered in the custom BNDZ menu — skip duplicates */
export const BUILT_IN_CONTEXT_VERBS = new Set([
  'open', 'edit', 'openas', 'openwith', 'cut', 'copy', 'paste', 'delete', 'trash',
  'rename', 'properties', 'settings', 'share', 'grantaccess', 'sendto',
]);

export function filterSupplementalNativeItems(items: any[] | undefined): any[] {
  if (!items?.length) return [];
  return items.filter(item => {
    if (item.separator) return true;
    const v = (item.verb || item.id || '').toLowerCase();
    return v && !BUILT_IN_CONTEXT_VERBS.has(v);
  });
}
