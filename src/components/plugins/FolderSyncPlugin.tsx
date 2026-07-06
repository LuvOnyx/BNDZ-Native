import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderSync, Plus, Play, Pause, Trash2, ArrowRight, RefreshCw, Loader2,
  CheckCircle2, AlertCircle, Eye, FolderInput, Zap, Clock, Pencil, ListTree, X,
} from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import DestinationPickerModal from '../DestinationPickerModal';
import PluginPanelShell from './PluginPanelShell';
import { pushToast } from '../ToastHost';

export const FolderSyncPluginDef = {
  id: 'folder-sync',
  name: 'Folder Sync',
  icon: FolderSync,
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

export interface FolderSyncJob {
  id: string;
  name: string;
  sourcePath: string;
  destPath: string;
  watchEnabled: boolean;
  mirrorMode: boolean;
  enabled: boolean;
  lastSyncUtc?: string | null;
  lastStatus: string;
  lastError?: string | null;
  filesCopied?: number;
}

interface FolderSyncPreviewResult {
  wouldCopy?: string[];
  wouldUpdate?: string[];
  wouldSkip?: string[];
  extraInDest?: string[];
  summary?: string;
}

function normalizeJob(raw: Record<string, unknown>): FolderSyncJob {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    name: String(raw.name ?? raw.Name ?? 'Folder Sync'),
    sourcePath: String(raw.sourcePath ?? raw.SourcePath ?? ''),
    destPath: String(raw.destPath ?? raw.DestPath ?? ''),
    watchEnabled: Boolean(raw.watchEnabled ?? raw.WatchEnabled ?? false),
    mirrorMode: Boolean(raw.mirrorMode ?? raw.MirrorMode ?? false),
    enabled: raw.enabled !== false && raw.Enabled !== false,
    lastSyncUtc: (raw.lastSyncUtc ?? raw.LastSyncUtc) as string | null | undefined,
    lastStatus: String(raw.lastStatus ?? raw.LastStatus ?? 'idle'),
    lastError: (raw.lastError ?? raw.LastError) as string | null | undefined,
    filesCopied: Number(raw.filesCopied ?? raw.FilesCopied ?? 0),
  };
}

