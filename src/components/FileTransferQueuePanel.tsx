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
  cancelling,
  errorExpanded,
  onToggleError,
}: {
  job: FileTransferJobDto;
  onCancel: (id: string) => void;
  cancelling: boolean;
  errorExpanded: boolean;
  onToggleError: () => void;
}) {
  const canCancel = (job.status === 'queued' || job.status === 'running') && !cancelling;
  const engineLabel = job.engine === 'native' ? 'Windows' : job.engine === 'teracopy' ? 'TeraCopy' : 'BNDZ';
  const progressLine = formatTransferProgressLine(job);
  const destination = formatTransferDestination(job);

  const statusColor =
    job.status === 'failed' ? 'text-rose-300'
    : job.status === 'completed' ? 'text-emerald-300'
    : job.status === 'cancelled' || cancelling ? 'text-amber-300/90'
    : 'text-[#99c9f0]';

  const statusLabel = cancelling
    ? 'Cancelling…'
    : job.status === 'running' || job.status === 'queued'
      ? `${Math.min(99, job.progress ?? 0)}%`
    : job.status === 'completed' ? 'Done'
    : job.status === 'cancelled' ? 'Cancelled'
    : job.status === 'failed' ? 'Failed'
    : job.status;

  const progressClass =
    job.status === 'completed' ? 'is-complete'
    : job.status === 'failed' ? 'is-failed'
    : job.status === 'cancelled' || cancelling ? 'is-cancelled'
    : '';

  const barWidth = cancelling
    ? Math.min(99, job.progress ?? 0)
    : job.status === 'completed'
      ? 100
      : Math.max(0, Math.min(job.status === 'running' ? 99 : 100, job.progress ?? 0));

  return (
    <div className="bndz-transfer-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {job.status === 'completed' && (
            <Icons8Icon id="check" size={10} className="text-emerald-400 shrink-0" />
          )}
          {(job.status === 'cancelled' || cancelling) && (
            <Icons8Icon id="close" size={10} className="text-amber-300/80 shrink-0" />
          )}
          <span className="text-[11px] font-medium text-gray-100 truncate">{job.label}</span>
          <span className="bndz-transfer-chip shrink-0">{formatTransferAction(job.action)}</span>
          {job.category && job.category !== 'fs' && (
            <span className="bndz-transfer-chip shrink-0">{formatTransferCategory(job.category)}</span>
          )}
          {job.priority === 'high' && (
            <span className="bndz-transfer-chip bndz-transfer-chip--high shrink-0">High</span>
          )}
          <span className="bndz-transfer-chip shrink-0">{engineLabel}</span>
        </div>
        {destination && (
          <div className="text-[10px] text-[#7eb8e8]/90 truncate mt-0.5 font-mono" title={destination}>
            → {destination}
          </div>
        )}
        {job.currentFile && (job.status === 'running' || cancelling) && (
          <div className="text-[10px] text-gray-500 truncate mt-0.5 font-mono">{job.currentFile}</div>
        )}
        {progressLine && (job.status === 'running' || job.status === 'queued') && !cancelling && (
          <div className="text-[10px] text-gray-500 mt-0.5 font-mono tabular-nums">{progressLine}</div>
        )}
        {job.error && job.status !== 'cancelled' && (
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
        <div className="bndz-transfer-progress-track mt-1.5">
          <div
            className={`bndz-transfer-progress-fill ${progressClass}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-1.5 shrink-0">
        <span className={`text-[10px] font-mono tabular-nums ${statusColor}`}>
          {statusLabel}
        </span>
        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel(job.operationId)}
            className="bndz-transfer-cancel-btn"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Docked transfer queue — real cancel + soft-squircle chrome. */
export default function FileTransferQueuePanel({ className = '', enabled = true }: Props) {
  const [state, setState] = useState<FileTransferQueueState>({ queuedCount: 0, activeCount: 0, jobs: [] });
  const [expanded, setExpanded] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});
  const [cancellingIds, setCancellingIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!enabled) return;
    let unsub: (() => void) | undefined;
    let unsubProgress: (() => void) | undefined;
    let alive = true;
    let progressPoll: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const { IPC } = await import('../lib/ipcBridge');
      if (!IPC.isNative || !alive) return;
      const refresh = async () => {
        const initial = await IPC.getFileTransferQueue();
        if (alive) setState(initial);
      };
      unsub = IPC.onFileTransferQueueChanged(next => {
        setState(next);
        setCancellingIds(prev => {
          const nextMap = { ...prev };
          let changed = false;
          for (const id of Object.keys(nextMap)) {
            const job = next.jobs.find(j => j.operationId === id);
            if (!job || job.status === 'cancelled' || job.status === 'failed' || job.status === 'completed') {
              delete nextMap[id];
              changed = true;
            }
          }
          return changed ? nextMap : prev;
        });
      });
      unsubProgress = IPC.onProgress((payload: { percentage?: number; operationId?: string }) => {
        if ((payload?.percentage ?? 0) >= 100) {
          if (progressPoll) clearTimeout(progressPoll);
          progressPoll = setTimeout(() => { void refresh(); }, 200);
        }
      });
      await refresh();
    })();

    return () => {
      alive = false;
      unsub?.();
      unsubProgress?.();
      if (progressPoll) clearTimeout(progressPoll);
    };
  }, [enabled]);

  if (!enabled) return null;

  const active = isTransferActive(state);
  if (!active) return null;

  const jobs = visibleTransferJobs(state.jobs);
  const completedRecent = jobs.filter(j => j.status === 'completed').length;
  const failedRecent = jobs.filter(j => j.status === 'failed').length;
  const cancelledRecent = jobs.filter(j => j.status === 'cancelled').length;
  const hasFinished = jobs.some(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');

  const handleCancel = async (operationId: string) => {
    setCancellingIds(prev => ({ ...prev, [operationId]: true }));
    const { IPC } = await import('../lib/ipcBridge');
    try {
      await IPC.cancelFileTransfer(operationId);
      const next = await IPC.getFileTransferQueue();
      setState(next);
    } catch {
      setCancellingIds(prev => {
        const n = { ...prev };
        delete n[operationId];
        return n;
      });
    }
  };

  const handleClearFinished = async () => {
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.clearFileTransferHistory();
    setExpandedErrors({});
    setCancellingIds({});
  };

  const summaryParts: string[] = [];
  if (state.activeCount > 0) summaryParts.push(`${state.activeCount} active`);
  if (state.queuedCount > 0) summaryParts.push(`${state.queuedCount} queued`);
  if (state.activeCount === 0 && state.queuedCount === 0 && completedRecent > 0) summaryParts.push(`${completedRecent} done`);
  if (failedRecent > 0) summaryParts.push(`${failedRecent} failed`);
  if (cancelledRecent > 0 && state.activeCount === 0) summaryParts.push(`${cancelledRecent} cancelled`);

  return (
    <div className={`bndz-transfer-panel shrink-0 ${className}`}>
      <div className="bndz-transfer-header w-full flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <Icons8Icon id="loading" size={12} spin={state.activeCount > 0} />
          <span className="text-[11px] font-semibold text-gray-200 tracking-wide">
            Background processing
          </span>
          <span className="text-[10px] text-gray-500 truncate">
            {summaryParts.join(' · ')}
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
            className="bndz-transfer-clear-btn shrink-0"
            title="Clear finished transfers"
          >
            Clear
          </button>
        )}
      </div>
      {expanded && (
        <div className="max-h-[220px] overflow-y-auto bndz-scrollbar px-3 py-1.5">
          {jobs.map(job => (
            <JobRow
              key={job.operationId}
              job={job}
              onCancel={id => void handleCancel(id)}
              cancelling={!!cancellingIds[job.operationId]}
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
