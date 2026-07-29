export const SPATIAL_SPRING = { tension: 280, friction: 26, mass: 0.8 } as const;

export const SPATIAL_MOMENTUM = { decay: 0.88, scale: 0.35 } as const;

export type SpringGoal = { x: number; y: number };

export function applyMomentum(
  samples: Array<{ x: number; y: number; t: number }>,
  goal: SpringGoal,
): SpringGoal {
  if (samples.length < 2) return goal;
  const a = samples[samples.length - 2];
  const b = samples[samples.length - 1];
  const dt = Math.max(1, b.t - a.t);
  const vx = (b.x - a.x) / dt;
  const vy = (b.y - a.y) / dt;
  return {
    x: goal.x + vx * 16 * SPATIAL_MOMENTUM.scale,
    y: goal.y + vy * 16 * SPATIAL_MOMENTUM.scale,
  };
}