function formatWhen(iso?: string | null) {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === 'syncing' ? { color: '#38bdf8', label: 'Syncing', Icon: Loader2, spin: true } :
    status === 'error' ? { color: '#f87171', label: 'Error', Icon: AlertCircle, spin: false } :
    status === 'watching' ? { color: '#a78bfa', label: 'Watching', Icon: Eye, spin: false } :
    { color: '#34d399', label: 'Ready', Icon: CheckCircle2, spin: false };
  const Icon = cfg.Icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
      style={{ color: cfg.color, borderColor: `${cfg.color}44`, background: `${cfg.color}15` }}
    >
      <Icon size={10} className={cfg.spin ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
}

export default function FolderSyncPlugin({ currentPath }: { currentPath?: string }) {
  const [jobs, setJobs] = useState<FolderSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<'source' | 'dest' | null>(null);
  const [draft, setDraft] = useState<Partial<FolderSyncJob> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ jobId: string; data: FolderSyncPreviewResult } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, { percent: number; message?: string; file?: string }>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await IPC.getFolderSyncJobs();
      setJobs((list || []).map((j: Record<string, unknown>) => normalizeJob(j)));
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    const unsub = IPC.onFolderSyncProgress((p) => {
      setProgress(prev => ({
        ...prev,
        [p.jobId]: { percent: p.percent, message: p.message, file: p.currentFile },
      }));
      if (p.percent >= 100 || p.status === 'idle' || p.status === 'error') {
        setSyncingId(null);
        loadJobs();
      }
    });
    return unsub;
  }, [loadJobs]);

  const persistJobs = async (next: FolderSyncJob[]) => {
    setJobs(next);
    await IPC.saveFolderSyncJobs(next);
  };

  const startNewJob = () => {
    setEditingId(null);
    const src = currentPath ? toWindowsPath(currentPath) : '';
    setDraft({
      id: `job-${Date.now()}`,
      name: 'My Sync',
      sourcePath: src,
      destPath: '',
      watchEnabled: true,
      mirrorMode: false,
      enabled: true,
      lastStatus: 'idle',
    });
  };

  const startEditJob = (job: FolderSyncJob) => {
    setEditingId(job.id);
    setDraft({ ...job });
    setPreview(null);
  };

  const usePaneAs = (side: 'source' | 'dest') => {
    if (!currentPath) {
      pushToast({ kind: 'warning', title: 'No folder open', message: 'Navigate to a folder in the file list first.' });
      return;
    }
    const win = toWindowsPath(currentPath);
    if (draft) {
      setDraft(side === 'source' ? { ...draft, sourcePath: win } : { ...draft, destPath: win });
      return;
    }
    setEditingId(null);
    setDraft({
      id: `job-${Date.now()}`,
      name: 'My Sync',
      sourcePath: side === 'source' ? win : '',
      destPath: side === 'dest' ? win : '',
      watchEnabled: true,
      mirrorMode: false,
      enabled: true,
      lastStatus: 'idle',
    });
  };

  const loadPreview = async (jobId: string) => {
    setPreviewLoading(jobId);
    try {
      const data = await IPC.previewFolderSync(jobId);
      setPreview({ jobId, data });
    } catch (e: any) {
      pushToast({ kind: 'error', title: 'Preview failed', message: e?.message || 'Could not compute diff.' });
    } finally {
      setPreviewLoading(null);
    }
  };

  const saveDraft = async () => {
    if (!draft?.sourcePath || !draft.destPath) return;
    const job: FolderSyncJob = {
      id: editingId || draft.id || `job-${Date.now()}`,
      name: draft.name || 'Folder Sync',
      sourcePath: toWindowsPath(draft.sourcePath),
      destPath: toWindowsPath(draft.destPath),
      watchEnabled: draft.watchEnabled !== false,
      mirrorMode: !!draft.mirrorMode,
      enabled: draft.enabled !== false,
      lastStatus: editingId ? (jobs.find(j => j.id === editingId)?.lastStatus ?? 'idle') : 'idle',
      lastSyncUtc: editingId ? jobs.find(j => j.id === editingId)?.lastSyncUtc : undefined,
    };
    const next = editingId
      ? jobs.map(j => j.id === editingId ? { ...j, ...job, id: editingId } : j)
      : [...jobs, job];
    await persistJobs(next);
    if (job.watchEnabled) await IPC.setFolderSyncWatch(job.id, true);
    setDraft(null);
    setEditingId(null);
    pushToast({ kind: 'success', title: editingId ? 'Sync updated' : 'Sync created', message: job.name });
  };

  const runSync = async (jobId: string) => {
    setSyncingId(jobId);
    setProgress(prev => ({ ...prev, [jobId]: { percent: 0, message: 'Starting…' } }));
    try {
      await IPC.runFolderSync(jobId);
    } catch (e: any) {
      setProgress(prev => ({ ...prev, [jobId]: { percent: 100, message: e?.message || 'Failed' } }));
      setSyncingId(null);
    }
  };

  const toggleWatch = async (job: FolderSyncJob) => {
    const next = !job.watchEnabled;
    const updated = jobs.map(j => j.id === job.id ? { ...j, watchEnabled: next, lastStatus: next ? 'watching' : 'idle' } : j);
    await persistJobs(updated);
    await IPC.setFolderSyncWatch(job.id, next);
  };

  const removeJob = async (id: string) => {
    await IPC.setFolderSyncWatch(id, false);
    await persistJobs(jobs.filter(j => j.id !== id));
  };

  return (
    <PluginPanelShell
      title="Folder Sync"
      icon={FolderSync}
      iconColor="#38bdf8"
      variant="embedded"
      subtitle="Auto-sync folders via robocopy"
      toolbar={
        <div className="flex items-center gap-1.5">
          {currentPath && (
            <>
              <button type="button" onClick={() => usePaneAs('source')} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md border border-white/10 text-gray-400 hover:text-sky-300 hover:border-sky-500/30" title="Use current folder as source">
                <FolderInput size={12} /> Pane → source
              </button>
              <button type="button" onClick={() => usePaneAs('dest')} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-md border border-white/10 text-gray-400 hover:text-sky-300 hover:border-sky-500/30" title="Use current folder as destination">
                <FolderInput size={12} /> Pane → dest
              </button>
            </>
          )}
          <button type="button" onClick={startNewJob} className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-sky-600 hover:bg-sky-500 text-white">
            <Plus size={14} /> New sync
          </button>
        </div>
      }
    >
    <div className="flex flex-col h-full min-h-0 bg-[#0e0e12] text-gray-200">
      <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
            <Loader2 size={18} className="animate-spin" /> Loading sync jobs…
          </div>
        )}

        {!loading && jobs.length === 0 && !draft && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-dashed border-white/10 p-10 text-center"
          >
            <FolderSync size={40} className="mx-auto text-gray-600 mb-3" />
            <p className="text-[13px] text-gray-400 mb-1">No sync pairs yet</p>
            <p className="text-[11px] text-gray-600 mb-4">Mirror a project folder to a backup drive, or keep two folders in sync automatically.</p>
            <button type="button" onClick={startNewJob} className="text-sky-400 hover:text-sky-300 text-[12px] font-semibold">
              Create your first sync →
            </button>
          </motion.div>
        )}

        <AnimatePresence>
          {draft && (
            <motion.div
              key="draft"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-[#0c1929]/80 to-[#101014] p-4 space-y-3"
            >
              <div className="text-[11px] font-bold uppercase tracking-widest text-sky-400/80">
                {editingId ? 'Edit sync pair' : 'New sync pair'}
              </div>
              <input
                className="w-full bg-[#1a1a22] border border-[#444] rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-sky-500"
                placeholder="Sync name"
                value={draft.name || ''}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 text-left bg-[#1a1a22] border border-[#444] rounded-lg px-3 py-2 text-[11px] font-mono truncate hover:border-sky-500/50"
                  onClick={() => setPicker('source')}
                >
                  {draft.sourcePath || 'Pick source folder…'}
                </button>
                <ArrowRight size={14} className="text-gray-600 shrink-0" />
                <button
                  type="button"
                  className="flex-1 text-left bg-[#1a1a22] border border-[#444] rounded-lg px-3 py-2 text-[11px] font-mono truncate hover:border-sky-500/50"
                  onClick={() => setPicker('dest')}
                >
                  {draft.destPath || 'Pick destination…'}
                </button>
              </div>
              <div className="flex flex-wrap gap-4 text-[11px]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={draft.watchEnabled !== false} onChange={e => setDraft({ ...draft, watchEnabled: e.target.checked })} className="accent-sky-500" />
                  <Zap size={12} className="text-amber-400" /> Watch for changes
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!draft.mirrorMode} onChange={e => setDraft({ ...draft, mirrorMode: e.target.checked })} className="accent-sky-500" />
                  Mirror mode (delete extras in destination)
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setDraft(null); setEditingId(null); }} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white">Cancel</button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={!draft.sourcePath || !draft.destPath}
                  className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[11px] font-semibold"
                >
                  {editingId ? 'Save changes' : 'Save & enable'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {jobs.map(job => {
          const prog = progress[job.id];
          const isSyncing = syncingId === job.id || job.lastStatus === 'syncing';
          return (
            <motion.div
              key={job.id}
              layout
              className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#18181f] to-[#101014] p-4 relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-white">{job.name}</span>
                    <StatusBadge status={isSyncing ? 'syncing' : job.watchEnabled ? 'watching' : job.lastStatus} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] font-mono text-gray-500">
                    <span className="truncate max-w-[45%]" title={job.sourcePath}>{job.sourcePath}</span>
                    <ArrowRight size={10} className="shrink-0" />
                    <span className="truncate max-w-[45%]" title={job.destPath}>{job.destPath}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-[9px] text-gray-600">
                    <Clock size={9} /> Last sync: {formatWhen(job.lastSyncUtc)}
                    {job.mirrorMode && <span className="ml-2 text-amber-500/80">• Mirror</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Preview diff"
                    disabled={previewLoading === job.id}
                    onClick={() => void loadPreview(job.id)}
                    className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-sky-300 disabled:opacity-40"
                  >
                    {previewLoading === job.id ? <Loader2 size={14} className="animate-spin" /> : <ListTree size={14} />}
                  </button>
                  <button
                    type="button"
                    title="Edit job"
                    onClick={() => startEditJob(job)}
                    className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-amber-300"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    title="Sync now"
                    disabled={isSyncing}
                    onClick={() => runSync(job.id)}
                    className="p-2 rounded-lg hover:bg-white/5 text-sky-400 disabled:opacity-40"
                  >
                    {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  </button>
                  <button
                    type="button"
                    title={job.watchEnabled ? 'Pause watching' : 'Enable watching'}
                    onClick={() => toggleWatch(job)}
                    className={`p-2 rounded-lg hover:bg-white/5 ${job.watchEnabled ? 'text-violet-400' : 'text-gray-500'}`}
                  >
                    {job.watchEnabled ? <Pause size={14} /> : <Eye size={14} />}
                  </button>
                  <button type="button" title="Remove" onClick={() => removeJob(job.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {(isSyncing || prog) && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-[#2a2a32] overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-sky-500 to-cyan-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${prog?.percent ?? 30}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <p className="text-[9px] text-gray-500 truncate">{prog?.message || prog?.file || 'Syncing…'}</p>
                </div>
              )}

              {job.lastError && (
                <p className="mt-2 text-[10px] text-red-400/90 flex items-center gap-1">
                  <AlertCircle size={10} /> {job.lastError}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      {preview && (
        <div className="shrink-0 border-t border-white/10 bg-[#0c0c10] max-h-[40%] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05]">
            <div className="text-[11px] font-semibold text-sky-300 flex items-center gap-2">
              <ListTree size={13} /> Sync preview
              <span className="text-gray-500 font-normal">{preview.data.summary}</span>
            </div>
            <button type="button" onClick={() => setPreview(null)} className="p-1 rounded hover:bg-white/5 text-gray-500"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto styled-scrollbar p-3 grid grid-cols-2 gap-3 text-[10px] font-mono">
            {([
              ['New files', preview.data.wouldCopy, 'text-emerald-400'],
              ['Updates', preview.data.wouldUpdate, 'text-amber-300'],
              ['Unchanged', preview.data.wouldSkip, 'text-gray-500'],
              ['Extra (mirror)', preview.data.extraInDest, 'text-rose-300'],
            ] as const).map(([label, items, color]) => (
              <div key={label} className="rounded-lg border border-white/[0.06] bg-[#111116] p-2 min-h-[80px]">
                <div className={`font-bold uppercase tracking-wider mb-1.5 ${color}`}>{label} ({items?.length ?? 0})</div>
                <div className="space-y-0.5 max-h-28 overflow-y-auto styled-scrollbar text-gray-500">
                  {(items || []).slice(0, 40).map(p => <div key={p} className="truncate" title={p}>{p}</div>)}
                  {(items?.length ?? 0) > 40 && <div className="text-gray-600">…and {(items?.length ?? 0) - 40} more</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-white/[0.05] flex justify-end gap-2">
            <button type="button" onClick={() => setPreview(null)} className="px-3 py-1.5 text-[11px] text-gray-400">Close</button>
            <button
              type="button"
              onClick={() => { void runSync(preview.jobId); setPreview(null); }}
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold flex items-center gap-1"
            >
              <Play size={12} /> Run sync
            </button>
          </div>
        </div>
      )}

      <DestinationPickerModal
        open={!!picker}
        title={picker === 'source' ? 'Source folder' : 'Destination folder'}
        onCancel={() => setPicker(null)}
        onConfirm={(path) => {
          if (!draft) return;
          const win = toWindowsPath(path);
          if (picker === 'source') setDraft({ ...draft, sourcePath: win });
          else setDraft({ ...draft, destPath: win });
          setPicker(null);
        }}
      />
    </div>
    </PluginPanelShell>
  );
}
