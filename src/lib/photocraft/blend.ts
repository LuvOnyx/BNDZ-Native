/**
 * Photoshop blend modes — scalar reference implementation.
 *
 * Ported from photocraft (MIT/Apache), source: `crates/color/src/blend.rs`.
 * Formulas follow the public PDF / ISO 32000-2 and W3C Compositing definitions,
 * with Photoshop's variants where they differ (Soft Light, Hard Mix,
 * Darker/Lighter Color, Linear Burn/Dodge, Vivid/Linear/Pin Light, Subtract,
 * Divide). All values are normalized floats (0..1).
 */

/** All 28 blend modes: PassThrough (groups only) plus the 27 layer modes. */
export type BlendMode =
  | 'pass-through'
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Photoshop menu groups (the menu shows separators between them). */
export type BlendModeCategory =
  | 'passthrough'
  | 'normal'
  | 'darken'
  | 'lighten'
  | 'contrast'
  | 'inversion'
  | 'color';

export interface BlendModeMeta {
  /** Stable id (same as the BlendMode value). */
  id: BlendMode;
  /** Display name, as shown in the Photoshop blend menu. */
  label: string;
  /** Photoshop menu group. */
  category: BlendModeCategory;
  /** PSD 4-character blend key. */
  psdKey: string;
  /** False for the non-separable modes (hue, saturation, color, luminosity) and the whole-pixel modes (darker/lighter color). */
  separable: boolean;
}

/** All modes except PassThrough, in Photoshop menu order. */
export const LAYER_MODES: readonly BlendMode[] = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'color-burn',
  'linear-burn',
  'darker-color',
  'lighten',
  'screen',
  'color-dodge',
  'linear-dodge',
  'lighter-color',
  'overlay',
  'soft-light',
  'hard-light',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export const BLEND_MODE_META: Record<BlendMode, BlendModeMeta> = {
  'pass-through': { id: 'pass-through', label: 'Pass Through', category: 'passthrough', psdKey: 'pass', separable: true },
  'normal': { id: 'normal', label: 'Normal', category: 'normal', psdKey: 'norm', separable: true },
  'dissolve': { id: 'dissolve', label: 'Dissolve', category: 'normal', psdKey: 'diss', separable: true },
  'darken': { id: 'darken', label: 'Darken', category: 'darken', psdKey: 'dark', separable: true },
  'multiply': { id: 'multiply', label: 'Multiply', category: 'darken', psdKey: 'mul ', separable: true },
  'color-burn': { id: 'color-burn', label: 'Color Burn', category: 'darken', psdKey: 'idiv', separable: true },
  'linear-burn': { id: 'linear-burn', label: 'Linear Burn', category: 'darken', psdKey: 'lbrn', separable: true },
  'darker-color': { id: 'darker-color', label: 'Darker Color', category: 'darken', psdKey: 'dkCl', separable: false },
  'lighten': { id: 'lighten', label: 'Lighten', category: 'lighten', psdKey: 'lite', separable: true },
  'screen': { id: 'screen', label: 'Screen', category: 'lighten', psdKey: 'scrn', separable: true },
  'color-dodge': { id: 'color-dodge', label: 'Color Dodge', category: 'lighten', psdKey: 'div ', separable: true },
  'linear-dodge': { id: 'linear-dodge', label: 'Linear Dodge (Add)', category: 'lighten', psdKey: 'lddg', separable: true },
  'lighter-color': { id: 'lighter-color', label: 'Lighter Color', category: 'lighten', psdKey: 'lgCl', separable: false },
  'overlay': { id: 'overlay', label: 'Overlay', category: 'contrast', psdKey: 'over', separable: true },
  'soft-light': { id: 'soft-light', label: 'Soft Light', category: 'contrast', psdKey: 'sLit', separable: true },
  'hard-light': { id: 'hard-light', label: 'Hard Light', category: 'contrast', psdKey: 'hLit', separable: true },
  'vivid-light': { id: 'vivid-light', label: 'Vivid Light', category: 'contrast', psdKey: 'vLit', separable: true },
  'linear-light': { id: 'linear-light', label: 'Linear Light', category: 'contrast', psdKey: 'lLit', separable: true },
  'pin-light': { id: 'pin-light', label: 'Pin Light', category: 'contrast', psdKey: 'pLit', separable: true },
  'hard-mix': { id: 'hard-mix', label: 'Hard Mix', category: 'contrast', psdKey: 'hMix', separable: true },
  'difference': { id: 'difference', label: 'Difference', category: 'inversion', psdKey: 'diff', separable: true },
  'exclusion': { id: 'exclusion', label: 'Exclusion', category: 'inversion', psdKey: 'smud', separable: true },
  'subtract': { id: 'subtract', label: 'Subtract', category: 'inversion', psdKey: 'fsub', separable: true },
  'divide': { id: 'divide', label: 'Divide', category: 'inversion', psdKey: 'fdiv', separable: true },
  'hue': { id: 'hue', label: 'Hue', category: 'color', psdKey: 'hue ', separable: false },
  'saturation': { id: 'saturation', label: 'Saturation', category: 'color', psdKey: 'sat ', separable: false },
  'color': { id: 'color', label: 'Color', category: 'color', psdKey: 'colr', separable: false },
  'luminosity': { id: 'luminosity', label: 'Luminosity', category: 'color', psdKey: 'lum ', separable: false },
};

