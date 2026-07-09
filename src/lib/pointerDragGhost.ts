/**
 * Throttle high-frequency pointer updates (drag ghosts) to one paint per frame.
 */
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
