import React, { memo, useRef } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { ShellNativeIcon } from '../ShellNativeIcon';
import type { CanvasItem } from '../../lib/spatialCanvasStore';
import type { PinIntelligence } from '../../lib/workspace/useSpatialIntelligence';

type Props = {
  item: CanvasItem;
  selected: boolean;
  dragging: boolean;
  editingNote: boolean;
  cardW: number;
  cardH: number;
  intelligence?: PinIntelligence;
  onPointerDown: (e: React.PointerEvent, item: CanvasItem) => void;
  onClick?: (e: React.MouseEvent, item: CanvasItem) => void;
  onDoubleClick: (item: CanvasItem) => void;
  onContextMenu: (e: React.MouseEvent, item: CanvasItem) => void;
  onNoteBlur: (id: string, value: string) => void;
  onNoteCancel: () => void;
  onReveal?: (item: CanvasItem) => void;
  onAutomate?: (item: CanvasItem) => void;
  onAddStickyBeside?: (item: CanvasItem) => void;
};

function looksLikeDirectory(path: string): boolean {
  const base = path.split(/[/\\]/).pop() || '';
  return !base.includes('.');
}

function severityColor(critical: number, warning: number): string {
  if (critical > 0) return 'var(--intel-critical, #ef4444)';
  if (warning > 0) return 'var(--intel-warning, #f59e0b)';
  return 'var(--intel-ok, #22c55e)';
}

