/** Escape text so it matches literally inside a RegExp. */
export function escapeRegExp(text: string): string {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** Build a RegExp from user/data input; returns null instead of throwing on a bad pattern. */
export function safeRegExp(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Remove a trailing ".ext" from a file name (case-insensitive) without building a RegExp.
 * File extensions come from disk and can contain regex characters such as ")" or "?".
 */
export function stripExtensionSuffix(name: string, ext: string): string {
  const e = String(ext ?? '').replace(/^\./, '');
  if (!e) return name;
  const suffix = `.${e}`;
  return name.length > suffix.length && name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, name.length - suffix.length)
    : name;
}
