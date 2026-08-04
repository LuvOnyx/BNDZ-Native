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

/** Pick the list row to highlight for the current prefix / repeat cycle. */
export function pickTypeAheadMatch<T extends TypeAheadItem>(
  matches: T[],
  focusedId: string | null,
  prefix: string,
  repeatCycle: boolean,
): T | null {
  if (!matches.length) return null;

  if (repeatCycle && matches.length > 1) {
    const idx = matches.findIndex(m => m.id === focusedId);
    const next = idx >= 0 ? (idx + 1) % matches.length : 0;
    return matches[next] ?? matches[0];
  }

  if (!repeatCycle && matches.length > 1 && focusedId && prefix.length > 1) {
    const idx = matches.findIndex(m => m.id === focusedId);
    if (idx >= 0) return matches[idx] ?? matches[0];
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
