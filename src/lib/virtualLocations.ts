import { FSEntity } from '../types';
import { isRecycleBinPath, normalizePanePath, RECYCLE_BIN_PATH } from './pathUtils';
import { getPaneTabLabel } from './paneLabels';
import { KNOWN_FOLDER_SHELL, resolveShellIconPath } from './shellPaths';
import { BNDZ_HOME, isBndzHomePath, isBndzVirtualPath } from './bndzVirtualViews';

export const NETWORK_PATH = '//';
export const THIS_PC_PATH = '/';
export const LIBRARIES_PATH = '/shell:Libraries';
export const CONTROL_PANEL_PATH = '/shell:ControlPanel';

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
  if (isBndzHomePath(p) || p === BNDZ_HOME) {
    return {
      id: 'loc:bndz-home',
      name: 'Continuum',
      type: 'directory',
      path: BNDZ_HOME,
      isVirtual: true,
    } as FSEntity;
  }
  if (isBndzVirtualPath(p)) {
    return {
      id: `loc:${p}`,
      name: getPaneTabLabel(p),
      type: 'directory',
      path: p,
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
  if (p.toLowerCase() === CONTROL_PANEL_PATH.toLowerCase()) {
    return {
      id: 'loc:control-panel',
      name: 'Control Panel',
      type: 'directory',
      path: CONTROL_PANEL_PATH,
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
  const p = normalizePanePath(path);
  // Continuum Home is virtual — use the Windows Profile glyph (same as tree Home).
  if (isBndzHomePath(p) || p === BNDZ_HOME) {
    return KNOWN_FOLDER_SHELL.Home;
  }
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
