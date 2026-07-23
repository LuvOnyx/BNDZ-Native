/** Pointer target is a list marquee surface (gutters / dedicated marquee pads only). */
export function isListMarqueeSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest('.bndz-list-col-gutter, .bndz-list-marquee-trail, .bndz-list-marquee-pad');
}

/**
 * Interactive hit target for click / select / file-drag.
 * Whole row counts (not just text cells) so hit boxes feel solid;
 * exclusive marquee pads/gutters stay marquee-only.
 */
export function isListSelectCellTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isListMarqueeSurface(target)) return false;
  return !!el.closest('.bndz-list-select-cell, .fs-item-wrapper');
}
