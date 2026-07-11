import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { FileTransferJobDto, FileTransferQueueState } from '../lib/ipcBridge';
import {
  formatTransferAction,
  formatTransferCategory,
  formatTransferDestination,
  formatTransferProgressLine,
  isTransferActive,
  visibleTransferJobs,
} from '../lib/fileTransferQueue';

type Props = {
  className?: string;
  enabled?: boolean;
};

function JobRow({
  job,
  onCancel,
  errorExpanded,
  onToggleError,
}: {
  job: FileTransferJobDto;
  onCancel: (id: string) => void;
  errorExpanded: boolean;
  onToggleError: () => void;
}) {
  const canCancel = job.status === 'queued' || job.status === 'running';
  const engineLabel = job.engine === 'native' ? 'Windows' : job.engine === 'teracopy' ? 'TeraCopy' : 'BNDZ';
  const progressLine = formatTransferProgressLine(job);
  const destination = formatTransferDestination(job);
  const statusColor =
    job.status === 'failed' ? 'text-rose-300'
    : job.status === 'completed' ? 'text-emerald-300'
    : job.status === 'cancelled' ? 'text-gray-500'
    : 'text-[#99c9f0]';

  const statusLabel =
    job.status === 'running' || job.status === 'queued'
      ? ((job.progress ?? 0) >= 100 ? 'Finishing…' : `${job.progress ?? 0}%`)
    : job.status === 'completed' ? 'Done'
    : job.status;

  const progressClass =
    job.status === 'completed' ? 'is-complete'
    : job.status === 'failed' ? 'is-failed'
    : '';

  return (
    <div className="bndz-transfer-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {job.status === 'completed' && (
            <Icons8Icon id="check" size={10} className="text-emerald-400 shrink-0" />
          )}
          <span className="text-[11px] font-medium text-gray-100 truncate">{job.label}</span>
          <span className="text-[9px] uppercase tracking-wide text-gray-500 shrink-0">
            {formatTransferAction(job.action)}
          </span>
          {job.category && job.category !== 'fs' && (
            <span className="text-[9px] px-1 py-px border bndz-transfer-category shrink-0">
              {formatTransferCategory(job.category)}
            </span>
          )}
          {job.priority === 'high' && (
            <span className="text-[9px] uppercase tracking-wide bndz-transfer-priority-high shrink-0">High</span>
          )}
          <span className="text-[9px] px-1 py-px border bndz-transfer-category shrink-0">
            {engineLabel}
          </span>
        </div>
        {destination && (
          <div className="text-[10px] text-[#7eb8e8]/90 truncate mt-0.5 font-mono" title={destination}>
            → {destination}
          </div>
        )}
        {job.currentFile && job.status === 'running' && (
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-mono">{job.currentFile}</div>
        )}
        {progressLine && (job.status === 'running' || job.status === 'queued') && (
          <div className="text-[10px] text-gray-500 mt-0.5 font-mono tabular-nums">{progressLine}</div>
        )}
        {job.error && (
          <div className="mt-0.5">
            <button
              type="button"
              onClick={onToggleError}
              className={`text-left text-[10px] text-rose-300/90 hover:text-rose-200 ${errorExpanded ? 'whitespace-pre-wrap break-words' : 'truncate block w-full'}`}
              title={errorExpanded ? 'Collapse error' : 'Expand error'}
            >
              {job.error}
            </button>
          </div>
        )}
        <div className="bndz-transfer-progress-track mt-1.5 h-1 overflow-hidden">
          <div
            className={`bndz-transfer-progress-fill h-full transition-[width] duration-300 ease-out ${progressClass}`}
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
export default function FileTransferQueuePanel({ className = '', enabled = true }: Props) {
  const [state, setState] = useState<FileTransferQueueState>({ queuedCount: 0, activeCount: 0, jobs: [] });
  const [expanded, setExpanded] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!enabled) return;
    let unsub: (() => void) | undefined;
    let unsubProgress: (() => void) | undefined;
    let alive = true;
    let tick: ReturnType<typeof setInterval> | undefined;
    let progressPoll: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const { IPC } = await import('../lib/ipcBridge');
      if (!IPC.isNative || !alive) return;
      const refresh = async () => {
        const initial = await IPC.getFileTransferQueue();
        if (alive) setState(initial);
      };
      unsub = IPC.onFileTransferQueueChanged(setState);
      unsubProgress = IPC.onProgress((payload: { percentage?: number; operationId?: string }) => {
        if ((payload?.percentage ?? 0) >= 100) {
          if (progressPoll) clearTimeout(progressPoll);
          progressPoll = setTimeout(() => { void refresh(); }, 250);
        }
      });
      await refresh();
    })();

    tick = setInterval(() => {
      setState(prev => {
        const hasStuck = prev.jobs.some(j =>
          j.status === 'running' && (j.progress ?? 0) >= 100
        );
        if (hasStuck) {
          void import('../lib/ipcBridge').then(({ IPC }) => IPC.getFileTransferQueue().then(next => {
            if (alive) setState(next);
          }));
        }
        return { ...prev, jobs: [...prev.jobs] };
      });
    }, 2000);

    return () => {
      alive = false;
      unsub?.();
      unsubProgress?.();
      if (tick) clearInterval(tick);
      if (progressPoll) clearTimeout(progressPoll);
    };
  }, [enabled]);

  if (!enabled) return null;

  const active = isTransferActive(state);
  if (!active) return null;

  const jobs = visibleTransferJobs(state.jobs);
  const completedRecent = jobs.filter(j => j.status === 'completed').length;
  const failedRecent = jobs.filter(j => j.status === 'failed').length;
  const hasFinished = jobs.some(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');

  const handleCancel = async (operationId: string) => {
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.cancelFileTransfer(operationId);
  };

  const handleClearFinished = async () => {
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.clearFileTransferHistory();
    setExpandedErrors({});
  };

  return (
    <div className={`bndz-transfer-panel shrink-0 ${className}`}>
      <div className="bndz-transfer-header w-full flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icons8Icon id="loading" size={12} spin={state.activeCount > 0} />
          <span className="text-[11px] font-semibold text-gray-200">
            Transfers
          </span>
          <span className="text-[10px] text-gray-500 truncate">
            {state.activeCount > 0 ? `${state.activeCount} active` : ''}
            {state.activeCount > 0 && state.queuedCount > 0 ? ' · ' : ''}
            {state.queuedCount > 0 ? `${state.queuedCount} queued` : ''}
            {completedRecent > 0 && state.activeCount === 0 && state.queuedCount === 0
              ? `${completedRecent} completed`
              : ''}
            {failedRecent > 0 ? `${state.activeCount === 0 && state.queuedCount === 0 ? '' : ' · '}${failedRecent} failed` : ''}
          </span>
          <Icons8Icon
            id="chevron_right"
            size={10}
            className={`ml-auto opacity-60 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        {hasFinished && state.activeCount === 0 && (
          <button
            type="button"
            onClick={() => void handleClearFinished()}
            className="text-[10px] px-1.5 py-0.5 border border-[#555] text-gray-400 hover:text-white hover:bg-[#094771]/40 shrink-0"
            title="Clear completed and failed transfers"
          >
            Clear
          </button>
        )}
      </div>
      {expanded && (
        <div className="max-h-[200px] overflow-y-auto bndz-scrollbar px-3 py-1">
          {jobs.map(job => (
            <JobRow
              key={job.operationId}
              job={job}
              onCancel={handleCancel}
              errorExpanded={!!expandedErrors[job.operationId]}
              onToggleError={() => setExpandedErrors(prev => ({
                ...prev,
                [job.operationId]: !prev[job.operationId],
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
