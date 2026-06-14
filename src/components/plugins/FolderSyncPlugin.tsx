import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderSync, Plus, Play, Pause, Trash2, ArrowRight, RefreshCw, Loader2,
  CheckCircle2, AlertCircle, Eye, FolderInput, Zap, Clock,
} from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import DestinationPickerModal from '../DestinationPickerModal';

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
  const [progress, setProgress] = useState<Record<string, { percent: number; message?: string; file?: string }>>({});
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await IPC.getFolderSyncJobs();
      setJobs(list);
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

  const saveDraft = async () => {
    if (!draft?.sourcePath || !draft.destPath) return;
    const job: FolderSyncJob = {
      id: draft.id || `job-${Date.now()}`,
      name: draft.name || 'Folder Sync',
      sourcePath: toWindowsPath(draft.sourcePath),
      destPath: toWindowsPath(draft.destPath),
      watchEnabled: draft.watchEnabled !== false,
      mirrorMode: !!draft.mirrorMode,
      enabled: draft.enabled !== false,
      lastStatus: 'idle',
    };
    await persistJobs([...jobs, job]);
    if (job.watchEnabled) await IPC.setFolderSyncWatch(job.id, true);
    setDraft(null);
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
    <div className="flex flex-col h-full min-h-0 bg-[#0e0e12] text-gray-200">
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3 bg-gradient-to-r from-[#12121a] to-[#0c1628]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
            <FolderSync size={18} className="text-sky-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-white tracking-tight">Folder Sync</h2>
            <p className="text-[10px] text-gray-500 truncate">Auto-sync folders when new files appear — powered by robocopy</p>
          </div>
        </div>
        <button
          type="button"
          onClick={startNewJob}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors"
        >
          <Plus size={14} /> New sync
        </button>
      </div>

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
              <div className="text-[11px] font-bold uppercase tracking-widest text-sky-400/80">New sync pair</div>
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
                <button type="button" onClick={() => setDraft(null)} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white">Cancel</button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={!draft.sourcePath || !draft.destPath}
                  className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[11px] font-semibold"
                >
                  Save & enable
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
  );
}
