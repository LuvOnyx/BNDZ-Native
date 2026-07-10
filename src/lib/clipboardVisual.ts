import { toWindowsPath } from './pathUtils';
import { joinPanePath } from './pathUtils';
import type { ClipboardAction } from '../data/ClipboardContext';

export function normalizeClipboardPath(path: string): string {
  return toWindowsPath(path).replace(/\\+$/, '').toLowerCase();
}

export function resolveEntityWindowsPath(
  panePath: string,
  entity: { path?: string; name: string; id?: string; type?: string },
): string {
  const raw = entity.path || '';
  if (raw && (/^[a-zA-Z]:/.test(raw.replace(/^\//, '')) || raw.startsWith('\\\\'))) {
    return toWindowsPath(raw);
  }
  return toWindowsPath(joinPanePath(panePath, entity));
}

/** Returns whether this list row matches an item on the internal clipboard. */
export function getClipboardMarkForEntity(
  entityWinPath: string,
  clipboard: { items: string[]; action: ClipboardAction },
): 'copy' | 'cut' | null {
  if (!clipboard.items.length || !clipboard.action) return null;
  const norm = normalizeClipboardPath(entityWinPath);
  const hit = clipboard.items.some(p => normalizeClipboardPath(p) === norm);
  if (!hit) return null;
  return clipboard.action === 'cut' ? 'cut' : 'copy';
}

export function describeClipboardState(
  clipboard: { items: string[]; action: ClipboardAction },
): string | null {
  if (!clipboard.items.length || !clipboard.action) return null;
  const n = clipboard.items.length;
  const verb = clipboard.action === 'cut' ? 'Cut' : 'Copied';
  const label = n === 1
    ? (clipboard.items[0].split(/[/\\]/).pop() || 'item')
    : `${n} items`;
  return `${verb}: ${label}`;
}
