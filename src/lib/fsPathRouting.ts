/** Route drag/drop paths between local Windows FS and mesh remote panes. */

import { isBndzRamPath } from './bndzVirtualViews';
import { isMeshPath, normalizeMeshPath, parseMeshPath } from './meshPaths';
import { isUriJunkPath, joinPanePath, normalizePanePath, toWindowsPath } from './pathUtils';

export type DropRoute =
  | { kind: 'local'; op: 'copy' | 'move' }
  | { kind: 'mesh-upload'; hostId: string; remoteDestDir: string }
  | { kind: 'mesh-download'; hostId: string; localDestDir: string }
  | { kind: 'mesh-replicate'; hostId: string; remoteDestDir: string; move: boolean }
  | { kind: 'mesh-relay'; srcHostId: string; destHostId: string; remoteDestDir: string; move: boolean }
  | { kind: 'mesh-drop-send'; paths: string[] };

/** Synthetic dest when dropping onto a Mesh Drop inbox surface. */
export const MESH_DROP_INBOX_DEST = '__bndz_mesh_drop_inbox__';

/**
 * Preserve mesh + RAM virtual pane paths; normalize other local paths to Windows shape.
 * CRITICAL: never run toWindowsPath on /bndz/ram/… — that yields unbound bndz\ram\… garbage.
 */
export function canonicalDropPath(path: string): string {
  if (!path) return '';
  if (path === MESH_DROP_INBOX_DEST) return MESH_DROP_INBOX_DEST;
  if (isMeshPath(path)) return normalizeMeshPath(path);

  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  // Already-mangled virtual RAM path from an earlier toWindowsPath pass.
  if (slashed === 'bndz/ram' || slashed.startsWith('bndz/ram/')) {
    return normalizePanePath(`/${slashed}`);
  }
  const pane = normalizePanePath(path);
  if (isBndzRamPath(pane) || isBndzRamPath(path)) {
    return pane;
  }
  return toWindowsPath(path);
}

/** Resolve a listing entity to a drag path — never stream or file: URI junk. */
export function resolveEntityDragPath(
  entity: { name: string; path?: string; id?: string; fsPath?: string },
  panePath: string,
): string {
  const raw = entity.fsPath
    ? String(entity.fsPath)
    : entity.path
      ? String(entity.path)
      : joinPanePath(panePath, entity);
  const trimmed = raw.trim();
  const slashed = trimmed.replace(/\\/g, '/');
  if (isUriJunkPath(trimmed)) {
    return canonicalDropPath(joinPanePath(panePath, { name: entity.name, id: entity.id }));
  }
  // Corrupted listing path stuck on file%3A artifact while entity is a different item.
  if (/[/]file%3A$/i.test(slashed) && entity.name !== 'file%3A') {
    return canonicalDropPath(joinPanePath(panePath, { name: entity.name, id: entity.id }));
  }
  return canonicalDropPath(raw);
}

export function meshRemoteDirFromDest(destPath: string): { hostId: string; remotePath: string } | null {
  const canon = canonicalDropPath(destPath);
  if (!isMeshPath(canon)) return null;
  const { hostId, remotePath } = parseMeshPath(canon);
  if (!hostId) return null;
  return { hostId, remotePath: remotePath || '/' };
}

export function meshHostIdFromSources(sourcePaths: string[]): string | null {
  const mesh = sourcePaths.filter(isMeshPath);
  if (!mesh.length) return null;
  const hosts = new Set(mesh.map(p => parseMeshPath(canonicalDropPath(p)).hostId).filter(Boolean));
  if (hosts.size !== 1) return null;
  return [...hosts][0]!;
}

export function resolveDropRoute(
  op: 'copy' | 'move',
  sourcePaths: string[],
  destPath: string,
  meshDropInbox?: boolean,
): DropRoute {
  const inbox = meshDropInbox
    || destPath === MESH_DROP_INBOX_DEST
    || canonicalDropPath(destPath) === MESH_DROP_INBOX_DEST;
  if (inbox && sourcePaths.length > 0 && !sourcePaths.some(isMeshPath)) {
    return { kind: 'mesh-drop-send', paths: sourcePaths.map(canonicalDropPath) };
  }
  const destCanon = canonicalDropPath(destPath);
  const srcMesh = sourcePaths.some(isMeshPath);
  const destMesh = isMeshPath(destCanon);

  if (destMesh && !srcMesh) {
    const dest = meshRemoteDirFromDest(destCanon);
    if (!dest) return { kind: 'local', op };
    return { kind: 'mesh-upload', hostId: dest.hostId, remoteDestDir: dest.remotePath };
  }

  if (!destMesh && srcMesh) {
    const hostId = meshHostIdFromSources(sourcePaths);
    if (!hostId) return { kind: 'local', op };
    return { kind: 'mesh-download', hostId, localDestDir: destCanon };
  }

  if (destMesh && srcMesh) {
    const dest = meshRemoteDirFromDest(destCanon);
    const srcHostId = meshHostIdFromSources(sourcePaths);
    if (!dest || !srcHostId) return { kind: 'local', op };
    if (dest.hostId !== srcHostId) {
      return { kind: 'mesh-relay', srcHostId, destHostId: dest.hostId, remoteDestDir: dest.remotePath, move: op === 'move' };
    }
    return { kind: 'mesh-replicate', hostId: srcHostId, remoteDestDir: dest.remotePath, move: op === 'move' };
  }

  return { kind: 'local', op };
}

export function meshPanePathsFromSources(sourcePaths: string[]): string[] {
  return sourcePaths.filter(isMeshPath).map(canonicalDropPath);
}

export function localPathsFromSources(sourcePaths: string[]): string[] {
  return sourcePaths.filter(p => !isMeshPath(p)).map(toWindowsPath);
}
