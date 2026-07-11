export type TypeAheadItem = { id: string };

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
