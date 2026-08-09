/** Cap WebGL canvas DPR for crisp HiDPI without melting integrated GPUs. */
export function getDisplayDpr(): [number, number] {
  if (typeof window === 'undefined') return [1, 1];
  const dpr = window.devicePixelRatio || 1;
  return [1, Math.min(2, Math.max(1, dpr))];
}

export function getDisplayDprScalar(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
}
