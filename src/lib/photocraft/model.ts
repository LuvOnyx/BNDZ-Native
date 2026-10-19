/**
 * Photo studio document model — the single source of truth for layers.
 *
 * Ported from photocraft (MIT/Apache):
 * - `crates/doc/src/lib.rs` — LayerId, Locks, LabelColor, LayerMask, Effects,
 *   Group, Fill, TextLayer, ShapeLayer, SmartObject, LayerContent, Layer, Document
 * - `crates/doc/src/adjust.rs` — Adjustment, CurvePoint, LevelsChannel, ToneSpace, HueRange
 * - `crates/doc/src/effects.rs` — Effect, Shadow, Glow, StrokeFx, Satin, Bevel, Gradient, GlobalLight
 * - `crates/doc/src/blend_if.rs` — BlendRange, BlendIf
 * - `crates/doc/src/vector.rs` — VectorMask
 *
 * Raster pixel data and vector paths live in the renderer (Fabric); this model
 * keeps only document structure. Pixels are referenced abstractly via
 * `surfaceRef` / `pathRef` placeholders, never embedded.
 */

import type { BlendMode } from './blend';
import type { Affine, Point } from './geometry';
import { AFFINE_IDENTITY } from './geometry';

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

/** Normalized RGBA color (0..1 per channel). */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function colorRgb(r: number, g: number, b: number, a = 1): RgbColor {
  return { r, g, b, a };
}

export const COLOR_BLACK: RgbColor = { r: 0, g: 0, b: 0, a: 1 };
export const COLOR_WHITE: RgbColor = { r: 1, g: 1, b: 1, a: 1 };
export const COLOR_TRANSPARENT: RgbColor = { r: 0, g: 0, b: 0, a: 0 };

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export type LayerId = number;

let nextId = 1;

/** Mint a fresh layer/document id. */
export function freshLayerId(): LayerId {
  return nextId++;
}

/**
 * Advance the id counter past `max`, so ids loaded from a file never collide
 * with ids minted later.
 */
export function ensureIdsAbove(max: number): void {
  nextId = Math.max(nextId, max + 1);
}

/* ------------------------------------------------------------------ */
/* Locks, labels, masks                                                */
/* ------------------------------------------------------------------ */

/** Photoshop layer locks. */
export interface Locks {
  transparency: boolean;
  pixels: boolean;
  position: boolean;
  artboard: boolean;
  all: boolean;
}

export const LOCKS_NONE: Locks = { transparency: false, pixels: false, position: false, artboard: false, all: false };

export function unionLocks(a: Locks, b: Locks): Locks {
  return {
    transparency: a.transparency || b.transparency,
    pixels: a.pixels || b.pixels,
    position: a.position || b.position,
    artboard: a.artboard || b.artboard,
    all: a.all || b.all,
  };
}

/** Photoshop layer color labels. */
export type LabelColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray';

/**
 * A layer's raster mask. `surfaceRef` points at the grayscale mask pixels in
 * the renderer (untouched pixels read as 1 = reveal). `density` and `feather`
 * follow the Properties panel semantics.
 */
export interface LayerMask {
  surfaceRef?: string;
  enabled: boolean;
  linked: boolean;
  density: number;
  feather: number;
}

export function revealAllMask(): LayerMask {
  return { enabled: true, linked: true, density: 1, feather: 0 };
}

/** A vector mask (Layer > Vector Mask); shape layers keep their outline in `pathRef` instead. */
export interface VectorMask {
  pathRef?: string;
  enabled: boolean;
  /** Moves with the layer. */
  linked: boolean;
  /** Density 0..1 (Properties panel). */
  density: number;
  /** Feather radius in px (stored; rendered unfeathered for now). */
  feather: number;
}

export function vectorMask(pathRef?: string): VectorMask {
  return { pathRef, enabled: true, linked: true, density: 1, feather: 0 };
}

/* ------------------------------------------------------------------ */
/* Blend If                                                            */
/* ------------------------------------------------------------------ */

/**
 * One Blend If slider pair: `black` = (low, high), `white` = (low, high),
 * all on 0..=255.
 */
export interface BlendRange {
  black: [number, number];
  white: [number, number];
}

export const BLEND_RANGE_FULL: BlendRange = { black: [0, 0], white: [255, 255] };

export function blendRangeIsFull(r: BlendRange): boolean {
  return r.black[0] === 0 && r.black[1] === 0 && r.white[0] === 255 && r.white[1] === 255;
}

/**
 * How much of a pixel with value `v` (0..=255) shows: 0 below the black point
 * or above the white point, 1 between them, and a linear ramp across a split
 * point.
 */
