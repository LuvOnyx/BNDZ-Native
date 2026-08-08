import React from 'react';
import { StorageUsageBar } from './StorageUsageBar';
import { ShellNativeIcon } from './ShellNativeIcon';
import { formatDriveDisplayName, formatDriveLetter, formatDriveVolumeLabel } from '../lib/displayPath';

export type DriveCardData = {
  name: string;
  label?: string;
  totalSpace: number;
  freeSpace: number;
  type?: string;
  format?: string;
  path?: string;
  /** When true, hide free-space chrome (Settings → skip calc for mapped network). */
  skipFreeSpace?: boolean;
};

type Props = {
  drive: DriveCardData;
  layout?: 'compact' | 'grid' | 'details' | 'list';
  selected?: boolean;
  /** Icon pixel size — follows the Grid/List density slider. */
  iconSize?: number;
};

function formatBytes(bytes: number) {
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i >= 3 ? 1 : 0))} ${sizes[i]}`;
}

/** Compact drive rows — rectangle-rounded, no pill cards */
export default function DriveCard({ drive, layout = 'compact', selected, iconSize }: Props) {
  const skipFree = !!drive.skipFreeSpace;
  const usedPct = !skipFree && drive.totalSpace > 0
    ? ((drive.totalSpace - drive.freeSpace) / drive.totalSpace) * 100
    : 0;
  const letter = formatDriveLetter(drive.name);
  const vol = formatDriveVolumeLabel(drive.label, letter);
  const displayLabel = vol || letter;
  const showLetterSuffix = !!vol && vol.replace(/\\/g, '').toLowerCase() !== letter.replace(/\\/g, '').toLowerCase();
  const title = formatDriveDisplayName(drive.label, drive.name);
  const freeOfTotal = skipFree
    ? 'Free space hidden'
    : `${formatBytes(drive.freeSpace)} free of ${formatBytes(drive.totalSpace)}`;
  const gridIcon = Math.max(28, Math.min(120, iconSize ?? 40));
  const listIcon = Math.max(16, Math.min(64, iconSize ?? 28));

  if (layout === 'grid') {
    return (
      <div
        className={`bndz-list-select-cell flex flex-col items-center w-full gap-1.5 p-2.5 rounded-[var(--bndz-radius-sm)] bg-white/[0.03] border transition-colors ${selected ? 'border-[#0078d4]/50 bg-[#094771]/25' : 'border-white/[0.06]'}`}
      >
        <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={gridIcon} eager />
        <div className="text-[11px] font-medium text-center truncate w-full text-white/90" title={title}>
          {displayLabel}{showLetterSuffix ? <span className="text-white/40"> ({letter})</span> : null}
        </div>
        {!skipFree && <StorageUsageBar usedPct={usedPct} height={6} className="w-full" />}
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
            <ShellNativeIcon path={drive.path || drive.name} isDir={false} size={listIcon} eager />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium truncate text-white/90" title={title}>
              {displayLabel}{showLetterSuffix ? <span className="text-white/40"> ({letter})</span> : null}
            </div>
          </div>
        </div>
        {!skipFree && (
          <div className="flex-1 min-w-0 max-w-[45%]">
            <StorageUsageBar usedPct={usedPct} height={5} className="mt-0" />
            <div className="text-[9px] text-white/45 mt-1 truncate">{freeOfTotal}</div>
          </div>
        )}
        {skipFree && (
          <div className="text-[9px] text-white/40 shrink-0">{freeOfTotal}</div>
        )}
      </div>
    );
  }

  if (layout === 'details') {
    return (
      <div className="flex-1 flex items-center min-w-0 gap-3">
        <div className="bndz-list-select-cell w-[30%] min-w-[110px] max-w-[280px] px-2 truncate text-[11px] text-white/90" title={title}>
          {displayLabel}{showLetterSuffix ? <span className="text-white/35"> ({letter})</span> : null}
        </div>
        <div className="bndz-list-select-cell w-[14%] max-w-[110px] px-2 text-[11px] text-white/50 truncate">{drive.type || drive.format || 'Local Disk'}</div>
        <div className="flex-1 min-w-[160px] max-w-[280px] px-2">
          {!skipFree && <StorageUsageBar usedPct={usedPct} height={6} />}
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
        <span className="text-[11px] font-medium truncate" title={title}>{displayLabel}</span>
        {showLetterSuffix ? <span className="text-[10px] text-white/35 truncate">({letter})</span> : null}
      </div>
      {!skipFree && <StorageUsageBar usedPct={usedPct} height={4} className="mb-1" />}
      <div className="flex justify-between text-[9px] text-white/40 font-mono">
        {skipFree ? (
          <span className="truncate">{freeOfTotal}</span>
        ) : (
          <>
            <span>{formatBytes(drive.freeSpace)} free</span>
            <span>{formatBytes(drive.totalSpace)}</span>
          </>
        )}
      </div>
    </div>
  );
}
