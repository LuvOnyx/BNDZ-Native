/**
 * Photo Studio pixel engine — raster operations that work directly on a
 * layer's pixels (paint, erase, fill, gradient, selections), plus the
 * adjustment LUT builder ported from photocraft's adjustment definitions
 * (src/lib/photocraft). Everything here is plain canvas2d/ImageData so the
 * math is identical in preview and export.
 */
import type { Adjustment } from '../../lib/photocraft';

/* ---------------------------------- types --------------------------------- */

export interface DocPoint { x: number; y: number }

export type SelectionShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number }
  | { kind: 'polygon'; points: DocPoint[] }
  | { kind: 'mask'; canvas: HTMLCanvasElement };

/* ------------------------------ canvas helpers ----------------------------- */

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** Draw a selection shape as a filled path on ctx (doc/layer pixel space). */
export function traceSelection(ctx: CanvasRenderingContext2D, sel: SelectionShape): void {
  ctx.beginPath();
  if (sel.kind === 'rect') {
    ctx.rect(sel.x, sel.y, sel.w, sel.h);
  } else if (sel.kind === 'ellipse') {
    ctx.ellipse(sel.x + sel.w / 2, sel.y + sel.h / 2, Math.abs(sel.w / 2), Math.abs(sel.h / 2), 0, 0, Math.PI * 2);
  } else if (sel.kind === 'polygon') {
    sel.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
}

/** Build a grayscale mask canvas (white = selected) for any selection shape. */
export function selectionToMask(sel: SelectionShape, w: number, h: number): HTMLCanvasElement {
  if (sel.kind === 'mask') return cloneCanvas(sel.canvas);
  const m = makeCanvas(w, h);
  const ctx = m.getContext('2d')!;
  ctx.fillStyle = '#fff';
  traceSelection(ctx, sel);
  ctx.fill();
  return m;
}

export function invertMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = cloneCanvas(mask);
  const ctx = out.getContext('2d')!;
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/* ------------------------------- flood tools ------------------------------- */

function colorDist(data: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): number {
  const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b, da = data[i + 3] - a;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da * 0.25);
}

