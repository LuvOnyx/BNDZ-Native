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

function normalizeTypeAheadText(value: string, ignoreDiacritics: boolean): string {
  let text = value.toLowerCase();
  if (ignoreDiacritics) text = text.normalize('NFD').replace(/\p{M}/gu, '');
  return text;
}

/** Type-ahead find matching per settings (beginning / anywhere / exact). */
export function matchesTypeAhead(
  name: string,
  prefix: string,
  mode: string,
  ignoreDiacritics = false,
): boolean {
  const n = normalizeTypeAheadText(name, ignoreDiacritics);
  const p = normalizeTypeAheadText(prefix, ignoreDiacritics);
  if (!p) return false;
  if (mode === 'Match exact') return n === p;
  if (mode === 'Match anywhere') return n.includes(p);
  return n.startsWith(p);
}
