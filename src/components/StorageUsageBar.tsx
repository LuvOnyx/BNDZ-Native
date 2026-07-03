import React from 'react';

interface StorageUsageBarProps {
  usedPct: number;
  height?: number;
  className?: string;
  warnAbove?: number;
  critAbove?: number;
  showLabels?: boolean;
}

function tier(pct: number, warnAbove: number, critAbove: number) {
  if (pct >= critAbove) return 'critical';
  if (pct >= warnAbove) return 'warn';
  return 'healthy';
}

/** macOS-inspired storage meter — rounded glass track with tiered fill */
export function StorageUsageBar({
  usedPct,
  height = 6,
  className = '',
  warnAbove = 85,
  critAbove = 95,
  showLabels = false,
}: StorageUsageBarProps) {
  const pct = Math.min(100, Math.max(0, usedPct));
  const freePct = 100 - pct;
  const level = tier(pct, warnAbove, critAbove);

  const fillClass =
    level === 'critical'
      ? 'bndz-storage-fill-critical'
      : level === 'warn'
        ? 'bndz-storage-fill-warn'
        : 'bndz-storage-fill-healthy';

  return (
    <div className={className}>
      {showLabels && (
        <div className="flex justify-between text-[8px] text-white/40 mb-0.5 font-medium tracking-wide">
          <span>{Math.round(pct)}% used</span>
          <span>{Math.round(freePct)}% free</span>
        </div>
      )}
      <div
        className="bndz-storage-track w-full overflow-hidden"
        style={{ height }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${Math.round(pct)} percent storage used`}
      >
        <div className={`h-full bndz-storage-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
