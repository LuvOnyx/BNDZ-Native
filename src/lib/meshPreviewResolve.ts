/** Hydrate remote mesh paths to local cache before read/preview/stream. */

import { isMeshPath, normalizeMeshPath } from './meshPaths';
import { IPC } from './ipcBridge';
import { toWindowsPath } from './pathUtils';

export type ResolvedReadPath = {
  localPath: string;
  meshPath?: string;
  error?: string;
};

export async function resolveLocalReadPath(path: string): Promise<ResolvedReadPath> {
  const n = normalizeMeshPath(path);
  if (!isMeshPath(n)) {
    return { localPath: toWindowsPath(n) };
  }
  if (!IPC.isNative) {
    return { localPath: '', error: 'Remote mesh preview requires the native host.' };
  }
  try {
    const res = await IPC.meshHydratePaths([n]);
    if (res.error) return { localPath: '', meshPath: n, error: res.error };
    const local = res.paths?.[0];
    if (!local) {
      return { localPath: '', meshPath: n, error: 'Remote file could not be cached for preview.' };
    }
    return { localPath: local, meshPath: n };
  } catch (e) {
    return {
      localPath: '',
      meshPath: n,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
