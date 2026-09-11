/** Cloud provider path detection + sync status badges for list rows. */

import type { EmblemId } from '../components/EmblemIcon';

export type CloudProvider = {
  name: string;
  path: string;
  icon?: string;
  syncStatus?: 'available' | 'online-only' | 'pinned' | 'missing' | 'unknown';
  accountId?: string;
  accountLabel?: string;
  cloudProvider?: string;
};

export type CloudBadge = {
  label: string;
  tone: 'sky' | 'amber' | 'emerald' | 'gray';
  title: string;
};

export type CloudStatusKind = 'available' | 'online-only' | 'pinned' | 'offline' | 'syncing' | 'error' | 'missing';

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function matchCloudProvider(fullPath: string, providers: CloudProvider[] | null | undefined): CloudProvider | null {
  const n = norm(fullPath);
  const list = Array.isArray(providers) ? providers : [];
  if (!n || !list.length) return null;
  let best: CloudProvider | null = null;
  let bestLen = 0;
  for (const p of list) {
    const root = norm(p.path || '');
    if (!root || root.length < 3) continue;
    if (n === root || n.startsWith(`${root}/`)) {
      if (root.length > bestLen) {
        best = p;
        bestLen = root.length;
      }
    }
  }
  return best;
}

export function cloudBadgeForPath(fullPath: string, providers: CloudProvider[]): CloudBadge | null {
  const match = matchCloudProvider(fullPath, providers);
  if (!match) return null;
  const status = match.syncStatus || 'available';
  if (status === 'online-only') {
    return { label: '☁', tone: 'amber', title: `${match.name} — online-only (not downloaded)` };
  }
  if (status === 'pinned') {
    return { label: '📌', tone: 'emerald', title: `${match.name} — always keep on device` };
  }
  if (status === 'missing') {
    return { label: '!', tone: 'gray', title: `${match.name} — unavailable` };
  }
  return { label: '☁', tone: 'sky', title: match.name };
}

export function cloudSidebarStatusLabel(status?: string): string {
  switch (status) {
    case 'online-only': return 'Online-only';
    case 'pinned': return 'Pinned';
    case 'missing': return 'Unavailable';
    case 'available': return 'Available';
    default: return '';
  }
}

/** Resolve per-file cloud status from listing DTO + provider roots. */
export function resolveEntityCloudStatus(
  entity: { cloudStatus?: string; path?: string; name?: string },
  panePath: string,
  providers: CloudProvider[] | null | undefined,
): { kind: CloudStatusKind; title: string; emblem: EmblemId } | null {
  const full = (entity.path || `${panePath}/${entity.name || ''}`).replace(/\\/g, '/');
  const provider = matchCloudProvider(full, providers);
  const raw = (entity.cloudStatus || provider?.syncStatus || '').toLowerCase();
  if (!raw && !provider) return null;

  const name = provider?.name || 'Cloud';
  if (raw === 'online-only' || raw === 'offline') {
    return { kind: 'online-only', title: `${name} — online-only`, emblem: 'state-download' };
  }
  if (raw === 'pinned') {
    return { kind: 'pinned', title: `${name} — always keep on this device`, emblem: 'state-ok' };
  }
  if (raw === 'missing' || raw === 'error') {
    return { kind: 'error', title: `${name} — unavailable`, emblem: 'state-error' };
  }
  if (raw === 'syncing') {
    return { kind: 'syncing', title: `${name} — syncing`, emblem: 'state-sync' };
  }
  if (provider || raw === 'available') {
    return { kind: 'available', title: `${name} — available locally`, emblem: 'state-ok' };
  }
  return null;
}