export function blendRangeWeight(r: BlendRange, v: number): number {
  const ramp = (lo: number, hi: number, x: number): number => {
    if (hi <= lo) return x >= lo ? 1 : 0;
    return Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
  };
  const lo = ramp(r.black[0], r.black[1], v);
  // Mirror for the white point: 1 at or below its low half, 0 above its high half.
  const hi = ramp(255 - r.white[1], 255 - r.white[0], 255 - v);
  return lo * hi;
}

/**
 * A layer's Blend If settings. `ranges[0]` is the "Gray" entry (composite of
 * the color channels), then one entry per color channel of the document mode
 * (R, G, B / C, M, Y, K / L, a, b / Gray), each as [this layer, underlying
 * layer]. Empty = every pixel blends.
 */
export interface BlendIf {
  ranges: Array<[BlendRange, BlendRange]>;
}

export function blendIfDefault(): BlendIf {
  return { ranges: [] };
}

/** Whether no range hides anything (the Photoshop default). */
export function blendIfIsDefault(b: BlendIf): boolean {
  return b.ranges.every((pair) => blendRangeIsFull(pair[0]) && blendRangeIsFull(pair[1]));
}

/** Entry `i` (0 = Gray); full when not stored. */
export function blendIfGet(b: BlendIf, i: number): [BlendRange, BlendRange] {
  return b.ranges[i] ?? [{ ...BLEND_RANGE_FULL }, { ...BLEND_RANGE_FULL }];
}

/**
 * Set entry `i` (0 = Gray), growing the list with full ranges as needed.
 * Trailing full entries are dropped so an all-default setting compares equal
 * to the default.
 */
export function blendIfSet(b: BlendIf, i: number, pair: [BlendRange, BlendRange]): void {
  while (b.ranges.length <= i) b.ranges.push([{ ...BLEND_RANGE_FULL }, { ...BLEND_RANGE_FULL }]);
  b.ranges[i] = pair;
  while (b.ranges.length > 0) {
    const last = b.ranges[b.ranges.length - 1];
    if (last && blendRangeIsFull(last[0]) && blendRangeIsFull(last[1])) b.ranges.pop();
    else break;
  }
}

/* ------------------------------------------------------------------ */
/* Gradients, contours, effect paint                                   */
/* ------------------------------------------------------------------ */

export type GradientStyle = 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';

/** A gradient: color stops plus transparency stops (both at 0..=1). */
export interface Gradient {
  stops: Array<[number, RgbColor]>;
  /** Opacity stops; empty means fully opaque. */
  opacityStops: Array<[number, number]>;
  style: GradientStyle;
  angle: number;
  scale: number;
  reverse: boolean;
  /** Align the gradient with the layer bounds (else the canvas). */
  align: boolean;
  /** Center offset as a fraction of the bounds. */
  offset: [number, number];
}

export function defaultGradient(): Gradient {
  return {
    stops: [
      [0, { ...COLOR_BLACK }],
      [1, { ...COLOR_WHITE }],
    ],
    opacityStops: [],
    style: 'linear',
    angle: 90,
    scale: 1,
    reverse: false,
    align: true,
    offset: [0, 0],
  };
}

/** Effect contour (transfer curve applied to the effect's coverage). */
export type Contour = { kind: 'linear' } | { kind: 'custom'; name: string; points: CurvePoint[] };

/** Paint used by strokes and glows. */
export type FxPaint =
  | { kind: 'color'; color: RgbColor }
  | { kind: 'gradient'; gradient: Gradient }
  | { kind: 'pattern'; name: string; id: string; scale: number };

/** Blend mode + opacity + enabled, shared by every effect. */
export interface FxCommon {
  enabled: boolean;
  blend: BlendMode;
  opacity: number;
}

export function fxCommon(blend: BlendMode, opacity: number, enabled = true): FxCommon {
  return { enabled, blend, opacity };
}

/* ------------------------------------------------------------------ */
/* Layer effects (layer styles)                                        */
/* ------------------------------------------------------------------ */

export interface Shadow {
  common: FxCommon;
  color: RgbColor;
  /** Degrees, counter-clockwise from 3 o'clock, direction the light comes FROM. */
  angle: number;
  useGlobalLight: boolean;
  distance: number;
  /** Spread (drop shadow) or choke (inner shadow), 0..=1. */
  spread: number;
  size: number;
  contour: Contour;
  antiAlias: boolean;
  noise: number;
  /** Drop shadow only: the layer knocks out the shadow beneath it. */
  knocksOut: boolean;
}

export type GlowTechnique = 'softer' | 'precise';
export type GlowSource = 'center' | 'edge';

export interface Glow {
  common: FxCommon;
  paint: FxPaint;
  technique: GlowTechnique;
  /** Spread (outer) or choke (inner), 0..=1. */
  spread: number;
  size: number;
  contour: Contour;
  antiAlias: boolean;
  range: number;
  jitter: number;
  noise: number;
  /** Inner glow only. */
  source: GlowSource;
}

