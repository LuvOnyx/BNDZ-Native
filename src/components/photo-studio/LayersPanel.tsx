/**
 * Layers panel — a pure view of the photocraft document model.
 * The panel never owns layer state: every row, slider and toggle reads the
 * model and every edit is a callback into the studio, which updates the
 * model and re-renders. One source of truth (the fix for the old studio's
 * dual bookkeeping).
 */
import React, { useState } from 'react';
import {
  BLEND_MODE_META, LAYER_MODES, type BlendMode,
  adjustmentLabel, defaultAdjustment, type Adjustment, type Document, type Layer, type LayerId,
} from '../../lib/photocraft';

/** Blend modes the canvas compositor can do live (the rest arrive with the custom compositor phase). */
export const LIVE_BLEND_MODES: BlendMode[] = LAYER_MODES.filter(m =>
  ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge',
   'linear-dodge', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion',
   'hue', 'saturation', 'color', 'luminosity'].includes(m));

const ADJUSTMENT_KINDS: Adjustment['kind'][] = [
  'brightness-contrast', 'levels', 'curves', 'exposure', 'vibrance', 'hue-saturation',
  'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'invert',
  'posterize', 'threshold', 'gradient-map',
];

export interface LayersPanelProps {
  doc: Document;
  activeId: LayerId | null;
  selectedIds: LayerId[];
  thumbs: Map<LayerId, string>;
  onSelect: (id: LayerId, additive: boolean) => void;
  onToggleVisible: (id: LayerId) => void;
  onToggleLock: (id: LayerId) => void;
  onRename: (id: LayerId, name: string) => void;
  onReorder: (id: LayerId, targetId: LayerId, placeAfterInPanel: boolean) => void;
  onBlendChange: (id: LayerId, mode: BlendMode) => void;
  onOpacityChange: (id: LayerId, opacity: number, fillOpacity: number) => void;
  onAddLayer: (kind: 'raster' | 'group' | 'text') => void;
  onAddAdjustment: (kind: Adjustment['kind']) => void;
  onDuplicate: (id: LayerId) => void;
  onDelete: (ids: LayerId[]) => void;
  onMergeDown: (id: LayerId) => void;
  onToggleGroup: (id: LayerId) => void;
}

interface Row { layer: Layer; depth: number }

function flattenTopFirst(layers: Layer[], depth: number, out: Row[]): Row[] {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    out.push({ layer, depth });
    if (layer.content.kind === 'group' && layer.content.group.expanded) {
      flattenTopFirst(layer.content.group.children, depth + 1, out);
    }
  }
  return out;
}

const KIND_GLYPH: Record<Layer['content']['kind'], string> = {
  raster: '▦', group: '🗀', adjustment: '◐', fill: '■', text: 'T', shape: '◆', smart: '⧉',
};

