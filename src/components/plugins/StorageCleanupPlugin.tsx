import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive, Trash2, FolderSearch, Sparkles, Loader2, PieChart, ArrowRight,
  Copy, FolderInput, CheckCircle2, X, FileStack, Zap, Eye,
  ChevronDown, ChevronRight, Shield, Wand2,
} from 'lucide-react';
import { toWindowsPath } from '../../lib/pathUtils';
import { StorageUsageBar } from '../StorageUsageBar';
import PluginPanelShell from './PluginPanelShell';
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

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string;
}) {
  return (
    <motion.div
      layout
      className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#18181f] to-[#101014] p-4 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-20" style={{ background: accent }} />
      <Icon size={16} style={{ color: accent }} className="mb-2.5" />
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">{label}</div>
      <div className="text-xl font-bold text-white mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </motion.div>
  );
}

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

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: PieChart },
    { id: 'duplicates', label: 'Duplicates', icon: Copy },
    { id: 'organize', label: 'Smart Organize', icon: FolderInput },
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
        <div className="flex gap-1 p-0.5 rounded-lg bg-black/30 border border-white/[0.06]">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                activeTab === t.id ? 'bg-emerald-600/35 text-emerald-200' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>
      }
    >
    <div className="h-full flex flex-col bg-[#09090d] text-gray-200 overflow-hidden relative">
      {wizardMode && (
        <StorageCleanupWizard
          mode={wizardMode}
          initialFolderPanePath={wizardFolderPath || currentPath}
          onClose={() => { setWizardMode(null); setWizardFolderPath(undefined); }}
        />
      )}

      <div className="flex-1 overflow-y-auto bndz-scrollbar p-5">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-950/20 to-[#0e0e14] p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-bold text-white flex items-center gap-2">
                    <Wand2 size={16} className="text-sky-400" />
                    Guided workflows
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 max-w-md">
                    Pick any folder, preview changes, then confirm. Same safe flow for cleanup and organize.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openWizard('cleanup')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/30 text-violet-200 text-[10px] font-bold uppercase tracking-wider transition-all"
                  >
                    <Copy size={13} /> Cleanup Wizard
                  </button>
                  <button
                    type="button"
                    onClick={() => openWizard('organize')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/30 text-emerald-200 text-[10px] font-bold uppercase tracking-wider transition-all"
                  >
                    <FolderInput size={13} /> Organize Wizard
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <p className="text-[11px] text-gray-500">Quick analysis of the current folder</p>
                <button
                  type="button"
                  onClick={() => void runFolderScan()}
                  disabled={scanning}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {scanning ? <Loader2 size={13} className="animate-spin" /> : <FolderSearch size={13} />}
                  Deep Scan
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Largest item" value={largeCandidates[0] ? formatStorageSize(largeCandidates[0].computedSize) : '—'} sub={largeCandidates[0]?.name} icon={Zap} accent="#f43f5e" />
                <StatCard label="Tracked bulk" value={formatStorageSize(totalVisible)} sub={`${largeCandidates.length} items`} icon={HardDrive} accent="#38bdf8" />
                <StatCard label="Duplicate waste" value={dupGroups.length ? formatStorageSize(duplicateWaste) : '—'} sub={dupGroups.length ? `${dupGroups.length} groups` : 'Use cleanup wizard'} icon={Copy} accent="#a78bfa" />
              </div>

              {typeBreakdown.length > 0 && (
                <div className="rounded-2xl border border-white/[0.06] bg-[#111116] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                    <FileStack size={13} className="text-sky-400" /> File type breakdown
                  </div>
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
                </div>
              )}

              <div className="rounded-2xl border border-white/[0.06] bg-[#111116] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Heavy items</span>
                  {lastScan && <span className="text-[9px] text-gray-600">Scanned {lastScan.toLocaleTimeString()}</span>}
                </div>
                {largeCandidates.length === 0 ? (
                  <div className="p-10 text-center">
                    <HardDrive size={32} className="mx-auto mb-3 text-gray-700" />
                    <p className="text-gray-500 text-xs">Open a folder with content, then run Deep Scan.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {largeCandidates.map((item: any) => (
                      <button
                        type="button"
                        key={item.id || item.winPath}
                        onClick={() => navigateToPath(item.winPath)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors group text-left"
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'directory' ? 'bg-amber-500/12 text-amber-400' : 'bg-sky-500/12 text-sky-400'}`}>
                          {item.type === 'directory' ? <HardDrive size={15} /> : <PieChart size={15} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium truncate text-gray-200">{item.name}</div>
                          <StorageUsageBar usedPct={(item.computedSize / maxItemSize) * 100} height={4} className="mt-1.5 max-w-[200px]" />
                        </div>
                        <div className="text-[12px] font-mono text-emerald-400 shrink-0">{formatStorageSize(item.computedSize)}</div>
                        <ArrowRight size={12} className="text-gray-700 group-hover:text-sky-400 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'duplicates' && (
            <motion.div key="duplicates" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="rounded-2xl border border-violet-500/25 bg-violet-950/15 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-bold text-violet-200">Recommended: Cleanup Wizard</div>
                  <p className="text-[10px] text-gray-500 mt-1">Select any folder → preview duplicates → confirm delete</p>
                </div>
                <button
                  type="button"
                  onClick={() => openWizard('cleanup')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600/30 hover:bg-violet-600/45 border border-violet-500/40 text-violet-100 text-[10px] font-bold uppercase tracking-wider"
                >
                  <Eye size={13} /> Open Cleanup Wizard
                </button>
              </div>

              <div className="rounded-2xl border border-violet-500/20 bg-violet-950/15 p-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={dupRecursive} onChange={e => setDupRecursive(e.target.checked)} className="accent-violet-500 rounded" />
                  Recursive (current folder)
                </label>
                <label className="flex items-center gap-2 text-[11px] text-gray-400">
                  Keep rule
                  <select value={dupKeepRule} onChange={e => setDupKeepRule(e.target.value as DupKeepRule)} className="bg-[#1a1a22] border border-[#333] rounded-lg px-2 py-1 text-[11px] text-gray-300 outline-none">
                    <option value="first">First in list</option>
                    <option value="newest">Newest path (Z→A)</option>
                    <option value="oldest">Oldest path (A→Z)</option>
                    <option value="shortest">Shortest path</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-gray-400">
                  Min size
                  <select value={dupMinKb} onChange={e => setDupMinKb(Number(e.target.value))} className="bg-[#1a1a22] border border-[#333] rounded-lg px-2 py-1 text-[11px] text-gray-300 outline-none">
                    {[1, 4, 16, 64, 256, 1024].map(k => <option key={k} value={k}>{k} KB</option>)}
                  </select>
                </label>
                <div className="flex gap-2 ml-auto">
                  {dupScanning && (
                    <button type="button" onClick={cancelDuplicateScan} className="px-3 py-2 rounded-xl border border-[#444] text-gray-400 text-[11px] hover:text-white transition-colors">
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void runDuplicateScan()}
                    disabled={dupScanning}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600/25 hover:bg-violet-600/40 border border-violet-500/35 text-violet-200 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all"
                  >
                    {dupScanning ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                    Quick scan (current folder)
                  </button>
                </div>
              </div>

              {dupProgress && (
                <div className="rounded-2xl border border-violet-500/25 bg-[#111116] p-4">
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-violet-300 font-medium">{dupProgress.percent}% — hashing files</span>
                    <span className="text-gray-500 font-mono">{dupProgress.filesScanned}/{dupProgress.totalFiles}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#1a1a22] overflow-hidden mb-2">
                    <motion.div className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-500 rounded-full" animate={{ width: `${dupProgress.percent}%` }} transition={{ duration: 0.2 }} />
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono truncate">{dupProgress.currentPath}</div>
                </div>
              )}

              {dupGroups.length > 0 && !dupScanning && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 flex items-center justify-between">
                  <div className="text-[12px] text-emerald-200">
                    <strong>{dupGroups.length}</strong> duplicate groups · reclaim up to <strong>{formatStorageSize(duplicateWaste)}</strong>
                  </div>
                  <Shield size={16} className="text-emerald-500/60" />
                </div>
              )}

              {!dupScanning && dupGroups.length === 0 && !dupProgress && (
                <div className="py-12 text-center">
                  <Copy size={36} className="mx-auto mb-4 text-gray-700" />
                  <p className="text-gray-500 text-sm">Use the Cleanup Wizard to pick any folder and preview before deleting.</p>
                </div>
              )}

              <div className="space-y-3">
                {dupGroups.map(group => {
                  const expanded = expandedDup === group.hash;
                  const waste = group.size * (group.paths.length - 1);
                  return (
                    <div key={group.hash} className="rounded-2xl border border-white/[0.06] bg-[#111116] overflow-hidden">
                      <button
                        type="button"
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left"
                        onClick={() => setExpandedDup(expanded ? null : group.hash)}
                      >
                        {expanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-gray-200">{group.paths.length} identical copies</div>
                          <div className="text-[10px] text-gray-500">{formatStorageSize(group.size)} each · {formatStorageSize(waste)} recoverable</div>
                        </div>
                        <button
                          type="button"
                          disabled={deletingDupes === group.hash}
                          onClick={e => { e.stopPropagation(); void deleteDuplicateExtras(group); }}
                          className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/30 text-rose-300 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {deletingDupes === group.hash ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                          Keep 1, delete rest
                        </button>
                      </button>
                      {expanded && (
                        <div className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
                          {group.paths.map((p, i) => {
                            const keepIdx = pickKeepIndex(group.paths, dupKeepRule);
                            return (
                            <div key={p} className="px-4 py-2 pl-10 flex items-center gap-2 text-[11px]">
                              <span className={`shrink-0 w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${i === keepIdx ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/30 text-gray-500'}`}>
                                {i === keepIdx ? '✓' : i + 1}
                              </span>
                              <button type="button" onClick={() => navigateToPath(p)} className="font-mono text-gray-400 hover:text-sky-300 truncate flex-1 text-left" title={p}>{p}</button>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'organize' && (
            <motion.div key="organize" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#14141a] to-[#0e0e14] p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                    <FolderInput size={22} className="text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px] font-bold text-white">Smart Organize Wizard</div>
                    <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                      Choose any folder on your PC, preview exactly which files move into category subfolders, then confirm.
                      Nothing moves until you approve the plan.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {Object.entries(ORGANIZE_BUCKETS).concat([['Other', { re: /$/, color: '#6b7280', icon: '📁' }]]).map(([bucket, cfg]) => (
                        <span key={bucket} className="px-2.5 py-1 rounded-full text-[10px] font-medium border border-white/[0.06]" style={{ color: cfg.color, background: `${cfg.color}12` }}>
                          {cfg.icon} {bucket}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => openWizard('organize')}
                      className="mt-5 flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-600/40 to-teal-600/30 hover:from-emerald-600/55 border border-emerald-500/40 text-emerald-100 text-[11px] font-bold uppercase tracking-wider transition-all"
                    >
                      <Wand2 size={14} />
                      Start Organize Wizard
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </PluginPanelShell>
  );
}
