/** Mesh Drop share-link helpers — deep links, web links, paste parsing. */

import { isMeshDropCode, meshDropCodeChecksum } from './meshDrop';

export const MESH_DROP_DEEP_SCHEME = 'bndz://mesh-drop';
export const DEFAULT_MESH_DROP_WEB_BASE = 'https://bndz.app/mesh-drop';

export type MeshDropShareMode = 'code' | 'link' | 'qr' | 'lan' | 'relay';

export function buildMeshDropDeepLink(meshCode: string): string {
  const code = meshCode.trim();
  const sum = meshDropCodeChecksum(code);
  return `${MESH_DROP_DEEP_SCHEME}?v=1&sum=${sum}&code=${encodeURIComponent(code)}`;
}

export function buildMeshDropWebLink(meshCode: string, webBase = DEFAULT_MESH_DROP_WEB_BASE): string {
  const code = meshCode.trim();
  const base = (webBase || DEFAULT_MESH_DROP_WEB_BASE).replace(/\/$/, '');
  const sum = meshDropCodeChecksum(code);
  return `${base}?v=1&sum=${sum}#${encodeURIComponent(code)}`;
}

export function buildMeshDropRelayJoinLink(relayJoinUrl: string, roomId: string): string {
  const base = relayJoinUrl.replace(/\/$/, '');
  return `${base}/${encodeURIComponent(roomId)}`;
}

/** Extract a Mesh Code from raw paste, deep link, or web link. */
export function extractMeshDropCode(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (isMeshDropCode(raw)) return raw;

  try {
    if (raw.startsWith('bndz://')) {
      const url = new URL(raw.replace('bndz://', 'https://bndz.local/'));
      const fromQuery = url.searchParams.get('code');
      if (fromQuery && isMeshDropCode(decodeURIComponent(fromQuery))) {
        return decodeURIComponent(fromQuery);
      }
      const hash = url.hash.replace(/^#/, '');
      if (hash && isMeshDropCode(decodeURIComponent(hash))) return decodeURIComponent(hash);
    }

    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get('code');
      if (fromQuery && isMeshDropCode(decodeURIComponent(fromQuery))) {
        return decodeURIComponent(fromQuery);
      }
      const hash = url.hash.replace(/^#/, '');
      if (hash && isMeshDropCode(decodeURIComponent(hash))) return decodeURIComponent(hash);
    }
  } catch {
    /* fall through */
  }

  const match = raw.match(/BNDZMD:[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

export function formatTransferSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}
