/** Smooth edge auto-scroll while dragging near scroll-container borders. */

export type DragAutoScrollOptions = {
  edgePx?: number;
  maxStepPx?: number;
};

/**
 * Scroll `el` when the pointer is within `edgePx` of top/bottom.
 * Uses quadratic ease so speed ramps up toward the edge.
 * Returns true if a scroll step was applied.
 */
export function autoScrollNearEdges(
  el: HTMLElement | null | undefined,
  clientY: number,
  opts?: DragAutoScrollOptions,
): boolean {
  if (!el) return false;
  const edge = opts?.edgePx ?? 56;
  const maxStep = opts?.maxStepPx ?? 28;
  const rect = el.getBoundingClientRect();
  if (rect.height < edge * 2) return false;

  const bottomDist = rect.bottom - clientY;
  const topDist = clientY - rect.top;
  let delta = 0;
  if (bottomDist >= 0 && bottomDist < edge) {
    const t = 1 - bottomDist / edge;
    delta = Math.ceil(maxStep * t * t);
  } else if (topDist >= 0 && topDist < edge) {
    const t = 1 - topDist / edge;
    delta = -Math.ceil(maxStep * t * t);
  }
  if (!delta) return false;
  const prev = el.scrollTop;
  el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, prev + delta));
  return el.scrollTop !== prev;
}

/** rAF loop that keeps scrolling while `getClientY` reports an edge hover. */
export function createDragAutoScrollLoop(
  getScrollEl: () => HTMLElement | null | undefined,
  getClientY: () => number | null,
  opts?: DragAutoScrollOptions,
): { start: () => void; stop: () => void } {
  let raf = 0;
  const tick = () => {
    raf = 0;
    const y = getClientY();
    const el = getScrollEl();
    if (y != null && el) autoScrollNearEdges(el, y, opts);
    raf = requestAnimationFrame(tick);
  };
  return {
    start: () => {
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop: () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
