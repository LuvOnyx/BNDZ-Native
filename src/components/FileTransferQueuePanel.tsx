import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { FileTransferJobDto, FileTransferQueueState } from '../lib/ipcBridge';
import {
  formatTransferAction,
  formatTransferProgressLine,
  isTransferActive,
  visibleTransferJobs,
} from '../lib/fileTransferQueue';

type Props = {
  className?: string;
};

function JobRow({
  job,
  onCancel,
}: {
  job: FileTransferJobDto;
  onCancel: (id: string) => void;
}) {
  const canCancel = job.status === 'queued' || job.status === 'running';
  const engineLabel = job.engine === 'native' ? 'Windows' : 'BNDZ';
  const progressLine = formatTransferProgressLine(job);
  const statusColor =
    job.status === 'failed' ? 'text-rose-300'
    : job.status === 'completed' ? 'text-emerald-300'
    : job.status === 'cancelled' ? 'text-gray-500'
    : 'text-[#99c9f0]';

  const statusLabel =
    job.status === 'running' || job.status === 'queued' ? `${job.progress ?? 0}%`
    : job.status === 'completed' ? 'Done'
    : job.status;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-1.5 border-b border-[#3a3a3a] last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {job.status === 'completed' && (
            <Icons8Icon id="check" size={10} className="text-emerald-400 shrink-0" />
          )}
          <span className="text-[11px] font-medium text-gray-100 truncate">{job.label}</span>
          <span className="text-[9px] uppercase tracking-wide text-gray-500 shrink-0">
            {formatTransferAction(job.action)}
          </span>
          <span className="text-[9px] px-1 py-px border border-[#454545] text-gray-500 shrink-0">
            {engineLabel}
          </span>
        </div>
        {job.currentFile && job.status === 'running' && (
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-mono">{job.currentFile}</div>
        )}
        {progressLine && (job.status === 'running' || job.status === 'queued') && (
          <div className="text-[10px] text-gray-500 mt-0.5 font-mono tabular-nums">{progressLine}</div>
        )}
        {job.error && (
          <div className="text-[10px] text-rose-300/90 truncate mt-0.5">{job.error}</div>
        )}
        <div className="mt-1.5 h-1 bg-[#1a1a1a] border border-[#333] overflow-hidden">
          <div
            className={`h-full transition-[width] duration-300 ease-out ${
              job.status === 'completed' ? 'bg-emerald-600' : job.status === 'failed' ? 'bg-rose-600' : 'bg-[#0078d4]'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, job.progress ?? 0))}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-1 shrink-0">
        <span className={`text-[10px] font-mono ${statusColor}`}>
          {statusLabel}
        </span>
        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel(job.operationId)}
            className="text-[10px] px-1.5 py-0.5 border border-[#555] text-gray-400 hover:text-white hover:bg-[#094771]/40 hover:border-[#0078d4]/40"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Docked transfer queue — visible while jobs are queued, running, or recently finished. */
export default function FileTransferQueuePanel({ className = '' }: Props) {
  const [state, setState] = useState<FileTransferQueueState>({ queuedCount: 0, activeCount: 0, jobs: [] });
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    let tick: ReturnType<typeof setInterval> | undefined;

    (async () => {
      const { IPC } = await import('../lib/ipcBridge');
      if (!IPC.isNative || !alive) return;
      unsub = IPC.onFileTransferQueueChanged(setState);
      const initial = await IPC.getFileTransferQueue();
      if (alive) setState(initial);
    })();

    tick = setInterval(() => {
      setState(prev => ({ ...prev, jobs: [...prev.jobs] }));
    }, 5000);

    return () => {
      alive = false;
      unsub?.();
      if (tick) clearInterval(tick);
    };
  }, []);

  const active = isTransferActive(state);
  if (!active) return null;

  const jobs = visibleTransferJobs(state.jobs);
  const completedRecent = jobs.filter(j => j.status === 'completed').length;

  const handleCancel = async (operationId: string) => {
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.cancelFileTransfer(operationId);
  };

  return (
    <div className={`shrink-0 border-t border-[#454545] bg-[#252526] ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[#2a2a2a] border-b border-[#333]"
      >
        <Icons8Icon id="loading" size={12} spin={state.activeCount > 0} />
        <span className="text-[11px] font-semibold text-gray-200">
          Transfers
        </span>
        <span className="text-[10px] text-gray-500">
          {state.activeCount > 0 ? `${state.activeCount} active` : ''}
          {state.activeCount > 0 && state.queuedCount > 0 ? ' · ' : ''}
          {state.queuedCount > 0 ? `${state.queuedCount} queued` : ''}
          {completedRecent > 0 && state.activeCount === 0 && state.queuedCount === 0
            ? `${completedRecent} completed`
            : ''}
        </span>
        <Icons8Icon
          id="chevron_right"
          size={10}
          className={`ml-auto opacity-60 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="max-h-[200px] overflow-y-auto bndz-scrollbar px-3 py-1">
          {jobs.map(job => (
            <JobRow key={job.operationId} job={job} onCancel={handleCancel} />
          ))}
        </div>
      )}
    </div>
  );
}
