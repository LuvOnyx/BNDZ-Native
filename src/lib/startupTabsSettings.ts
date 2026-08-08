import type { AppConfig } from '../data/configContext';
import { normalizePanePath } from './pathUtils';

/** Settings → Reuse existing tabs when changing the location */
export function findReusableTab(
  panes: Array<{ id: string; tabs: Array<{ id: string; path: string }>; activeTabIndex: number }>,
  path: string,
  preferredPaneId?: string,
): { paneId: string; tabIndex: number } | null {
  const norm = normalizePanePath(path).toLowerCase();
  if (!norm) return null;
  const ordered = preferredPaneId
    ? [...panes].sort((a, b) => (a.id === preferredPaneId ? -1 : b.id === preferredPaneId ? 1 : 0))
    : panes;
  for (const pane of ordered) {
    const idx = pane.tabs.findIndex(t => normalizePanePath(t.path).toLowerCase() === norm);
    if (idx >= 0) return { paneId: pane.id, tabIndex: idx };
  }
  return null;
}

/** Prefix with \\?\ when Settings → Support overlong filenames is on. */
export function toFsPathWithOverlongSupport(config: AppConfig, winPath: string): string {
  const p = String(winPath || '').replace(/\//g, '\\');
  if (!config.supportOverlongFilenames) return p;
  if (p.startsWith('\\\\?\\') || p.startsWith('\\\\.\\')) return p;
  if (p.startsWith('\\\\')) return `\\\\?\\UNC\\${p.slice(2)}`;
  if (/^[A-Za-z]:\\/.test(p) && p.length >= 240) return `\\\\?\\${p}`;
  if (config.supportOverlongFilenames && /^[A-Za-z]:\\/.test(p)) return `\\\\?\\${p}`;
  return p;
}

/**
 * Settings → Support volume labels in paths.
 * Accepts `Dataspace:\folder` → resolve via drive label map when provided.
 */
export function resolveVolumeLabelPath(
  config: AppConfig,
  input: string,
  drives: Array<{ name?: string; label?: string }>,
): string | null {
  if (!config.supportVolumeLabelsInPaths) return null;
  const m = String(input || '').trim().match(/^([^:\\/]+):(.*)$/);
  if (!m) return null;
  const label = m[1].toLowerCase();
  if (label.length === 1) return null; // drive letter
  const rest = (m[2] || '').replace(/^[\\/]+/, '');
  const hit = drives.find(d => String(d.label || '').toLowerCase() === label);
  if (!hit?.name) return null;
  const root = String(hit.name).replace(/\\/g, '/').replace(/\/+$/, '');
  return rest ? `${root}/${rest.replace(/\\/g, '/')}` : root;
}

export function localizedEntityName(
  config: AppConfig,
  entity: { name?: string; type?: string; localizedName?: string; displayName?: string; friendlyName?: string },
  fallback: string,
): string {
  if (!config.showLocalizedFolderNames) return fallback;
  if (entity.type !== 'directory' && entity.type !== 'folder') return fallback;
  const localized = entity.localizedName || entity.displayName || entity.friendlyName;
  if (typeof localized === 'string' && localized.trim()) return localized.trim();
  return fallback;
}
