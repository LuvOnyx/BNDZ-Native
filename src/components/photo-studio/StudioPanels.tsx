/**
 * Right-side studio panels under the layer stack: Adjust (per-layer quick
 * adjustments + full photocraft adjustment editors for adjustment layers)
 * and Style (layer effects). All editors write real model values — the
 * studio applies them to pixels through the LUT engine.
 */
import React from 'react';
import {
  adjustmentLabel, defaultEffect,
  type Adjustment, type Layer, type RgbColor,
} from '../../lib/photocraft';

export interface QuickAdjust {
  brightness: number; contrast: number; saturation: number;
  hue: number; exposure: number; blur: number;
}

interface Props {
  activeLayer: Layer | null;
  quickAdjust: QuickAdjust;
  onQuickAdjust: (qa: QuickAdjust) => void;
  onAdjustmentParams: (adj: Adjustment) => void;
  onEffectsChange: (layer: Layer) => void;
}

function rgbToHex(c: RgbColor): string {
  const p = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}
function hexToRgb(hex: string, a = 1): RgbColor {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
}

function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <label className="ps-slider-row">
      <span className="ps-slider-label">{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={e => props.onChange(Number(e.target.value))} />
      <span className="ps-slider-val">{props.format ? props.format(props.value) : Math.round(props.value)}</span>
    </label>
  );
}

/* ------------------------- adjustment editors ------------------------- */

