import React, { useMemo, useState } from 'react';
import { formatStorageSize } from '../../lib/storageOrganize';

export type BreakdownTopItem = {
  path: string;
  name: string;
  size: number;
  isDirectory?: boolean;
};

export type BreakdownSegment = {
  id: string;
  name: string;
  color: string;
  totalBytes: number;
  fileCount: number;
  percent: number;
  topItems: BreakdownTopItem[];
};

export type BreakdownResult = {
  rootPath: string;
  segments: BreakdownSegment[];
  totalBytes: number;
  filesSeen: number;
  partial?: boolean;
  cancelled?: boolean;
  fromCache?: boolean;
  driveRootLimited?: boolean;
  warning?: string | null;
  elapsedMs?: number;
};

type Props = {
  result: BreakdownResult | null;
  scanning?: boolean;
  progressPercent?: number;
  size?: number;
  onNavigate?: (winPath: string) => void;
};

const R = 34;
const C = 2 * Math.PI * R;

function buildArcs(segments: BreakdownSegment[]) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.totalBytes), 0);
  if (total <= 0) return [] as Array<BreakdownSegment & { dash: number; offset: number }>;
  let offset = 0;
  return segments
    .filter(s => s.totalBytes > 0)
    .map(s => {
      const dash = (s.totalBytes / total) * C;
      const arc = { ...s, dash, offset: -offset };
      offset += dash;
      return arc;
    });
}

/** Dense native multi-segment capacity ring — matches Properties ring craft. */
export default function StorageCategoryWheel({
  result,
  scanning = false,
  progressPercent = 0,
  size = 96,
  onNavigate,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const arcs = useMemo(() => buildArcs(result?.segments || []), [result]);
  const hover = arcs.find(a => a.id === hoverId) || null;
  const centerLabel = scanning
    ? `${Math.max(0, Math.min(99, Math.round(progressPercent)))}%`
    : result?.totalBytes
      ? formatStorageSize(result.totalBytes)
      : '—';

  return (
    <div className="bndz-cat-wheel" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" width={size} height={size} className="bndz-cat-wheel-svg" aria-label="Storage category breakdown">
        <circle cx="40" cy="40" r={R} className="bndz-props-ring-track" />
        {arcs.length === 0 && !scanning && (
          <circle
            cx="40" cy="40" r={R}
            className="bndz-props-ring-fill is-healthy"
            strokeDasharray={`${C * 0.08} ${C}`}
            transform="rotate(-90 40 40)"
          />
        )}
        {arcs.map(a => (
          <circle
            key={a.id}
            cx="40" cy="40" r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={hoverId === a.id ? 9 : 7}
            strokeLinecap="butt"
            strokeDasharray={`${a.dash} ${C - a.dash}`}
            strokeDashoffset={a.offset}
            transform="rotate(-90 40 40)"
            className={`bndz-cat-wheel-seg${hoverId === a.id ? ' is-hot' : ''}`}
            onMouseEnter={() => setHoverId(a.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{ cursor: 'default', transition: 'stroke-width 120ms ease' }}
          />
        ))}
        {scanning && arcs.length === 0 && (
          <circle
            cx="40" cy="40" r={R}
            className="bndz-props-ring-fill is-healthy bndz-cat-wheel-pulse"
            strokeDasharray={`${C * Math.max(0.04, progressPercent / 100)} ${C}`}
            transform="rotate(-90 40 40)"
          />
        )}
      </svg>
      <div className="bndz-props-ring-label bndz-cat-wheel-label">
        <span className="bndz-cat-wheel-label-main">{centerLabel}</span>
        {scanning && <span className="bndz-cat-wheel-label-sub">Scanning…</span>}
        {!scanning && result?.partial && <span className="bndz-cat-wheel-label-sub">Partial</span>}
      </div>

      {hover && (
        <div className="bndz-cat-wheel-tip" role="tooltip">
          <div className="bndz-cat-wheel-tip-head">
            <span className="bndz-cat-wheel-tip-swatch" style={{ background: hover.color }} />
            <strong>{hover.name}</strong>
            <em>{formatStorageSize(hover.totalBytes)} · {hover.percent.toFixed(1)}%</em>
          </div>
          <div className="bndz-cat-wheel-tip-meta">{hover.fileCount.toLocaleString()} files</div>
          {hover.topItems?.length > 0 ? (
            <ul className="bndz-cat-wheel-tip-list">
              {hover.topItems.slice(0, 5).map(item => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="bndz-cat-wheel-tip-item"
                    title={item.path}
                    onClick={() => onNavigate?.(item.path)}
                  >
                    <span className="bndz-cat-wheel-tip-name">{item.name}</span>
                    <span className="bndz-cat-wheel-tip-size">{formatStorageSize(item.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="bndz-cat-wheel-tip-empty">No large items sampled yet</div>
          )}
        </div>
      )}
    </div>
  );
}