export type StrokePosition = 'outside' | 'inside' | 'center';

export interface StrokeFx {
  common: FxCommon;
  size: number;
  position: StrokePosition;
  paint: FxPaint;
}

export interface Satin {
  common: FxCommon;
  color: RgbColor;
  angle: number;
  distance: number;
  size: number;
  contour: Contour;
  antiAlias: boolean;
  invert: boolean;
}

export type BevelStyle = 'outer-bevel' | 'inner-bevel' | 'emboss' | 'pillow-emboss' | 'stroke-emboss';
export type BevelTechnique = 'smooth' | 'chisel-hard' | 'chisel-soft';

export interface BevelContour {
  contour: Contour;
  /** Range 0..=1 (Photoshop default 50%): the part of the bevel the contour spans. */
  range: number;
  antiAlias: boolean;
}

export interface BevelTexture {
  name: string;
  id: string;
  /** Scale as a fraction (1 = 100%). */
  scale: number;
  /** Depth -10..=10 (1 = +100%); negative carves the pattern in. */
  depth: number;
  invert: boolean;
  /** "Link with Layer": tile from the layer (else the canvas origin). */
  link: boolean;
  phase: [number, number];
}

export interface Bevel {
  enabled: boolean;
  style: BevelStyle;
  technique: BevelTechnique;
  /** Depth, 0..=10 (1 = 100%). */
  depth: number;
  /** Direction up (true) or down. */
  up: boolean;
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  glossContour: Contour;
  highlight: FxCommon;
  highlightColor: RgbColor;
  shadow: FxCommon;
  shadowColor: RgbColor;
  /** Bevel & Emboss > Contour: shapes the bevel's height profile. Undefined = off. */
  contour?: BevelContour;
  /** Bevel & Emboss > Texture: a pattern's luminance added to the height. Undefined = off. */
  texture?: BevelTexture;
}

/**
 * One layer effect. Several instances of the same kind are allowed
 * (Photoshop's multiple strokes/shadows/overlays).
 */
export type Effect =
  | { kind: 'drop-shadow'; shadow: Shadow }
  | { kind: 'inner-shadow'; shadow: Shadow }
  | { kind: 'outer-glow'; glow: Glow }
  | { kind: 'inner-glow'; glow: Glow }
  | { kind: 'stroke'; stroke: StrokeFx }
  | { kind: 'color-overlay'; common: FxCommon; color: RgbColor }
  | { kind: 'gradient-overlay'; common: FxCommon; gradient: Gradient; dither: boolean }
  | {
      kind: 'pattern-overlay';
      common: FxCommon;
      name: string;
      id: string;
      scale: number;
      /** Rotation in degrees (counter-clockwise). */
      angle: number;
      /** "Link with Layer": the pattern origin follows the layer (else the canvas). */
      link: boolean;
      /** Phase (origin offset) in pixels. */
      phase: [number, number];
    }
  | { kind: 'satin'; satin: Satin }
  | { kind: 'bevel-emboss'; bevel: Bevel };

/** Whether this effect instance is switched on. */
export function effectEnabled(e: Effect): boolean {
  switch (e.kind) {
    case 'drop-shadow':
    case 'inner-shadow':
      return e.shadow.common.enabled;
    case 'outer-glow':
    case 'inner-glow':
      return e.glow.common.enabled;
    case 'stroke':
      return e.stroke.common.enabled;
    case 'color-overlay':
    case 'gradient-overlay':
    case 'pattern-overlay':
      return e.common.enabled;
    case 'satin':
      return e.satin.common.enabled;
    case 'bevel-emboss':
      return e.bevel.enabled;
  }
}

/** Short label for UIs. */
export function effectLabel(e: Effect): string {
  switch (e.kind) {
    case 'drop-shadow':
      return 'Drop Shadow';
    case 'inner-shadow':
      return 'Inner Shadow';
    case 'outer-glow':
      return 'Outer Glow';
    case 'inner-glow':
      return 'Inner Glow';
    case 'stroke':
      return 'Stroke';
    case 'color-overlay':
      return 'Color Overlay';
    case 'gradient-overlay':
      return 'Gradient Overlay';
    case 'pattern-overlay':
      return 'Pattern Overlay';
    case 'satin':
      return 'Satin';
    case 'bevel-emboss':
      return 'Bevel & Emboss';
  }
}

/** Photoshop's defaults for a drop shadow. */
export function defaultDropShadow(): Effect {
  return {
    kind: 'drop-shadow',
    shadow: {
      common: fxCommon('multiply', 0.75),
      color: { ...COLOR_BLACK },
      angle: 120,
      useGlobalLight: true,
      distance: 5,
      spread: 0,
      size: 5,
      contour: { kind: 'linear' },
      antiAlias: false,
      noise: 0,
      knocksOut: true,
    },
  };
}

