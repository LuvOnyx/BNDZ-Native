import React from 'react';
import { StorageUsageBar } from './StorageUsageBar';
import { ShellNativeIcon } from './ShellNativeIcon';
import { formatDriveLetter } from '../lib/displayPath';

export type DriveCardData = {
  name: string;
  label?: string;
  totalSpace: number;
  freeSpace: number;
  type?: string;
  format?: string;
  path?: string;
};

type Props = {
  drive: DriveCardData;
  layout?: 'compact' | 'grid' | 'details' | 'list';
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
  const letter = formatDriveLetter(drive.name);
  const rawLabel = (drive.label || '').trim();
  const displayLabel = !rawLabel || rawLabel.replace(/\\/g, '') === letter.replace(/\\/g, '')
    ? letter
    : rawLabel;
  const showLetterSuffix = displayLabel.replace(/\\/g, '').toLowerCase() !== letter.replace(/\\/g, '').toLowerCase();
  const freeOfTotal = `${formatBytes(drive.freeSpace)} free of ${formatBytes(drive.totalSpace)}`;

  if (layout === 'grid') {
    return (
      <div
        className={`bndz-list-select-cell flex flex-col items-center w-full gap-1.5 p-2.5 rounded-[var(--bndz-radius-sm)] bg-white/[0.03] border transition-colors ${selected ? 'border-[#0078d4]/50 bg-[#094771]/25' : 'border-white/[0.06]'}`}
      >
        <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={40} eager />
        <div className="text-[11px] font-medium text-center truncate w-full text-white/90" title={showLetterSuffix ? `${displayLabel} (${letter})` : letter}>
          {displayLabel}{showLetterSuffix ? <span className="text-white/40"> ({letter})</span> : null}
        </div>
        <StorageUsageBar usedPct={usedPct} height={6} className="w-full" />
        <div className="text-[9px] text-white/45 text-center truncate w-full">{freeOfTotal}</div>
      </div>
    );
  }

  if (layout === 'list') {
    return (
      <div
        className={`flex items-center gap-2.5 w-full min-w-0 p-2 rounded-[var(--bndz-radius-sm)] bg-white/[0.03] border transition-colors ${selected ? 'border-[#0078d4]/50 bg-[#094771]/25' : 'border-white/[0.06]'}`}
      >
        <div className="bndz-list-select-cell flex items-center gap-2.5 flex-1 min-w-0">
          <div className="shrink-0">
            <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={28} eager />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium truncate text-white/90" title={showLetterSuffix ? `${displayLabel} (${letter})` : letter}>
              {displayLabel}{showLetterSuffix ? <span className="text-white/40"> ({letter})</span> : null}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0 max-w-[45%]">
          <StorageUsageBar usedPct={usedPct} height={5} className="mt-0" />
          <div className="text-[9px] text-white/45 mt-1 truncate">{freeOfTotal}</div>
        </div>
      </div>
    );
  }

  if (layout === 'details') {
    return (
      <div className="flex-1 flex items-center min-w-0 gap-3">
        <div className="bndz-list-select-cell w-[30%] min-w-[110px] max-w-[280px] px-2 truncate text-[11px] text-white/90">
          {displayLabel}{showLetterSuffix ? <span className="text-white/35"> ({letter})</span> : null}
        </div>
        <div className="bndz-list-select-cell w-[14%] max-w-[110px] px-2 text-[11px] text-white/50 truncate">{drive.type || drive.format || 'Local Disk'}</div>
        <div className="flex-1 min-w-[160px] max-w-[280px] px-2">
          <StorageUsageBar usedPct={usedPct} height={6} />
          <div className="text-[9px] text-white/45 mt-0.5 truncate">
            {freeOfTotal}
          </div>
        </div>
      </div>
    );
  }

  // compact — sidebar & list strip
  return (
    <div className="px-3 py-1.5 cursor-pointer hover:bg-white/[0.04] border-l-2 border-transparent hover:border-[#0078d4]/40 transition-colors">
      <div className="flex items-center gap-2 mb-1 text-white/80">
        <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={14} eager />
        <span className="text-[11px] font-medium truncate">{displayLabel}</span>
        {showLetterSuffix ? <span className="text-[10px] text-white/35 truncate">({letter})</span> : null}
      </div>
      <StorageUsageBar usedPct={usedPct} height={4} className="mb-1" />
      <div className="flex justify-between text-[9px] text-white/40 font-mono">
        <span>{formatBytes(drive.freeSpace)} free</span>
        <span>{formatBytes(drive.totalSpace)}</span>
      </div>
    </div>
  );
}
