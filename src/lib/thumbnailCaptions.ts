/** Grid caption line count — treat legacy `false`/empty as default (2). */
export function resolveThumbnailCaptionLines(raw: unknown): number {
  if (raw === false || raw == null || raw === '') return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(4, Math.floor(n)));
}
