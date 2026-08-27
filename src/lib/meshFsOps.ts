/** Helpers for Remote Mesh file ops — keep /mesh pane paths intact (never toWindowsPath). */

import { isMeshPath, normalizeMeshPath, parseMeshPath, buildMeshPath } from './meshPaths';
import { normalizePanePath } from './pathUtils';
import { IPC } from './ipcBridge';

export function preserveMeshOrFsPath(path: string): string {
  const n = normalizePanePath(path);
  if (isMeshPath(n)) return normalizeMeshPath(n);
  return n;
}

export function joinMeshPaneChild(panePath: string, name: string): string {
  const n = normalizeMeshPath(panePath);
  const { hostId, remotePath } = parseMeshPath(n);
  if (!hostId) return `${n}/${name}`;
  const parent = remotePath === '/' ? '' : remotePath.replace(/\/$/, '');
  return buildMeshPath(hostId, `${parent}/${name}`);
}

export async function createMeshItemInPane(
  panePath: string,
  name: string,
  kind: 'dir' | 'file',
): Promise<{ ok: boolean; error?: string; fullPath?: string }> {
  if (!isMeshPath(panePath)) {
    return { ok: false, error: 'Not a mesh path' };
  }
  const fullPath = joinMeshPaneChild(panePath, name);
  const op = kind === 'dir' ? 'create-dir' : 'create-file';
  try {
    const res = await IPC.executeFsOperation(
      `${op}-${Date.now()}`,
      op,
      fullPath,
      '',
      false,
      name,
      'high',
    );
    if (res && res.ok === false) {
      return { ok: false, error: res.error || 'Create failed', fullPath };
    }
    return { ok: true, fullPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), fullPath };
  }
}

export async function meshShellHere(hostId: string, remoteCwd: string): Promise<{ sessionId?: string; error?: string }> {
  try {
    const session = await IPC.meshTerminalOpen({ hostId, cwd: remoteCwd || '/' });
    if (session?.error) return { error: String(session.error) };
    return { sessionId: session?.id || session?.Id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function meshDownloadSelection(
  meshPaths: string[],
  localDestDir: string,
): Promise<{ ok: boolean; error?: string; operationId?: string }> {
  const first = meshPaths[0];
  if (!first || !isMeshPath(first)) return { ok: false, error: 'No mesh selection' };
  const { hostId } = parseMeshPath(first);
  if (!hostId) return { ok: false, error: 'Invalid mesh path' };
  const operationId = `mesh-dl-${Date.now()}`;
  return IPC.meshTransfer({
    operationId,
    direction: 'download',
    hostId,
    meshPaths,
    localDestDir,
  });
}

export async function meshWriteBack(
  meshPath: string,
  opts: { localFile?: string; contentBase64?: string; expectedRemoteMtime?: string },
): Promise<{ ok: boolean; error?: string }> {
  return IPC.meshWrite({ path: meshPath, ...opts });
}