function AdjustmentEditor({ adj, onChange }: { adj: Adjustment; onChange: (a: Adjustment) => void }): React.ReactElement {
  const set = (patch: Record<string, unknown>) => onChange({ ...adj, ...patch } as Adjustment);
  switch (adj.kind) {
    case 'brightness-contrast':
      return (<>
        <Slider label="Brightness" value={adj.brightness} min={-150} max={150} onChange={v => set({ brightness: v })} />
        <Slider label="Contrast" value={adj.contrast} min={-100} max={100} onChange={v => set({ contrast: v })} />
      </>);
    case 'exposure':
      return (<>
        <Slider label="Exposure" value={adj.exposure} min={-5} max={5} step={0.05} format={v => v.toFixed(2)} onChange={v => set({ exposure: v })} />
        <Slider label="Offset" value={adj.offset} min={-0.5} max={0.5} step={0.01} format={v => v.toFixed(2)} onChange={v => set({ offset: v })} />
        <Slider label="Gamma" value={adj.gamma} min={0.2} max={3} step={0.05} format={v => v.toFixed(2)} onChange={v => set({ gamma: v })} />
      </>);
    case 'vibrance':
      return (<>
        <Slider label="Vibrance" value={adj.vibrance} min={-100} max={100} onChange={v => set({ vibrance: v })} />
        <Slider label="Saturation" value={adj.saturation} min={-100} max={100} onChange={v => set({ saturation: v })} />
      </>);
    case 'hue-saturation':
      return (<>
        <Slider label="Hue" value={adj.hue} min={-180} max={180} onChange={v => set({ hue: v })} />
        <Slider label="Saturation" value={adj.saturation} min={-100} max={100} onChange={v => set({ saturation: v })} />
        <Slider label="Lightness" value={adj.lightness} min={-100} max={100} onChange={v => set({ lightness: v })} />
      </>);
    case 'levels': {
      const m = adj.master;
      const setMaster = (patch: Partial<typeof m>) => set({ master: { ...m, ...patch } });
      return (<>
        <Slider label="Black point" value={m.inBlack} min={0} max={0.9} step={0.01} format={v => `${Math.round(v * 255)}`} onChange={v => setMaster({ inBlack: v })} />
        <Slider label="White point" value={m.inWhite} min={0.1} max={1} step={0.01} format={v => `${Math.round(v * 255)}`} onChange={v => setMaster({ inWhite: v })} />
        <Slider label="Gamma" value={m.gamma} min={0.2} max={3} step={0.05} format={v => v.toFixed(2)} onChange={v => setMaster({ gamma: v })} />
        <Slider label="Output black" value={m.outBlack} min={0} max={1} step={0.01} format={v => `${Math.round(v * 255)}`} onChange={v => setMaster({ outBlack: v })} />
        <Slider label="Output white" value={m.outWhite} min={0} max={1} step={0.01} format={v => `${Math.round(v * 255)}`} onChange={v => setMaster({ outWhite: v })} />
      </>);
    }
    case 'curves': {
      const presets: { name: string; pts: { input: number; output: number }[] }[] = [
        { name: 'Linear', pts: [{ input: 0, output: 0 }, { input: 1, output: 1 }] },
        { name: 'Darken', pts: [{ input: 0, output: 0 }, { input: 0.5, output: 0.32 }, { input: 1, output: 1 }] },
        { name: 'Lighten', pts: [{ input: 0, output: 0 }, { input: 0.5, output: 0.68 }, { input: 1, output: 1 }] },
        { name: 'Contrast (S)', pts: [{ input: 0, output: 0 }, { input: 0.25, output: 0.14 }, { input: 0.75, output: 0.86 }, { input: 1, output: 1 }] },
        { name: 'Negative', pts: [{ input: 0, output: 1 }, { input: 1, output: 0 }] },
      ];
      return (
        <div className="ps-btn-row">
          {presets.map(p => (
            <button key={p.name} type="button" onClick={() => set({ master: p.pts })}>{p.name}</button>
          ))}
        </div>
      );
    }
    case 'posterize':
      return <Slider label="Levels" value={adj.levels} min={2} max={32} onChange={v => set({ levels: v })} />;
    case 'threshold':
      return <Slider label="Level" value={adj.level} min={0} max={1} step={0.01} format={v => `${Math.round(v * 255)}`} onChange={v => set({ level: v })} />;
    case 'black-white': {
      const names = ['Reds', 'Greens', 'Blues', 'Yellows', 'Cyans', 'Magentas'];
      return (<>
        {adj.weights.map((w, i) => (
          <Slider key={names[i]} label={names[i]} value={w} min={0} max={1.5} step={0.01} format={v => `${Math.round(v * 100)}%`}
            onChange={v => { const weights = [...adj.weights] as typeof adj.weights; weights[i] = v; set({ weights }); }} />
        ))}
      </>);
    }
    case 'photo-filter':
      return (<>
        <label className="ps-field-row"><span>Filter color</span>
          <input type="color" value={rgbToHex({ ...adj.color, a: 1 } as RgbColor)}
            onChange={e => { const c = hexToRgb(e.target.value); set({ color: [c.r, c.g, c.b] }); }} />
        </label>
        <Slider label="Density" value={adj.density} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} onChange={v => set({ density: v })} />
      </>);
    case 'gradient-map': {
      const stops = adj.stops.length >= 2 ? adj.stops : [[0, [0, 0, 0]], [1, [1, 1, 1]]] as [number, [number, number, number]][];
      const setStop = (idx: number, hex: string) => {
        const c = hexToRgb(hex);
        const next = stops.map((s, i) => (i === idx ? [s[0], [c.r, c.g, c.b]] as [number, [number, number, number]] : s));
        set({ stops: next });
      };
      return (<>
        <label className="ps-field-row"><span>Shadows</span>
          <input type="color" value={rgbToHex({ r: stops[0][1][0], g: stops[0][1][1], b: stops[0][1][2], a: 1 })} onChange={e => setStop(0, e.target.value)} />
        </label>
        <label className="ps-field-row"><span>Highlights</span>
          <input type="color" value={rgbToHex({ r: stops[1][1][0], g: stops[1][1][1], b: stops[1][1][2], a: 1 })} onChange={e => setStop(1, e.target.value)} />
        </label>
        <label className="ps-check"><input type="checkbox" checked={adj.reverse} onChange={e => set({ reverse: e.target.checked })} /> Reverse</label>
      </>);
    }
    case 'color-balance': {
      const rows: ['shadows' | 'midtones' | 'highlights', string][] = [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']];
      const chNames = ['Cyan–Red', 'Magenta–Green', 'Yellow–Blue'];
      return (<>
        {rows.map(([keyName, label]) => (
          <div key={keyName} className="ps-subgroup">
            <div className="ps-subgroup-title">{label}</div>
            {([0, 1, 2] as const).map(ch => (
              <Slider key={ch} label={chNames[ch]} value={adj[keyName][ch]} min={-100} max={100}
                onChange={v => { const next = [...adj[keyName]] as [number, number, number]; next[ch] = v; set({ [keyName]: next }); }} />
            ))}
          </div>
        ))}
      </>);
    }
    case 'channel-mixer': {
      return (<>
        {(['Red output', 'Green output', 'Blue output'] as const).map((label, row) => (
          <div key={label} className="ps-subgroup">
            <div className="ps-subgroup-title">{label}</div>
            {(['Source red', 'Source green', 'Source blue'] as const).map((sLabel, col) => (
              <Slider key={sLabel} label={sLabel} value={adj.matrix[row][col]} min={-2} max={2} step={0.01} format={v => v.toFixed(2)}
                onChange={v => {
                  const matrix = adj.matrix.map(r => [...r]) as typeof adj.matrix;
                  matrix[row][col] = v;
                  set({ matrix });
                }} />
            ))}
          </div>
        ))}
        <label className="ps-check"><input type="checkbox" checked={adj.monochrome} onChange={e => set({ monochrome: e.target.checked })} /> Monochrome</label>
      </>);
    }
    case 'invert':
      return <p className="ps-note">Invert has no settings — it flips every color.</p>;
    default:
      return <p className="ps-note">No editor for this adjustment yet.</p>;
  }
}

