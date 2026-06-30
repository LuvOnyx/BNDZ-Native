import React from 'react';
import { StorageUsageBar } from './StorageUsageBar';
import { ShellNativeIcon } from './ShellNativeIcon';

export type DriveCardData = {
  name: string;
  label?: string;
  totalSpace: number;
  freeSpace: number;
  type?: string;
  path?: string;
};

type Props = {
  drive: DriveCardData;
  layout?: 'compact' | 'grid' | 'details';
  selected?: boolean;
};

function formatBytes(bytes: number) {
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i >= 3 ? 1 : 0))} ${sizes[i]}`;
}

/** Compact drive rows — rectangle-rounded, no pill cards */
export default function DriveCard({ drive, layout = 'compact', selected }: Props) {
  const usedPct = drive.totalSpace > 0
    ? ((drive.totalSpace - drive.freeSpace) / drive.totalSpace) * 100
    : 0;
  const letter = drive.name.replace(/^\//, '');
  const displayLabel = drive.label || letter;

  if (layout === 'grid') {
    return (
      <div className={`flex flex-col items-center justify-center w-full h-full min-h-0 gap-1.5 px-1 ${selected ? 'opacity-100' : ''}`}>
        <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={36} eager />
        <div className="text-[11px] font-medium text-center truncate w-full text-white/90">{displayLabel}</div>
        <div className="w-full max-w-[120px]">
          <StorageUsageBar usedPct={usedPct} height={5} />
        </div>
        <div className="text-[9px] text-white/45 text-center truncate w-full">{formatBytes(drive.freeSpace)} free</div>
      </div>
    );
  }

  if (layout === 'details') {
    return (
      <div className="flex-1 flex items-center min-w-0 gap-3">
        <div className="w-[38%] max-w-[280px] px-2 truncate text-[11px]">
          {displayLabel} <span className="text-white/35">({letter})</span>
        </div>
        <div className="w-[14%] max-w-[100px] px-2 text-[11px] text-white/50 truncate">{drive.type || 'Local Disk'}</div>
        <div className="w-[12%] max-w-[90px] px-2 text-right text-[11px] text-white/50">
          {formatBytes(drive.totalSpace)}
        </div>
        <div className="flex-1 min-w-[140px] max-w-[220px] px-2">
          <StorageUsageBar usedPct={usedPct} height={6} />
          <div className="text-[9px] text-white/45 mt-0.5 truncate">
            {formatBytes(drive.freeSpace)} free of {formatBytes(drive.totalSpace)}
          </div>
        </div>
      </div>
    );
  }

  // compact — sidebar & list strip
  return (
    <div className="px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] border-l-2 border-transparent hover:border-sky-500/40 transition-colors">
      <div className="flex items-center gap-2 mb-1 text-white/80">
        <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={14} eager />
        <span className="text-[11px] font-medium truncate">{displayLabel}</span>
        <span className="text-[10px] text-white/35 truncate">({letter})</span>
      </div>
      <StorageUsageBar usedPct={usedPct} height={4} className="mb-1" />
      <div className="flex justify-between text-[9px] text-white/40 font-mono">
        <span>{formatBytes(drive.freeSpace)} free</span>
        <span>{formatBytes(drive.totalSpace)}</span>
      </div>
    </div>
  );
}
