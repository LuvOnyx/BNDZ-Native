/**
 * Explicit list pointer-gesture intent — staged rules, no implicit preference between
 * marquee and file drag. Surfaces and modifiers commit intent; movement only resolves
 * when still undecided.
 */

export const MARQUEE_ARM_PX = 4;
/** Horizontal sweep on an unselected row before drag threshold arms marquee. */
const ROW_MARQUEE_DX_PX = 12;
const ROW_MARQUEE_DX_OVER_DY = 1.5;

export type RowPointerIntent = 'pending' | 'marquee' | 'drag';

export function resolveRowPointerIntent(opts: {
  /** Row was selected before pointer-down. */
  wasSelectedAtDown: boolean;
  /** Plain click arms drag immediately (Explorer-style) even when unselected at down. */
  dragArmAtDown: boolean;
  shiftKey: boolean;
  dx: number;
  dy: number;
  dragThresholdMet: boolean;
  dragSessionReady: boolean;
}): RowPointerIntent {
  const moved = opts.dx > MARQUEE_ARM_PX || opts.dy > MARQUEE_ARM_PX;

  // Explicit modifier: Shift always starts marquee from a row.
  if (opts.shiftKey && moved) return 'marquee';

  // Modifier/extension rows (not drag-armed): horizontal sweep → marquee.
  if (
    !opts.dragArmAtDown
    && !opts.dragThresholdMet
    && opts.dx > ROW_MARQUEE_DX_PX
    && opts.dx > opts.dy * ROW_MARQUEE_DX_OVER_DY
  ) {
    return 'marquee';
  }

  // Drag arms only after movement threshold + hold delay.
  if (opts.dragThresholdMet && opts.dragSessionReady) return 'drag';

  return 'pending';
}
