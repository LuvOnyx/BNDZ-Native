import React, { useCallback, useEffect, useState } from 'react';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
  PluginSectionTitle,
} from './PluginPanelPrimitives';

export const BranchingTimePluginDef = {
  id: 'branching-time',
  name: 'Branching Time',
  icon: 'history_ui',
  description: 'Content-addressed folder branches — snapshot, scrub, restore. Git for folders without git.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type TabId = 'branches' | 'peek' | 'vss';

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

export default function BranchingTimePlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('branches');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekEntries, setPeekEntries] = useState<PeekEntry[]>([]);
  const [peekMeta, setPeekMeta] = useState<{ name: string; fileCount: number; totalBytes: number } | null>(null);
  const [vssBranches, setVssBranches] = useState<VssBranchRow[]>([]);

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

  return (
    <PluginPanelShell
      title="Branching Time"
      icon="history_ui"
      iconColor="#c4a35a"
      variant="embedded"
      subtitle="Content-addressed save-states + VSS named branches"
      toolbar={
        <PluginTabStrip className="!border-0 !min-h-0 bg-black/20 rounded-md p-0.5 gap-0.5">
          <PluginTab active={activeTab === 'branches'} onClick={() => setActiveTab('branches')}>
            Branches
          </PluginTab>
          <PluginTab active={activeTab === 'vss'} onClick={() => setActiveTab('vss')}>
            VSS
          </PluginTab>
          <PluginTab active={activeTab === 'peek'} onClick={() => peekId && setActiveTab('peek')}>
            Peek
          </PluginTab>
        </PluginTabStrip>
      }
    >
      <div className="flex flex-col min-h-0 h-full">
        <PluginHeroStrip
          icon={
            <div className="flex items-center justify-center">
              <EmblemIcon id="emblem-locally-modified" size={48} />
            </div>
          }
          name="Branching Time"
          typeLabel="Folder time machine"
          path={root || null}
          meta={
            <span className="bndz-panel-muted text-xs">
              {branches.length} branch{branches.length === 1 ? '' : 'es'}
            </span>
          }
          actions={
            <>
              <input
                type="text"
                value={branchName}
                onChange={e => setBranchName(e.target.value)}
                placeholder="Branch name (optional)"
                className="bg-[#1a1d24] border border-[#3a4250] rounded-[var(--bndz-radius-sm)] text-[11px] px-2 py-1 text-gray-200 w-[160px]"
              />
              <PluginHeroActionButton disabled={busy || !root} onClick={() => void createBranch()}>
                Create branch
              </PluginHeroActionButton>
              <PluginHeroActionButton disabled={busy || !root} onClick={() => void createVssBranch()}>
                Create VSS
              </PluginHeroActionButton>
              <PluginToolbarButton title="Refresh" onClick={() => void refresh()} disabled={busy} icon="refresh_ui" />
            </>
          }
        />

        <div className="flex gap-2 px-3 py-2">
          <PluginStatCard label="Branches" value={String(branches.length)} iconId="history_ui" />
          <PluginStatCard label="Tip files" value={peekMeta ? String(peekMeta.fileCount) : '—'} />
          <PluginStatCard label="Tip size" value={peekMeta ? formatBytes(peekMeta.totalBytes) : '—'} />
        </div>

        {activeTab === 'branches' && (
          <div className="px-3 pb-3 space-y-2 overflow-y-auto bndz-scrollbar flex-1 min-h-0">
            {branches.length === 0 ? (
              <PluginEmptyState
                icon="history_ui"
                title="No branches yet"
                description="Create a branch of the active folder to freeze a content-addressed tip you can restore later."
              />
            ) : (
              branches.map(b => (
                <PluginCard key={b.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <PluginSectionTitle>{b.name}</PluginSectionTitle>
                      <div className="text-[10px] text-gray-500 truncate" title={formatUiPath(b.rootWinPath)}>{formatUiPath(b.rootWinPath)}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {b.fileCount} files · {b.createdUtc ? new Date(b.createdUtc).toLocaleString() : ''}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
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
                </PluginCard>
              ))
            )}
          </div>
        )}

        {activeTab === 'vss' && (
          <div className="px-3 pb-3 space-y-2 overflow-y-auto bndz-scrollbar flex-1 min-h-0">
            {vssBranches.length === 0 ? (
              <PluginEmptyState
                icon="history_ui"
                title="No VSS branches"
                description="Create a named Volume Shadow Copy branch of the active folder (may require elevation)."
              />
            ) : (
              vssBranches.map(b => (
                <PluginCard key={b.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <PluginSectionTitle>{b.name}</PluginSectionTitle>
                      <div className="text-[10px] text-gray-500 truncate" title={formatUiPath(b.rootPath)}>{formatUiPath(b.rootPath)}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        VSS · {b.createdUtc ? new Date(b.createdUtc).toLocaleString() : ''}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
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
                </PluginCard>
              ))
            )}
          </div>
        )}

        {activeTab === 'peek' && (
          <div className="px-3 pb-3 space-y-1 overflow-y-auto bndz-scrollbar flex-1 min-h-0">
            {!peekMeta ? (
              <PluginEmptyState
                icon="history_ui"
                title="Select a branch"
                description="Peek a tip to inspect hashed files before restore."
              />
            ) : (
              <>
                <PluginSectionTitle>{peekMeta.name}</PluginSectionTitle>
                {peekEntries.map(e => (
                  <div
                    key={e.relPath + e.contentHash}
                    className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-[#2a2f3a]/60"
                  >
                    <span className="truncate text-gray-200" title={e.relPath}>{e.relPath}</span>
                    <span className="shrink-0 text-gray-500 font-mono text-[9px]">{formatBytes(e.size)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </PluginPanelShell>
  );
}
