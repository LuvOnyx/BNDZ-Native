import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import DestinationPickerModal from '../DestinationPickerModal';
import PluginPanelShell from './PluginPanelShell';
import { pushToast } from '../ToastHost';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginFieldLabel,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const FolderSyncPluginDef = {
  id: 'folder-sync',
  name: 'Folder Sync',
  icon: 'sync_folders',
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
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === 'syncing' ? { color: '#0078d4', label: 'Syncing', icon: 'loading', spin: true } :
    status === 'error' ? { color: '#f87171', label: 'Error', icon: 'warning', spin: false } :
    status === 'watching' ? { color: '#a78bfa', label: 'Watching', icon: 'toggle_preview', spin: false } :
    { color: '#34d399', label: 'Ready', icon: 'check', spin: false };
  return (
    <span
      className="bndz-plugin-kind-pill inline-flex items-center gap-1"
      style={{ color: cfg.color, borderColor: `${cfg.color}44`, background: `${cfg.color}15` }}
    >
      <Icons8Icon id={cfg.icon} size={10} spin={cfg.spin} />
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
      icon="sync_folders"
      iconColor="#0078d4"
      variant="embedded"
      subtitle="Auto-sync folders via robocopy"
      toolbar={
        currentPath ? (
          <>
            <PluginToolbarButton icon="explorer" onClick={() => usePaneAs('source')} title="Use current folder as source">Pane → source</PluginToolbarButton>
            <PluginToolbarButton icon="explorer" onClick={() => usePaneAs('dest')} title="Use current folder as destination">Pane → dest</PluginToolbarButton>
          </>
        ) : undefined
      }
    >
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <PluginHeroStrip
        icon={<Icons8Icon id="sync_folders" size={52} className="opacity-90" />}
        name={jobs.length ? `${jobs.length} sync pair${jobs.length === 1 ? '' : 's'}` : 'Folder sync'}
        typeLabel="Robocopy engine"
        path={currentPath ? toWindowsPath(currentPath) : undefined}
        meta={
          <span className="bndz-panel-muted text-xs">
            {jobs.filter(j => j.watchEnabled).length} watching · {syncingId ? 'Sync in progress' : 'Ready'}
          </span>
        }
        actions={
          <>
            <PluginHeroActionButton
              icon="sync_folders"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: '/bndz/twin-volume' } }));
              }}
            >
              Cross-volume board
            </PluginHeroActionButton>
            <PluginHeroActionButton icon="plus_ui" variant="primary" onClick={startNewJob}>New sync</PluginHeroActionButton>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 space-y-3 min-h-0">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-500 gap-2 text-sm">
            <Icons8Icon id="loading" size={18} spin /> Loading sync jobs…
          </div>
        )}

        {!loading && jobs.length === 0 && !draft && (
          <div className="flex flex-col items-center gap-3 py-8">
            <PluginEmptyState
              icon="sync_folders"
              title="No sync pairs yet"
              description="Mirror a project folder to a backup drive, or keep two folders in sync automatically."
            />
            <PluginToolbarButton onClick={startNewJob}>Create your first sync</PluginToolbarButton>
          </div>
        )}

        {draft && (
          <PluginCard className="border-[#0078d4]/30 space-y-3">
            <PluginSectionTitle icon="sync_folders">{editingId ? 'Edit sync pair' : 'New sync pair'}</PluginSectionTitle>
            <div>
              <PluginFieldLabel>Sync name</PluginFieldLabel>
              <input
                className={PLUGIN_INPUT_CLASS}
                placeholder="Sync name"
                value={draft.name || ''}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`flex-1 text-left ${PLUGIN_INPUT_CLASS} bndz-mono truncate`}
                onClick={() => setPicker('source')}
              >
                {draft.sourcePath || 'Pick source folder…'}
              </button>
              <Icons8Icon id="chevron_right" size={14} className="shrink-0 text-gray-500" />
              <button
                type="button"
                className={`flex-1 text-left ${PLUGIN_INPUT_CLASS} bndz-mono truncate`}
                onClick={() => setPicker('dest')}
              >
                {draft.destPath || 'Pick destination…'}
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={draft.watchEnabled !== false} onChange={e => setDraft({ ...draft, watchEnabled: e.target.checked })} className="accent-[#0078d4]" />
                <Icons8Icon id="sparkles_ui" size={12} /> Watch for changes
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!draft.mirrorMode} onChange={e => setDraft({ ...draft, mirrorMode: e.target.checked })} className="accent-[#0078d4]" />
                Mirror mode (delete extras in destination)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <PluginToolbarButton
                icon="sync"
                onClick={() => setDraft(d => d ? { ...d, sourcePath: d.destPath, destPath: d.sourcePath } : d)}
              >
                Pull (swap source ↔ dest)
              </PluginToolbarButton>
            </div>
            <div>
              <PluginFieldLabel>Exclude patterns (; or newline)</PluginFieldLabel>
              <textarea
                className={`${PLUGIN_INPUT_CLASS} min-h-[52px] resize-y bndz-mono text-[11px]`}
                placeholder="*.tmp; node_modules; .git"
                value={(draft as any).excludePatterns || ''}
                onChange={e => setDraft({ ...draft, excludePatterns: e.target.value } as any)}
              />
              <p className="text-[10px] text-white/35 mt-1">Applied client-side to preview lists; stored with the job draft.</p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <PluginToolbarButton onClick={() => { setDraft(null); setEditingId(null); }}>Cancel</PluginToolbarButton>
              <PluginToolbarButton icon="check" active onClick={() => void saveDraft()} disabled={!draft.sourcePath || !draft.destPath}>
                {editingId ? 'Save changes' : 'Save & enable'}
              </PluginToolbarButton>
            </div>
          </PluginCard>
        )}

        {jobs.map(job => {
          const prog = progress[job.id];
          const isSyncing = syncingId === job.id || job.lastStatus === 'syncing';
          return (
            <PluginCard key={job.id} className="relative overflow-hidden">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{job.name}</span>
                    <StatusBadge status={isSyncing ? 'syncing' : job.watchEnabled ? 'watching' : job.lastStatus} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs bndz-mono bndz-panel-muted">
                    <span className="truncate max-w-[45%]" title={job.sourcePath}>{job.sourcePath}</span>
                    <Icons8Icon id="chevron_right" size={10} className="shrink-0" />
                    <span className="truncate max-w-[45%]" title={job.destPath}>{job.destPath}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-xs bndz-panel-muted">
                    <Icons8Icon id="clock_ui" size={10} /> Last sync: {formatWhen(job.lastSyncUtc)}
                    {job.mirrorMode && <span className="ml-2 text-amber-400/80">• Mirror</span>}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <PluginToolbarButton
                    icon={previewLoading === job.id ? 'loading' : 'table_ui'}
                    title="Preview diff"
                    disabled={previewLoading === job.id}
                    onClick={() => void loadPreview(job.id)}
                  />
                  <PluginToolbarButton icon="pencil_ui" title="Edit job" onClick={() => startEditJob(job)} />
                  <PluginToolbarButton
                    icon={isSyncing ? 'loading' : 'play_ui'}
                    title="Sync now"
                    disabled={isSyncing}
                    onClick={() => void runSync(job.id)}
                  />
                  <PluginToolbarButton
                    icon={job.watchEnabled ? 'close' : 'toggle_preview'}
                    title={job.watchEnabled ? 'Pause watching' : 'Enable watching'}
                    onClick={() => void toggleWatch(job)}
                  />
                  <PluginToolbarButton icon="delete" title="Remove" onClick={() => void removeJob(job.id)} />
                </div>
              </div>

              {(isSyncing || prog) && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                    <div className="h-full bg-[#0078d4] rounded-full transition-all duration-300" style={{ width: `${prog?.percent ?? 30}%` }} />
                  </div>
                  <p className="text-xs bndz-panel-muted truncate">{prog?.message || prog?.file || 'Syncing…'}</p>
                </div>
              )}

              {job.lastError && (
                <p className="mt-2 text-xs text-red-400/90 flex items-center gap-1">
                  <Icons8Icon id="warning" size={10} /> {job.lastError}
                </p>
              )}
            </PluginCard>
          );
        })}
      </div>

      {preview && (
        <div className="shrink-0 border-t border-white/10 bg-black/20 max-h-[40%] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
            <div className="text-xs font-semibold text-[#99c9f0] flex items-center gap-2">
              <Icons8Icon id="table_ui" size={13} /> Sync preview
              <span className="bndz-panel-muted font-normal">{preview.data.summary}</span>
            </div>
            <PluginToolbarButton icon="close" onClick={() => setPreview(null)} />
          </div>
          <div className="flex-1 overflow-y-auto bndz-scrollbar p-3 grid grid-cols-2 gap-3 bndz-mono text-xs">
            {([
              ['New files', preview.data.wouldCopy, 'text-emerald-400'],
              ['Updates', preview.data.wouldUpdate, 'text-amber-300'],
              ['Unchanged', preview.data.wouldSkip, 'text-gray-500'],
              ['Extra (mirror)', preview.data.extraInDest, 'text-rose-300'],
            ] as const).map(([label, items, color]) => (
              <PluginCard key={label} className="!p-2 min-h-[80px]">
                <div className={`bndz-plugin-section-title mb-1.5 ${color}`}>{label} ({items?.length ?? 0})</div>
                <div className="space-y-0.5 max-h-28 overflow-y-auto bndz-scrollbar bndz-panel-muted">
                  {(items || []).slice(0, 40).map(p => <div key={p} className="truncate" title={p}>{p}</div>)}
                  {(items?.length ?? 0) > 40 && <div>…and {(items?.length ?? 0) - 40} more</div>}
                </div>
              </PluginCard>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-white/[0.06] flex justify-end gap-2">
            <PluginToolbarButton onClick={() => setPreview(null)}>Close</PluginToolbarButton>
            <PluginToolbarButton icon="play_ui" active onClick={() => { void runSync(preview.jobId); setPreview(null); }}>Run sync</PluginToolbarButton>
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
