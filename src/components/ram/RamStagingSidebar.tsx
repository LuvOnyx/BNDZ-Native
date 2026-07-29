import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import ImDiskSetupWizard from './ImDiskSetupWizard';

type Zone = {
  id: string;
  name: string;
  kind: string;
  state: string;
  mountPath: string;
  driveLetter?: string;
  sizeBudgetMb: number;
  usedBytes: number;
  isDirty: boolean;
  stagedFileCount: number;
};

type Status = {
  imDiskAvailable?: boolean;
  zoneCount?: number;
  totalUsedBytes?: number;
  dirtyCount?: number;
};

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  onNavigate?: (path: string) => void;
};

export default function RamStagingSidebar({ onNavigate }: Props) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [status, setStatus] = useState<Status>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('RAM Staging');
  const [newSizeMb, setNewSizeMb] = useState(4096);

  const refresh = useCallback(async () => {
    const r = await IPC.ramStagingListZones();
    setZones((r.zones as Zone[]) ?? []);
    setStatus((r.status as Status) ?? {});
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('bndz-ram-zone-changed', onChange);
    return () => window.removeEventListener('bndz-ram-zone-changed', onChange);
  }, [refresh]);

  const createZone = async () => {
    setBusy(true);
    try {
      const r = await IPC.ramStagingCreateZone(newName, newSizeMb, status.imDiskAvailable !== false);
      if (!r.ok) throw new Error(r.error);
      pushToast({
        kind: 'success',
        title: 'Zone created',
        message: status.imDiskAvailable ? 'RAM disk mounted.' : 'Fast staging zone ready (NVMe fallback).',
      });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Create failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const flushZone = async (zoneId: string) => {
    setBusy(true);
    try {
      await IPC.ramStagingFlushZone(zoneId);
      pushToast({ kind: 'success', title: 'Flushed', message: 'Staged files written back to disk.' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const ejectZone = async (zoneId: string) => {
    setBusy(true);
    try {
      await IPC.ramStagingDeleteZone(zoneId, true);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (zoneId: string, e: React.DragEvent) => {
    e.preventDefault();
    const paths = (e.dataTransfer.getData('application/bndz-paths') || '')
      .split('\n').filter(Boolean);
    if (!paths.length) return;
    setBusy(true);
    try {
      await IPC.ramStagingStagePaths(zoneId, paths);
      pushToast({ kind: 'success', title: 'Staged', message: `${paths.length} item(s) in zone.` });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bndz-ram-sidebar flex flex-col h-full min-h-0">
      <div className="bndz-ram-sidebar-head px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Icons8Icon id="hard_drive_ui" size={16} />
          <span className="text-xs font-bold text-white tracking-wide">RAM Staging</span>
        </div>
        <p className="text-[10px] text-gray-500 mt-1">
          {status.imDiskAvailable ? 'ImDisk detected — true RAM zones' : 'Fast staging (install ImDisk for RAM)'}
        </p>
      </div>

      <ImDiskSetupWizard imDiskAvailable={status.imDiskAvailable} />

      <div className="px-3 py-2 border-b border-white/[0.06] space-y-2">
        <input className="bndz-ram-input w-full" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Zone name" />
        <div className="flex gap-2">
          <input type="number" className="bndz-ram-input flex-1" value={newSizeMb} onChange={e => setNewSizeMb(Number(e.target.value))} />
          <span className="text-[10px] text-gray-500 self-center">MB</span>
        </div>
        <button type="button" className="bndz-ram-cta w-full" disabled={busy} onClick={() => void createZone()}>
          + New zone
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-2">
        {zones.map(z => (
          <div
            key={z.id}
            className={`bndz-ram-zone-card${z.isDirty ? ' is-dirty' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDrop={e => void onDrop(z.id, e)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm text-white truncate">{z.name}</span>
              <span className={`bndz-ram-kind ${z.kind}`}>{z.kind === 'ramdisk' ? 'RAM' : 'Fast'}</span>
            </div>
            <div className="bndz-ram-gauge mt-2">
              <div className="bndz-ram-gauge-fill" style={{ width: `${Math.min(100, (z.usedBytes / (z.sizeBudgetMb * 1024 * 1024)) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {formatMb(z.usedBytes)} / {z.sizeBudgetMb} MB · {z.stagedFileCount} files
            </p>
            <p className="text-[10px] text-gray-600 truncate" title={z.mountPath}>{z.mountPath}</p>
            <div className="flex gap-1 mt-2">
              <button type="button" className="bndz-ram-btn" disabled={busy} onClick={() => onNavigate?.(z.mountPath)}>Open</button>
              <button type="button" className="bndz-ram-btn" disabled={busy || !z.isDirty} onClick={() => void flushZone(z.id)}>Flush</button>
              <button type="button" className="bndz-ram-btn is-danger" disabled={busy} onClick={() => void ejectZone(z.id)}>Eject</button>
            </div>
          </div>
        ))}
        {!zones.length && (
          <p className="text-center text-gray-500 text-xs py-6">Drop projects here for zero-latency staging.</p>
        )}
      </div>
    </div>
  );
}
