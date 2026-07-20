import { normalizePanePath } from './pathUtils';
import { KNOWN_FOLDER_SHELL, toPanePath } from './shellPaths';

export const RAPID_ACCESS_ORDER = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'] as const;

export type RapidAccessItem = {
  name: string;
  path: string;
  iconPath?: string;
  isDefault?: boolean;
};

const normPath = (p: string) => normalizePanePath(p).replace(/\\/g, '/').toLowerCase();

/** shell: known-folder pane → Rapid Access identity key (dedupes FS vs shell paths). */
const SHELL_PANE_TO_KNOWN: Record<string, string> = {
  '/shell:desktop': 'desktop',
  '/shell:personal': 'documents',
  '/shell:downloads': 'downloads',
  '/shell:my pictures': 'pictures',
  '/shell:my music': 'music',
  '/shell:my video': 'videos',
  '/shell:pictureslibrary': 'gallery',
  '/shell:profile': 'home',
  '/shell:home': 'home',
};

const KNOWN_LEAF_NAMES = new Set(
  [...RAPID_ACCESS_ORDER, 'Home', 'Gallery', 'Profile'].map(n => n.toLowerCase()),
);

/** Hardcoded profile folder paths — never empty when username is known. */
export function profileFolderPath(name: string, username: string): string {
  if (!username || username === 'Public') return '';
  return toPanePath(`C:/Users/${username}/${name}`);
}

/**
 * Collapse nested known-folder shadows like `…/Desktop/Desktop` → `…/Desktop`.
 * Windows often has a real folder named "Desktop" inside the Desktop known folder;
 * Rapid Access must never treat that child as the Desktop pin/target.
 */
export function collapseKnownFolderShadowPath(
  path: string,
  shortcuts: Array<{ name?: string; path?: string }> = [],
): string {
  const pane = toPanePath(path);
  const n = normPath(pane);
  if (!n) return pane;

  for (const sc of shortcuts) {
    if (!sc?.name || !sc.path || /^shell:/i.test(String(sc.path))) continue;
    const real = normPath(toPanePath(sc.path));
    if (!real) continue;
    const leaf = String(sc.name).toLowerCase();
    if (n === `${real}/${leaf}`) return toPanePath(sc.path);
  }

  // Generic …/Name/Name collapse for known folder leaf names
  const parts = pane.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    if (last.toLowerCase() === prev.toLowerCase() && KNOWN_LEAF_NAMES.has(last.toLowerCase())) {
      parts.pop();
      return normalizePanePath('/' + parts.join('/'));
    }
  }

  return pane;
}

/** Identity key so `/shell:Desktop` and `C:/Users/…/Desktop` collapse to one Rapid Access row. */
export function knownFolderDedupeKey(
  path: string,
  shortcuts: Array<{ name?: string; path?: string }> = [],
): string {
  const collapsed = collapseKnownFolderShadowPath(path, shortcuts);
  const n = normPath(collapsed);
  if (!n) return '';
  const shellId = SHELL_PANE_TO_KNOWN[n];
  if (shellId) return `kf:${shellId}`;
  for (const sc of shortcuts) {
    if (!sc?.name || !sc.path) continue;
    if (normPath(toPanePath(sc.path)) === n) return `kf:${String(sc.name).toLowerCase()}`;
  }
  return n;
}

/**
 * Prefer real filesystem paths from GET_SYSTEM_SHORTCUTS so the address bar shows
 * `C:\Users\…\Desktop` instead of `shell:Desktop`. Keep shell: only as iconPath.
 * Always collapse Desktop\Desktop shadows.
 */
export function buildRapidAccessDefaults(
  username: string,
  shortcuts: Array<{ name?: string; path?: string }>,
  galleryPath: string | undefined,
  hiddenPaths: string[],
  iconMap: Record<string, string | undefined>,
): RapidAccessItem[] {
  const hidden = new Set(hiddenPaths.map(p => knownFolderDedupeKey(p, shortcuts) || normPath(p)));
  const defaults: RapidAccessItem[] = [];

  for (const name of RAPID_ACCESS_ORDER) {
    const sc = shortcuts.find(s => s.name === name);
    const shellKey = KNOWN_FOLDER_SHELL[name] || iconMap[name];
    const raw = sc?.path || profileFolderPath(name, username) || (
      shellKey
        ? (String(shellKey).startsWith('/') ? String(shellKey) : `/${shellKey}`)
        : ''
    );
    if (!raw) continue;
    const path = collapseKnownFolderShadowPath(toPanePath(raw), shortcuts);
    const hideKey = knownFolderDedupeKey(path, shortcuts) || normPath(path);
    if (hidden.has(hideKey)) continue;
    defaults.push({
      name,
      path,
      iconPath: shellKey || iconMap[name],
      isDefault: true,
    });
  }

  if (galleryPath) {
    const gPath = collapseKnownFolderShadowPath(toPanePath(galleryPath), shortcuts);
    const hideKey = knownFolderDedupeKey(gPath, shortcuts) || normPath(gPath);
    if (!hidden.has(hideKey)) {
      defaults.push({
        name: 'Gallery',
        path: gPath,
        iconPath: iconMap.Gallery || KNOWN_FOLDER_SHELL.Gallery,
        isDefault: true,
      });
    }
  }

  return defaults;
}

export function mergeRapidAccessItems(
  pins: RapidAccessItem[],
  defaults: RapidAccessItem[],
  shortcuts: Array<{ name?: string; path?: string }> = [],
): RapidAccessItem[] {
  const seen = new Set<string>();
  const out: RapidAccessItem[] = [];
  const defaultsByKey = new Map<string, RapidAccessItem>();
  for (const d of defaults) {
    const key = knownFolderDedupeKey(d.path, shortcuts) || normPath(d.path);
    if (key) defaultsByKey.set(key, d);
  }
  const push = (item: RapidAccessItem) => {
    const collapsedPath = collapseKnownFolderShadowPath(item.path, shortcuts);
    const key = knownFolderDedupeKey(collapsedPath, shortcuts) || normPath(collapsedPath);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...item, path: normalizePanePath(collapsedPath) });
  };
  // Pins first; any Desktop\Desktop (etc.) pin is remapped to the real known-folder path.
  for (const p of pins) {
    const collapsed = collapseKnownFolderShadowPath(p.path, shortcuts);
    const key = knownFolderDedupeKey(collapsed, shortcuts) || normPath(collapsed);
    const canonical = defaultsByKey.get(key);
    if (canonical) push({ ...canonical, isDefault: true });
    else push({ ...p, path: collapsed });
  }
  for (const d of defaults) push(d);
  return out;
}

export type PinnedFavorite = { name: string; path: string; icon: string; iconPath?: string; label?: string };

/** Collapse duplicate pinned paths (config migration / bad writes). */
export function dedupePinnedFavorites(
  pinned: Array<{ name?: string; path?: string; icon?: string; iconPath?: string; label?: string }>,
  shortcuts: Array<{ name?: string; path?: string }> = [],
): PinnedFavorite[] {
  const seen = new Set<string>();
  const out: PinnedFavorite[] = [];
  for (const p of pinned) {
    if (!p?.path) continue;
    const path = collapseKnownFolderShadowPath(normalizePanePath(p.path), shortcuts);
    const key = knownFolderDedupeKey(path, shortcuts) || normPath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: p.name || path.split('/').filter(Boolean).pop() || 'Folder',
      path,
      icon: p.icon || 'folder',
      ...(p.label ? { label: p.label } : {}),
      ...(p.iconPath ? { iconPath: p.iconPath } : {}),
    });
  }
  return out;
}