function defaultGlow(source: GlowSource): Glow {
  return {
    common: fxCommon('screen', 0.75),
    paint: { kind: 'color', color: colorRgb(1, 1, 0) },
    technique: 'softer',
    spread: 0,
    size: 5,
    contour: { kind: 'linear' },
    antiAlias: false,
    range: 0.5,
    jitter: 0,
    noise: 0,
    source,
  };
}

/** Sensible default instance for each effect kind. */
export function defaultEffect(kind: Effect['kind']): Effect {
  switch (kind) {
    case 'drop-shadow':
      return defaultDropShadow();
    case 'inner-shadow':
      return {
        kind: 'inner-shadow',
        shadow: {
          common: fxCommon('multiply', 0.75),
          color: { ...COLOR_BLACK },
          angle: 120,
          useGlobalLight: true,
          distance: 5,
          spread: 0,
          size: 5,
          contour: { kind: 'linear' },
          antiAlias: false,
          noise: 0,
          knocksOut: false,
        },
      };
    case 'outer-glow':
      return { kind: 'outer-glow', glow: defaultGlow('edge') };
    case 'inner-glow':
      return { kind: 'inner-glow', glow: { ...defaultGlow('center'), source: 'center', paint: { kind: 'color', color: { ...COLOR_WHITE } } } };
    case 'stroke':
      return {
        kind: 'stroke',
        stroke: {
          common: fxCommon('normal', 1),
          size: 3,
          position: 'outside',
          paint: { kind: 'color', color: colorRgb(1, 0, 0) },
        },
      };
    case 'color-overlay':
      return { kind: 'color-overlay', common: fxCommon('normal', 1), color: colorRgb(1, 0, 0) };
    case 'gradient-overlay':
      return { kind: 'gradient-overlay', common: fxCommon('normal', 1), gradient: defaultGradient(), dither: false };
    case 'pattern-overlay':
      return {
        kind: 'pattern-overlay',
        common: fxCommon('normal', 1),
        name: '',
        id: '',
        scale: 1,
        angle: 0,
        link: true,
        phase: [0, 0],
      };
    case 'satin':
      return {
        kind: 'satin',
        satin: {
          common: fxCommon('multiply', 0.5),
          color: { ...COLOR_BLACK },
          angle: 19,
          distance: 11,
          size: 14,
          contour: { kind: 'linear' },
          antiAlias: false,
          invert: false,
        },
      };
    case 'bevel-emboss':
      return {
        kind: 'bevel-emboss',
        bevel: {
          enabled: true,
          style: 'inner-bevel',
          technique: 'smooth',
          depth: 1,
          up: true,
          size: 5,
          soften: 0,
          angle: 120,
          altitude: 30,
          useGlobalLight: true,
          glossContour: { kind: 'linear' },
          highlight: fxCommon('screen', 0.75),
          highlightColor: { ...COLOR_WHITE },
          shadow: fxCommon('multiply', 0.75),
          shadowColor: { ...COLOR_BLACK },
        },
      };
  }
}

/** Layer styles container. */
export interface Effects {
  enabled: boolean;
  items: Effect[];
}

export function effectsDefault(): Effects {
  return { enabled: true, items: [] };
}

/** Document-wide light used by effects with `useGlobalLight`. */
export interface GlobalLight {
  angle: number;
  altitude: number;
}

export const GLOBAL_LIGHT_DEFAULT: GlobalLight = { angle: 120, altitude: 30 };

/* ------------------------------------------------------------------ */
/* Fill                                                                */
/* ------------------------------------------------------------------ */

export type Fill =
  | { kind: 'solid'; color: RgbColor }
  | {
      kind: 'gradient';
      stops: Array<[number, RgbColor]>;
      angle: number;
      scale: number;
      style: GradientStyle;
      reverse: boolean;
      /** Opacity stops (location, opacity), both 0..=1; empty = each color stop's alpha. */
      opacityStops: Array<[number, number]>;
      /** Color midpoints, one per segment between consecutive (sorted) color stops (0..=1 of the segment); missing = 0.5. */
      midpoints: number[];
      /** Center offset as a fraction of the frame. */
      offset: [number, number];
      /** Dither (breaks 8-bit banding with one level of noise). */
      dither: boolean;
      /** "Align with layer": lay out in the layer's frame (its masks' bounds), else the canvas. */
      align: boolean;
    }
  | {
      kind: 'pattern';
      name: string;
      scale: number;
      id: string;
      /** Rotation in degrees (counter-clockwise). */
      angle: number;
      /** "Link with Layer": the pattern origin follows the layer's frame (else the canvas). */
      link: boolean;
      /** Phase (origin offset) in pixels. */
      phase: [number, number];
    };

