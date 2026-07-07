/** Explorer-style modifier: Ctrl/Meta/Alt during drag → copy instead of move. */
export function isCopyDragModifier(e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return !!(e.ctrlKey || e.metaKey || e.altKey);
}
