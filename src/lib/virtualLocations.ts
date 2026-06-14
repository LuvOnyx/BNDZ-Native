import { FSEntity } from '../types';
import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH } from './pathUtils';
import { getPaneTabLabel } from './paneLabels';
import { resolveShellIconPath } from './shellPaths';

export const NETWORK_PATH = '//';
export const THIS_PC_PATH = '/';
export const LIBRARIES_PATH = '/shell:Libraries';

/** Synthetic entity representing the current pane location (tree roots, virtual folders). */
export function getLocationEntityFromPath(path: string | null | undefined): FSEntity | null {
  if (!path) return null;
  const p = normalizePanePath(path);

  if (p === THIS_PC_PATH || p === '/this-pc') {
    return {
      id: 'loc:this-pc',
      name: 'This PC',
      type: 'directory',
      path: THIS_PC_PATH,
      isVirtual: true,
    } as FSEntity;
  }
  if (p === NETWORK_PATH || p === '\\\\') {
    return {
      id: 'loc:network',
      name: 'Network',
      type: 'directory',
      path: NETWORK_PATH,
      isVirtual: true,
    } as FSEntity;
  }
  if (isRecycleBinPath(p)) {
    return {
      id: 'loc:recycle-bin',
      name: 'Recycle Bin',
      type: 'directory',
      path: RECYCLE_BIN_PATH,
      isVirtual: true,
    } as FSEntity;
  }
  if (p.toLowerCase() === LIBRARIES_PATH.toLowerCase()) {
    return {
      id: 'loc:libraries',
      name: 'Libraries',
      type: 'directory',
      path: LIBRARIES_PATH,
      isVirtual: true,
    } as FSEntity;
  }
  if (p.toLowerCase().startsWith('/shell:')) {
    const label = getPaneTabLabel(p);
    return {
      id: `loc:${p}`,
      name: label,
      type: 'directory',
      path: p,
      isVirtual: true,
    } as FSEntity;
  }
  if (/^\/[A-Za-z]:$/.test(p)) {
    return {
      id: `loc:${p}`,
      name: p.slice(1),
      type: 'directory',
      path: p,
      isVirtual: true,
    } as FSEntity;
  }
  return null;
}

/** Best shell icon path for a pane location */
export function getLocationIconPath(path: string | null | undefined): string {
  if (!path) return '';
  return resolveShellIconPath(path) || path;
}

/** Resolve preview panel entity: list selection → focused item → current location */
export function resolvePreviewEntity(
  panePath: string,
  selectedIds: string[],
  resolveEntity: (id: string | null) => FSEntity | null,
): FSEntity | null {
  if (selectedIds.length > 0) {
    const ent = resolveEntity(selectedIds[0]);
    if (ent) return ent;
  }
  const focused = resolveEntity(null);
  if (focused) return focused;
  return getLocationEntityFromPath(panePath);
}
