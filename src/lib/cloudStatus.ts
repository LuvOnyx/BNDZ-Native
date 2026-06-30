/** Cloud provider path detection + sync status badges for list rows. */

export type CloudProvider = {
  name: string;
  path: string;
  icon?: string;
  syncStatus?: 'available' | 'online-only' | 'pinned' | 'missing' | 'unknown';
};

export type CloudBadge = {
  label: string;
  tone: 'sky' | 'amber' | 'emerald' | 'gray';
  title: string;
};

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function matchCloudProvider(fullPath: string, providers: CloudProvider[]): CloudProvider | null {
  const n = norm(fullPath);
  if (!n || !providers.length) return null;
  let best: CloudProvider | null = null;
  let bestLen = 0;
  for (const p of providers) {
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
