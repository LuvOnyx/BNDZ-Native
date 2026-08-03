/** Pointer target is a list marquee surface (gutters / dedicated marquee pads only). */
export function isListMarqueeSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return !!el.closest(
    '.bndz-list-col-gutter, .bndz-list-marquee-trail, .bndz-list-marquee-pad, .bndz-list-marquee-lead, .bndz-list-empty-canvas',
  );
}

/**
 * Interactive hit target for click / select / file-drag.
 * Only explicit select cells — marquee lead/trail/pad/gutters stay marquee-only.
 * Grid/list tiles expand hit area in the list pointer handler.
 */
export function isListSelectCellTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (isListMarqueeSurface(target)) return false;
  return !!el.closest('.bndz-list-select-cell');
}
