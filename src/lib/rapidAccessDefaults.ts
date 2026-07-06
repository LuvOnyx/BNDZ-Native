import { normalizePanePath } from './pathUtils';
import { toPanePath } from './shellPaths';

export const RAPID_ACCESS_ORDER = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'] as const;

export type RapidAccessItem = {
  name: string;
  path: string;
  iconPath?: string;
  isDefault?: boolean;
};

const normPath = (p: string) => normalizePanePath(p).replace(/\\/g, '/').toLowerCase();

/** Hardcoded profile folder paths — never empty when username is known. */
export function profileFolderPath(name: string, username: string): string {
  if (!username || username === 'Public') return '';
  return toPanePath(`C:/Users/${username}/${name}`);
}

export function buildRapidAccessDefaults(
  username: string,
  shortcuts: Array<{ name?: string; path?: string }>,
  galleryPath: string | undefined,
  hiddenPaths: string[],
  iconMap: Record<string, string | undefined>,
): RapidAccessItem[] {
  const hidden = new Set(hiddenPaths.map(normPath));
  const defaults: RapidAccessItem[] = [];

  for (const name of RAPID_ACCESS_ORDER) {
    const sc = shortcuts.find(s => s.name === name);
    const raw = sc?.path || profileFolderPath(name, username);
    if (!raw) continue;
    const path = toPanePath(raw);
    if (hidden.has(normPath(path))) continue;
    defaults.push({ name, path, iconPath: iconMap[name], isDefault: true });
  }

  if (galleryPath) {
    const gPath = toPanePath(galleryPath);
    if (!hidden.has(normPath(gPath))) {
      defaults.push({ name: 'Gallery', path: gPath, iconPath: iconMap.Gallery, isDefault: true });
    }
  }

  return defaults;
}

export function mergeRapidAccessItems(
  pins: RapidAccessItem[],
  defaults: RapidAccessItem[],
): RapidAccessItem[] {
  const seen = new Set<string>();
  const out: RapidAccessItem[] = [];
  const push = (item: RapidAccessItem) => {
    const key = normPath(item.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, path: normalizePanePath(item.path) });
  };
  for (const p of pins) push(p);
  for (const d of defaults) push(d);
  return out;
}

export type PinnedFavorite = { name: string; path: string; icon: string; iconPath?: string };

/** Collapse duplicate pinned paths (config migration / bad writes). */
export function dedupePinnedFavorites(pinned: Array<{ name?: string; path?: string; icon?: string; iconPath?: string }>): PinnedFavorite[] {
  const seen = new Set<string>();
  const out: PinnedFavorite[] = [];
  for (const p of pinned) {
    if (!p?.path) continue;
    const key = normPath(p.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const path = normalizePanePath(p.path);
    out.push({
      name: p.name || path.split('/').filter(Boolean).pop() || 'Folder',
      path,
      icon: p.icon || 'folder',
      ...(p.iconPath ? { iconPath: p.iconPath } : {}),
    });
  }
  return out;
}