export function blendModeFromPsdKey(key: string): BlendMode | undefined {
  const all: BlendMode[] = ['pass-through', ...LAYER_MODES];
  return all.find((m) => BLEND_MODE_META[m].psdKey === key);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function colorBurn(cb: number, cs: number): number {
  if (cb >= 1) return 1;
  if (cs <= 0) return 0;
  return 1 - Math.min((1 - cb) / cs, 1);
}

function colorDodge(cb: number, cs: number): number {
  if (cb <= 0) return 0;
  if (cs >= 1) return 1;
  return Math.min(cb / (1 - cs), 1);
}

function hardLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb * 2 * cs;
  const s = 2 * cs - 1;
  return cb + s - cb * s;
}

/** Photoshop's Soft Light (differs from the W3C/PDF definition in the upper half). */
function softLightPs(cb: number, cs: number): number {
  if (cs <= 0.5) return 2 * cb * cs + cb * cb * (1 - 2 * cs);
  return 2 * cb * (1 - cs) + Math.sqrt(Math.max(cb, 0)) * (2 * cs - 1);
}

function vividLightHardMix(cb: number, cs: number): number {
  const edge = 1e-4;
  if (cs <= 0.5) {
    if (cb >= 1 - edge) return 1;
    if (cs <= 0) return 0;
    return 1 - Math.min((1 - cb) / (2 * cs), 1);
  }
  if (cb <= edge) return 0;
  if (cs >= 1) return 1;
  return Math.min(cb / (2 * (1 - cs)), 1);
}

/** Separable per-channel blend function B(cb, cs). */
export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'normal':
    case 'dissolve':
    case 'pass-through':
      return cs;
    case 'darken':
      return Math.min(cb, cs);
    case 'multiply':
      return cb * cs;
    case 'color-burn':
      return colorBurn(cb, cs);
    case 'linear-burn':
      return Math.max(cb + cs - 1, 0);
    case 'lighten':
      return Math.max(cb, cs);
    case 'screen':
      return cb + cs - cb * cs;
    case 'color-dodge':
      return colorDodge(cb, cs);
    case 'linear-dodge':
      return Math.min(cb + cs, 1);
    case 'overlay':
      return hardLight(cs, cb);
    case 'soft-light':
      return softLightPs(cb, cs);
    case 'hard-light':
      return hardLight(cb, cs);
    case 'vivid-light':
      if (cs <= 0) return 0;
      if (cs >= 1) return 1;
      return cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * (cs - 0.5));
    case 'linear-light':
      return clamp01(cb + 2 * cs - 1);
    case 'pin-light':
      return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    case 'hard-mix':
      return vividLightHardMix(cb, cs) >= 0.5 - 1e-6 ? 1 : 0;
    case 'difference':
      return Math.abs(cb - cs);
    case 'exclusion':
      return cb + cs - 2 * cb * cs;
    case 'subtract':
      return Math.max(cb - cs, 0);
    case 'divide':
      if (cs <= 0) return cb <= 0 ? 0 : 1;
      return Math.min(cb / cs, 1);
    // Non-separable modes are handled by blendRgb; fall back to source.
    case 'darker-color':
    case 'lighter-color':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return cs;
  }
}

