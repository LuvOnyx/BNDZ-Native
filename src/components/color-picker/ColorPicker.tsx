import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ColorPicker as AriaColorPicker,
  parseColor,
  type Color,
} from 'react-aria-components';
import { DialogTrigger } from './src/Dialog';
import { ColorSwatch } from './src/ColorSwatch';
import { ColorSlider } from './src/ColorSlider';
import { ColorArea } from './src/ColorArea';
import { ColorField } from './src/ColorField';
import { Popover } from './src/Popover';
import {
  type ColorFill,
  type GradientStop,
  defaultGradientFromSolid,
  fillToBackground,
  fillToSolid,
  parseColorFill,
  serializeColorFill,
} from '../../lib/colorFill';
import type { ColorFillMode } from '../../data/colorConfigSchema';
import './src/ColorPicker.css';
import './FillColorPicker.css';

type Props = {
  value: string;
  onChange: (serialized: string) => void;
  /** any = Solid|Gradient in picker; gradient = forced; solid = forced */
  fillMode?: ColorFillMode | 'solid';
  minStops?: number;
};

/**
 * BNDZ fill picker — solid or multi-stop gradient.
 * Gradient stops are editable *steps on the rail* inside this picker (not settings-page sliders).
 */
export default function ColorPicker({
  value,
  onChange,
  fillMode = 'any',
  minStops = 2,
}: Props) {
  const forceGradient = fillMode === 'gradient';
  const forceSolid = fillMode === 'solid';

  const fill = useMemo(() => {
    const parsed = parseColorFill(value, '#888888');
    if (forceGradient && parsed.mode === 'solid') {
      return ensureStops(defaultGradientFromSolid(parsed.color, 90), minStops);
    }
    if (forceSolid && parsed.mode === 'gradient') {
      return { mode: 'solid' as const, color: fillToSolid(parsed) };
    }
    if (parsed.mode === 'gradient') return ensureStops(parsed, minStops);
    return parsed;
  }, [value, forceGradient, forceSolid, minStops]);

  const [activeStop, setActiveStop] = useState(0);
  const stopIndex =
    fill.mode === 'gradient' ? Math.min(activeStop, Math.max(0, fill.stops.length - 1)) : 0;

  const activeHex =
    fill.mode === 'solid'
      ? toPickerHex(fill.color)
      : toPickerHex(fill.stops[stopIndex]?.color || '#888888');

  let colorValue: Color;
  try {
    colorValue = parseColor(activeHex);
  } catch {
    colorValue = parseColor('#000000');
  }

  const commit = useCallback(
    (next: ColorFill) => {
      if (forceGradient && next.mode === 'solid') {
        onChange(serializeColorFill(ensureStops(defaultGradientFromSolid(next.color, 90), minStops)));
        return;
      }
      if (next.mode === 'gradient') {
        onChange(serializeColorFill(ensureStops(next, minStops)));
        return;
      }
      onChange(serializeColorFill(next));
    },
    [forceGradient, minStops, onChange],
  );

  const [draftColor, setDraftColor] = useState<Color | null>(null);
  const commitRaf = useRef(0);

  const displayColor = draftColor ?? colorValue;

  const flushColor = useCallback(
    (color: Color) => {
      const alpha = color.getChannelValue('alpha');
      const hex = alpha < 0.999 ? color.toString('hexa') : color.toString('hex');
      if (fill.mode === 'solid') {
        commit({ mode: 'solid', color: hex });
        return;
      }
      const stops = fill.stops.map((s, i) => (i === stopIndex ? { ...s, color: hex } : s));
      commit({ ...fill, stops });
    },
    [commit, fill, stopIndex],
  );

  const onSolidColorChange = (color: Color) => {
    // Local draft keeps the thumb smooth; parent commit is rAF-throttled.
    setDraftColor(color);
    if (commitRaf.current) cancelAnimationFrame(commitRaf.current);
    commitRaf.current = requestAnimationFrame(() => {
      flushColor(color);
      commitRaf.current = 0;
    });
  };

  // Drop draft when switching stops / mode (not on every parent echo — that fights the drag).
  useEffect(() => {
    setDraftColor(null);
  }, [stopIndex, fill.mode]);

  const setMode = (mode: 'solid' | 'gradient') => {
    if (forceGradient && mode === 'solid') return;
    if (forceSolid && mode === 'gradient') return;
    if (mode === fill.mode) return;
    if (mode === 'solid') commit({ mode: 'solid', color: fillToSolid(fill) });
    else commit(ensureStops(defaultGradientFromSolid(fillToSolid(fill), 90), minStops));
  };

  const updateStopPos = (index: number, pos: number) => {
    if (fill.mode !== 'gradient') return;
    const stops = fill.stops.map((s, i) => (i === index ? { ...s, pos: clamp(pos, 0, 100) } : s));
    commit({ ...fill, stops });
  };

  const addStop = () => {
    if (fill.mode !== 'gradient') return;
    const sorted = [...fill.stops].sort((a, b) => a.pos - b.pos);
    let pos = 50;
    if (sorted.length >= 2) {
      let bestGap = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].pos - sorted[i].pos;
        if (gap > bestGap) {
          bestGap = gap;
          pos = Math.round(sorted[i].pos + gap / 2);
        }
      }
    }
    const color = fill.stops[stopIndex]?.color || '#888888';
    const nextStops = [...fill.stops, { color, pos }];
    commit({ ...fill, stops: nextStops });
    setActiveStop(nextStops.length - 1);
  };

  const removeStop = () => {
    if (fill.mode !== 'gradient' || fill.stops.length <= minStops) return;
    const next = fill.stops.filter((_, i) => i !== stopIndex);
    commit({ ...fill, stops: next });
    setActiveStop(Math.max(0, stopIndex - 1));
  };

  const swatchBg = fillToBackground(fill);

  return (
    <AriaColorPicker value={displayColor} onChange={onSolidColorChange} className="inline-flex w-max">
      <DialogTrigger>
        <Button className="color-picker">
          <span className="bndz-fill-swatch" style={{ background: swatchBg }} aria-hidden />
          {/* Keep Aria swatch in tree for accessibility / focus ring plumbing */}
          <ColorSwatch className="bndz-fill-swatch-aria" />
        </Button>
        <Popover hideArrow placement="bottom start" className="color-picker-dialog bndz-fill-picker-dialog">
          {!forceGradient && !forceSolid && (
            <div className="bndz-fill-mode-row">
              <button
                type="button"
                className={`bndz-fill-mode-btn${fill.mode === 'solid' ? ' is-active' : ''}`}
                onClick={() => setMode('solid')}
              >
                Solid
              </button>
              <button
                type="button"
                className={`bndz-fill-mode-btn${fill.mode === 'gradient' ? ' is-active' : ''}`}
                onClick={() => setMode('gradient')}
              >
                Gradient
              </button>
            </div>
          )}
          {forceGradient && fill.mode === 'gradient' && (
            <div className="bndz-fill-mode-badge">
              Gradient · {fill.stops.length} steps
            </div>
          )}

          {fill.mode === 'gradient' && (
            <>
              <GradientStepsRail
                angle={fill.angle}
                stops={fill.stops}
                activeIndex={stopIndex}
                onSelect={setActiveStop}
                onMove={updateStopPos}
              />
              <div className="bndz-fill-step-actions">
                <AngleSteps value={fill.angle} onChange={angle => commit({ ...fill, angle })} />
                <div className="bndz-fill-step-btns">
                  <button type="button" className="bndz-fill-chip" onClick={addStop}>
                    + Step
                  </button>
                  <button
                    type="button"
                    className="bndz-fill-chip"
                    disabled={fill.stops.length <= minStops}
                    onClick={removeStop}
                  >
                    − Step
                  </button>
                </div>
              </div>
            </>
          )}

          <ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness" />
          <ColorSlider colorSpace="hsb" channel="hue" label="Hue" />
          <ColorSlider colorSpace="hsb" channel="alpha" label="Opacity" className="bndz-opacity-slider" />
          <ColorField label="Hex" />
        </Popover>
      </DialogTrigger>
    </AriaColorPicker>
  );
}

