import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HardDrive, Trash2, FolderSearch, Sparkles, Loader2, PieChart, ArrowRight,
  Copy, FolderInput, CheckCircle2, AlertCircle, X, FileStack, Zap, Eye,
  ChevronDown, ChevronRight, Shield,
} from 'lucide-react';
import { toWindowsPath } from '../../lib/pathUtils';
import { StorageUsageBar } from '../StorageUsageBar';

export const StorageCleanupPluginDef = {
  id: 'storage-cleanup',
  name: 'Storage Cleanup',
  icon: HardDrive,
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type TabId = 'overview' | 'duplicates' | 'organize';

interface DupGroup {
  hash: string;
  size: number;
  paths: string[];
}

interface OrganizePlan {
  file: string;
  name: string;
  bucket: string;
  dest: string;
}

function formatSize(bytes: number) {
  if (!bytes || bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0))} ${sizes[i]}`;
}

const ORGANIZE_BUCKETS: Record<string, { re: RegExp; color: string; icon: string }> = {
  Images: { re: /\.(png|jpe?g|gif|bmp|webp|svg|ico|heic|tiff?|raw)$/i, color: '#f472b6', icon: '🖼' },
  Videos: { re: /\.(mp4|mkv|avi|mov|wmv|webm|m4v)$/i, color: '#a78bfa', icon: '🎬' },
  Audio: { re: /\.(mp3|wav|flac|aac|ogg|m4a|wma)$/i, color: '#38bdf8', icon: '🎵' },
  Documents: { re: /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|csv|md)$/i, color: '#fbbf24', icon: '📄' },
  Archives: { re: /\.(zip|rar|7z|tar|gz|bz2)$/i, color: '#fb923c', icon: '📦' },
  Code: { re: /\.(js|ts|jsx|tsx|py|cs|java|cpp|c|h|html|css|json|xml|sql)$/i, color: '#34d399', icon: '💻' },
};

function bucketForFile(name: string): string {
  for (const [bucket, cfg] of Object.entries(ORGANIZE_BUCKETS)) {
    if (cfg.re.test(name)) return bucket;
  }
  return 'Other';
}

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

export default function StorageCleanupPlugin({ currentPath, pathContentsCache, folderSizeMap }: any) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [dupRecursive, setDupRecursive] = useState(true);
  const [dupMinKb, setDupMinKb] = useState(4);
  const [dupProgress, setDupProgress] = useState<{ percent: number; currentPath: string; filesScanned: number; totalFiles: number } | null>(null);
  const [expandedDup, setExpandedDup] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeResult, setOrganizeResult] = useState<string | null>(null);
  const [showOrganizePreview, setShowOrganizePreview] = useState(false);
  const [organizePlan, setOrganizePlan] = useState<OrganizePlan[]>([]);
  const [deletingDupes, setDeletingDupes] = useState<string | null>(null);

  const items = pathContentsCache?.[currentPath] || [];

  const largeCandidates = useMemo(() => {
    return items
      .map((e: any) => {
        const win = toWindowsPath(e.path || `${currentPath}/${e.name}`).toLowerCase();
        const folderSize = e.type === 'directory' ? folderSizeMap?.[win] : null;
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
      if (IPC.isNative) {
        unsub = IPC.onDuplicateScanProgress(p => setDupProgress(p));
      }
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
      if (result.error) {
        setOrganizeResult(result.error);
      }
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

  const deleteDuplicateExtras = async (group: DupGroup, keepIndex = 0) => {
    setDeletingDupes(group.hash);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const toDelete = group.paths.filter((_, i) => i !== keepIndex);
      for (const p of toDelete) {
        await IPC.executeFsOperation(`dup-del-${Date.now()}`, 'delete', p, '');
      }
      setDupGroups(prev => prev.filter(g => g.hash !== group.hash));
    } finally {
      setDeletingDupes(null);
    }
  };

  const buildOrganizePlan = (): OrganizePlan[] => {
    const root = toWindowsPath(currentPath);
    return items
      .filter((e: any) => e.type === 'file')
      .map((file: any) => {
        const name = file.name || '';
        const bucket = bucketForFile(name);
        const src = toWindowsPath(file.path || `${currentPath}/${name}`);
        const dest = `${root}\\${bucket}\\${name}`;
        return { file: src, name, bucket, dest };
      })
      .filter(p => p.file.toLowerCase() !== p.dest.toLowerCase());
  };

  const previewOrganize = () => {
    const plan = buildOrganizePlan();
    setOrganizePlan(plan);
    setShowOrganizePreview(true);
    setOrganizeResult(null);
  };

  const runSmartOrganize = async () => {
    const plan = organizePlan.length ? organizePlan : buildOrganizePlan();
    if (!plan.length) {
      setOrganizeResult('No files to organize in the current folder.');
      return;
    }
    setOrganizing(true);
    setOrganizeResult(null);
    let moved = 0;
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const mkdirDone = new Set<string>();
      for (const entry of plan) {
        const destDir = entry.dest.replace(/\\[^\\]+$/, '');
        if (!mkdirDone.has(destDir.toLowerCase())) {
          await IPC.executeFsOperation(`org-mkdir-${destDir}`, 'create-dir', destDir, '');
          mkdirDone.add(destDir.toLowerCase());
        }
        await IPC.executeFsOperation(`org-move-${entry.name}`, 'move', entry.file, entry.dest);
        moved++;
      }
      setOrganizeResult(`Organized ${moved} file(s) into category folders.`);
      setShowOrganizePreview(false);
      setOrganizePlan([]);
    } catch (err: any) {
      setOrganizeResult(err?.message || 'Organize failed.');
    } finally {
      setOrganizing(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: PieChart },
    { id: 'duplicates', label: 'Duplicates', icon: Copy },
    { id: 'organize', label: 'Smart Organize', icon: FolderInput },
  ];

  const folderLabel = currentPath?.split('/').filter(Boolean).pop() || 'This PC';

  return (
    <div className="h-full flex flex-col bg-[#09090d] text-gray-200 overflow-hidden">
      {/* Hero header */}
      <div className="shrink-0 relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/50 via-[#0c1018] to-violet-950/40" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(16,185,129,0.15),transparent_50%)]" />
        <div className="relative px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Sparkles size={18} className="text-emerald-400" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white tracking-tight">Smart Storage</h2>
                <p className="text-[10px] text-gray-500 mt-0.5 font-mono truncate max-w-[280px]">{folderLabel}</p>
              </div>
            </div>
          </div>
          <div className="flex gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.06]">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                  activeTab === t.id
                    ? 'bg-emerald-600/35 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
                }`}
              >
                <t.icon size={11} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bndz-scrollbar p-5">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex justify-between items-center">
                <p className="text-[11px] text-gray-500">Analyze folder weight and file-type distribution</p>
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
                <StatCard label="Largest item" value={largeCandidates[0] ? formatSize(largeCandidates[0].computedSize) : '—'} sub={largeCandidates[0]?.name} icon={Zap} accent="#f43f5e" />
                <StatCard label="Tracked bulk" value={formatSize(totalVisible)} sub={`${largeCandidates.length} items`} icon={HardDrive} accent="#38bdf8" />
                <StatCard label="Duplicate waste" value={dupGroups.length ? formatSize(duplicateWaste) : '—'} sub={dupGroups.length ? `${dupGroups.length} groups` : 'Scan duplicates tab'} icon={Copy} accent="#a78bfa" />
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
                            <span className="font-mono text-gray-500">{formatSize(size)}</span>
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
                      <div key={item.id || item.winPath} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'directory' ? 'bg-amber-500/12 text-amber-400' : 'bg-sky-500/12 text-sky-400'}`}>
                          {item.type === 'directory' ? <HardDrive size={15} /> : <PieChart size={15} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium truncate text-gray-200">{item.name}</div>
                          <StorageUsageBar usedPct={(item.computedSize / maxItemSize) * 100} height={4} className="mt-1.5 max-w-[200px]" />
                        </div>
                        <div className="text-[12px] font-mono text-emerald-400 shrink-0">{formatSize(item.computedSize)}</div>
                        <ArrowRight size={12} className="text-gray-700 group-hover:text-gray-400 shrink-0 transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'duplicates' && (
            <motion.div key="duplicates" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              <div className="rounded-2xl border border-violet-500/20 bg-violet-950/15 p-4 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={dupRecursive} onChange={e => setDupRecursive(e.target.checked)} className="accent-violet-500 rounded" />
                  Recursive scan
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
                    {dupScanning ? 'Scanning…' : 'Find Duplicates'}
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
                    <strong>{dupGroups.length}</strong> duplicate groups · reclaim up to <strong>{formatSize(duplicateWaste)}</strong>
                  </div>
                  <Shield size={16} className="text-emerald-500/60" />
                </div>
              )}

              {!dupScanning && dupGroups.length === 0 && !dupProgress && (
                <div className="py-16 text-center">
                  <Copy size={36} className="mx-auto mb-4 text-gray-700" />
                  <p className="text-gray-500 text-sm">Scan the current folder to find identical files by content hash.</p>
                  <p className="text-gray-600 text-[11px] mt-1">MD5 comparison · safe keep-one-delete-rest workflow</p>
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
                          <div className="text-[10px] text-gray-500">{formatSize(group.size)} each · {formatSize(waste)} recoverable</div>
                        </div>
                        <button
                          type="button"
                          disabled={deletingDupes === group.hash}
                          onClick={e => { e.stopPropagation(); void deleteDuplicateExtras(group, 0); }}
                          className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/30 text-rose-300 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {deletingDupes === group.hash ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                          Keep 1st, delete rest
                        </button>
                      </button>
                      {expanded && (
                        <div className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
                          {group.paths.map((p, i) => (
                            <div key={p} className="px-4 py-2 pl-10 flex items-center gap-2 text-[11px]">
                              <span className={`shrink-0 w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center ${i === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/30 text-gray-500'}`}>
                                {i === 0 ? '✓' : i + 1}
                              </span>
                              <span className="font-mono text-gray-400 truncate flex-1" title={p}>{p}</span>
                            </div>
                          ))}
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
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#14141a] to-[#0e0e14] p-5">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                    <FolderInput size={20} className="text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14px] font-bold text-white">Smart Organize</div>
                    <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                      Sort loose files into category subfolders. Preview the plan before moving — folders are never touched.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {Object.entries(ORGANIZE_BUCKETS).concat([['Other', { re: /$/, color: '#6b7280', icon: '📁' }]]).map(([bucket, cfg]) => (
                        <span key={bucket} className="px-2.5 py-1 rounded-full text-[10px] font-medium border border-white/[0.06]" style={{ color: cfg.color, background: `${cfg.color}12` }}>
                          {cfg.icon} {bucket}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={previewOrganize}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-sky-500/30 bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 text-[11px] font-bold uppercase tracking-wider transition-all"
                >
                  <Eye size={14} /> Preview Plan
                </button>
                <button
                  type="button"
                  onClick={() => void runSmartOrganize()}
                  disabled={organizing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/35 text-emerald-300 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 transition-all"
                >
                  {organizing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {organizing ? 'Organizing…' : 'Organize Now'}
                </button>
              </div>

              {showOrganizePreview && organizePlan.length > 0 && (
                <div className="rounded-2xl border border-sky-500/20 bg-[#111116] overflow-hidden max-h-[220px] overflow-y-auto bndz-scrollbar">
                  <div className="px-4 py-2 border-b border-white/[0.05] text-[11px] font-bold text-sky-400 uppercase tracking-wider sticky top-0 bg-[#111116]">
                    {organizePlan.length} files will move
                  </div>
                  {organizePlan.map(entry => {
                    const cfg = ORGANIZE_BUCKETS[entry.bucket];
                    return (
                      <div key={entry.file} className="px-4 py-2 flex items-center gap-2 text-[11px] border-b border-white/[0.03] last:border-0">
                        <span style={{ color: cfg?.color || '#6b7280' }}>{cfg?.icon || '📁'}</span>
                        <span className="text-gray-300 truncate flex-1">{entry.name}</span>
                        <ArrowRight size={10} className="text-gray-600 shrink-0" />
                        <span className="text-gray-500 shrink-0">{entry.bucket}/</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {organizeResult && (
                <div className={`flex items-center gap-2 text-[11px] px-4 py-3 rounded-xl border ${
                  organizeResult.includes('Organized') || organizeResult.includes('Moved')
                    ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-950/30 text-amber-300'
                }`}>
                  {organizeResult.includes('Organized') || organizeResult.includes('Moved') ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {organizeResult}
                  <button type="button" onClick={() => setOrganizeResult(null)} className="ml-auto p-1 hover:text-white"><X size={12} /></button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
