/**
 * Explorer-grade list gesture hit classification.
 *
 * Several independent signals decide marquee vs item-drag so presses between
 * detail columns (gutters / residual row chrome) do not steal item drag, and
 * presses on icon/name still select+drag.
 */

export type ListGestureIntent = 'marquee' | 'item';

/** Hard marquee strips only — not in-row flex spacers (marquee-pad) that sit beside names. */
const MARQUEE_ZONE_SELECTOR = [
  '.bndz-list-empty-canvas',
  '.bndz-list-marquee-lead',
  '.bndz-list-marquee-trail',
  '.bndz-list-col-gutter',
].join(',');

/** Content that owns select / double-click / drag — not dead row chrome. */
const ITEM_CONTENT_SELECTOR = [
  '.bndz-list-select-cell',
  '.bndz-clipboard-icon-slot',
  '.bndz-list-caption',
  '.bndz-list-name',
  '.bndz-list-icon-well',
  '[data-col-id]',
  'input',
  'button',
  'a',
  'img',
  'canvas',
  'label',
].join(',');

/** Row chrome / flex hosts that fill space between columns — marquee surface. */
const ROW_CHROME_SELECTOR = [
  '.fs-item-wrapper',
  '.fs-list-item',
  '.bndz-list-tile-row',
  '.bndz-list-columns',
  '.bndz-vlist-row',
].join(',');

function asElement(target: EventTarget | null): HTMLElement | null {
  if (!target || !(target instanceof Element)) return null;
  return target as HTMLElement;
}

/**
 * Signal 1 — explicit marquee zones marked in the DOM (lead/trail/gutters/empty canvas).
 */
export function hitMarqueeZone(el: Element | null): boolean {
  return !!el?.closest?.(MARQUEE_ZONE_SELECTOR);
}

/**
 * Signal 2 — interactive item content (icon, name, column cells, controls).
 */
export function hitItemContent(el: Element | null): boolean {
  return !!el?.closest?.(ITEM_CONTENT_SELECTOR);
}

/**
 * Signal 3 — press landed on residual row chrome (flex host / wrapper), not a cell.
 */
export function hitRowChromeOnly(el: Element | null): boolean {
  if (!el) return false;
  if (hitMarqueeZone(el) || hitItemContent(el)) return false;
  return !!el.closest(ROW_CHROME_SELECTOR);
}

/**
 * Signal 4 — geometry at the pointer: if the topmost element under the cursor
 * is a marquee zone (even when event.target bubbled from a child), prefer marquee.
 * Useful when overlapping badges/icons and gutters share a row.
 */
export function hitMarqueeAtPoint(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return false;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    // Skip invisible overlays / selection chrome that ignore hits.
    const pe = getComputedStyle(node).pointerEvents;
    if (pe === 'none') continue;
    if (node.matches?.(MARQUEE_ZONE_SELECTOR) || node.closest?.(MARQUEE_ZONE_SELECTOR)) return true;
    if (node.matches?.(ITEM_CONTENT_SELECTOR) || node.closest?.(ITEM_CONTENT_SELECTOR)) return false;
    if (node.classList?.contains('fs-item-wrapper')) break;
  }
  return false;
}

/**
 * Combine signals. Precedence:
 * 1) Explicit gutter / empty-canvas wins → marquee
 * 2) Point-sampled marquee zone → marquee
 * 3) Item content → item
 * 4) Any residual press inside a row → item
 * 5) Row chrome without content → marquee
 * 6) Outside any row → marquee
 */
export function classifyListPointerDown(
  target: EventTarget | null,
  clientX?: number,
  clientY?: number,
): ListGestureIntent {
  const el = asElement(target);
  if (!el) return 'marquee';

  const inRow = el.closest('.fs-item-wrapper');

  if (hitMarqueeZone(el)) return 'marquee';

  if (
    typeof clientX === 'number'
    && typeof clientY === 'number'
    && hitMarqueeAtPoint(clientX, clientY)
  ) {
    return 'marquee';
  }

  if (hitItemContent(el)) return 'item';

  if (inRow) return 'item';

  if (hitRowChromeOnly(el)) return 'marquee';

  return 'marquee';
}