/* ------------------------------ main panel ------------------------------ */

export function StudioPanels(props: Props): React.ReactElement {
  const { activeLayer } = props;
  const qa = props.quickAdjust;
  const setQa = (patch: Partial<QuickAdjust>) => props.onQuickAdjust({ ...qa, ...patch });

  const isAdjustment = activeLayer?.content.kind === 'adjustment';
  const isRasterLike = activeLayer && (activeLayer.content.kind === 'raster' || activeLayer.content.kind === 'smart');

  const fxItems = activeLayer?.effects.items ?? [];
  const findFx = (kind: string) => fxItems.find(e => e.kind === kind);
  const toggleFx = (kind: 'drop-shadow' | 'outer-glow' | 'stroke') => {
    if (!activeLayer) return;
    const exists = findFx(kind);
    if (exists) {
      activeLayer.effects.items = fxItems.filter(e => e.kind !== kind);
    } else {
      activeLayer.effects.enabled = true;
      activeLayer.effects.items = [...fxItems, defaultEffect(kind)];
    }
    props.onEffectsChange(activeLayer);
  };
  const patchFx = (kind: string, mutate: (fx: never) => void) => {
    if (!activeLayer) return;
    const fx = findFx(kind) as never | undefined;
    if (fx) { mutate(fx); props.onEffectsChange(activeLayer); }
  };

  const shadow = findFx('drop-shadow') as { kind: 'drop-shadow'; shadow: { size: number; distance: number; color: RgbColor } } | undefined;
  const glow = findFx('outer-glow') as { kind: 'outer-glow'; glow: { size: number; paint: { kind: string; color?: RgbColor } } } | undefined;
  const stroke = findFx('stroke') as { kind: 'stroke'; stroke: { size: number; paint: { kind: string; color?: RgbColor } } } | undefined;

  return (
    <div className="ps-panels">
      <div className="ps-panel-block">
        <div className="ps-panel-head"><span>{isAdjustment ? 'Adjustment' : 'Adjust'}</span></div>
        <div className="ps-panel-body">
          {!activeLayer && <p className="ps-note">Select a layer to adjust it.</p>}
          {isAdjustment && activeLayer.content.kind === 'adjustment' && (
            <>
              <div className="ps-adj-title">{adjustmentLabel(activeLayer.content.adjustment)}</div>
              <AdjustmentEditor adj={activeLayer.content.adjustment} onChange={props.onAdjustmentParams} />
            </>
          )}
          {activeLayer && !isAdjustment && !isRasterLike && (
            <p className="ps-note">Quick adjustments apply to image layers. Add an adjustment layer to affect everything below it.</p>
          )}
          {isRasterLike && (
            <>
              <Slider label="Brightness" value={qa.brightness} min={-150} max={150} onChange={v => setQa({ brightness: v })} />
              <Slider label="Contrast" value={qa.contrast} min={-100} max={100} onChange={v => setQa({ contrast: v })} />
              <Slider label="Saturation" value={qa.saturation} min={-100} max={100} onChange={v => setQa({ saturation: v })} />
              <Slider label="Hue" value={qa.hue} min={-180} max={180} onChange={v => setQa({ hue: v })} />
              <Slider label="Exposure" value={qa.exposure} min={-3} max={3} step={0.05} format={v => v.toFixed(2)} onChange={v => setQa({ exposure: v })} />
              <Slider label="Blur" value={qa.blur} min={0} max={100} onChange={v => setQa({ blur: v })} />
              <button type="button" className="ps-reset-btn" onClick={() => props.onQuickAdjust({ brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0 })}>Reset adjustments</button>
            </>
          )}
        </div>
      </div>

      <div className="ps-panel-block">
        <div className="ps-panel-head"><span>Layer style</span></div>
        <div className="ps-panel-body">
          {!activeLayer && <p className="ps-note">Select a layer to style it.</p>}
          {activeLayer && (
            <>
              <label className="ps-check"><input type="checkbox" checked={!!shadow} onChange={() => toggleFx('drop-shadow')} /> Drop shadow</label>
              {shadow && (<>
                <Slider label="Size" value={shadow.shadow.size} min={0} max={80} onChange={v => patchFx('drop-shadow', fx => { (fx as typeof shadow).shadow.size = v; })} />
                <Slider label="Distance" value={shadow.shadow.distance} min={0} max={80} onChange={v => patchFx('drop-shadow', fx => { (fx as typeof shadow).shadow.distance = v; })} />
                <label className="ps-field-row"><span>Color</span>
                  <input type="color" value={rgbToHex(shadow.shadow.color)} onChange={e => patchFx('drop-shadow', fx => { (fx as typeof shadow).shadow.color = hexToRgb(e.target.value, (fx as typeof shadow).shadow.color.a); })} />
                </label>
              </>)}
              <label className="ps-check"><input type="checkbox" checked={!!glow} onChange={() => toggleFx('outer-glow')} /> Outer glow</label>
              {glow && (
                <Slider label="Size" value={glow.glow.size} min={0} max={120} onChange={v => patchFx('outer-glow', fx => { (fx as typeof glow).glow.size = v; })} />
              )}
              <label className="ps-check"><input type="checkbox" checked={!!stroke} onChange={() => toggleFx('stroke')} /> Stroke (shapes & text)</label>
              {stroke && (<>
                <Slider label="Width" value={stroke.stroke.size} min={1} max={40} onChange={v => patchFx('stroke', fx => { (fx as typeof stroke).stroke.size = v; })} />
                <label className="ps-field-row"><span>Color</span>
                  <input type="color" value={stroke.stroke.paint.kind === 'color' && stroke.stroke.paint.color ? rgbToHex(stroke.stroke.paint.color) : '#ff0000'}
                    onChange={e => patchFx('stroke', fx => { (fx as typeof stroke).stroke.paint = { kind: 'color', color: hexToRgb(e.target.value) }; })} />
                </label>
              </>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