export function LayersPanel(props: LayersPanelProps): React.ReactElement {
  const { doc, activeId, selectedIds, thumbs } = props;
  const [renaming, setRenaming] = useState<LayerId | null>(null);
  const [renameText, setRenameText] = useState('');
  const [dragId, setDragId] = useState<LayerId | null>(null);
  const [adjMenuOpen, setAdjMenuOpen] = useState(false);
  const rows = flattenTopFirst(doc.layers, 0, []);
  const active = rows.find(r => r.layer.id === activeId)?.layer ?? null;

  const commitRename = (id: LayerId) => {
    const name = renameText.trim();
    if (name) props.onRename(id, name);
    setRenaming(null);
  };

  return (
    <div className="ps-layers">
      <div className="ps-panel-head">
        <span>Layers</span>
        <div className="ps-panel-head-actions">
          <button type="button" title="Add adjustment layer" onClick={() => setAdjMenuOpen(v => !v)}>◐</button>
          <button type="button" title="New group" onClick={() => props.onAddLayer('group')}>🗀</button>
          <button type="button" title="New layer" onClick={() => props.onAddLayer('raster')}>＋</button>
        </div>
        {adjMenuOpen && (
          <div className="ps-menu ps-adj-menu">
            {ADJUSTMENT_KINDS.map(kind => (
              <button key={kind} type="button" onClick={() => { props.onAddAdjustment(kind); setAdjMenuOpen(false); }}>
                {adjustmentLabel(defaultAdjustment(kind))}
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div className="ps-layer-blendbar">
          <select
            className="ps-select"
            value={active.blend}
            disabled={active.content.kind === 'group'}
            onChange={e => props.onBlendChange(active.id, e.target.value as BlendMode)}
            title="Blend mode"
          >
            {(active.content.kind === 'group' ? ['pass-through'] as BlendMode[] : LIVE_BLEND_MODES).map(m => (
              <option key={m} value={m}>{BLEND_MODE_META[m].label}</option>
            ))}
          </select>
          <label className="ps-mini-slider" title="Opacity">
            <span>Opacity</span>
            <input type="range" min={0} max={100} value={Math.round(active.opacity * 100)}
              onChange={e => props.onOpacityChange(active.id, Number(e.target.value) / 100, active.fillOpacity)} />
            <span className="ps-mini-val">{Math.round(active.opacity * 100)}%</span>
          </label>
          <label className="ps-mini-slider" title="Fill opacity">
            <span>Fill</span>
            <input type="range" min={0} max={100} value={Math.round(active.fillOpacity * 100)}
              onChange={e => props.onOpacityChange(active.id, active.opacity, Number(e.target.value) / 100)} />
            <span className="ps-mini-val">{Math.round(active.fillOpacity * 100)}%</span>
          </label>
        </div>
      )}

      <div className="ps-layer-rows">
        {rows.map(({ layer, depth }) => {
          const isActive = layer.id === activeId;
          const isSelected = selectedIds.includes(layer.id);
          const locked = layer.locks.all || layer.locks.position;
          const thumb = thumbs.get(layer.id);
          return (
            <div
              key={layer.id}
              className={`ps-layer-row${isActive ? ' is-active' : ''}${isSelected && !isActive ? ' is-selected' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              draggable={renaming !== layer.id}
              onDragStart={e => { setDragId(layer.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={e => {
                e.preventDefault();
                if (dragId == null || dragId === layer.id) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const afterInPanel = (e.clientY - rect.top) > rect.height / 2;
                props.onReorder(dragId, layer.id, afterInPanel);
                setDragId(null);
              }}
              onClick={e => props.onSelect(layer.id, e.ctrlKey || e.metaKey)}
            >
              <button type="button" className="ps-eye" title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={e => { e.stopPropagation(); props.onToggleVisible(layer.id); }}>
                {layer.visible ? '👁' : '—'}
              </button>
              {layer.content.kind === 'group' && (
                <button type="button" className="ps-group-toggle" title="Expand/collapse group"
                  onClick={e => { e.stopPropagation(); props.onToggleGroup(layer.id); }}>
                  {layer.content.kind === 'group' && layer.content.group.expanded ? '▾' : '▸'}
                </button>
              )}
              <span className="ps-layer-thumb">
                {thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="ps-layer-kind">{KIND_GLYPH[layer.content.kind]}</span>}
              </span>
              {renaming === layer.id ? (
                <input
                  className="ps-rename"
                  autoFocus
                  value={renameText}
                  onChange={e => setRenameText(e.target.value)}
                  onBlur={() => commitRename(layer.id)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(layer.id); if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="ps-layer-name" onDoubleClick={e => { e.stopPropagation(); setRenaming(layer.id); setRenameText(layer.name); }}>
                  {layer.name}
                </span>
              )}
              {layer.content.kind === 'adjustment' && (
                <span className="ps-layer-tag">{adjustmentLabel(layer.content.adjustment)}</span>
              )}
              <button type="button" className={`ps-lock${locked ? ' is-locked' : ''}`} title={locked ? 'Unlock layer' : 'Lock layer'}
                onClick={e => { e.stopPropagation(); props.onToggleLock(layer.id); }}>
                {locked ? '🔒' : '🔓'}
              </button>
            </div>
          );
        })}
        {rows.length === 0 && <div className="ps-empty">No layers yet — open an image or add a layer.</div>}
      </div>

      <div className="ps-layer-footer">
        <button type="button" title="Duplicate layer" disabled={!active}
          onClick={() => active && props.onDuplicate(active.id)}>⧉ Duplicate</button>
        <button type="button" title="Merge down" disabled={!active}
          onClick={() => active && props.onMergeDown(active.id)}>Merge down</button>
        <button type="button" title="Delete selected layers" disabled={selectedIds.length === 0 && !active}
          onClick={() => props.onDelete(selectedIds.length ? selectedIds : (active ? [active.id] : []))}>🗑 Delete</button>
      </div>
    </div>
  );
}
