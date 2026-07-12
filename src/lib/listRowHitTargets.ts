/** Pointer target is a list marquee surface (gutters, row padding, non-cell chrome). */
export function isListMarqueeSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.closest('.bndz-list-col-gutter, .bndz-list-marquee-trail, .bndz-list-marquee-pad')) return true;
  const row = el.closest('.fs-item-wrapper');
  if (!row) return false;
  return !el.closest('.bndz-list-select-cell');
}

/** Interactive cells — click/drag/select. */
export function isListSelectCellTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isListMarqueeSurface(target)) return false;
  return !!el.closest('.bndz-list-select-cell');
}
