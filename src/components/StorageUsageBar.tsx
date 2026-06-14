import React from 'react';

interface StorageUsageBarProps {
  usedPct: number;
  height?: number;
  className?: string;
  warnAbove?: number;
}

/** Rounded-rectangle storage meter (sidebar + list view) */
export function StorageUsageBar({
  usedPct,
  height = 6,
  className = '',
  warnAbove = 90,
}: StorageUsageBarProps) {
  const pct = Math.min(100, Math.max(0, usedPct));
  const critical = pct >= warnAbove;

  return (
    <div
      className={`storage-usage-bar w-full overflow-hidden rounded-[3px] bg-[#2a2a2a] border border-[#333]/80 shadow-inner ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-[2px] transition-[width] duration-300 ${
          critical ? 'bg-gradient-to-r from-[#c43c4a] to-[#e85d6a]' : 'bg-gradient-to-r from-[#4a9fd4] to-[#6db4e6]'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
