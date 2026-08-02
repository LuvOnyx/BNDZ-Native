import { normalizePanePath, toWindowsPath } from './pathUtils';
import type { CloudProvider } from './cloudStatus';

export type { CloudProvider };
export const GOOGLE_DRIVE_HUB_PATH = '/cloud/googledrive';

export type DriveLike = {
  name?: string;
  label?: string;
  path?: string;
  fileSystem?: string;
  format?: string;
  totalSpace?: number;
  freeSpace?: number;
  /** Backend-annotated: dedicated cloud volume letter (Google Drive FS, etc.). */
  isCloudVolume?: boolean;
  cloudProvider?: string;
  cloudAccountLabel?: string;
};

export function isGoogleDriveProvider(p: { name?: string; icon?: string; path?: string; cloudProvider?: string }): boolean {
  const name = (p.name || '').toLowerCase();
  const icon = (p.icon || '').toLowerCase();
  const path = (p.path || '').toLowerCase();
  const cloud = (p.cloudProvider || '').toLowerCase();
  return cloud === 'gdrive'
    || name.includes('google drive')
    || icon === 'gdrive'
    || path.includes('google drive');
}

/** Prefer backend annotation; fall back to volume-label heuristics. */
export function isGoogleDriveVolume(d: DriveLike): boolean {
  if (d.isCloudVolume && (d.cloudProvider || '').toLowerCase() === 'gdrive') return true;
  if ((d.cloudProvider || '').toLowerCase() === 'gdrive') return true;
  const label = (d.label || '').trim();
  if (!label) return false;
  if (/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/.test(label)) return true;
  const lower = label.toLowerCase();
  return lower.includes('google drive');
}

export function isCloudOwnedDrive(d: DriveLike): boolean {
  if (d.isCloudVolume) return true;
  return isGoogleDriveVolume(d);
}

export function isGoogleDriveHubPath(path: string | null | undefined): boolean {
  return normalizePanePath(path || '') === GOOGLE_DRIVE_HUB_PATH;
}

export function cloudVolumeRoot(path: string | null | undefined): string | null {
  if (!path) return null;
  const win = toWindowsPath(path).replace(/\//g, '\\');
  const m = win.match(/^([A-Za-z]:)/);
  return m ? m[1].toUpperCase() : null;
}

export function isDedicatedCloudVolumeMount(path: string | null | undefined): boolean {
  if (!path) return false;
  const win = toWindowsPath(path).replace(/\//g, '\\').replace(/\\+$/, '');
  if (/^[A-Za-z]:$/.test(win)) return true;
  const m = win.match(/^([A-Za-z]:)\\(.*)$/);
  if (!m) return false;
  const rest = (m[2] || '').replace(/\\+$/, '');
  if (!rest) return true;
  return /^(My Drive|Google Drive)$/i.test(rest);
}

export function canonicalizeCloudProviders(providers: CloudProvider[] | null | undefined): CloudProvider[] {
  const byKey = new Map<string, CloudProvider>();
  const list = Array.isArray(providers) ? providers : [];

  for (const p of list) {
    const volume = cloudVolumeRoot(p.path);
    const key = volume && isDedicatedCloudVolumeMount(p.path)
      ? `vol|${volume}`
      : normalizePanePath(p.path).toLowerCase();

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...p,
        accountLabel: p.accountLabel || deriveAccountLabel(p),
      });
      continue;
    }

    const existingLen = normalizePanePath(existing.path).length;
    const nextLen = normalizePanePath(p.path).length;
    if (nextLen < existingLen) {
      byKey.set(key, {
        ...p,
        accountLabel: p.accountLabel || existing.accountLabel || deriveAccountLabel(p),
      });
    } else if (!existing.accountLabel && (p.accountLabel || deriveAccountLabel(p))) {
      byKey.set(key, {
        ...existing,
        accountLabel: p.accountLabel || deriveAccountLabel(p),
      });
    }
  }

  return [...byKey.values()];
}

function cloudProviderNavIcon(p: CloudProvider): string {
  const icon = (p.icon || '').toLowerCase();
  const name = (p.name || '').toLowerCase();
  if (icon === 'gdrive' || icon === 'googledrive' || name.includes('google drive')) return 'gdrive';
  if (icon === 'onedrive' || name.includes('onedrive')) return 'cloud_drive';
  if (icon === 'dropbox' || name.includes('dropbox')) return 'cloud_ui';
  if (icon === 'icloud' || name.includes('icloud')) return 'cloud_ui';
  return 'cloud_drive';
}

function deriveAccountLabel(p: CloudProvider): string {
  if (p.accountLabel) return p.accountLabel;
  const win = toWindowsPath(p.path);
  const emailMatch = win.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (emailMatch) return emailMatch[0];
  const volume = cloudVolumeRoot(p.path);
  if (volume) return `${p.name || 'Cloud'} (${volume})`;
  const leaf = win.split(/[/\\]/).filter(Boolean).pop();
  return leaf || p.name || 'Cloud account';
}