/** Magic-wand mask: flood from (x,y) selecting pixels within tolerance of the seed color. */
export function wandMask(source: HTMLCanvasElement, x: number, y: number, tolerance: number): HTMLCanvasElement {
  const w = source.width, h = source.height;
  const mask = makeCanvas(w, h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return mask;
  const sctx = source.getContext('2d', { willReadFrequently: true })!;
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const si = (y * w + x) * 4;
  const sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
  const tol = tolerance * 4.41; // 0..100 slider → distance space (max ~441)
  const seen = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const stack: number[] = [y * w + x];
  seen[y * w + x] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % w, py = (p / w) | 0;
    if (colorDist(d, p * 4, sr, sg, sb, sa) <= tol) {
      out[p] = 255;
      if (px > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (py < h - 1 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
  }
  const mctx = mask.getContext('2d')!;
  const mimg = mctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    mimg.data[i * 4] = 255; mimg.data[i * 4 + 1] = 255; mimg.data[i * 4 + 2] = 255;
    mimg.data[i * 4 + 3] = out[i];
  }
  mctx.putImageData(mimg, 0, 0);
  return mask;
}

/** Paint-bucket flood fill on a layer canvas at (x, y), honoring an optional mask. */
export function floodFill(target: HTMLCanvasElement, x: number, y: number, fill: string, tolerance: number, mask?: HTMLCanvasElement | null): void {
  const region = wandMask(target, x, y, tolerance);
  const ctx = target.getContext('2d')!;
  const paint = makeCanvas(target.width, target.height);
  const pctx = paint.getContext('2d')!;
  pctx.fillStyle = fill;
  pctx.fillRect(0, 0, paint.width, paint.height);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(region, 0, 0);
  if (mask) {
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(mask, 0, 0);
  }
  ctx.drawImage(paint, 0, 0);
}

/* --------------------------- masked pixel edits ---------------------------- */

/** Erase (to transparent) the selected area of a layer canvas. No selection = whole canvas. */
export function clearSelection(target: HTMLCanvasElement, sel: SelectionShape | null): void {
  const ctx = target.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  if (!sel) {
    ctx.fillRect(0, 0, target.width, target.height);
  } else if (sel.kind === 'mask') {
    ctx.drawImage(sel.canvas, 0, 0);
  } else {
    traceSelection(ctx, sel);
    ctx.fill();
  }
  ctx.restore();
}

/** Fill the selected area of a layer canvas with a color. No selection = whole canvas. */
export function fillSelection(target: HTMLCanvasElement, sel: SelectionShape | null, color: string): void {
  const ctx = target.getContext('2d')!;
  ctx.save();
  ctx.fillStyle = color;
  if (!sel) ctx.fillRect(0, 0, target.width, target.height);
  else if (sel.kind === 'mask') {
    const paint = makeCanvas(target.width, target.height);
    const pctx = paint.getContext('2d')!;
    pctx.fillStyle = color;
    pctx.fillRect(0, 0, paint.width, paint.height);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(sel.canvas, 0, 0);
    ctx.drawImage(paint, 0, 0);
  } else {
    traceSelection(ctx, sel);
    ctx.fill();
  }
  ctx.restore();
}

/** Linear gradient rendered into a layer canvas, clipped by the selection. */
export function paintGradient(
  target: HTMLCanvasElement, from: DocPoint, to: DocPoint,
  fromColor: string, toColor: string, sel: SelectionShape | null,
): void {
  const layer = makeCanvas(target.width, target.height);
  const lctx = layer.getContext('2d')!;
  const g = lctx.createLinearGradient(from.x, from.y, to.x, to.y);
  g.addColorStop(0, fromColor);
  g.addColorStop(1, toColor);
  lctx.fillStyle = g;
  lctx.fillRect(0, 0, layer.width, layer.height);
  if (sel) {
    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(selectionToMask(sel, target.width, target.height), 0, 0);
  }
  target.getContext('2d')!.drawImage(layer, 0, 0);
}

/* ------------------------------ stroke paint ------------------------------- */

/**
 * Draw one brush segment onto a layer canvas, in layer pixel coordinates.
 * mode 'paint' lays color down; 'erase' removes alpha.
 */
export function paintSegment(
  target: HTMLCanvasElement, from: DocPoint, to: DocPoint,
  size: number, color: string, opacity: number, erase: boolean, soft: boolean,
): void {
  const ctx = target.getContext('2d')!;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;
  if (erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = '#000';
  } else if (soft) {
    ctx.globalAlpha = opacity * 0.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.45;
  } else {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
  }
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x + 0.01, to.y + 0.01);
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------- adjustment LUTs ------------------------------ */

export interface LutSet { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray }

function identityLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  return lut;
}

function applyLutFn(lut: Uint8ClampedArray, fn: (v: number) => number): void {
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, Math.round(fn(lut[i] / 255) * 255)));
}

/** Smooth curve through control points (monotone-ish cubic via Catmull-Rom sampling). */
function curveLut(points: { input: number; output: number }[]): Uint8ClampedArray {
  const lut = identityLut();
  const pts = [...points].sort((a, b) => a.input - b.input);
  if (pts.length < 2) return lut;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1].input < x) j++;
    const p0 = pts[Math.max(0, j - 1)], p1 = pts[j], p2 = pts[j + 1], p3 = pts[Math.min(pts.length - 1, j + 2)];
    const t = Math.max(0, Math.min(1, (x - p1.input) / Math.max(1e-6, p2.input - p1.input)));
    const t2 = t * t, t3 = t2 * t;
    const y = 0.5 * ((2 * p1.output) + (-p0.output + p2.output) * t + (2 * p0.output - 5 * p1.output + 4 * p2.output - p3.output) * t2 + (-p0.output + 3 * p1.output - 3 * p2.output + p3.output) * t3);
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

/**
 * Build per-channel LUTs for one adjustment. Covers the LUT-expressible
 * photocraft adjustments: BrightnessContrast, Exposure (gamma), Levels,
 * Curves, Invert, Posterize, Threshold, BlackWhite (luminance mix),
 * ChannelMixer (gray weights) and GradientMap handled separately (needs
 * full-color mapping — see applyAdjustmentToCanvas).
 */
