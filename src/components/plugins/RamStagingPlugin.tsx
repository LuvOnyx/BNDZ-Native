import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { bndzRamVirtualPath, BNDZ_RAM_ROOT } from '../../lib/bndzVirtualViews';
import { invalidateRamZoneMountCache } from '../../lib/ramStagingPaths';
import { readBndzFileDragData, hasBndzFileDrag } from '../../lib/bndzDrag';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const RamStagingPluginDef = {
  id: 'ram-staging',
  name: 'RAM Staging',
  icon: 'hard_drive_ui',
  description: 'Staging zones — RAM disk when the driver is ready, otherwise fast disk staging. Flush back on eject.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

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
  error?: string;
};

type Status = {
  imDiskAvailable?: boolean;
  aimAvailable?: boolean;
  aimCliPresent?: boolean;
  zoneCount?: number;
  totalUsedBytes?: number;
  dirtyCount?: number;
};

function formatMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  onNavigate?: (path: string) => void;
  onStatus?: (msg: string | null) => void;
  selectedItems?: string[];
  config?: { ramStagingPreferImDisk?: boolean };
  pluginLaunch?: { paths?: string[] } | null;
};

export default function RamStagingPlugin({ onNavigate, onStatus, selectedItems, config, pluginLaunch }: Props) {
  const preferRam = config?.ramStagingPreferImDisk !== false;
  const [zones, setZones] = useState<Zone[]>([]);
  const [stageZoneId, setStageZoneId] = useState('');
  const activeStageZone = zones.find(z => z.id === stageZoneId) || zones[0];
  const launchHandledRef = useRef<string>('');

  useEffect(() => {
    if (zones.length && !zones.some(z => z.id === stageZoneId)) setStageZoneId(zones[0].id);
  }, [zones, stageZoneId]);
  const [status, setStatus] = useState<Status>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('RAM Staging');
  const [newSizeMb, setNewSizeMb] = useState(4096);
  const [memoryPressure, setMemoryPressure] = useState(false);

  const refresh = useCallback(async () => {
    const r = await IPC.ramStagingListZones();
    setZones((r.zones as Zone[]) ?? []);
    setStatus((r.status as Status) ?? {});
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    const onPressure = (e: Event) => {
      const detail = (e as CustomEvent).detail as { underPressure?: boolean } | undefined;
      setMemoryPressure(detail?.underPressure === true);
    };
    window.addEventListener('bndz-ram-zone-changed', onChange);
    window.addEventListener('bndz-ram-memory-pressure', onPressure);
    return () => {
      window.removeEventListener('bndz-ram-zone-changed', onChange);
      window.removeEventListener('bndz-ram-memory-pressure', onPressure);
    };
  }, [refresh]);

  const createZone = async () => {
    setBusy(true);
    onStatus?.(preferRam ? 'Creating zone…' : 'Creating fast staging zone…');
    try {
      const r = await IPC.ramStagingCreateZone(newName.trim() || 'RAM Staging', newSizeMb, preferRam);
      if (!r.ok) throw new Error(r.error || 'Create failed');
      const zone = r.zone as Zone | undefined;
      const isRam = zone?.kind === 'ramdisk';
      const hardFail = Boolean(zone?.error && (zone.state === 'unmounted' || !zone.mountPath));
      if (hardFail) {
        pushToast({
          kind: 'warning',
          title: 'Zone needs remount',
          message: zone!.error!,
        });
      } else {
        pushToast({
          kind: 'success',
          title: 'Zone ready',
          message: isRam
            ? 'RAM zone mounted — open it to paste or drop files.'
            : 'Fast staging zone ready — open it to paste or drop files.',
        });
      }
      invalidateRamZoneMountCache();
      await refresh();
      onStatus?.(null);
      if (zone?.id) {
        const zonePath = bndzRamVirtualPath(zone.id);
        window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: zonePath } }));
        window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: zonePath } }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', title: 'Create failed', message: msg });
      onStatus?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const flushZone = async (zoneId: string) => {
    setBusy(true);
    onStatus?.('Flushing staged files to disk…');
    try {
      const r = await IPC.ramStagingFlushZone(zoneId);
      if ((r as { ok?: boolean }).ok === false) {
        throw new Error((r as { error?: string }).error || 'Flush failed');
      }
      pushToast({ kind: 'success', title: 'Flushed', message: 'Staged files written back to their source paths.' });
      await refresh();
      onStatus?.(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', title: 'Flush failed', message: msg });
      onStatus?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const ejectZone = async (zoneId: string, flushFirst = false) => {
    setBusy(true);
    onStatus?.(flushFirst ? 'Flushing and ejecting zone…' : 'Ejecting zone…');
    try {
      const r = await IPC.ramStagingDeleteZone(zoneId, flushFirst);
      if (r.ok === false) throw new Error(r.error || 'Eject failed');
      invalidateRamZoneMountCache();
      pushToast({
        kind: 'success',
        title: 'Zone ejected',
        message: flushFirst ? 'Staged files flushed and zone removed.' : 'Zone discarded.',
      });
      await refresh();
      onStatus?.(null);
      window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_RAM_ROOT } }));
      window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: BNDZ_RAM_ROOT } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', title: 'Eject failed', message: msg });
      onStatus?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const stagePaths = async (zoneId: string, paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    onStatus?.(`Staging ${paths.length} item(s)…`);
    try {
      const { resolvePanePathForFs } = await import('../../lib/ramStagingPaths');
      const { isBndzRamPath } = await import('../../lib/bndzVirtualViews');
      const { toWindowsPath } = await import('../../lib/pathUtils');
      const winPaths = (await Promise.all(paths.map(async p => {
        const raw = (p || '').trim();
        if (!raw) return '';
        if (isBndzRamPath(raw) || raw.replace(/\\/g, '/').includes('/bndz/ram/') || raw.toLowerCase().startsWith('bndz\\')) {
          return (await resolvePanePathForFs(raw.startsWith('/') || raw.toLowerCase().startsWith('bndz') ? raw.replace(/^bndz\\/i, '/bndz/').replace(/\\/g, '/') : raw)) || '';
        }
        return toWindowsPath(raw);
      }))).filter(p => p && !p.toLowerCase().startsWith('bndz\\'));
      if (!winPaths.length) throw new Error('No readable source paths to stage.');
      const r = await IPC.ramStagingStagePaths(zoneId, winPaths);
      if ((r as { ok?: boolean }).ok === false) {
        throw new Error((r as { error?: string }).error || 'Stage failed');
      }
      pushToast({ kind: 'success', title: 'Staged', message: `${winPaths.length} item(s) copied into zone.` });
      invalidateRamZoneMountCache();
      await refresh();
      onStatus?.(null);
      const zonePath = bndzRamVirtualPath(zoneId);
      window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: zonePath } }));
      window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: zonePath } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const partial = /^Staged \d+ of \d+/.test(msg);
      onStatus?.(msg);
      pushToast({
        kind: partial ? 'warning' : 'error',
        title: partial ? 'Staging partial' : 'Stage failed',
        message: msg,
      });
      if (partial) {
        invalidateRamZoneMountCache();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const remountZone = async (zoneId: string) => {
    setBusy(true);
    onStatus?.('Remounting zone…');
    try {
      const r = await IPC.ramStagingRemountZone(zoneId);
      if (r.ok === false) throw new Error(r.error || 'Remount failed');
      invalidateRamZoneMountCache();
      pushToast({ kind: 'success', title: 'Zone remounted', message: 'Mount path is ready again.' });
      await refresh();
      onStatus?.(null);
      window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: bndzRamVirtualPath(zoneId) } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', title: 'Remount failed', message: msg });
      onStatus?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const selectionPaths = selectedItems || [];

  // Context-menu / Command Deck launch: auto-stage selection into the active zone.
  useEffect(() => {
    const paths = (pluginLaunch?.paths || []).filter(Boolean);
    if (!paths.length || busy) return;
    const key = `${paths.join('|')}::${activeStageZone?.id || ''}`;
    if (launchHandledRef.current === key) return;
    if (!activeStageZone?.id) {
      // Wait until zones load / create one first.
      return;
    }
    launchHandledRef.current = key;
    void stagePaths(activeStageZone.id, paths);
  }, [pluginLaunch, activeStageZone?.id, busy, zones.length]);
  const totalMb = zones.reduce((s, z) => s + z.sizeBudgetMb, 0);
  const usedMb = zones.reduce((s, z) => s + z.usedBytes, 0) / (1024 * 1024);
  const ramZones = zones.filter(z => z.kind === 'ramdisk').length;

  return (
    <PluginPanelShell
      title="RAM Staging"
      icon="hard_drive_ui"
      iconColor="#a78bfa"
      variant="embedded"
      subtitle={
        ramZones > 0
          ? `${ramZones} RAM zone${ramZones === 1 ? '' : 's'} active`
          : zones.length > 0
            ? `${zones.length} fast staging zone${zones.length === 1 ? '' : 's'}`
            : 'Create a zone to stage projects'
      }
    >
      <div className="flex flex-col gap-3 min-h-0 bndz-ram-panel px-4 pb-4">
        {memoryPressure && (
          <div className="shrink-0 px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-500/10 text-[10px] text-amber-200/90">
            System memory is under pressure — flush dirty zones soon to avoid data loss on eject.
          </div>
        )}

        <PluginHeroStrip
          icon={(
            <div className="bndz-ram-hero-icon flex items-center justify-center w-[72px] h-[72px] rounded-2xl bg-violet-500/10 border border-violet-400/20">
              <Icons8Icon id="hard_drive_ui" size={40} className="text-violet-300" />
            </div>
          )}
          name="RAM Staging"
          typeLabel={ramZones > 0 ? 'RAM active' : zones.some(z => z.kind === 'faststaging') ? 'Fast staging' : preferRam ? 'Prefers RAM' : 'Fast staging'}
          meta={(
            <span className="bndz-panel-muted text-xs">
              Browse zones at <span className="font-mono text-violet-200/80">{BNDZ_RAM_ROOT}</span>
            </span>
          )}
          actions={(
            <>
              {selectionPaths.length > 0 && activeStageZone && (
                <PluginHeroActionButton icon="upload_ui" onClick={() => void stagePaths(activeStageZone.id, selectionPaths)} disabled={busy}>
                  Stage selection ({selectionPaths.length})
                </PluginHeroActionButton>
              )}
              {zones.length > 1 && (
                <select
                  className={`${PLUGIN_INPUT_CLASS} !w-auto !py-1`}
                  value={activeStageZone?.id || ''}
                  onChange={e => setStageZoneId(e.target.value)}
                  title="Stage into zone"
                >
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              )}
              <PluginHeroActionButton icon="plus_ui" variant="primary" onClick={() => void createZone()} disabled={busy}>
                New zone
              </PluginHeroActionButton>
              <PluginHeroActionButton icon="reset_ui" onClick={() => void refresh()} disabled={busy}>
                Refresh
              </PluginHeroActionButton>
            </>
          )}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
          <PluginStatCard label="Zones" value={String(zones.length)} iconId="hard_drive_ui" />
          <PluginStatCard label="Capacity" value={`${totalMb} MB`} />
          <PluginStatCard label="In use" value={`${usedMb.toFixed(0)} MB`} />
          <PluginStatCard label="Dirty" value={String(zones.filter(z => z.isDirty).length)} />
        </div>

        <PluginCard className="shrink-0">
          <PluginSectionTitle icon="plus_ui">Create zone</PluginSectionTitle>
          <p className="text-[10px] text-gray-500 mt-1 mb-2">
            Creates a RAM disk when the bundled driver is available; otherwise uses fast disk staging.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2 mt-2">
            <input className={PLUGIN_INPUT_CLASS} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Zone name" />
            <div className="flex items-center gap-2">
              <input type="number" min={256} step={256} className={`${PLUGIN_INPUT_CLASS} flex-1`} value={newSizeMb} onChange={e => setNewSizeMb(Number(e.target.value))} />
              <span className="text-[10px] text-gray-500 shrink-0">MB</span>
            </div>
            <PluginToolbarButton icon="hard_drive_ui" onClick={() => void createZone()} disabled={busy}>
              Create
            </PluginToolbarButton>
          </div>
        </PluginCard>

        <div className="space-y-2 pr-1">
          {zones.map(z => {
            const pct = Math.min(100, (z.usedBytes / (z.sizeBudgetMb * 1024 * 1024)) * 100);
            return (
              <PluginCard
                key={z.id}
                className={`bndz-ram-zone-card${z.isDirty ? ' is-dirty' : ''}`}
                onDragOver={e => {
                  // HTML5 internal + Explorer FileList drops (path may arrive via File.path in WebView2).
                  // Host OLE drops still go through fileDropBus → list/paste stagePaths as primary.
                  if (
                    hasBndzFileDrag(e)
                    || e.dataTransfer.types.includes('text/plain')
                    || e.dataTransfer.types.includes('Files')
                    || Array.from(e.dataTransfer.files || []).length > 0
                  ) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                }}
                onDrop={e => {
                  e.preventDefault();
                  const payload = readBndzFileDragData(e);
                  const fromPlain = (e.dataTransfer.getData('text/plain') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                  const fromFiles = Array.from(e.dataTransfer.files || [])
                    .map(f => String((f as File & { path?: string }).path || '').trim())
                    .filter(Boolean);
                  const paths = payload?.paths?.length
                    ? payload.paths
                    : (fromPlain.length ? fromPlain : fromFiles);
                  if (paths.length) void stagePaths(z.id, paths);
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icons8Icon id="hard_drive_ui" size={14} className="text-violet-300 shrink-0" />
                      <span className="font-semibold text-sm text-white truncate">{z.name}</span>
                      <span className={`bndz-ram-kind ${z.kind}`}>{z.kind === 'ramdisk' ? 'RAM' : 'Fast'}</span>
                      {z.state === 'unmounted' && <span className="text-[9px] font-bold uppercase tracking-wider text-rose-300/90">Unmounted</span>}
                      {z.isDirty && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300/90">Dirty</span>}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1 font-mono truncate" title={z.mountPath}>{z.mountPath || '— no mount —'}</p>
                    {z.error && (z.state === 'unmounted' || !z.mountPath) && (
                      <div className="mt-1.5 space-y-1.5">
                        <p className="text-[10px] text-amber-300/90 leading-snug">{z.error}</p>
                        <PluginToolbarButton icon="hard_drive_ui" onClick={() => void remountZone(z.id)} disabled={busy}>
                          Retry mount
                        </PluginToolbarButton>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bndz-ram-gauge mt-3">
                  <div className="bndz-ram-gauge-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  {formatMb(z.usedBytes)} / {z.sizeBudgetMb} MB · {z.stagedFileCount} file{z.stagedFileCount === 1 ? '' : 's'}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {z.state === 'unmounted' || !z.mountPath ? (
                    <PluginToolbarButton icon="hard_drive_ui" onClick={() => void remountZone(z.id)} disabled={busy}>
                      Remount
                    </PluginToolbarButton>
                  ) : (
                    <PluginToolbarButton icon="folder_open_ui" onClick={() => onNavigate?.(bndzRamVirtualPath(z.id))} disabled={busy}>Open</PluginToolbarButton>
                  )}
                  <PluginToolbarButton icon="upload_ui" onClick={() => void stagePaths(z.id, selectionPaths)} disabled={busy || !selectionPaths.length || z.state === 'unmounted'}>Stage selection</PluginToolbarButton>
                  <PluginToolbarButton icon="sync_folders" onClick={() => void flushZone(z.id)} disabled={busy || !z.isDirty || z.state === 'unmounted'}>Flush</PluginToolbarButton>
                  {z.isDirty && z.stagedFileCount > 0 && (
                    <PluginToolbarButton icon="sync_folders" onClick={() => void ejectZone(z.id, true)} disabled={busy}>
                      Flush &amp; Eject
                    </PluginToolbarButton>
                  )}
                  <PluginToolbarButton icon="delete" onClick={() => void ejectZone(z.id, false)} disabled={busy}>
                    Eject
                  </PluginToolbarButton>
                </div>
              </PluginCard>
            );
          })}
          {!zones.length && (
            <PluginEmptyState
              icon="hard_drive_ui"
              title="No staging zones"
              description="Create a zone, then drag files from the list or use Stage selection. Zones appear under /bndz/ram in the path bar."
            />
          )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