function providersFromGoogleDriveVolumes(drives: DriveLike[] | undefined): CloudProvider[] {
  if (!drives?.length) return [];
  return drives.filter(isGoogleDriveVolume).map((d) => {
    const panePath = normalizePanePath(d.name || d.path || '');
    return {
      name: 'Google Drive',
      path: panePath.startsWith('/') ? panePath : `/${panePath}`,
      icon: 'gdrive',
      accountLabel: (d.cloudAccountLabel || d.label || '').trim() || undefined,
      syncStatus: 'available' as const,
      cloudProvider: 'gdrive',
    };
  });
}

export function groupCloudProvidersForNav(
  providers: CloudProvider[] | null | undefined,
  drives?: DriveLike[] | null,
): {
  navItems: Array<{
    label: string;
    path: string;
    icon: string;
    iconColor: string;
    syncStatus?: string;
    isHub?: boolean;
    accounts?: CloudProvider[];
    shellIconPath?: string;
  }>;
  googleAccounts: CloudProvider[];
  ownedVolumes: Set<string>;
} {
  const safeProviders = Array.isArray(providers) ? providers : [];
  const safeDrives = Array.isArray(drives) ? drives : [];
  const merged = canonicalizeCloudProviders([
    ...safeProviders,
    ...providersFromGoogleDriveVolumes(safeDrives),
  ]);
  const googleAccounts = merged.filter(isGoogleDriveProvider);
  const others = merged.filter(p => !isGoogleDriveProvider(p));

  const ownedVolumes = new Set<string>();
  for (const p of merged) {
    if (!isDedicatedCloudVolumeMount(p.path)) continue;
    const v = cloudVolumeRoot(p.path);
    if (v) ownedVolumes.add(v);
  }
  for (const d of safeDrives) {
    if (!isCloudOwnedDrive(d)) continue;
    const v = cloudVolumeRoot(d.name || d.path);
    if (v) ownedVolumes.add(v);
  }

  const navItems: Array<{
    label: string;
    path: string;
    icon: string;
    iconColor: string;
    syncStatus?: string;
    isHub?: boolean;
    accounts?: CloudProvider[];
    shellIconPath?: string;
  }> = [];

  for (const p of others) {
    const panePath = normalizePanePath(p.path.startsWith('/') ? p.path : `/${p.path.replace(/\\/g, '/')}`);
    navItems.push({
      label: p.name,
      path: panePath,
      icon: cloudProviderNavIcon(p),
      iconColor: p.syncStatus === 'online-only' ? '#fbbf24' : '#0078d4',
      syncStatus: p.syncStatus,
      shellIconPath: panePath,
    });
  }

  if (googleAccounts.length === 1) {
    const p = googleAccounts[0];
    navItems.push({
      label: 'Google Drive',
      path: normalizePanePath(p.path.startsWith('/') ? p.path : `/${p.path.replace(/\\/g, '/')}`),
      icon: 'gdrive',
      iconColor: p.syncStatus === 'online-only' ? '#fbbf24' : '#4285F4',
      syncStatus: p.syncStatus,
      accounts: googleAccounts,
      shellIconPath: normalizePanePath(p.path.startsWith('/') ? p.path : `/${p.path.replace(/\\/g, '/')}`),
    });
  } else if (googleAccounts.length > 1) {
    const first = googleAccounts[0];
    navItems.push({
      label: 'Google Drive',
      path: GOOGLE_DRIVE_HUB_PATH,
      icon: 'gdrive',
      iconColor: '#4285F4',
      isHub: true,
      accounts: googleAccounts,
      // Native shell icon from first account volume (triangle), not the generic blue cloud.
      shellIconPath: normalizePanePath(first.path.startsWith('/') ? first.path : `/${first.path.replace(/\\/g, '/')}`),
    });
  }

  navItems.sort((a, b) => {
    const aOd = a.label.toLowerCase().includes('onedrive');
    const bOd = b.label.toLowerCase().includes('onedrive');
    if (aOd && !bOd) return -1;
    if (bOd && !aOd) return 1;
    return a.label.localeCompare(b.label);
  });

  return { navItems, googleAccounts, ownedVolumes };
}

export function googleDriveHubEntities(accounts: CloudProvider[]): any[] {
  return accounts.map((p, i) => {
    const panePath = normalizePanePath(p.path.startsWith('/') ? p.path : `/${String(p.path).replace(/\\/g, '/')}`);
    return {
      id: `gdrive-account-${i}-${panePath}`,
      name: p.accountLabel || deriveAccountLabel(p),
      type: 'directory',
      path: panePath,
      typeDescription: 'Google Drive account',
      size: 0,
      modified: new Date().toISOString(),
      created: new Date().toISOString(),
      tags: [],
      cloudProvider: p,
    };
  });
}
