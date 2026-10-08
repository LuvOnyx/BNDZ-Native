import {
  computeModelFraming,
  polarAngleOf,
  rageToGltfAxes,
  MIN_POLAR_ANGLE,
  MAX_POLAR_ANGLE,
  DEFAULT_VIEW_DIRECTION,
} from '../src/lib/modelViewportFraming';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number];
const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Every bounding-sphere point must be inside the frustum (vertical and horizontal). */
function sphereFits(f: ReturnType<typeof computeModelFraming>, fovDeg: number, aspect: number) {
  const v = (fovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  const d = len(sub(f.position, f.target));
  return d * Math.sin(Math.min(v, h) / 2) >= f.radius - 1e-9;
}

// 1) Pivot = bounding-box centre, even for an asset authored far from the origin (map collision).
{
  const f = computeModelFraming([-1520, 790, 20], [-1480, 830, 60], 42, 1.6);
  assert(near(f.target[0], -1500) && near(f.target[1], 810) && near(f.target[2], 40), `pivot centre ${f.target}`);
  assert(sphereFits(f, 42, 1.6), 'map collision fits');
}

// 2) Distance scales with model size: a 0.3 m prop and a 400 m collision both frame identically.
{
  const small = computeModelFraming([-0.15, -0.15, -0.15], [0.15, 0.15, 0.15], 42, 1);
  const big = computeModelFraming([-200, -200, -200], [200, 200, 200], 42, 1);
  const ratio = big.distance / small.distance;
  assert(near(ratio, 400 / 0.3, 1e-6), `distance scales linearly (ratio ${ratio})`);
  assert(small.near < small.distance - small.radius, 'small: near plane in front of the model');
  assert(big.near < big.distance - big.radius, 'big: near plane in front of the model');
  assert(big.far > big.maxDistance + big.radius, 'big: far plane covers max zoom-out');
  assert(small.minDistance > small.near, 'small: min zoom never crosses the near plane');
  assert(sphereFits(small, 42, 1) && sphereFits(big, 42, 1), 'both fit');
}

// 3) Narrow sidebar panel (tall viewport): horizontal FOV must drive the fit.
{
  const car = { min: [-1, 0, -2.4] as const, max: [1, 1.5, 2.4] as const }; // ~GTA sedan after Z-up -> Y-up
  for (const aspect of [0.35, 0.6, 1, 1.8, 3]) {
    const f = computeModelFraming(car.min, car.max, 42, aspect);
    assert(sphereFits(f, 42, aspect), `car fits at aspect ${aspect}`);
  }
  const tall = computeModelFraming(car.min, car.max, 42, 0.35);
  const wide = computeModelFraming(car.min, car.max, 42, 1.8);
  assert(tall.distance > wide.distance, 'tall panel pulls the camera back');
}

// 4) Default view sits between the clamped poles (no flip / azimuth spin at start).
{
  const f = computeModelFraming([-1, -1, -1], [1, 1, 1], 42, 1);
  const polar = polarAngleOf(sub(f.position, f.target));
  assert(polar > MIN_POLAR_ANGLE && polar < MAX_POLAR_ANGLE, `polar ${polar}`);
  assert(MIN_POLAR_ANGLE > 0 && MAX_POLAR_ANGLE < Math.PI, 'poles clamped');
  assert(f.position[2] > f.target[2], 'camera on the +Z (glTF front) side');
  const dir = sub(f.position, f.target);
  const d = DEFAULT_VIEW_DIRECTION;
  const cos = (dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2]) / (len(dir) * len(d));
  assert(near(cos, 1, 1e-9), 'camera along default 3/4 direction');
}

// 5) Degenerate input never yields NaN (flat decal, empty/NaN bounds).
{
  for (const [mn, mx] of [
    [[0, 0, 0], [0, 0, 0]],
    [[-1, 0, -1], [1, 0, 1]],
    [[NaN, 0, 0], [1, 1, 1]],
    [[1, 1, 1], [-1, -1, -1]],
  ] as const) {
    const f = computeModelFraming(mn as never, mx as never, 42, 0);
    const vals = [...f.position, ...f.target, f.near, f.far, f.minDistance, f.maxDistance, f.distance];
    assert(vals.every(Number.isFinite), `finite framing for ${JSON.stringify([mn, mx])}`);
    assert(f.near > 0 && f.far > f.near, 'valid clip planes');
  }
}

// 6) RAGE Z-up/+Y-forward -> glTF Y-up/+Z-front is a proper rotation (no mirror, winding kept).
{
  const X = rageToGltfAxes([1, 0, 0]);
  const Y = rageToGltfAxes([0, 1, 0]);
  const Z = rageToGltfAxes([0, 0, 1]);
  assert(Z[0] === 0 && Z[1] === 1 && Z[2] === 0, 'RAGE up (+Z) -> three up (+Y)');
  assert(Y[0] === 0 && Y[1] === 0 && Y[2] === 1, 'RAGE forward (+Y) -> glTF front (+Z)');
  const c = cross(X, Y);
  assert(c[0] === Z[0] && c[1] === Z[1] && c[2] === Z[2], 'right-handed basis preserved (det +1)');
  // A triangle's normal rotates with it (winding preserved).
  const a = [0, 0, 0], b = [1, 0, 0], cc = [0, 1, 0];
  const n0 = cross(sub(b, a), sub(cc, a));
  const ra = rageToGltfAxes(a as never), rb = rageToGltfAxes(b as never), rc = rageToGltfAxes(cc as never);
  const n1 = cross(sub(rb, ra), sub(rc, ra));
  const rn0 = rageToGltfAxes(n0 as never);
  assert(n1.every((v, i) => near(v, rn0[i])), 'face normal follows the rotation');
}

console.log('model viewport framing: OK');
