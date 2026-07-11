import React, { useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toWindowsPath } from '../../lib/pathUtils';
import { StorageUsageBar } from '../StorageUsageBar';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginSectionTitle,
  PluginCard,
  PluginStatCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginFieldLabel,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';
import StorageCleanupWizard, { type StorageWizardMode } from './StorageCleanupWizard';
import {
  ORGANIZE_BUCKETS,
  bucketForFile,
  formatStorageSize,
  panePathFromWin,
  pickKeepIndex,
  type DupKeepRule,
  type DupGroup,
} from '../../lib/storageOrganize';

export const StorageCleanupPluginDef = {
  id: 'storage-cleanup',
  name: 'Storage Cleanup',
  icon: 'storage_cleanup',
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type TabId = 'overview' | 'duplicates' | 'organize';

export default function StorageCleanupPlugin({ currentPath, pathContentsCache, folderSizeMap, pluginLaunch }: any) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [wizardMode, setWizardMode] = useState<StorageWizardMode | null>(null);
  const [wizardFolderPath, setWizardFolderPath] = useState<string | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [dupRecursive, setDupRecursive] = useState(true);
  const [dupMinKb, setDupMinKb] = useState(4);
  const [dupProgress, setDupProgress] = useState<{ percent: number; currentPath: string; filesScanned: number; totalFiles: number } | null>(null);
  const [expandedDup, setExpandedDup] = useState<string | null>(null);
  const [deletingDupes, setDeletingDupes] = useState<string | null>(null);
  const [dupKeepRule, setDupKeepRule] = useState<DupKeepRule>('first');

  const navigateToPath = (winPath: string) => {
    if (!winPath) return;
    const isFile = /\.[A-Za-z0-9]{1,8}$/.test(winPath.replace(/\\/g, '/'));
    const target = isFile ? winPath.replace(/\\[^\\]+$/, '') : winPath;
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: panePathFromWin(target) } }));
  };

  const openWizard = (mode: StorageWizardMode, folderPath?: string) => {
    if (folderPath) setWizardFolderPath(folderPath);
    setWizardMode(mode);
    if (mode === 'organize') setActiveTab('organize');
    else setActiveTab('duplicates');
  };

  useEffect(() => {
    const onWizard = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const mode = detail.mode as StorageWizardMode | undefined;
      if (mode === 'organize' || mode === 'cleanup') openWizard(mode, detail.currentPath);
    };
    window.addEventListener('bndz-storage-wizard', onWizard);
    return () => window.removeEventListener('bndz-storage-wizard', onWizard);
  }, []);

  useEffect(() => {
    const mode = pluginLaunch?.wizardMode as StorageWizardMode | undefined;
    if (mode === 'organize' || mode === 'cleanup') {
      openWizard(mode, pluginLaunch?.currentPath);
    }
  }, [pluginLaunch?.wizardMode, pluginLaunch?.currentPath]);

  const items = pathContentsCache?.[currentPath] || [];

  const largeCandidates = useMemo(() => {
    return items
      .map((e: any) => {
        const win = toWindowsPath(e.path || `${currentPath}/${e.name}`);
        const folderSize = e.type === 'directory' ? folderSizeMap?.[win.toLowerCase()] : null;
        const size = e.type === 'directory' ? (folderSize ?? 0) : (Number(e.size) || 0);
        return { ...e, computedSize: size, winPath: win };
      })
      .filter((e: any) => e.computedSize > 0)
      .sort((a: any, b: any) => b.computedSize - a.computedSize)
      .slice(0, 16);
  }, [currentPath, items, folderSizeMap]);

  const totalVisible = useMemo(
    () => largeCandidates.reduce((s: number, e: any) => s + e.computedSize, 0),
    [largeCandidates],
  );

  const maxItemSize = largeCandidates[0]?.computedSize || 1;

  const duplicateWaste = useMemo(
    () => dupGroups.reduce((sum, g) => sum + g.size * Math.max(0, g.paths.length - 1), 0),
    [dupGroups],
  );

  const typeBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (const e of items) {
      if (e.type !== 'file') continue;
      const b = bucketForFile(e.name || '');
      buckets[b] = (buckets[b] || 0) + (Number(e.size) || 0);
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  }, [items]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../../lib/ipcBridge').then(({ IPC }) => {
      if (IPC.isNative) unsub = IPC.onDuplicateScanProgress(p => setDupProgress(p));
    });
    return () => unsub?.();
  }, []);

  const runFolderScan = async () => {
    setScanning(true);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const dirs = items
        .filter((e: any) => e.type === 'directory')
        .map((e: any) => toWindowsPath(e.path || `${currentPath}/${e.name}`));
      if (dirs.length) await IPC.scanFolderSizes(dirs, true);
      setLastScan(new Date());
    } finally {
      setScanning(false);
    }
  };

  const runDuplicateScan = async () => {
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    setDupScanning(true);
    setDupGroups([]);
    setDupProgress({ percent: 0, currentPath: '', filesScanned: 0, totalFiles: 0 });
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const root = toWindowsPath(currentPath);
      const result = await IPC.scanDuplicates(root, dupRecursive, dupMinKb * 1024);
      setDupGroups(result.groups || []);
    } finally {
      setDupScanning(false);
      setDupProgress(null);
    }
  };

  const cancelDuplicateScan = () => {
    import('../../lib/ipcBridge').then(({ IPC }) => IPC.cancelDuplicateScan());
    setDupScanning(false);
    setDupProgress(null);
  };

  const deleteDuplicateExtras = async (group: DupGroup, keepIndex?: number) => {
    const keep = keepIndex ?? pickKeepIndex(group.paths, dupKeepRule);
    setDeletingDupes(group.hash);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const toDelete = group.paths.filter((_, i) => i !== keep);
      for (const p of toDelete) {
        await IPC.executeFsOperation(`dup-del-${Date.now()}`, 'delete', p, '');
      }
      setDupGroups(prev => prev.filter(g => g.hash !== group.hash));
    } finally {
      setDeletingDupes(null);
    }
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'piechart_ui' },
    { id: 'duplicates', label: 'Duplicates', icon: 'copy' },
    { id: 'organize', label: 'Smart Organize', icon: 'folder_plus_ui' },
  ];

  const folderLabel = currentPath?.split('/').filter(Boolean).pop() || 'This PC';

  return (
    <PluginPanelShell
      title="Smart Storage"
      icon="storage_cleanup"
      iconColor="#34d399"
      variant="embedded"
      subtitle={folderLabel}
      toolbar={
        <PluginTabStrip className="!border-0 !min-h-0 bg-black/20 rounded-md p-0.5 gap-0.5">
          {tabs.map(t => (
            <PluginTab key={t.id} active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
              <span className="inline-flex items-center gap-1"><Icons8Icon id={t.icon} size={11} />{t.label}</span>
            </PluginTab>
          ))}
        </PluginTabStrip>
      }
    >
    <div className="h-full flex flex-col overflow-hidden relative">
      <PluginHeroStrip
        icon={<Icons8Icon id="storage_cleanup" size={52} className="opacity-90" />}
        name={folderLabel}
        typeLabel="Storage analysis"
        path={currentPath && currentPath !== '/' ? currentPath : undefined}
        meta={
          <span className="bndz-panel-muted text-xs">
            {items.length} item(s) · {dupGroups.length ? `${dupGroups.length} duplicate group(s)` : 'No duplicate scan yet'}
            {duplicateWaste > 0 ? ` · ${formatStorageSize(duplicateWaste)} recoverable` : ''}
          </span>
        }
        actions={
          <>
            <PluginHeroActionButton icon="copy" variant="primary" onClick={() => openWizard('cleanup')}>Cleanup</PluginHeroActionButton>
            <PluginHeroActionButton icon="folder_plus_ui" onClick={() => openWizard('organize')}>Organize</PluginHeroActionButton>
          </>
        }
      />
      {wizardMode && (
        <StorageCleanupWizard
          mode={wizardMode}
          initialFolderPanePath={wizardFolderPath || currentPath}
          onClose={() => { setWizardMode(null); setWizardFolderPath(undefined); }}
        />
      )}

      <div className="flex-1 overflow-y-auto bndz-scrollbar p-4">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <PluginCard className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Icons8Icon id="wand_ui" size={16} className="text-[#7eb8e8]" />
                    Guided workflows
                  </div>
                  <p className="text-xs bndz-panel-muted mt-1 max-w-md">
                    Use the hero actions above to launch cleanup or organize wizards for any folder.
                  </p>
                </div>
              </PluginCard>

              <div className="flex justify-between items-center gap-3">
                <p className="text-xs bndz-panel-muted">Quick analysis of the current folder</p>
                <PluginToolbarButton icon={scanning ? 'loading' : 'file_search_ui'} onClick={() => void runFolderScan()} disabled={scanning}>
                  Deep scan
                </PluginToolbarButton>
              </div>

              <div className="bndz-plugin-stat-grid">
                <PluginStatCard label="Largest item" value={largeCandidates[0] ? formatStorageSize(largeCandidates[0].computedSize) : '—'} sub={largeCandidates[0]?.name} iconId="zap_ui" />
                <PluginStatCard label="Tracked bulk" value={formatStorageSize(totalVisible)} sub={`${largeCandidates.length} items`} iconId="hard_drive_ui" />
                <PluginStatCard label="Duplicate waste" value={dupGroups.length ? formatStorageSize(duplicateWaste) : '—'} sub={dupGroups.length ? `${dupGroups.length} groups` : 'Use cleanup wizard'} iconId="copy" />
              </div>

              {typeBreakdown.length > 0 && (
                <PluginCard>
                  <PluginSectionTitle icon="layers_ui">File type breakdown</PluginSectionTitle>
                  <div className="space-y-2.5">
                    {typeBreakdown.map(([bucket, size]) => {
                      const cfg = ORGANIZE_BUCKETS[bucket];
                      const pct = totalVisible > 0 ? (size / totalVisible) * 100 : 0;
                      return (
                        <div key={bucket}>
                          <div className="flex justify-between text-[11px] mb-1">
                            <span className="text-gray-300">{cfg?.icon || '📁'} {bucket}</span>
                            <span className="font-mono text-gray-500">{formatStorageSize(size)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[#1a1a22] overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, pct)}%`, background: cfg?.color || '#6b7280' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PluginCard>
              )}

              <PluginCard className="!p-0 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                  <PluginSectionTitle>Heavy items</PluginSectionTitle>
                  {lastScan && <span className="bndz-panel-muted text-xs">Scanned {lastScan.toLocaleTimeString()}</span>}
                </div>
                {largeCandidates.length === 0 ? (
                  <PluginEmptyState icon="hard_drive_ui" description="Open a folder with content, then run Deep scan." />
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {largeCandidates.map((item: any) => (
                      <button
                        type="button"
                        key={item.id || item.winPath}
                        onClick={() => navigateToPath(item.winPath)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors group text-left"
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'directory' ? 'bg-amber-500/12 text-amber-400' : 'bg-[#0078d4]/12 text-[#7eb8e8]'}`}>
                          {item.type === 'directory' ? <Icons8Icon id="hard_drive_ui" size={15} /> : <Icons8Icon id="piechart_ui" size={15} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium truncate text-gray-200">{item.name}</div>
                          <StorageUsageBar usedPct={(item.computedSize / maxItemSize) * 100} height={4} className="mt-1.5 max-w-[200px]" />
                        </div>
                        <div className="text-[12px] font-mono text-emerald-400 shrink-0">{formatStorageSize(item.computedSize)}</div>
                        <Icons8Icon id="arrow_right_ui" size={12} className="text-gray-700 group-hover:text-[#7eb8e8] shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </PluginCard>
            </div>
          )}

          {activeTab === 'duplicates' && (
            <div className="space-y-3">
              <PluginCard className="flex flex-wrap items-center justify-between gap-3 border-violet-500/20 bg-violet-950/10">
                <div>
                  <div className="text-sm font-semibold text-violet-200">Recommended: Cleanup Wizard</div>
                  <p className="text-xs bndz-panel-muted mt-1">Select any folder, preview duplicates, then confirm delete.</p>
                </div>
                <PluginToolbarButton icon="eye_ui" onClick={() => openWizard('cleanup')}>Open cleanup wizard</PluginToolbarButton>
              </PluginCard>

              <PluginCard className="flex flex-wrap items-end gap-4 border-violet-500/15">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={dupRecursive} onChange={e => setDupRecursive(e.target.checked)} className="accent-violet-500 rounded" />
                  Recursive (current folder)
                </label>
                <div>
                  <PluginFieldLabel>Keep rule</PluginFieldLabel>
                  <select value={dupKeepRule} onChange={e => setDupKeepRule(e.target.value as DupKeepRule)} className={PLUGIN_SELECT_CLASS}>
                    <option value="first">First in list</option>
                    <option value="newest">Newest path (Z→A)</option>
                    <option value="oldest">Oldest path (A→Z)</option>
                    <option value="shortest">Shortest path</option>
                  </select>
                </div>
                <div>
                  <PluginFieldLabel>Min size</PluginFieldLabel>
                  <select value={dupMinKb} onChange={e => setDupMinKb(Number(e.target.value))} className={PLUGIN_SELECT_CLASS}>
                    {[1, 4, 16, 64, 256, 1024].map(k => <option key={k} value={k}>{k} KB</option>)}
                  </select>
                </div>
                <div className="flex gap-2 ml-auto">
                  {dupScanning && (
                    <PluginToolbarButton onClick={cancelDuplicateScan}>Cancel</PluginToolbarButton>
                  )}
                  <PluginToolbarButton icon={dupScanning ? 'loading' : 'copy'} onClick={() => void runDuplicateScan()} disabled={dupScanning}>
                    Quick scan (current folder)
                  </PluginToolbarButton>
                </div>
              </PluginCard>

              {dupProgress && (
                <PluginCard>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-violet-300 font-medium">{dupProgress.percent}% — hashing files</span>
                    <span className="bndz-panel-muted bndz-mono">{dupProgress.filesScanned}/{dupProgress.totalFiles}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/30 overflow-hidden mb-2">
                    <div className="h-full bg-violet-500 rounded-full transition-all duration-200" style={{ width: `${dupProgress.percent}%` }} />
                  </div>
                  <div className="text-xs bndz-panel-muted bndz-mono truncate">{dupProgress.currentPath}</div>
                </PluginCard>
              )}

              {dupGroups.length > 0 && !dupScanning && (
                <PluginCard className="flex items-center justify-between border-emerald-500/25 bg-emerald-950/15 !py-3">
                  <div className="text-xs text-emerald-200">
                    <strong>{dupGroups.length}</strong> duplicate groups · reclaim up to <strong>{formatStorageSize(duplicateWaste)}</strong>
                  </div>
                  <Icons8Icon id="shield_ui" size={16} className="text-emerald-500/60" />
                </PluginCard>
              )}

              {!dupScanning && dupGroups.length === 0 && !dupProgress && (
                <PluginEmptyState icon="copy" description="Use the cleanup wizard to pick any folder and preview before deleting." />
              )}

              <div className="space-y-2">
                {dupGroups.map(group => {
                  const expanded = expandedDup === group.hash;
                  const waste = group.size * (group.paths.length - 1);
                  return (
                    <PluginCard key={group.hash} className="!p-0 overflow-hidden">
                      <div className="w-full px-4 py-3 flex items-center gap-3">
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-3 min-w-0 hover:opacity-90 transition-opacity text-left"
                          onClick={() => setExpandedDup(expanded ? null : group.hash)}
                        >
                          {expanded ? <Icons8Icon id="chevron_down" size={14} className="text-gray-500 shrink-0" /> : <Icons8Icon id="chevron_right" size={14} className="text-gray-500 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-200">{group.paths.length} identical copies</div>
                            <div className="text-xs bndz-panel-muted">{formatStorageSize(group.size)} each · {formatStorageSize(waste)} recoverable</div>
                          </div>
                        </button>
                        <PluginToolbarButton
                          icon={deletingDupes === group.hash ? 'loading' : 'trash_ui'}
                          disabled={deletingDupes === group.hash}
                          onClick={() => void deleteDuplicateExtras(group)}
                        >
                          Keep 1, delete rest
                        </PluginToolbarButton>
                      </div>
                      {expanded && (
                        <div className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
                          {group.paths.map((p, i) => {
                            const keepIdx = pickKeepIndex(group.paths, dupKeepRule);
                            return (
                            <div key={p} className="px-4 py-2 pl-10 flex items-center gap-2 text-xs">
                              <span className={`shrink-0 w-5 h-5 rounded text-[10px] font-semibold flex items-center justify-center ${i === keepIdx ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-gray-500'}`}>
                                {i === keepIdx ? '✓' : i + 1}
                              </span>
                              <button type="button" onClick={() => navigateToPath(p)} className="bndz-mono text-gray-400 hover:text-[#99c9f0] truncate flex-1 text-left" title={p}>{p}</button>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </PluginCard>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'organize' && (
            <PluginCard>
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                  <Icons8Icon id="folder_plus_ui" size={20} className="text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <PluginSectionTitle icon="wand_ui">Smart organize wizard</PluginSectionTitle>
                  <p className="text-xs bndz-panel-muted leading-relaxed">
                    Choose any folder on your PC, preview exactly which files move into category subfolders, then confirm.
                    Nothing moves until you approve the plan.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-3 mb-4">
                    {Object.entries(ORGANIZE_BUCKETS).concat([['Other', { re: /$/, color: '#6b7280', icon: '📁' }]]).map(([bucket, cfg]) => (
                      <span key={bucket} className="bndz-plugin-kind-pill border border-white/[0.06]" style={{ color: cfg.color, background: `${cfg.color}12` }}>
                        {cfg.icon} {bucket}
                      </span>
                    ))}
                  </div>
                  <PluginToolbarButton icon="wand_ui" onClick={() => openWizard('organize')}>Start organize wizard</PluginToolbarButton>
                </div>
              </div>
            </PluginCard>
          )}
      </div>
    </div>
    </PluginPanelShell>
  );
}
