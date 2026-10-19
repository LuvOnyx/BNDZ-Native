/**
 * Geometry primitives for the photo studio document model.
 *
 * Ported from photocraft (MIT/Apache):
 * - `crates/geom/src/lib.rs` — Size, Rect, Point, Affine
 * - `crates/algo/src/transform.rs` — Homography (projective warps)
 *
 * Document space is integer pixels with the origin at the canvas top-left.
 * Layers may extend beyond the canvas (negative coordinates are valid).
 */

export interface Size {
  width: number;
  height: number;
}

export function sizeNew(width: number, height: number): Size {
  return { width, height };
}

/** Integer rectangle, half-open: [x0, x1) x [y0, y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const RECT_EMPTY: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

export function rectNew(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x0, y0, x1, y1 };
}

export function rectFromXywh(x: number, y: number, w: number, h: number): Rect {
  return rectNew(x, y, x + w, y + h);
}

export function rectFromSize(s: Size): Rect {
  return rectFromXywh(0, 0, s.width, s.height);
}

export function rectWidth(r: Rect): number {
  return r.x1 > r.x0 ? r.x1 - r.x0 : 0;
}

export function rectHeight(r: Rect): number {
  return r.y1 > r.y0 ? r.y1 - r.y0 : 0;
}

export function rectIsEmpty(r: Rect): boolean {
  return r.x1 <= r.x0 || r.y1 <= r.y0;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
}

export function rectIntersect(a: Rect, b: Rect): Rect {
  const r = rectNew(Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1));
  return rectIsEmpty(r) ? { ...RECT_EMPTY } : r;
}

export function rectUnion(a: Rect, b: Rect): Rect {
  if (rectIsEmpty(a)) return { ...b };
  if (rectIsEmpty(b)) return { ...a };
  return rectNew(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1));
}

export function rectTranslate(r: Rect, dx: number, dy: number): Rect {
  return rectNew(r.x0 + dx, r.y0 + dy, r.x1 + dx, r.y1 + dy);
}

export function rectInflate(r: Rect, d: number): Rect {
  return rectNew(r.x0 - d, r.y0 - d, r.x1 + d, r.y1 + d);
}

export interface Point {
  x: number;
  y: number;
}

export function pointNew(x: number, y: number): Point {
  return { x, y };
}

/** 2D affine transform [a c e; b d f; 0 0 1] (column vectors), stored as [a, b, c, d, e, f]. */
export interface Affine {
  m: [number, number, number, number, number, number];
}

export const AFFINE_IDENTITY: Affine = { m: [1, 0, 0, 1, 0, 0] };

export function affineTranslate(dx: number, dy: number): Affine {
  return { m: [1, 0, 0, 1, dx, dy] };
}

export function affineScale(s: number): Affine {
  return { m: [s, 0, 0, s, 0, 0] };
}

export function affineScaleXY(sx: number, sy: number): Affine {
  return { m: [sx, 0, 0, sy, 0, 0] };
}

export function affineRotate(radians: number): Affine {
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  return { m: [c, s, -s, c, 0, 0] };
}

/** Matrix product self * o: apply o first, then self. */
export function affineMul(self: Affine, o: Affine): Affine {
  const [a, b, c, d, e, f] = self.m;
  const [oa, ob, oc, od, oe, of] = o.m;
  return {
    m: [a * oa + c * ob, b * oa + d * ob, a * oc + c * od, b * oc + d * od, a * oe + c * of + e, b * oe + d * of + f],
  };
}

/** self.then(other): apply self first, then other. */
export function affineThen(self: Affine, other: Affine): Affine {
  return affineMul(other, self);
}

export function affineApply(t: Affine, p: Point): Point {
  const [a, b, c, d, e, f] = t.m;
  return pointNew(a * p.x + c * p.y + e, b * p.x + d * p.y + f);
}

export function affineDeterminant(t: Affine): number {
  return t.m[0] * t.m[3] - t.m[1] * t.m[2];
}

/** Inverse transform; undefined when the matrix is degenerate. */
export function affineInvert(t: Affine): Affine | undefined {
  const det = affineDeterminant(t);
  if (Math.abs(det) < 1e-12) return undefined;
  const [a, b, c, d, e, f] = t.m;
  const inv = 1 / det;
  return { m: [d * inv, -b * inv, -c * inv, a * inv, (c * f - d * e) * inv, (b * e - a * f) * inv] };
}

/**
 * 3x3 projective matrix, row-major: [x', y', w'] = H * [x, y, 1].
 * Used for Free Transform's Distort / Perspective modes; affine
 * scale/rotate/skew/flip are special cases.
 */
export interface Homography {
  m: [number, number, number, number, number, number, number, number, number];
}

export const HOMOGRAPHY_IDENTITY: Homography = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

export function homographyApply(h: Homography, x: number, y: number): [number, number] {
  const m = h.m;
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

export function homographyMul(self: Homography, o: Homography): Homography {
  const a = self.m;
  const b = o.m;
  const r = new Array(9).fill(0) as [number, number, number, number, number, number, number, number, number];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return { m: r };
}

export function homographyInverse(h: Homography): Homography | undefined {
  const m = h.m;
  const c = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
  const det = m[0] * c[0] + m[1] * c[3] + m[2] * c[6];
  if (Math.abs(det) < 1e-12) return undefined;
  return { m: c.map((v) => v / det) as Homography['m'] };
}

/** Unit square -> quad (corners in order: (0,0), (1,0), (1,1), (0,1)). */
function squareToQuad(q: [[number, number], [number, number], [number, number], [number, number]]): Homography | undefined {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // Affine.
    return { m: [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1] };
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return undefined;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return { m: [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1] };
}

/**
 * The transform taking rectangle r ([x0, y0, x1, y1]) onto quad
 * (corners clockwise from top-left). Undefined for degenerate quads.
 */
export function homographyFromRectToQuad(
  r: [number, number, number, number],
  quad: [[number, number], [number, number], [number, number], [number, number]],
): Homography | undefined {
  const w = r[2] - r[0];
  const h = r[3] - r[1];
  if (w <= 0 || h <= 0) return undefined;
  const toUnit: Homography = { m: [1 / w, 0, -r[0] / w, 0, 1 / h, -r[1] / h, 0, 0, 1] };
  const s2q = squareToQuad(quad);
  if (!s2q) return undefined;
  return homographyMul(s2q, toUnit);
}