export function buildLuts(adj: Adjustment): LutSet | null {
  const r = identityLut(), g = identityLut(), b = identityLut();
  const all = (fn: (v: number) => number) => { applyLutFn(r, fn); applyLutFn(g, fn); applyLutFn(b, fn); };
  switch (adj.kind) {
    case 'brightness-contrast': {
      const br = adj.brightness / 300; // Photoshop range -150..150 -> -0.5..0.5
      const co = Math.max(-255, Math.min(255, adj.contrast * 2.55));
      const factor = (259 * (co + 255)) / (255 * (259 - co));
      all(v => factor * (v + br - 0.5) + 0.5);
      break;
    }
    case 'exposure':
      all(v => Math.pow(Math.max(0, v * Math.pow(2, adj.exposure) + adj.offset), 1 / Math.max(0.05, adj.gamma)));
      break;
    case 'levels': {
      const chanLut = (ch: { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }) => {
        const lut = identityLut();
        applyLutFn(lut, v => {
          const tt = Math.max(0, Math.min(1, (v - ch.inBlack) / Math.max(0.001, ch.inWhite - ch.inBlack)));
          return ch.outBlack + Math.pow(tt, 1 / Math.max(0.05, ch.gamma)) * (ch.outWhite - ch.outBlack);
        });
        return lut;
      };
      const m = chanLut(adj.master);
      const lr = chanLut(adj.perChannel[0]), lg = chanLut(adj.perChannel[1]), lb = chanLut(adj.perChannel[2]);
      for (let i = 0; i < 256; i++) { r[i] = lr[m[i]]; g[i] = lg[m[i]]; b[i] = lb[m[i]]; }
      return { r, g, b };
    }
    case 'curves': {
      const master = curveLut(adj.master);
      const cr = curveLut(adj.perChannel[0]), cg = curveLut(adj.perChannel[1]), cb = curveLut(adj.perChannel[2]);
      for (let i = 0; i < 256; i++) {
        r[i] = cr[master[i]]; g[i] = cg[master[i]]; b[i] = cb[master[i]];
      }
      return { r, g, b };
    }
    case 'invert':
      all(v => 1 - v);
      break;
    case 'posterize': {
      const levels = Math.max(2, adj.levels);
      all(v => Math.round(v * (levels - 1)) / (levels - 1));
      break;
    }
    case 'threshold':
      all(v => (v >= adj.level ? 1 : 0));
      break;
    case 'hue-saturation':
      return null; // handled per-pixel (HSL space)
    default:
      return null;
  }
  return { r, g, b };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t; if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/**
 * Apply one adjustment to a canvas in place (returns a new canvas — the
 * input is left untouched so adjustments stay non-destructive).
 */
export function applyAdjustmentToCanvas(source: HTMLCanvasElement, adj: Adjustment): HTMLCanvasElement {
  const out = cloneCanvas(source);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const luts = buildLuts(adj);
  if (luts) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = luts.r[d[i]]; d[i + 1] = luts.g[d[i + 1]]; d[i + 2] = luts.b[d[i + 2]];
    }
  } else if (adj.kind === 'hue-saturation') {
    const hueShift = adj.hue / 360, satMul = 1 + adj.saturation / 100, lightShift = adj.lightness / 200;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      const [nr, ng, nb] = hslToRgb((h + hueShift + 1) % 1, Math.max(0, Math.min(1, s * satMul)), Math.max(0, Math.min(1, l + lightShift)));
      d[i] = nr * 255; d[i + 1] = ng * 255; d[i + 2] = nb * 255;
    }
  } else if (adj.kind === 'black-white') {
    const [wr, wg, wb, wy, wc, wm] = adj.weights;
    const wsum = Math.max(0.0001, wr + wg + wb + wy + wc + wm);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const v = (r * wr + g * wg + b * wb + Math.min(r, g) * wy + Math.min(g, b) * wc + Math.min(r, b) * wm) / wsum;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
    if (adj.tint) {
      const [tr, tg, tb] = adj.tint;
      for (let i = 0; i < d.length; i += 4) {
        d[i] *= tr * 1.6; d[i + 1] *= tg * 1.6; d[i + 2] *= tb * 1.6;
      }
    }
  } else if (adj.kind === 'vibrance') {
    const amt = adj.vibrance / 100, sat = 1 + adj.saturation / 100;
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      const boost = s * sat + amt * (1 - s) * s;
      const [nr, ng, nb] = hslToRgb(h, Math.max(0, Math.min(1, boost)), l);
      d[i] = nr * 255; d[i + 1] = ng * 255; d[i + 2] = nb * 255;
    }
  } else if (adj.kind === 'gradient-map') {
    const rawStops = adj.stops.length >= 2 ? adj.stops : [[0, [0, 0, 0]], [1, [1, 1, 1]]] as Array<[number, [number, number, number]]>;
    const stops = [...rawStops].sort((a, b2) => a[0] - b2[0])
      .map(([at, c]) => ({ at: adj.reverse ? 1 - at : at, rgb: [c[0] * 255, c[1] * 255, c[2] * 255] as [number, number, number] }))
      .sort((a, b2) => a.at - b2.at);
    const table: [number, number, number][] = [];
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let a = stops[0] ?? { at: 0, rgb: [0, 0, 0] as [number, number, number] };
      let b = stops[stops.length - 1] ?? a;
      for (let j = 0; j < stops.length - 1; j++) if (t >= stops[j].at && t <= stops[j + 1].at) { a = stops[j]; b = stops[j + 1]; break; }
      const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
      table.push([a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f, a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f, a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f]);
    }
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      const [nr, ng, nb] = table[Math.max(0, Math.min(255, lum))];
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
    }
  } else if (adj.kind === 'photo-filter') {
    const [fr, fg, fb] = [adj.color[0] * 255, adj.color[1] * 255, adj.color[2] * 255];
    const den = Math.max(0, Math.min(1, adj.density));
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (fr - d[i]) * den; d[i + 1] += (fg - d[i + 1]) * den; d[i + 2] += (fb - d[i + 2]) * den;
    }
  } else if (adj.kind === 'channel-mixer') {
    const m = adj.matrix;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const nr = r * m[0][0] + g * m[0][1] + b * m[0][2] + m[0][3] * 255;
      const ng = r * m[1][0] + g * m[1][1] + b * m[1][2] + m[1][3] * 255;
      const nb = r * m[2][0] + g * m[2][1] + b * m[2][2] + m[2][3] * 255;
      if (adj.monochrome) { d[i] = nr; d[i + 1] = nr; d[i + 2] = nr; }
      else { d[i] = nr; d[i + 1] = ng; d[i + 2] = nb; }
    }
  } else if (adj.kind === 'color-balance') {
    const mix = (v: number, s: number, m: number, h: number, l: number) => {
      const amt = l < 0.5 ? s * (1 - l * 2) + m * 0 : l > 0.5 ? h * (l * 2 - 1) : m;
      return v + amt * (1 - Math.abs(v / 127.5 - 1)) * 0.5;
    };
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      d[i] = mix(d[i], adj.shadows[0], adj.midtones[0], adj.highlights[0], lum);
      d[i + 1] = mix(d[i + 1], adj.shadows[1], adj.midtones[1], adj.highlights[1], lum);
      d[i + 2] = mix(d[i + 2], adj.shadows[2], adj.midtones[2], adj.highlights[2], lum);
    }
  } else if (adj.kind === 'selective-color') {
    // Range order: reds, yellows, greens, cyans, blues, magentas, whites, neutrals, blacks.
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let idx: number;
      if (mx - mn < 0.08) idx = mx > 0.85 ? 6 : mx < 0.15 ? 8 : 7;
      else if (mx === r && mn === b) idx = g > (r + b) / 2 ? 1 : 0;
      else if (mx === r) idx = 5;
      else if (mx === g && mn === b) idx = 2;
      else if (mx === g) idx = 3;
      else if (mn === r) idx = 4;
      else idx = 5;
      const [cc, mm, yy, kk] = adj.adjustments[idx];
      const scale = adj.relative ? mx : 1;
      d[i] = Math.max(0, Math.min(255, d[i] - cc * 2.55 * scale * (idx === 0 || idx === 1 || idx === 5 ? 1 : 0.35)));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] - yy * 2.55 * scale * (idx === 1 || idx === 2 || idx === 3 ? 1 : 0.35)));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] - mm * 2.55 * scale * (idx === 3 || idx === 4 || idx === 5 ? 1 : 0.35)));
      const dk = kk * 2.55 * scale * 0.4;
      d[i] -= dk; d[i + 1] -= dk; d[i + 2] -= dk;
    }
  } else if (adj.kind === 'color-lookup') {
    // No LUT file loaded = identity (a .cube can be dropped on the layer later).
    return out;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Apply a chain of adjustments (an adjustment layer's stack) to a canvas. */
export function applyAdjustments(source: HTMLCanvasElement, adjustments: Adjustment[]): HTMLCanvasElement {
  let cur = source;
  for (const adj of adjustments) cur = applyAdjustmentToCanvas(cur, adj);
  return cur;
}
