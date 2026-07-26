/** BNDZ remote mesh pane paths — /mesh/{hostId}/remote/path */

export const MESH_ROOT = '/mesh';

export function isMeshPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const n = normalizeMeshPath(path);
  return n === MESH_ROOT || n.startsWith(`${MESH_ROOT}/`);
}

export function normalizeMeshPath(path: string): string {
  let p = path.replace(/\\/g, '/').trim();
  if (!p.startsWith('/')) p = '/' + p;
  while (p.includes('//')) p = p.replace('//', '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export function parseMeshPath(path: string): { hostId: string | null; remotePath: string } {
  const n = normalizeMeshPath(path);
  if (!isMeshPath(n)) return { hostId: null, remotePath: '/' };
  if (n === MESH_ROOT) return { hostId: null, remotePath: '/' };
  const rest = n.slice(MESH_ROOT.length + 1);
  const slash = rest.indexOf('/');
  if (slash < 0) return { hostId: rest, remotePath: '/' };
  return { hostId: rest.slice(0, slash), remotePath: rest.slice(slash) || '/' };
}

export function buildMeshPath(hostId: string, remotePath = '/'): string {
  let rp = remotePath.replace(/\\/g, '/');
  if (!rp.startsWith('/')) rp = '/' + rp;
  if (rp.length > 1 && rp.endsWith('/')) rp = rp.slice(0, -1);
  return rp === '/' ? `${MESH_ROOT}/${hostId}` : `${MESH_ROOT}/${hostId}${rp}`;
}
