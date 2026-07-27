/**
 * Imperative drag-ghost positioning — avoids React re-renders on every pointermove.
 */
export function setDragGhostPosition(el: HTMLElement | null | undefined, x: number, y: number) {
  if (!el) return;
  el.style.transform = `translate3d(${Math.round(x + 12)}px, ${Math.round(y + 8)}px, 0)`;
}

/** Set ghost metadata then position after React commits the portal content. */
export function armDragGhost<T>(
  setGhost: (value: T) => void,
  meta: T,
  ghostEl: HTMLElement | null | undefined,
  x: number,
  y: number,
) {
  setGhost(meta);
  const position = () => setDragGhostPosition(ghostEl, x, y);
  requestAnimationFrame(() => {
    position();
    requestAnimationFrame(position);
  });
}

/** @deprecated Prefer setDragGhostPosition for list/archive ghosts. */
export function createRafPointerThrottler(
  onFrame: (x: number, y: number) => void,
): (x: number, y: number) => void {
  let raf = 0;
  let lastX = 0;
  let lastY = 0;

  const flush = () => {
    raf = 0;
    onFrame(lastX, lastY);
  };

  return (x: number, y: number) => {
    lastX = x;
    lastY = y;
    if (!raf) raf = requestAnimationFrame(flush);
  };
}
