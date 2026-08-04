/** Explorer-style type-ahead find helpers for the file list. */

export type TypeAheadItem = { id: string; name?: string; label?: string; displayName?: string };

export type TypeAheadAdvanceOptions = {
  /** When true, pressing the same key again cycles matches instead of appending (Explorer-style). */
  allowRepeatCycle: boolean;
  cycleWindowMs?: number;
};

export type TypeAheadAdvanceResult = {
  prefix: string;
  repeatCycle: boolean;
};

/** Advance the type-ahead prefix for a key press, or signal repeat-key cycling. */
export function advanceTypeAheadPrefix(
  prevPrefix: string,
  prevKeyAt: number,
  key: string,
  now: number,
  options: TypeAheadAdvanceOptions,
): TypeAheadAdvanceResult {
  const windowMs = options.cycleWindowMs ?? 1500;
  const withinWindow = now - prevKeyAt <= windowMs;
  const normalizedKey = key.toLowerCase();

  const repeatCycle = options.allowRepeatCycle
    && withinWindow
    && prevPrefix.length === 1
    && prevPrefix === normalizedKey;

  if (repeatCycle) {
    return { prefix: prevPrefix, repeatCycle: true };
  }

  const prefix = withinWindow ? `${prevPrefix}${normalizedKey}` : normalizedKey;
  return { prefix, repeatCycle: false };
}

/**
 * Pick the list row for the current prefix / repeat cycle.
 * Walks `listItems` in view order from the focused row (wraps) — Explorer behavior.
 */
export function pickTypeAheadMatch<T extends TypeAheadItem>(
  listItems: T[],
  predicate: (item: T) => boolean,
  focusedId: string | null,
  repeatCycle: boolean,
): T | null {
  if (!listItems.length) return null;

  const matches: T[] = [];
  for (const item of listItems) {
    if (predicate(item)) matches.push(item);
  }
  if (!matches.length) return null;

  if (repeatCycle && matches.length > 1) {
    const idx = matches.findIndex(m => m.id === focusedId);
    const next = idx >= 0 ? (idx + 1) % matches.length : 0;
    return matches[next] ?? matches[0];
  }

  const focusIdx = focusedId ? listItems.findIndex(i => i.id === focusedId) : -1;
  const start = focusIdx >= 0 ? focusIdx : 0;
  for (let n = 0; n < listItems.length; n++) {
    const item = listItems[(start + n) % listItems.length];
    if (predicate(item)) return item;
  }
  return matches[0];
}

/** True for a printable key that can appear in a Windows file name (not Space — reserved). */
export function isTypeAheadKey(key: string): boolean {
  if (!key || key.length !== 1) return false;
  if (key === ' ') return false;
  // Control chars
  if (key.charCodeAt(0) < 32) return false;
  // Forbidden in Win32 names: < > : " / \ | ? *
  if (/[<>:"/\\|?*]/.test(key)) return false;
  return true;
}

/**
 * Resolve a type-ahead character from a KeyboardEvent.
 * WebView2 occasionally reports odd `key` values; fall back to `code` (KeyA / Digit1).
 */
export function typeAheadCharFromEvent(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  if (isTypeAheadKey(e.key)) return e.key.toLowerCase();
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (code === 'Period' || code === 'NumpadDecimal') return '.';
  if (code === 'Minus' || code === 'NumpadSubtract') return '-';
  if (code === 'Equal') return '=';
  if (code === 'BracketLeft') return '[';
  if (code === 'BracketRight') return ']';
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  if (code === 'Comma') return ',';
  return null;
}

/**
 * Scroll a virtualized/non-virtualized list body so `entityId` is visible.
 * Uses DOM when the row is mounted; otherwise estimates via index × rowHeight then retries.
 */
export function scrollListToEntity(opts: {
  paneId: string;
  entityId: string;
  index: number;
  rowHeight: number;
}): void {
  const { paneId, entityId, index, rowHeight } = opts;
  const listEl = document.querySelector(
    `[data-list-body][data-list-pane-id="${paneId}"]`,
  ) as HTMLElement | null;
  if (!listEl) return;

  listEl.focus({ preventScroll: true });

  const attrH = Number(listEl.getAttribute('data-list-row-height'));
  const rh = (Number.isFinite(attrH) && attrH > 0 ? attrH : rowHeight) || 26;

  const findRow = () => {
    try {
      const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(entityId)
        : entityId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return listEl.querySelector(`[data-id="${esc}"]`) as HTMLElement | null;
    } catch {
      return document.getElementById(`fs-item-${entityId}`);
    }
  };

  const row = findRow();
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (index < 0 || rh <= 0) return;
  const target = Math.max(0, index * rh - Math.max(0, listEl.clientHeight / 3));
  listEl.scrollTop = target;

  // Virtualizer mounts the row on the next frame after scrollTop changes.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      findRow()?.scrollIntoView({ block: 'nearest' });
    });
  });
}