/** W3C Compositing Level 1 luminosity of an RGB triple. */
export function rgbLuminance(c: readonly [number, number, number]): number {
  return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
}

function clipColor(c: [number, number, number]): [number, number, number] {
  const l = rgbLuminance(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  const out: [number, number, number] = [c[0], c[1], c[2]];
  if (n < 0) {
    const d = l - n;
    for (let i = 0; i < 3; i++) out[i] = Math.abs(d) < 1e-12 ? l : l + (out[i] - l) * (l / d);
  }
  if (x > 1) {
    const d = x - l;
    for (let i = 0; i < 3; i++) out[i] = Math.abs(d) < 1e-12 ? l : l + (out[i] - l) * ((1 - l) / d);
  }
  return out;
}

/** `c` with its luminosity moved to `l`, clipped back into gamut towards grey. */
export function setLuminance(c: readonly [number, number, number], l: number): [number, number, number] {
  const d = l - rgbLuminance(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

function saturation(c: readonly [number, number, number]): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

function setSaturation(c: readonly [number, number, number], s: number): [number, number, number] {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [imin, imid, imax] = idx as [number, number, number];
  const out: [number, number, number] = [0, 0, 0];
  if (c[imax] > c[imin]) {
    out[imid] = ((c[imid] - c[imin]) * s) / (c[imax] - c[imin]);
    out[imax] = s;
  }
  out[imin] = 0;
  return out;
}

/** Blend a whole RGB triple B(Cb, Cs), including the non-separable modes. */
export function blendRgb(
  mode: BlendMode,
  cb: readonly [number, number, number],
  cs: readonly [number, number, number],
): [number, number, number] {
  switch (mode) {
    case 'hue':
      return setLuminance(setSaturation(cs, saturation(cb)), rgbLuminance(cb));
    case 'saturation':
      return setLuminance(setSaturation(cb, saturation(cs)), rgbLuminance(cb));
    case 'color':
      return setLuminance(cs, rgbLuminance(cb));
    case 'luminosity':
      return setLuminance(cb, rgbLuminance(cs));
    case 'darker-color':
      return rgbLuminance(cs) < rgbLuminance(cb) ? [cs[0], cs[1], cs[2]] : [cb[0], cb[1], cb[2]];
    case 'lighter-color':
      return rgbLuminance(cs) > rgbLuminance(cb) ? [cs[0], cs[1], cs[2]] : [cb[0], cb[1], cb[2]];
    default:
      return [blendChannel(mode, cb[0], cs[0]), blendChannel(mode, cb[1], cs[1]), blendChannel(mode, cb[2], cs[2])];
  }
}

export type Rgba = [number, number, number, number];

/**
 * Composite a straight-alpha source over a straight-alpha backdrop with blend
 * mode and opacity. Uses the W3C/PDF general formula:
 * alpha_o = alpha_s + alpha_b * (1 - alpha_s),
 * alpha_o * C_o = (1 - alpha_s) * alpha_b * C_b + (1 - alpha_b) * alpha_s * C_s + alpha_s * alpha_b * B(C_b, C_s).
 * Dissolve must be resolved by the caller (per-pixel coverage decision) before calling.
 */
export function composite(mode: BlendMode, backdrop: Rgba, source: Rgba, opacity: number): Rgba {
  const ab = backdrop[3];
  const as_ = source[3] * opacity;
  if (as_ <= 0) return [...backdrop] as Rgba;
  const cb: [number, number, number] = [backdrop[0], backdrop[1], backdrop[2]];
  const cs: [number, number, number] = [source[0], source[1], source[2]];
  const b = blendRgb(mode, cb, cs);
  const ao = as_ + ab * (1 - as_);
  if (ao <= 0) return [0, 0, 0, 0];
  const out: Rgba = [0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = ((1 - as_) * ab * cb[i] + (1 - ab) * as_ * cs[i] + as_ * ab * b[i]) / ao;
  }
  out[3] = ao;
  return out;
}
