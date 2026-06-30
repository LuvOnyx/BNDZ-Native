export const DEFAULT_LAUNCHER_BACKGROUND_OPACITY_PERCENT = 46;
export const DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT = 35;

export function clampLauncherBackgroundPercent(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Map 0–100 blur slider to px (SuperCmd-style). */
export function launcherBackgroundBlurPercentToPx(percent: number): number {
  const p = clampLauncherBackgroundPercent(percent, DEFAULT_LAUNCHER_BACKGROUND_BLUR_PERCENT);
  return Math.round(4 + (p / 100) * 20);
}