function AngleSteps({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const presets = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <div className="bndz-fill-angle-steps" title="Gradient angle">
      {presets.map(deg => (
        <button
          key={deg}
          type="button"
          className={`bndz-fill-angle-step${value === deg ? ' is-active' : ''}`}
          onClick={() => onChange(deg)}
        >
          {deg}°
        </button>
      ))}
    </div>
  );
}

function GradientStepsRail({
  angle,
  stops,
  activeIndex,
  onSelect,
  onMove,
}: {
  angle: number;
  stops: GradientStop[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onMove: (i: number, pos: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const bg = fillToBackground({ mode: 'gradient', angle, stops });

  const posFromEvent = (clientX: number) => {
    const el = railRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp(Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * 100), 0, 100);
  };

  return (
    <div className="bndz-fill-rail-wrap">
      <div
        ref={railRef}
        className="bndz-fill-rail"
        style={{ background: bg }}
        onClick={e => {
          if ((e.target as HTMLElement).dataset.stop != null) return;
          const pos = posFromEvent(e.clientX);
          let best = 0;
          let bestDist = Infinity;
          stops.forEach((s, i) => {
            const d = Math.abs(s.pos - pos);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          });
          onSelect(best);
        }}
        onPointerMove={e => {
          if (dragRef.current == null) return;
          onMove(dragRef.current, posFromEvent(e.clientX));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            data-stop={i}
            className={`bndz-fill-stop${i === activeIndex ? ' is-active' : ''}`}
            style={{ left: `${stop.pos}%`, background: toPickerHex(stop.color) }}
            title={`Step ${i + 1} · ${stop.pos}%`}
            onPointerDown={e => {
              e.preventDefault();
              e.stopPropagation();
              dragRef.current = i;
              onSelect(i);
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
          />
        ))}
      </div>
      <div className="bndz-fill-rail-caption">Drag steps · select · edit color below</div>
    </div>
  );
}

function ensureStops(fill: ColorFill, min: number): ColorFill {
  if (fill.mode !== 'gradient') return fill;
  const stops = [...fill.stops];
  while (stops.length < min) {
    const last = stops[stops.length - 1] || { color: '#888888', pos: 0 };
    stops.push({ color: last.color, pos: Math.min(100, last.pos + Math.round(100 / min)) });
  }
  return { ...fill, stops };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function toPickerHex(hex: string): string {
  const h = hex.trim();
  // Keep 8-digit hexa so opacity round-trips into the picker
  if (/^#[0-9a-fA-F]{8}$/.test(h)) return h.toLowerCase();
  if (/^#[0-9a-fA-F]{4}$/.test(h)) {
    const r = h[1], g = h[2], b = h[3], a = h[4];
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toLowerCase();
  }
  return h || '#000000';
}
