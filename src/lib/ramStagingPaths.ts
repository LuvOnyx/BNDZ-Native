import { IPC } from './ipcBridge';
import { BNDZ_RAM_ROOT, isBndzRamPath, parseBndzRamZoneId, bndzRamVirtualPath } from './bndzVirtualViews';
import { isMeshPath, normalizeMeshPath } from './meshPaths';
import { createMeshItemInPane } from './meshFsOps';
import { normalizePanePath, toWindowsPath } from './pathUtils';

type ZoneMount = { id: string; mountPath: string; name?: string };

let mountCache: Map<string, ZoneMount> = new Map();
let cacheAt = 0;
const CACHE_TTL_MS = 4000;

function normalizeMountPath(raw: string): string {
  const mp = raw.replace(/\//g, '\\').trim();
  if (!mp) return '';
  const bare = mp.replace(/\\+$/, '');
  if (/^[A-Za-z]:$/.test(bare)) return `${bare}\\`;
  return bare;
}

/** Refresh zone mount cache from host. */
export async function refreshRamZoneMounts(force = false): Promise<Map<string, ZoneMount>> {
  if (!force && mountCache.size && Date.now() - cacheAt < CACHE_TTL_MS) return mountCache;
  try {
    const r = await IPC.ramStagingListZones();
    const zones = Array.isArray(r.zones)
      ? (r.zones as Array<{ id: string; mountPath?: string; name?: string }>)
      : [];
    const next = new Map<string, ZoneMount>();
    for (const z of zones) {
      if (!z.id || !z.mountPath) continue;
      next.set(z.id, { id: z.id, mountPath: normalizeMountPath(z.mountPath), name: z.name });
    }
    mountCache = next;
    cacheAt = Date.now();
  } catch {
    /* keep previous */
  }
  return mountCache;
}

export function invalidateRamZoneMountCache(): void {
  mountCache = new Map();
  cacheAt = 0;
}

/**
 * Resolve a `/bndz/ram/{zoneId}/...` pane path to a real Windows filesystem path.
 * Returns null for non-RAM paths, the RAM root picker, or unresolved zones.
 */
/** Zone root mount path only (no subdirectory). */
export async function resolveRamZoneMountPath(zoneId: string): Promise<string | null> {
  let mounts = await refreshRamZoneMounts();
  let zone = mounts.get(zoneId);
  if (!zone) {
    mounts = await refreshRamZoneMounts(true);
    zone = mounts.get(zoneId);
  }
  return zone?.mountPath || null;
}

export async function resolveRamStagingFsPath(panePath: string): Promise<string | null> {
  if (!panePath) return null;
  // Tolerate mangled "bndz\ram\…" from accidental toWindowsPath on virtual paths.
  let n = normalizePanePath(panePath).replace(/\/+$/, '');
  const slashed = panePath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!n.startsWith('/bndz/') && (slashed === 'bndz/ram' || slashed.startsWith('bndz/ram/'))) {
    n = normalizePanePath(`/${slashed}`).replace(/\/+$/, '');
  }
  if (!isBndzRamPath(n)) return null;
  if (n === BNDZ_RAM_ROOT) return null;
  const zoneId = parseBndzRamZoneId(n);
  if (!zoneId) return null;

  const mountPath = await resolveRamZoneMountPath(zoneId);
  if (!mountPath) return null;

  const prefix = `${BNDZ_RAM_ROOT}/${zoneId}`;
  const rest = n === prefix ? '' : n.slice(prefix.length).replace(/^\/+/, '');
  if (!rest) return mountPath;
  const mount = mountPath.replace(/\\+$/, '');
  return `${mount}\\${rest.replace(/\//g, '\\')}`;
}

/** Sync helper when mount is already known (listing remap). */
export function joinRamVirtualPath(zoneId: string, relativeWinPath: string, mountPath: string): string {
  const mount = normalizeMountPath(mountPath).replace(/\\+$/, '');
  const win = relativeWinPath.replace(/\//g, '\\');
  let rel = win;
  if (win.toLowerCase().startsWith(mount.toLowerCase())) {
    rel = win.slice(mount.length).replace(/^\\+/, '');
  }
  if (!rel) return bndzRamVirtualPath(zoneId);
  return `${bndzRamVirtualPath(zoneId)}/${rel.replace(/\\/g, '/')}`;
}

/**
 * Resolve any pane path to a Windows FS path for copy/move/paste/drop.
 * RAM virtual paths → mount; mesh paths stay as /mesh/…; others → toWindowsPath.
 */
export async function resolvePanePathForFs(panePath: string): Promise<string> {
  if (isMeshPath(panePath)) return normalizeMeshPath(panePath);
  const ram = await resolveRamStagingFsPath(panePath);
  if (ram) return ram;
  return toWindowsPath(panePath);
}

/** Create a file or folder inside a pane path (supports /bndz/ram zones and /mesh). */
export async function createItemInPane(
  panePath: string,
  name: string,
  kind: 'dir' | 'file',
): Promise<{ ok: boolean; error?: string; fullPath?: string; finalName?: string }> {
  if (isMeshPath(panePath)) {
    return createMeshItemInPane(panePath, name, kind);
  }
  const base = await resolvePanePathForFs(panePath);
  if (!base || /^bndz\\/i.test(base)) {
    return { ok: false, error: 'This location is not writable.' };
  }
  const fullPath = `${base.replace(/\\+$/, '')}\\${name}`;
  const op = kind === 'dir' ? 'create-dir' : 'create-file';
  try {
    const res = await IPC.executeFsOperation(
      `${op}-${Date.now()}`,
      op,
      '',
      fullPath,
      false,
      name,
      'high',
    );
    if (res && (res.ok === false || res.success === false || (res.background && !res.finalPath && !res.finalName))) {
      return { ok: false, error: res.error || 'Create failed', fullPath: res.finalPath || fullPath };
    }
    if (res && res.ok !== true && res.success !== true && !res.finalPath && !res.created) {
      return { ok: false, error: res.error || 'Create failed', fullPath };
    }
    const createdPath = res.finalPath || fullPath;
    const createdName = res.finalName || name;
    return { ok: true, fullPath: createdPath, finalName: createdName };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), fullPath };
  }
}

/** Remap native dir listing entries under a RAM zone to virtual pane paths. */
export function remapRamListingEntries(
  zoneId: string,
  mountPath: string,
  entries: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const mount = normalizeMountPath(mountPath);
  return entries.map(ent => {
    const name = String(ent.name || '');
    const rawPath = String(ent.path || '');
    const winPath = rawPath
      ? rawPath.replace(/\//g, '\\')
      : `${mount.replace(/\\+$/, '')}\\${name}`.replace(/\\\\+/g, '\\');
    const virtualPath = joinRamVirtualPath(zoneId, winPath, mount);
    return {
      ...ent,
      id: virtualPath,
      path: virtualPath,
      fsPath: winPath,
    };
  });
}

/** Absolute Windows path for a listing entity (prefers fsPath when present). */
export function entityFsPath(entity: { path?: string; fsPath?: string; name?: string }, panePath: string): string {
  if (entity.fsPath) return entity.fsPath.replace(/\//g, '\\');
  if (entity.path && isBndzRamPath(entity.path)) {
    // Never mangle /bndz/ram/... via toWindowsPath — callers must resolve async for writes.
    return '';
  }
  if (entity.path) return toWindowsPath(entity.path);
  return toWindowsPath(`${panePath}/${entity.name || ''}`);
}
