import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginFieldLabel,
  PluginStatCard,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';

export const TranscodeRackPluginDef = {
  id: 'transcode-rack',
  name: 'Transcode Rack',
  icon: 'edit_image',
  targetPanel: 'bottom' as const,
  installOnFirstUse: true,
};

type TranscodeJob = {
  id: string;
  sourcePath: string;
  destPath: string;
  format: string;
  quality: number;
  status: string;
  progress: number;
  error?: string;
};

type RackStatus = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  overallProgress: number;
  jobs: TranscodeJob[];
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function normalizeJob(raw: Record<string, unknown>): TranscodeJob {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    sourcePath: String(raw.sourcePath ?? raw.SourcePath ?? ''),
    destPath: String(raw.destPath ?? raw.DestPath ?? ''),
    format: String(raw.format ?? raw.Format ?? 'jpeg'),
    quality: Number(raw.quality ?? raw.Quality ?? 90),
    status: String(raw.status ?? raw.Status ?? 'queued'),
    progress: Number(raw.progress ?? raw.Progress ?? 0),
    error: raw.error ?? raw.Error ? String(raw.error ?? raw.Error) : undefined,
  };
}

function normalizeStatus(raw: Record<string, unknown>): RackStatus {
  const jobsRaw = raw.jobs ?? raw.Jobs;
  const jobs = Array.isArray(jobsRaw) ? jobsRaw.map((j: Record<string, unknown>) => normalizeJob(j)) : [];
  return {
    queued: Number(raw.queued ?? raw.Queued ?? 0),
    running: Number(raw.running ?? raw.Running ?? 0),
    completed: Number(raw.completed ?? raw.Completed ?? 0),
    failed: Number(raw.failed ?? raw.Failed ?? 0),
    overallProgress: Number(raw.overallProgress ?? raw.OverallProgress ?? 0),
    jobs,
  };
}

export default function TranscodeRackPlugin({ selectedItems, focusedPath, currentPath }: {
  selectedItems?: string[];
  focusedPath?: string;
  currentPath?: string;
}) {
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp'>('jpeg');
  const [quality, setQuality] = useState(90);
  const [destFolder, setDestFolder] = useState('');
  const [status, setStatus] = useState<RackStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [polling, setPolling] = useState(false);

  const imagePaths = useMemo(() => {
    const raw = selectedItems?.length ? selectedItems : [];
    const parent = (focusedPath || currentPath || '').replace(/\//g, '\\');
    return raw.map(p => {
      const n = p.replace(/\//g, '\\');
      if (/^[A-Za-z]:\\/.test(n) || n.startsWith('\\\\')) return n;
      return parent ? `${parent.replace(/\\+$/, '')}\\${n}` : n;
    }).filter(Boolean);
  }, [selectedItems, focusedPath, currentPath]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await IPC.transcodeStatus();
      if (res.status) setStatus(normalizeStatus(res.status as Record<string, unknown>));
    } catch {
      /* ignore poll errors */
    }
  }, []);

  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(pollStatus, 800);
    return () => window.clearInterval(t);
  }, [polling, pollStatus]);

  const enqueue = async () => {
    if (!imagePaths.length) {
      pushToast('Select image files in the list first', 'warning');
      return;
    }
    setRunning(true);
    setPolling(true);
    try {
      const res = await IPC.transcodeEnqueue(
        imagePaths,
        format,
        quality,
        destFolder.trim() ? toWindowsPath(destFolder.trim()) : undefined,
      );
      if (!res.ok) throw new Error(res.error || 'Enqueue failed');
      pushToast(`Queued ${res.jobIds?.length ?? 0} image(s)`, 'success');
      await pollStatus();
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Enqueue failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  const activeJobs = status?.jobs.filter(j => j.status === 'running' || j.status === 'queued') ?? [];
  const doneJobs = status?.jobs.filter(j => j.status === 'completed' || j.status === 'failed') ?? [];

  return (
    <PluginPanelShell
      title="Transcode Rack"
      icon="edit_image"
      toolbar={
        <PluginToolbarButton icon="play_ui" onClick={enqueue} disabled={running || !imagePaths.length}>
          Run batch
        </PluginToolbarButton>
      }
    >
      <PluginHeroStrip
        title="Format transcode rack"
        subtitle="SkiaSharp batch encode — JPEG, PNG, or WebP with visible queue progress."
        actions={
          <PluginHeroActionButton icon="refresh_ui" onClick={pollStatus}>
            Refresh
          </PluginHeroActionButton>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 pb-2">
        <PluginStatCard label="Queued" value={String(status?.queued ?? 0)} />
        <PluginStatCard label="Running" value={String(status?.running ?? 0)} />
        <PluginStatCard label="Done" value={String(status?.completed ?? 0)} />
        <PluginStatCard label="Progress" value={`${status?.overallProgress ?? 0}%`} />
      </div>

      <div className="px-3 pb-3 grid gap-3 sm:grid-cols-2">
        <PluginCard className="p-3 flex flex-col gap-2">
          <PluginFieldLabel>Output format</PluginFieldLabel>
          <select className={PLUGIN_SELECT_CLASS} value={format} onChange={e => setFormat(e.target.value as 'jpeg' | 'png' | 'webp')}>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
          </select>

          <PluginFieldLabel>Quality ({format === 'png' ? 'lossless' : quality})</PluginFieldLabel>
          <input
            type="range"
            min={10}
            max={100}
            value={quality}
            disabled={format === 'png'}
            onChange={e => setQuality(Number(e.target.value))}
            className="w-full accent-[#0078d4]"
          />

          <PluginFieldLabel>Destination folder (optional)</PluginFieldLabel>
          <input
            className={PLUGIN_INPUT_CLASS}
            value={destFolder}
            onChange={e => setDestFolder(e.target.value)}
            placeholder="Same folder as source"
          />

          <div className="text-[10px] text-gray-500 mt-1">
            {imagePaths.length} image(s) selected · outputs named *_transcoded.ext
          </div>
        </PluginCard>

        <PluginCard className="p-3 flex flex-col min-h-0 max-h-[220px]">
          <div className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-2">
            <Icons8Icon id="dropstack" size={12} /> Queue
          </div>
          <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-1.5">
            {activeJobs.length === 0 && doneJobs.length === 0 && (
              <PluginEmptyState icon="edit_image" title="Queue empty" hint="Select images and run batch." />
            )}
            {activeJobs.map(job => (
              <div key={job.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
                <div className="text-[11px] truncate font-medium">{job.sourcePath.split('\\').pop()}</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#0078d4]/80 transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{job.progress}%</span>
                </div>
              </div>
            ))}
            {doneJobs.slice(0, 8).map(job => (
              <div key={job.id} className="text-[10px] text-gray-500 truncate px-1">
                {job.status === 'completed' ? '✓' : '✗'} {job.sourcePath.split('\\').pop()}
                {job.error ? ` — ${job.error}` : ''}
              </div>
            ))}
          </div>
        </PluginCard>
      </div>
    </PluginPanelShell>
  );
}
