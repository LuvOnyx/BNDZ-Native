/**
 * Camera framing math for the 3D / RAGE preview viewport (GpuModelViewport).
 *
 * Pure functions (no three.js import) so the orbit/fit behaviour is unit-testable:
 * - every model is framed on its bounding-box centre (the orbit pivot), never on the origin
 * - distance fits the bounding sphere into the narrower of the vertical/horizontal FOV
 * - near/far and zoom limits scale with the model, so a 0.3 m prop and a 400 m map collision
 *   both orbit cleanly without clipping or "camera inside the mesh"
 * - polar angle stays a hair off the poles so the orbit never flips or spins around the view axis
 */

export type Vec3 = readonly [number, number, number];

export type ModelFraming = {
  /** Orbit pivot = bounding-box centre. */
  target: [number, number, number];
  /** Camera position on the default 3/4 front view. */
  position: [number, number, number];
  radius: number;
  distance: number;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
};

/** Default view direction (from target towards camera): front three-quarter, slightly above. */
export const DEFAULT_VIEW_DIRECTION: Vec3 = [0.62, 0.42, 1];

/** Keep the orbit this far (radians) from straight up/down -- no pole flip, no azimuth spin. */
export const POLAR_EPSILON = 0.06;
export const MIN_POLAR_ANGLE = POLAR_EPSILON;
export const MAX_POLAR_ANGLE = Math.PI - POLAR_EPSILON;

const FIT_MARGIN = 1.12;

function normalize(v: Vec3): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function finiteBox(min: Vec3, max: Vec3): boolean {
  return [...min, ...max].every(n => Number.isFinite(n)) && max[0] >= min[0] && max[1] >= min[1] && max[2] >= min[2];
}

/**
 * Fit a bounding box into a perspective camera.
 * @param fovDeg vertical field of view in degrees (three.js PerspectiveCamera.fov)
 * @param aspect viewport width / height
 */
export function computeModelFraming(
  min: Vec3,
  max: Vec3,
  fovDeg: number,
  aspect: number,
  direction: Vec3 = DEFAULT_VIEW_DIRECTION,
): ModelFraming {
  const ok = finiteBox(min, max);
  const lo: Vec3 = ok ? min : [-0.5, -0.5, -0.5];
  const hi: Vec3 = ok ? max : [0.5, 0.5, 0.5];

  const target: [number, number, number] = [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ];
  const halfDiag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  // Flat decals / single quads still need a non-zero sphere.
  const radius = Math.max(halfDiag, 1e-3);

  const vFov = (Math.min(Math.max(fovDeg, 5), 150) * Math.PI) / 180;
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * safeAspect);
  const fitFov = Math.min(vFov, hFov);
  const distance = (radius / Math.sin(fitFov / 2)) * FIT_MARGIN;

  const dir = normalize(direction);
  const position: [number, number, number] = [
    target[0] + dir[0] * distance,
    target[1] + dir[1] * distance,
    target[2] + dir[2] * distance,
  ];

  const minDistance = radius * 0.15;
  const maxDistance = distance * 10;
  const near = Math.max(radius * 0.005, 1e-4);
  const far = maxDistance + radius * 4;

  return { target, position, radius, distance, near, far, minDistance, maxDistance };
}

/** Spherical polar angle (0 = straight down the +Y axis onto the target) of a camera offset. */
export function polarAngleOf(offset: Vec3): number {
  const r = Math.hypot(offset[0], offset[1], offset[2]);
  if (r < 1e-12) return Math.PI / 2;
  return Math.acos(Math.min(1, Math.max(-1, offset[1] / r)));
}

/**
 * RAGE (GTA V / FiveM) assets are Z-up with +Y forward. glTF/three.js are Y-up with +Z front.
 * (x, y, z) -> (-x, z, y) is a proper rotation (det +1): winding and normals stay valid.
 * Mirrors RageModelPreviewService.ToGltfAxes on the host -- kept here for tests and docs.
 */
export function rageToGltfAxes(p: Vec3): [number, number, number] {
  return [-p[0], p[2], p[1]];
}
