/** Match a KeyboardEvent against a shortcut string like "Ctrl+Shift+P", "F2", "Delete". */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut?.trim()) return false;
  const parts = shortcut.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  let needCtrl = false;
  let needShift = false;
  let needAlt = false;
  let needMeta = false;
  let keyPart = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') needCtrl = true;
    else if (lower === 'shift') needShift = true;
    else if (lower === 'alt') needAlt = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'win') needMeta = true;
    else keyPart = part;
  }

  if (needCtrl !== e.ctrlKey) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;
  if (needMeta !== e.metaKey) return false;

  if (!keyPart) return true;

  const normalized = keyPart.toLowerCase();
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const eventCode = e.code.replace(/^Key/, '').toLowerCase();

  if (normalized === 'delete') return e.key === 'Delete';
  if (normalized === 'escape' || normalized === 'esc') return e.key === 'Escape';
  if (normalized === 'space') return e.code === 'Space';
  if (normalized === '\\' || normalized === 'backslash') return e.key === '\\';

  return eventKey.toLowerCase() === normalized || eventCode === normalized;
}

/**
 * Serialize a KeyboardEvent into a canonical shortcut string ("Ctrl+Shift+P",
 * "F2", "Alt+P", "Delete") that {@link matchesShortcut} can parse back.
 * Returns null while only modifier keys are held (so capture UIs can wait).
 */
export function eventToShortcut(e: KeyboardEvent): string | null {
  const key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta' || key === 'OS') {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');

  let main: string;
  if (key === ' ' || e.code === 'Space') main = 'Space';
  else if (key === 'Escape') main = 'Escape';
  else if (key === 'Delete') main = 'Delete';
  else if (key.length === 1) main = key.toUpperCase();
  else main = key; // F2, Enter, Tab, ArrowUp, etc.

  parts.push(main);
  return parts.join('+');
}

/** Human-friendly display of a stored shortcut string (empty -> "Unbound"). */
export function formatShortcut(shortcut: string): string {
  return shortcut?.trim() ? shortcut.trim() : 'Unbound';
}

function normalizeTypeAheadText(value: string, ignoreDiacritics: boolean, matchCase = false): string {
  let text = matchCase ? value : value.toLowerCase();
  if (ignoreDiacritics) text = text.normalize('NFD').replace(/\p{M}/gu, '');
  return text;
}

/** Type-ahead find matching per settings (beginning / anywhere / exact). */
export function matchesTypeAhead(
  name: string,
  prefix: string,
  mode: string,
  ignoreDiacritics = false,
  matchCase = false,
): boolean {
  const n = normalizeTypeAheadText(name, ignoreDiacritics, matchCase);
  const p = normalizeTypeAheadText(prefix, ignoreDiacritics, matchCase);
  if (!p) return false;
  if (mode === 'Match exact') return n === p;
  if (mode === 'Match anywhere') return n.includes(p);
  return n.startsWith(p);
}

/** Prefer raw filesystem name for type-ahead so truncation/localization can't hide matches. */
export function typeAheadEntityName(entity: any, displayName: string): string {
  const raw = entity?.name ?? entity?.label ?? entity?.displayName;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return displayName || '';
}
