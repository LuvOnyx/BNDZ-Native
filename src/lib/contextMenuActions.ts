import { toWindowsPath, isValidShellTarget, isRecycleBinPath, normalizePanePath, joinPanePath } from './pathUtils';
import { resolveShellPropertiesPath } from './shellPaths';

export type ContextMenuSurface =
  | 'list-background'
  | 'list-item'
  | 'tree-background'
  | 'tree-item'
  | 'sidebar-item'
  | 'preview';

export interface ContextMenuState {
  x: number;
  y: number;
  entityId: string | null;
  path: string;
  entityName: string | null;
  entityExtension?: string | null;
  isDirectory: boolean;
  surface?: ContextMenuSurface;
  nativeContextItems?: any[];
  selectedPaths?: string[];
}

export function isContextMenuBackground(menu: ContextMenuState): boolean {
  if (menu.surface) {
    return menu.surface === 'list-background' || menu.surface === 'tree-background';
  }
  return menu.entityId === null && !menu.entityName;
}

/** Recycle Bin location (tree root / list background) — not a selected recycled item. */
export function isRecycleBinLocationMenu(menu: ContextMenuState): boolean {
  if (!isRecycleBinPath(menu.path)) return false;
  if (isContextMenuBackground(menu)) return true;
  // Tree/sidebar root click wrongly passes entityId = path; treat as location.
  if (menu.surface === 'tree-item' || menu.surface === 'sidebar-item') {
    const id = normalizePanePath(menu.entityId || '');
    const path = normalizePanePath(menu.path);
    if (!menu.entityName || menu.entityName === 'Recycle Bin' || id === path || isRecycleBinPath(id)) {
      return true;
    }
  }
  return false;
}

export function contextMenuRefreshLabel(surface?: ContextMenuSurface): string {
  if (surface === 'tree-background' || surface === 'tree-item') return 'Refresh Tree';
  if (surface === 'list-background' || surface === 'list-item') return 'Refresh List';
  return 'Refresh';
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
  const filtered = items.filter(item => {
    if (item.separator) return true;
    const v = (item.verb || item.id || '').toLowerCase();
    return v && !BUILT_IN_CONTEXT_VERBS.has(v);
  });
  // Drop orphan / leading / trailing / adjacent separators left after verb filtering.
  const out: any[] = [];
  for (const item of filtered) {
    if (item.separator) {
      if (!out.length || out[out.length - 1].separator) continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}
