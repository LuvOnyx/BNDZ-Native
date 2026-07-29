/** Route drag/drop paths between local Windows FS and mesh remote panes. */

import { isMeshPath, normalizeMeshPath, parseMeshPath } from './meshPaths';
import { toWindowsPath } from './pathUtils';

export type DropRoute =
  | { kind: 'local'; op: 'copy' | 'move' }
  | { kind: 'mesh-upload'; hostId: string; remoteDestDir: string }
  | { kind: 'mesh-download'; hostId: string; localDestDir: string }
  | { kind: 'mesh-replicate'; hostId: string; remoteDestDir: string; move: boolean }
  | { kind: 'mesh-relay'; srcHostId: string; destHostId: string; remoteDestDir: string; move: boolean }
  | { kind: 'mesh-drop-send'; paths: string[] };

/** Preserve mesh pane paths; normalize local paths to Windows shape. */
export function canonicalDropPath(path: string): string {
  if (isMeshPath(path)) return normalizeMeshPath(path);
  return toWindowsPath(path);
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
  if (meshDropInbox && sourcePaths.length > 0 && !sourcePaths.some(isMeshPath)) {
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
