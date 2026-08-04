/** Pointer target is a dedicated marquee pad (CSS/layout helpers; empty canvas drives marquee). */
export function isListMarqueeSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest(
    '.bndz-list-col-gutter, .bndz-list-marquee-trail, .bndz-list-marquee-pad, .bndz-list-marquee-lead, .bndz-list-empty-canvas',
  );
}

/**
 * Interactive hit target for click / select semantics.
 * Select cells are name/icon/column content; marquee chrome is excluded for click tests.
 * Row press-drag uses the whole .fs-item-wrapper (Explorer blend), not this helper.
 */
export function isListSelectCellTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isListMarqueeSurface(target)) return false;
  return !!el.closest('.bndz-list-select-cell');
}