/** A gradient fill with the classic settings: opaque stops at their alpha, 50% midpoints, centered, no dither, aligned with the layer. */
export function gradientFill(
  stops: Array<[number, RgbColor]>,
  angle: number,
  scale: number,
  style: GradientStyle,
  reverse: boolean,
): Fill {
  return {
    kind: 'gradient',
    stops,
    angle,
    scale,
    style,
    reverse,
    opacityStops: [],
    midpoints: [],
    offset: [0, 0],
    dither: false,
    align: true,
  };
}

/* ------------------------------------------------------------------ */
/* Adjustments                                                         */
/* ------------------------------------------------------------------ */

export interface CurvePoint {
  input: number;
  output: number;
}

/** Whether `points` is the straight 0->0, 1->1 line (or too short to be a curve). */
export function isIdentityCurve(points: CurvePoint[]): boolean {
  if (points.length === 2) {
    const [a, b] = points as [CurvePoint, CurvePoint];
    return a.input === 0 && a.output === 0 && b.input === 1 && b.output === 1;
  }
  return points.length < 2;
}

export interface LevelsChannel {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export function defaultLevelsChannel(): LevelsChannel {
  return { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 };
}

/**
 * Which document channels the per-channel records of Levels and Curves
 * address. Compositing happens in display RGB; `cmyk` and `lab` records are
 * applied to the pixel converted into that space (the same conversions the
 * document's surfaces use). Grayscale documents use `rgb` with the master record.
 */
export type ToneSpace = 'rgb' | 'cmyk' | 'lab';

/** One of Hue/Saturation's six color ranges (reds, yellows, greens, cyans, blues, magentas). */
export interface HueRange {
  /** Hue shift in degrees (-180..=180). */
  hue: number;
  /** Saturation change in percent (-100..=100). */
  saturation: number;
  /** Lightness change in percent (-100..=100). */
  lightness: number;
  /** Hue degrees where the range starts fading in, is fully on, starts fading out and ends (Photoshop's four range sliders). May wrap past 0/360. */
  bounds: [number, number, number, number];
}

/** The neutral range `i` (0 = reds ... 5 = magentas) with Photoshop's default extent. */
export function hueRangeNeutral(i: number): HueRange {
  const c = 60 * i;
  return { hue: 0, saturation: 0, lightness: 0, bounds: [c - 45, c - 15, c + 15, c + 45] };
}

export function hueRangeDefaults(): [HueRange, HueRange, HueRange, HueRange, HueRange, HueRange] {
  return [hueRangeNeutral(0), hueRangeNeutral(1), hueRangeNeutral(2), hueRangeNeutral(3), hueRangeNeutral(4), hueRangeNeutral(5)];
}

/**
 * The canonical form of four range sliders: increasing, within one turn,
 * center in -30..330 (so the default reds are -45, -15, 15, 45 whichever way
 * they were written).
 */
export function hueRangeCanonicalBounds(b: [number, number, number, number]): [number, number, number, number] {
  if (b.some((v) => !Number.isFinite(v))) return [-45, -15, 15, 45];
  const out: [number, number, number, number] = [b[0], b[1], b[2], b[3]];
  for (let k = 1; k < 4; k++) {
    out[k] = Math.min(out[k - 1] + ((b[k] - out[k - 1]) % 360 + 360) % 360, out[0] + 359);
  }
  const center = (out[1] + out[2]) / 2;
  const shift = ((((center + 30) % 360) + 360) % 360) - 30 - center;
  return out.map((v) => v + shift) as [number, number, number, number];
}

export function hueRangeIsNeutral(r: HueRange): boolean {
  return r.hue === 0 && r.saturation === 0 && r.lightness === 0;
}

/** How much a pixel of hue `deg` (degrees) belongs to this range, 0..=1. */
export function hueRangeWeight(r: HueRange, deg: number): number {
  const [a, b0, c0, d0] = r.bounds;
  // Measure from the range's start so wrap-around ranges (reds) work.
  const rel = (x: number): number => (Number.isFinite(x) ? (((x - a) % 360) + 360) % 360 : 0);
  const b = rel(b0);
  const c = Math.max(rel(c0), b);
  const d = Math.max(rel(d0), c);
  const h = rel(deg);
  if (h <= b) return b <= 0 ? 1 : h / b;
  if (h <= c) return 1;
  if (h <= d) return d <= c ? 1 : (d - h) / (d - c);
  return 0;
}

/**
 * Number of values in the table of a `size`^3 color lookup (`size^3 x 3`).
 * Undefined for a size below 2 or one whose table length overflows: a stored
 * document's size is untrusted.
 */
export function lut3dLen(size: number): number | undefined {
  if (size < 2 || !Number.isInteger(size)) return undefined;
  const n = Math.pow(size, 3) * 3;
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Photoshop adjustment layers (Layer > New Adjustment Layer). */
export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number; legacy: boolean }
  | {
      kind: 'levels';
      /** Composite channel first. */
      master: LevelsChannel;
      /** Then R, G, B (or the channels `space` names). */
      perChannel: [LevelsChannel, LevelsChannel, LevelsChannel];
      space: ToneSpace;
      /** The black ink channel when `space` is 'cmyk'. */
      black: LevelsChannel;
    }
  | {
      kind: 'curves';
      /** Master curve. */
      master: CurvePoint[];
      /** R, G, B curves (or the channels `space` names). */
      perChannel: [CurvePoint[], CurvePoint[], CurvePoint[]];
      space: ToneSpace;
      /** The black ink curve when `space` is 'cmyk' (empty = identity). */
      black: CurvePoint[];
    }
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | {
      kind: 'hue-saturation';
      /** Master hue / saturation / lightness (or the Colorize color). */
      hue: number;
      saturation: number;
      lightness: number;
      colorize: boolean;
      ranges: [HueRange, HueRange, HueRange, HueRange, HueRange, HueRange];
    }
  | {
      kind: 'color-balance';
      shadows: [number, number, number];
      midtones: [number, number, number];
      highlights: [number, number, number];
      preserveLuminosity: boolean;
    }
  | { kind: 'black-white'; weights: [number, number, number, number, number, number]; tint?: [number, number, number] }
  | { kind: 'photo-filter'; color: [number, number, number]; density: number; preserveLuminosity: boolean }
  | { kind: 'channel-mixer'; matrix: [[number, number, number, number], [number, number, number, number], [number, number, number, number]]; monochrome: boolean }
  | {
      kind: 'color-lookup';
      name: string;
      /** Tetrahedral instead of trilinear interpolation. */
      tetrahedral: boolean;
      /** Ordered dither of +/- 1/2 an 8-bit step to hide banding (Photoshop's "Dither"). */
      dither: boolean;
    }
  | { kind: 'invert' }
  | { kind: 'posterize'; levels: number }
  | { kind: 'threshold'; level: number }
  | {
      kind: 'gradient-map';
      stops: Array<[number, [number, number, number]]>;
      reverse: boolean;
      /** Ordered dither of +/- 1/2 an 8-bit step to hide banding. */
      dither: boolean;
    }
  | {
      kind: 'selective-color';
      relative: boolean;
      /** Per range (reds, yellows, greens, cyans, blues, magentas, whites, neutrals, blacks): the cyan, magenta, yellow and black change in percent (-100..=100). */
      adjustments: [
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
        [number, number, number, number],
      ];
    }
  | { kind: 'unsupported'; psdKey: string };

/** Short label for UIs. */
export function adjustmentLabel(a: Adjustment): string {
  switch (a.kind) {
    case 'brightness-contrast':
      return 'Brightness/Contrast';
    case 'levels':
      return 'Levels';
    case 'curves':
      return 'Curves';
    case 'exposure':
      return 'Exposure';
    case 'vibrance':
      return 'Vibrance';
    case 'hue-saturation':
      return 'Hue/Saturation';
    case 'color-balance':
      return 'Color Balance';
    case 'black-white':
      return 'Black & White';
    case 'photo-filter':
      return 'Photo Filter';
    case 'channel-mixer':
      return 'Channel Mixer';
    case 'color-lookup':
      return 'Color Lookup';
    case 'invert':
      return 'Invert';
    case 'posterize':
      return 'Posterize';
    case 'threshold':
      return 'Threshold';
    case 'gradient-map':
      return 'Gradient Map';
    case 'selective-color':
      return 'Selective Color';
    case 'unsupported':
      return 'Adjustment';
  }
}

function identityCurve(): CurvePoint[] {
  return [
    { input: 0, output: 0 },
    { input: 1, output: 1 },
  ];
}

/** Default (neutral) parameters for each adjustment kind. */
export function defaultAdjustment(kind: Adjustment['kind']): Adjustment {
  switch (kind) {
    case 'brightness-contrast':
      return { kind: 'brightness-contrast', brightness: 0, contrast: 0, legacy: false };
    case 'levels':
      return {
        kind: 'levels',
        master: defaultLevelsChannel(),
        perChannel: [defaultLevelsChannel(), defaultLevelsChannel(), defaultLevelsChannel()],
        space: 'rgb',
        black: defaultLevelsChannel(),
      };
    case 'curves':
      return {
        kind: 'curves',
        master: identityCurve(),
        perChannel: [identityCurve(), identityCurve(), identityCurve()],
        space: 'rgb',
        black: [],
      };
    case 'exposure':
      return { kind: 'exposure', exposure: 0, offset: 0, gamma: 1 };
    case 'vibrance':
      return { kind: 'vibrance', vibrance: 0, saturation: 0 };
    case 'hue-saturation':
      return { kind: 'hue-saturation', hue: 0, saturation: 0, lightness: 0, colorize: false, ranges: hueRangeDefaults() };
    case 'color-balance':
      return {
        kind: 'color-balance',
        shadows: [0, 0, 0],
        midtones: [0, 0, 0],
        highlights: [0, 0, 0],
        preserveLuminosity: true,
      };
    case 'black-white':
      return { kind: 'black-white', weights: [0.4, 0.6, 0.4, 0.6, 0.2, 0.8], tint: undefined };
    case 'photo-filter':
      return { kind: 'photo-filter', color: [1, 0.72, 0.32], density: 0.25, preserveLuminosity: true };
    case 'channel-mixer':
      return {
        kind: 'channel-mixer',
        matrix: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        monochrome: false,
      };
    case 'color-lookup':
      return { kind: 'color-lookup', name: '', tetrahedral: false, dither: false };
    case 'invert':
      return { kind: 'invert' };
    case 'posterize':
      return { kind: 'posterize', levels: 4 };
    case 'threshold':
      return { kind: 'threshold', level: 0.5 };
    case 'gradient-map':
      return { kind: 'gradient-map', stops: [], reverse: false, dither: false };
    case 'selective-color':
      return {
        kind: 'selective-color',
        relative: false,
        adjustments: [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      };
    case 'unsupported':
      return { kind: 'unsupported', psdKey: '' };
  }
}

/* ------------------------------------------------------------------ */
/* Layer content kinds                                                 */
/* ------------------------------------------------------------------ */

export interface Group {
  children: Layer[];
  expanded: boolean;
}

/** Text layer (type engine data; rendering stays in the renderer). */
export interface TextLayer {
  text: string;
  fontFamily: string;
  sizePt: number;
  color: RgbColor;
  transform: Affine;
  /** Rasterized appearance cache in the renderer. */
  cacheRef?: string;
  /** Point or paragraph (box) text. */
  shape: 'point' | 'box';
  antialias: 'none' | 'crisp' | 'smooth' | 'strong';
}

export function defaultTextLayer(): TextLayer {
  return {
    text: '',
    fontFamily: '',
    sizePt: 12,
    color: { ...COLOR_BLACK },
    transform: { m: [...AFFINE_IDENTITY.m] },
    shape: 'point',
    antialias: 'smooth',
  };
}

/** Shape layer outline/stroke; the outline path lives in the renderer (`pathRef`). */
export interface ShapeLayer {
  pathRef?: string;
  /** Undefined = no fill (Photoshop's fill "none"). */
  fill?: Fill;
  stroke?: {
    width: number;
    paint: Fill;
    opacity: number;
    dashes: number[];
  };
  /** Rasterized appearance cache in the renderer. */
  cacheRef?: string;
}

export type SmartSource = { kind: 'embedded'; fileName: string } | { kind: 'linked'; path: string };

/** A filter applied non-destructively: a command id plus its parameters (data, not code). */
export interface SmartFilter {
  command: string;
  params: unknown;
  blend: BlendMode;
  opacity: number;
  visible: boolean;
}

export interface SmartObject {
  source: SmartSource;
  transform: Affine;
  smartFilters: SmartFilter[];
  /** Layer > Smart Filter > Disable Smart Filters turns the whole stack off without touching each filter's own visibility. */
  filtersEnabled: boolean;
  /** The smart filter mask (one per smart object): where the filter stack's result shows over the unfiltered content. */
  filterMask?: LayerMask;
  /** Rasterized appearance cache in the renderer. */
  cacheRef?: string;
  /**
   * Distort / Perspective: the full projective map from source pixels to
   * document pixels, row-major 3x3. Overrides `transform` when present.
   */
  perspective?: [number, number, number, number, number, number, number, number, number];
}

export function newSmartObject(source: SmartSource, transform: Affine, cacheRef?: string): SmartObject {
  return { source, transform, smartFilters: [], filtersEnabled: true, cacheRef };
}

export type LayerContent =
  | { kind: 'raster'; surfaceRef?: string }
  | { kind: 'group'; group: Group }
  | { kind: 'adjustment'; adjustment: Adjustment }
  | { kind: 'fill'; fill: Fill }
  | { kind: 'text'; text: TextLayer }
  | { kind: 'shape'; shape: ShapeLayer }
  | { kind: 'smart'; smart: SmartObject };

/** Panel label for a content kind ("Pixel", "Group", "Adjustment", ...). */
export function contentKindName(c: LayerContent): string {
  switch (c.kind) {
    case 'raster':
      return 'Pixel';
    case 'group':
      return 'Group';
    case 'adjustment':
      return 'Adjustment';
    case 'fill':
      return 'Fill';
    case 'text':
      return 'Type';
    case 'shape':
      return 'Shape';
    case 'smart':
      return 'Smart Object';
  }
}

/* ------------------------------------------------------------------ */
/* Layer                                                               */
/* ------------------------------------------------------------------ */

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locks: Locks;
  blend: BlendMode;
  /** Layer opacity (applies to content and effects). */
  opacity: number;
  /** Fill opacity (applies to content but not effects). */
  fillOpacity: number;
  /** Clipped to the layer below (clipping mask). */
  clipped: boolean;
  mask?: LayerMask;
  vectorMask?: VectorMask;
  effects: Effects;
  label: LabelColor;
  content: LayerContent;
  /** Layer > Link Layers: layers sharing a link group move together. Undefined = not linked. */
  linkGroup?: number;
  /** Blending Options > Advanced Blending > Channels: bit `i` set = color channel `i` is left out of blending (backdrop's value is kept there). 0 = every channel blends. */
  excludedChannels: number;
  /** Blending Options > Blend If: value ranges of this layer and of the layers beneath it outside which the layer's pixels are hidden. */
  blendIf: BlendIf;
}

export function createLayer(name: string, content: LayerContent): Layer {
  return {
    id: freshLayerId(),
    name,
    visible: true,
    locks: { ...LOCKS_NONE },
    blend: 'normal',
    opacity: 1,
    fillOpacity: 1,
    clipped: false,
    effects: effectsDefault(),
    label: 'none',
    content,
    excludedChannels: 0,
    blendIf: blendIfDefault(),
  };
}

/** A pixel layer (raster pixels live in the renderer under `surfaceRef`). */
export function createRasterLayer(name: string, surfaceRef?: string): Layer {
  return createLayer(name, { kind: 'raster', surfaceRef });
}

/** A group layer; groups default to the Pass Through blend mode. */
export function createGroupLayer(name: string, children: Layer[] = []): Layer {
  const layer = createLayer(name, { kind: 'group', group: { children, expanded: true } });
  layer.blend = 'pass-through';
  return layer;
}

export function isGroupLayer(layer: Layer): boolean {
  return layer.content.kind === 'group';
}

export function groupChildren(layer: Layer): Layer[] | undefined {
  return layer.content.kind === 'group' ? layer.content.group.children : undefined;
}

/** Deep copy with fresh ids (for Duplicate Layer). */
export function duplicateLayer(layer: Layer): Layer {
  const copy: Layer = JSON.parse(JSON.stringify(layer));
  const reassign = (l: Layer): void => {
    l.id = freshLayerId();
    if (l.content.kind === 'group') l.content.group.children.forEach(reassign);
  };
  reassign(copy);
  return copy;
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

/** Deepest group nesting a document may hold. */
export const MAX_GROUP_DEPTH = 100;

export interface Document {
  id: number;
  name: string;
  width: number;
  height: number;
  resolutionDpi: number;
  /** Bottom-to-top. */
  layers: Layer[];
  /** Currently selected layer (panel focus). */
  activeLayerId?: LayerId;
  globalLight: GlobalLight;
}

export function createDocument(name: string, width: number, height: number): Document {
  return {
    id: freshLayerId(),
    name,
    width,
    height,
    resolutionDpi: 72,
    layers: [],
    globalLight: { ...GLOBAL_LIGHT_DEFAULT },
  };
}

/** A layer's address in the tree: indices from the root down. */
export type LayerPath = number[];

export interface WalkedLayer {
  layer: Layer;
  path: LayerPath;
  depth: number;
}

/** Flatten the tree bottom-to-top, carrying each layer's path and depth. */
export function walkLayers(layers: Layer[], basePath: LayerPath = []): WalkedLayer[] {
  const out: WalkedLayer[] = [];
  layers.forEach((layer, i) => {
    const path = [...basePath, i];
    out.push({ layer, path, depth: basePath.length });
    if (layer.content.kind === 'group') {
      out.push(...walkLayers(layer.content.group.children, path));
    }
  });
  return out;
}

/** Find a layer by id anywhere in the tree. */
export function findLayer(layers: Layer[], id: LayerId): { layer: Layer; path: LayerPath } | undefined {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.id === id) return { layer, path: [i] };
    if (layer.content.kind === 'group') {
      const found = findLayer(layer.content.group.children, id);
      if (found) return { layer: found.layer, path: [i, ...found.path] };
    }
  }
  return undefined;
}

/** Resolve a layer by its index path from the root. */
export function findLayerByPath(layers: Layer[], path: LayerPath): Layer | undefined {
  let current: Layer[] = layers;
  let layer: Layer | undefined;
  for (const i of path) {
    layer = current[i];
    if (!layer) return undefined;
    current = layer.content.kind === 'group' ? layer.content.group.children : [];
  }
  return layer;
}

/* ------------------------------------------------------------------ */
/* Point (re-export for convenience)                                   */
/* ------------------------------------------------------------------ */

export type { Point };
