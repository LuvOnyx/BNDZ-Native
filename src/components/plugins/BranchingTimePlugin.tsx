import React, { useCallback, useEffect, useState } from 'react';
import { EmblemIcon } from '../EmblemIcon';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const BranchingTimePluginDef = {
  id: 'branching-time',
  name: 'Branching Time',
  icon: 'history_ui',
  description: 'Save folder snapshots you can peek and restore later — like undo for a whole folder',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type TabId = 'branches' | 'peek' | 'vss' | 'system';

type BranchRow = {
  id: string;
  name: string;
  rootWinPath: string;
  tipManifestId: string;
  createdUtc: string;
  fileCount: number;
};

type VssBranchRow = {
  id: string;
  name: string;
  rootPath: string;
  browseRoot: string;
  createdUtc: string;
};

type SystemShadowRow = {
  id: string;
  volumeRoot: string;
  deviceObject: string;
  browseRoot: string;
  createdUtc: string;
  clientAccessible: boolean;
  originalPath: string;
};

type PeekEntry = {
  relPath: string;
  contentHash: string;
  size: number;
  lastWriteUtc?: string;
};

function normalizeBranch(raw: Record<string, unknown>): BranchRow {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'branch'),
    rootWinPath: String(raw.rootWinPath ?? raw.RootWinPath ?? ''),
    tipManifestId: String(raw.tipManifestId ?? raw.TipManifestId ?? ''),
    createdUtc: String(raw.createdUtc ?? raw.CreatedUtc ?? ''),
    fileCount: Number(raw.fileCount ?? raw.FileCount ?? 0) || 0,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function BranchingTimePlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('branches');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [createProgress, setCreateProgress] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekEntries, setPeekEntries] = useState<PeekEntry[]>([]);
  const [peekMeta, setPeekMeta] = useState<{ name: string; fileCount: number; totalBytes: number } | null>(null);
  const [vssBranches, setVssBranches] = useState<VssBranchRow[]>([]);
  const [systemShadows, setSystemShadows] = useState<SystemShadowRow[]>([]);
  const [shadowsLoading, setShadowsLoading] = useState(false);
  const [shadowsError, setShadowsError] = useState<string | null>(null);

  const root = (currentPath || '').replace(/\//g, '\\');

  const refresh = useCallback(async () => {
    const res = await IPC.branchList(root || undefined);
    setBranches((res.branches || []).map((b: Record<string, unknown>) => normalizeBranch(b)));
    try {
      const vss = await IPC.branchListVss();
      setVssBranches((vss.branches || []).map((b: Record<string, unknown>) => ({
        id: String(b.id ?? b.Id ?? ''),
        name: String(b.name ?? b.Name ?? ''),
        rootPath: String(b.rootPath ?? b.RootPath ?? ''),
        browseRoot: String(b.browseRoot ?? b.BrowseRoot ?? ''),
        createdUtc: String(b.createdUtc ?? b.CreatedUtc ?? ''),
      })));
    } catch {
      setVssBranches([]);
    }
  }, [root]);

  const loadSystemShadows = useCallback(async () => {
    setShadowsLoading(true);
    setShadowsError(null);
    try {
      const res = await IPC.branchListSystemShadows(root || 'C:\\');
      if (!res.ok && res.error) {
        setShadowsError(res.error);
        setSystemShadows([]);
      } else {
        setSystemShadows((res.shadows || []).map((s: Record<string, unknown>) => ({
          id: String(s.id ?? s.Id ?? ''),
          volumeRoot: String(s.volumeRoot ?? s.VolumeRoot ?? ''),
          deviceObject: String(s.deviceObject ?? s.DeviceObject ?? ''),
          browseRoot: String(s.browseRoot ?? s.BrowseRoot ?? ''),
          createdUtc: String(s.createdUtc ?? s.CreatedUtc ?? ''),
          clientAccessible: Boolean(s.clientAccessible ?? s.ClientAccessible ?? false),
          originalPath: String(s.originalPath ?? s.OriginalPath ?? root ?? ''),
        })));
      }
    } catch (e) {
      setShadowsError(e instanceof Error ? e.message : String(e));
      setSystemShadows([]);
    } finally {
      setShadowsLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createBranch = async () => {
    if (!root) {
      pushToast('Open a real folder tab to create a branch.');
      return;
    }
    const name = branchName.trim() || `snapshot-${new Date().toISOString().slice(0, 16).replace('T', '-')}`;
    setBusy(true);
    setCreateProgress('Hashing files…');
    try {
      const res = await IPC.branchCreate(root, name);
      if (!res.ok) {
        pushToast(res.error || 'Branch create failed.');
        return;
      }
      pushToast(`Branch "${name}" created (${res.branch?.fileCount ?? '?'} files).`);
      setBranchName('');
      await refresh();
    } finally {
      setBusy(false);
      setCreateProgress(null);
    }
  };

  const openPeek = async (id: string) => {
    setPeekId(id);
    setActiveTab('peek');
    const res = await IPC.branchPeek(id);
    if (!res.ok || !res.peek) {
      setPeekEntries([]);
      setPeekMeta(null);
      pushToast('Could not load branch tip.');
      return;
    }
    const peek = res.peek as Record<string, unknown>;
    setPeekMeta({
      name: String(peek.branchName ?? peek.BranchName ?? ''),
      fileCount: Number(peek.fileCount ?? peek.FileCount ?? 0) || 0,
      totalBytes: Number(peek.totalBytes ?? peek.TotalBytes ?? 0) || 0,
    });
    const entries = (peek.entries ?? peek.Entries ?? []) as Record<string, unknown>[];
    setPeekEntries(entries.map(e => ({
      relPath: String(e.relPath ?? e.RelPath ?? ''),
      contentHash: String(e.contentHash ?? e.ContentHash ?? ''),
      size: Number(e.size ?? e.Size ?? 0) || 0,
      lastWriteUtc: (e.lastWriteUtc as string | undefined) ?? (e.LastWriteUtc as string | undefined),
    })));
  };

  const restoreAll = async (id: string) => {
    setBusy(true);
    try {
      const res = await IPC.branchRestore(id);
      if (!res.ok) {
        pushToast(res.errors?.[0] || 'Restore failed.');
        return;
      }
      pushToast(`Restored ${res.restored ?? 0} file(s)${res.skipped ? `, skipped ${res.skipped}` : ''}.`);
    } finally {
      setBusy(false);
    }
  };

  const removeBranch = async (id: string) => {
    const res = await IPC.branchDelete(id);
    if (res.ok) {
      pushToast('Branch removed (blobs retained for other tips).');
      if (peekId === id) {
        setPeekId(null);
        setPeekEntries([]);
        setPeekMeta(null);
        setActiveTab('branches');
      }
      await refresh();
    }
  };

  const createVssBranch = async () => {
    if (!root) {
      pushToast('Open a real folder tab to create a VSS branch.');
      return;
    }
    const name = branchName.trim() || `vss-${new Date().toISOString().slice(0, 16).replace('T', '-')}`;
    setBusy(true);
    try {
      const res = await IPC.branchCreateVss(root, name);
      if (!res.ok) {
        pushToast(res.error || 'VSS branch failed — try elevated BNDZ.');
        return;
      }
      pushToast(`VSS branch "${name}" created.`);
      setBranchName('');
      setActiveTab('vss');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openVssBrowse = async (id: string, browseRoot: string) => {
    const res = await IPC.branchBrowseVss(id);
    if (!res.ok) {
      pushToast(res.error || 'Could not browse shadow copy.');
      return;
    }
    window.dispatchEvent(new CustomEvent('bndz-navigate', {
      detail: { path: browseRoot.replace(/^([A-Za-z]):\\/, '/$1/').replace(/\\/g, '/') },
    }));
    pushToast(`Opened VSS browse root (${(res.items || []).length} items).`);
  };

  const restoreVss = async (id: string) => {
    setBusy(true);
    try {
      const res = await IPC.branchRestoreVss(id);
      if (!res.ok) pushToast(res.error || 'VSS restore failed.');
      else pushToast('VSS restore queued into live folder.');
    } finally {
      setBusy(false);
    }
  };

  const deleteVss = async (id: string) => {
    const res = await IPC.branchDeleteVss(id);
    if (res.ok) {
      pushToast('VSS branch deleted.');
      await refresh();
    }
  };

  const restoreSystemShadow = async (shadow: SystemShadowRow) => {
    setBusy(true);
    try {
      const res = await IPC.branchRestoreSystemShadow(shadow.deviceObject, shadow.originalPath);
      if (!res.ok) pushToast(res.error || 'System shadow restore failed.');
      else pushToast('System shadow restore queued to live folder.');
    } finally {
      setBusy(false);
    }
  };

  const sortedBranches = [...branches].sort((a, b) => {
    const ta = a.createdUtc ? Date.parse(a.createdUtc) : 0;
    const tb = b.createdUtc ? Date.parse(b.createdUtc) : 0;
    return tb - ta;
  });

  return (
    <PluginPanelShell
      title="Branching Time"
      icon="history_ui"
      iconColor="#c4a35a"
      variant="embedded"
      subtitle="Folder snapshots · preview · restore"
      toolbar={
        <PluginTabStrip className="!border-0 !min-h-0 bg-black/20 rounded-md p-0.5 gap-0.5">
          <PluginTab active={activeTab === 'branches'} onClick={() => setActiveTab('branches')}>
            Timeline
          </PluginTab>
          <PluginTab active={activeTab === 'vss'} onClick={() => setActiveTab('vss')}>
            Named VSS
          </PluginTab>
          <PluginTab active={activeTab === 'system'} onClick={() => { setActiveTab('system'); void loadSystemShadows(); }}>
            Shadows
          </PluginTab>
          <PluginTab active={activeTab === 'peek'} onClick={() => peekId && setActiveTab('peek')}>
            Tip
          </PluginTab>
        </PluginTabStrip>
      }
    >
      <div className="flex flex-col min-h-0 h-full bndz-bt-root">
        <PluginHeroStrip
          icon={
            <div className="bndz-bt-hero-mark flex items-center justify-center">
              <EmblemIcon id="emblem-locally-modified" size={48} />
            </div>
          }
          name="Branching Time"
          typeLabel="Folder timeline"
          path={root || null}
          meta={
            <span className="bndz-panel-muted text-xs">
              {createProgress
                ? (
                  <span className="inline-flex items-center gap-1.5 text-[#c4a35a]">
                    <Icons8Icon id="loading" size={12} spin />
                    {createProgress}
                  </span>
                )
                : `${branches.length} snapshot${branches.length === 1 ? '' : 's'}`}
            </span>
          }
          actions={
            <>
              <input
                type="text"
                value={branchName}
                onChange={e => setBranchName(e.target.value)}
                placeholder="Name (optional)"
                className="bndz-bt-name-input"
                aria-label="Branch name"
              />
              <PluginHeroActionButton disabled={busy || !root} onClick={() => void createBranch()}>
                Snapshot
              </PluginHeroActionButton>
              <PluginHeroActionButton disabled={busy || !root} onClick={() => void createVssBranch()}>
                VSS snapshot
              </PluginHeroActionButton>
              <PluginToolbarButton title="Refresh" onClick={() => void refresh()} disabled={busy} icon="refresh_ui" />
            </>
          }
        />

        {activeTab === 'branches' && (
          <div className="bndz-bt-scroll px-3 pb-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
            {sortedBranches.length === 0 ? (
              <PluginEmptyState
                icon="history_ui"
                title={root ? 'No snapshots yet' : 'No folder selected'}
                description={root
                  ? 'Snapshot this folder to pin a content-addressed tip you can peek and restore later.'
                  : 'Open a folder in the list, then snapshot it from Branching Time.'}
              />
            ) : (
              <ol className="bndz-bt-timeline">
                {sortedBranches.map((b, i) => (
                  <li key={b.id} className={`bndz-bt-node${peekId === b.id ? ' is-active' : ''}`}>
                    <div className="bndz-bt-rail" aria-hidden>
                      <span className="bndz-bt-dot" />
                      {i < sortedBranches.length - 1 ? <span className="bndz-bt-line" /> : null}
                    </div>
                    <div className="bndz-bt-card">
                      <div className="bndz-bt-card-head">
                        <div className="min-w-0">
                          <div className="bndz-bt-card-title">{b.name}</div>
                          <div className="bndz-bt-card-path" title={formatUiPath(b.rootWinPath)}>
                            {formatUiPath(b.rootWinPath)}
                          </div>
                          <div className="bndz-bt-card-meta">
                            <span>{b.fileCount.toLocaleString()} files</span>
                            <span className="bndz-bt-sep" />
                            <span>{formatWhen(b.createdUtc)}</span>
                          </div>
                        </div>
                        <div className="bndz-bt-actions">
                          <PluginToolbarButton title="Peek tip" onClick={() => void openPeek(b.id)}>
                            <EmblemIcon id="emblem-information" size={12} />
                          </PluginToolbarButton>
                          <PluginToolbarButton title="Restore all" onClick={() => void restoreAll(b.id)} disabled={busy}>
                            <EmblemIcon id="emblem-update" size={12} />
                          </PluginToolbarButton>
                          <PluginToolbarButton title="Delete branch" onClick={() => void removeBranch(b.id)}>
                            <EmblemIcon id="emblem-remove" size={12} />
                          </PluginToolbarButton>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {activeTab === 'vss' && (
          <div className="bndz-bt-scroll px-3 pb-3 space-y-2 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
            {vssBranches.length === 0 ? (
              <PluginEmptyState
                icon="history_ui"
                title="No named VSS snapshots"
                description="Create a Volume Shadow Copy of this folder. Elevation may be required — run BNDZ as Administrator if create fails."
              />
            ) : (
              vssBranches.map(b => (
                <div key={b.id} className="bndz-bt-card bndz-bt-card-flat">
                  <div className="bndz-bt-card-head">
                    <div className="min-w-0">
                      <div className="bndz-bt-card-title">{b.name}</div>
                      <div className="bndz-bt-card-path" title={formatUiPath(b.rootPath)}>{formatUiPath(b.rootPath)}</div>
                      <div className="bndz-bt-card-meta">
                        <span className="bndz-bt-pill">VSS</span>
                        <span>{formatWhen(b.createdUtc)}</span>
                      </div>
                    </div>
                    <div className="bndz-bt-actions">
                      <PluginToolbarButton title="Browse shadow" onClick={() => void openVssBrowse(b.id, b.browseRoot)}>
                        <EmblemIcon id="emblem-mounted" size={12} />
                      </PluginToolbarButton>
                      <PluginToolbarButton title="Restore to live" onClick={() => void restoreVss(b.id)} disabled={busy}>
                        <EmblemIcon id="emblem-update" size={12} />
                      </PluginToolbarButton>
                      <PluginToolbarButton title="Delete VSS branch" onClick={() => void deleteVss(b.id)}>
                        <EmblemIcon id="emblem-remove" size={12} />
                      </PluginToolbarButton>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div className="bndz-bt-scroll px-3 pb-3 space-y-2 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
            <div className="bndz-bt-toolbar-row">
              <span className="bndz-panel-muted text-[10px]">Windows Volume Shadow Copies on this volume</span>
              <button
                type="button"
                onClick={() => void loadSystemShadows()}
                disabled={shadowsLoading}
                className="bndz-bt-refresh-btn"
              >
                {shadowsLoading
                  ? <><Icons8Icon id="loading" size={10} spin /> Loading</>
                  : <><Icons8Icon id="refresh_ui" size={10} /> Refresh</>}
              </button>
            </div>
            {shadowsError && (
              <div className="bndz-bt-error" role="alert">
                <strong>Shadow access</strong>
                <span>{shadowsError}</span>
                <span className="bndz-bt-error-hint">Run BNDZ as Administrator to list or restore system shadows.</span>
              </div>
            )}
            {!shadowsLoading && !shadowsError && systemShadows.length === 0 && (
              <PluginEmptyState
                icon="history_ui"
                title="No system shadows found"
                description="Windows has no Volume Shadow Copies for this drive, or elevation is required. Enable System Protection to create restore points."
              />
            )}
            {systemShadows.map(s => (
              <div key={s.id} className="bndz-bt-card bndz-bt-card-flat">
                <div className="bndz-bt-card-head">
                  <div className="min-w-0">
                    <div className="bndz-bt-card-title">
                      {formatWhen(s.createdUtc) || s.id}
                      {s.clientAccessible ? <span className="bndz-bt-pill is-ok">accessible</span> : null}
                    </div>
                    <div className="bndz-bt-card-path" title={s.originalPath}>{formatUiPath(s.originalPath)}</div>
                    <div className="bndz-bt-device" title={s.deviceObject}>{s.deviceObject}</div>
                  </div>
                  <div className="bndz-bt-actions">
                    <PluginToolbarButton title="Restore shadow to live folder" onClick={() => void restoreSystemShadow(s)} disabled={busy}>
                      <EmblemIcon id="emblem-update" size={12} />
                    </PluginToolbarButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'peek' && (
          <div className="bndz-bt-scroll px-3 pb-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
            {!peekMeta ? (
              <PluginEmptyState
                icon="history_ui"
                title="Select a snapshot"
                description="Peek a tip to inspect hashed files before restore."
              />
            ) : (
              <>
                <div className="bndz-bt-peek-meta">
                  <PluginSectionTitle>{peekMeta.name}</PluginSectionTitle>
                  <div className="bndz-bt-card-meta">
                    <span>{peekMeta.fileCount.toLocaleString()} files</span>
                    <span className="bndz-bt-sep" />
                    <span>{formatBytes(peekMeta.totalBytes)}</span>
                  </div>
                </div>
                <ul className="bndz-bt-peek-list">
                  {peekEntries.map(e => (
                    <li key={e.relPath + e.contentHash} className="bndz-bt-peek-row">
                      <span className="bndz-bt-peek-path" title={e.relPath}>{e.relPath}</span>
                      <span className="bndz-bt-peek-size">{formatBytes(e.size)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </PluginPanelShell>
  );
}