function capacityColor(usedPercent: number): string {
  if (usedPercent >= 90) return 'var(--intel-critical, #ef4444)';
  if (usedPercent >= 75) return 'var(--intel-warning, #f59e0b)';
  return 'var(--intel-ok, #22c55e)';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/** Spatial pin — glass constellation (WorkspaceLaunchCard DNA), distinct from Automation rack. */
function SpatialCanvasCardInner({
  item,
  selected,
  dragging,
  editingNote,
  cardW,
  cardH,
  intelligence,
  onPointerDown,
  onClick,
  onDoubleClick,
  onContextMenu,
  onNoteBlur,
  onNoteCancel,
  onReveal,
  onAutomate,
  onAddStickyBeside,
}: Props) {
  const cardRef = useRef<HTMLElement>(null);
  const isDir = looksLikeDirectory(item.path);
  const kind = isDir ? 'Folder' : 'File';
  const accent = isDir ? '#c4a35a' : '#7eb8e8';

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const card = cardRef.current;
    if (!card || dragging) return;
    const rect = card.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', `${x}%`);
    card.style.setProperty('--mouse-y', `${y}%`);
  };

  return (
    <article
      ref={cardRef}
      data-spatial-card={item.id}
      role="button"
      tabIndex={0}
      aria-label={`${kind}: ${item.name}. Click to select · double-click to open.`}
      aria-pressed={selected}
      className={`bndz-spatial-card bndz-pin-module${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${isDir ? ' is-folder' : ' is-file'}`}
      style={{ left: item.x, top: item.y, width: cardW, minHeight: cardH, ['--ws-accent' as string]: accent }}
      onPointerDown={e => onPointerDown(e, item)}
      onPointerMove={handlePointerMove}
      onClick={e => onClick?.(e, item)}
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={e => onContextMenu(e, item)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDoubleClick(item);
        }
      }}
    >
      <span className="bndz-pin-bloom" aria-hidden />
      <span className="bndz-pin-mesh" aria-hidden />
      <span className="bndz-pin-spotlight" aria-hidden />
      <span className="bndz-pin-topline" aria-hidden />
      <span className="bndz-pin-shimmer" aria-hidden />
      <span className="bndz-pin-edge" aria-hidden />

      <div className="bndz-pin-main">
        <span className="bndz-pin-medallion" aria-hidden>
          <span className="bndz-pin-medallion-ring" />
          <span className="bndz-pin-medallion-glow" />
          <span className="bndz-pin-medallion-icon">
            <ShellNativeIcon path={item.path} isDir={isDir} size={40} preferThumbnail eager stableSrc />
          </span>
        </span>
        <div className="bndz-pin-body">
          <div className="bndz-pin-kicker">{kind} pin</div>
          <div className="bndz-pin-title" title={item.name}>{item.name}</div>
          <div className="bndz-pin-path" title={item.path}>{item.path}</div>
          {editingNote ? (
            <input
              className="bndz-spatial-card-note-input"
              autoFocus
              defaultValue={item.note || ''}
              placeholder="Add a note…"
              aria-label={`Note for ${item.name}`}
              onBlur={e => onNoteBlur(item.id, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onNoteBlur(item.id, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') onNoteCancel();
              }}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            />
          ) : item.note ? (
            <div className="bndz-spatial-card-note" title={item.note}>{item.note}</div>
          ) : null}
        </div>
      </div>

      {intelligence && !intelligence.loading && (
        <div className="bndz-pin-intel-badges">
          {intelligence.health && intelligence.health.total > 0 && (
            <span
              className="bndz-pin-intel-badge bndz-pin-intel-badge--health"
              style={{ '--badge-accent': severityColor(intelligence.health.critical, intelligence.health.warning) } as React.CSSProperties}
              title={`${intelligence.health.total} problem${intelligence.health.total === 1 ? '' : 's'} (${intelligence.health.critical} critical, ${intelligence.health.warning} warn)`}
            >
              <span className="bndz-pin-intel-badge-dot" />
              {intelligence.health.critical > 0
                ? `${intelligence.health.critical} critical`
                : `${intelligence.health.total} issue${intelligence.health.total === 1 ? '' : 's'}`}
            </span>
          )}
          {intelligence.lineage && (intelligence.lineage.inboundCount > 0 || intelligence.lineage.outboundCount > 0) && (
            <span
              className="bndz-pin-intel-badge bndz-pin-intel-badge--lineage"
              title={`Lineage: ${intelligence.lineage.inboundCount} in · ${intelligence.lineage.outboundCount} out${intelligence.lineage.recentOp ? ` · last: ${intelligence.lineage.recentOp}` : ''}`}
            >
              <span className="bndz-pin-intel-badge-arc" />
              {intelligence.lineage.inboundCount + intelligence.lineage.outboundCount} edge{(intelligence.lineage.inboundCount + intelligence.lineage.outboundCount) === 1 ? '' : 's'}
            </span>
          )}
          {intelligence.capacity && (
            <span
              className="bndz-pin-intel-badge bndz-pin-intel-badge--capacity"
              style={{ '--badge-accent': capacityColor(intelligence.capacity.usedPercent) } as React.CSSProperties}
              title={`${intelligence.capacity.usedPercent}% used · ${formatBytes(intelligence.capacity.freeBytes)} free`}
            >
              <span className="bndz-pin-intel-badge-bar">
                <span className="bndz-pin-intel-badge-bar-fill" style={{ width: `${intelligence.capacity.usedPercent}%` }} />
              </span>
              {intelligence.capacity.usedPercent}%
            </span>
          )}
        </div>
      )}

      <div className="bndz-pin-actions">
        {onAddStickyBeside && (
          <button type="button" className="bndz-pin-chip" title="Add sticky beside" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onAddStickyBeside(item); }}>
            <Icons8Icon id="notepad" size={11} /> Note
          </button>
        )}
        {onAutomate && (
          <button type="button" className="bndz-pin-chip" title="Send to automation" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onAutomate(item); }}>
            <Icons8Icon id="zap_ui" size={11} /> Auto
          </button>
        )}
        {onReveal && (
          <button type="button" className="bndz-pin-chip" title="Reveal in Explorer" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onReveal(item); }}>
            <Icons8Icon id="explorer" size={11} /> Reveal
          </button>
        )}
        <button type="button" className="bndz-pin-chip is-primary" title={isDir ? 'Open folder' : 'Open file'} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDoubleClick(item); }}>
          <Icons8Icon id="folder_open_ui" size={11} /> Open
        </button>
      </div>

      {item.note && !editingNote && (
        <span className="bndz-spatial-card-note-badge" title="Has note" aria-hidden>
          <Icons8Icon id="notepad" size={10} />
        </span>
      )}
    </article>
  );
}

export const SpatialCanvasCard = memo(SpatialCanvasCardInner);
export default SpatialCanvasCard;
