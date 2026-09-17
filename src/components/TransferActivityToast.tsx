import React, { useEffect, useState } from 'react';
import { EmblemIcon } from './EmblemIcon';
import { IPC, type FileTransferJobDto, type FileTransferQueueState } from '../lib/ipcBridge';
import {
  formatTransferAction,
  formatTransferProgressLine,
  isTransferActive,
  visibleTransferJobs,
} from '../lib/fileTransferQueue';

function jobIsActive(j: FileTransferJobDto): boolean {
  return j.status === 'queued' || j.status === 'running' || j.status === 'paused';
}

const EMPTY_QUEUE: FileTransferQueueState = { queuedCount: 0, activeCount: 0, jobs: [] };

/**
 * Floating transfer loader — push-first; light fallback poll only while idle.
 * Small ops should appear instantly via `bndz-transfer-started` and leave quickly.
 */
export default function TransferActivityToast() {
  const [queue, setQueue] = useState<FileTransferQueueState>(EMPTY_QUEUE);
  const [collapsed, setCollapsed] = useState(false);
  const [optimistic, setOptimistic] = useState<{ label: string; until: number } | null>(null);

  useEffect(() => {
    IPC.init();
    let poll = 0;
    let lastPushAt = Date.now();

    function pull() {
      void IPC.getFileTransferQueue().then((state) => {
        if (!state) return;
        setQueue(state);
        if (isTransferActive(state)) setOptimistic(null);
      }).catch(() => {});
    }

    const unsub = IPC.onFileTransferQueueChanged((state: FileTransferQueueState) => {
      lastPushAt = Date.now();
      setQueue(state);
      if (isTransferActive(state)) setOptimistic(null);
    });
    pull();
    // Fallback only: if pushes go quiet for 2.5s, soft-poll once per 2s (not 160ms hot loop).
    poll = window.setInterval(() => {
      if (Date.now() - lastPushAt > 2500) pull();
    }, 2000);

    const onOptimistic = (e: Event) => {
      const d = (e as CustomEvent<{ label?: string; op?: string }>).detail;
      const verb = d?.op === 'move' ? 'Moving' : d?.op === 'copy' ? 'Copying' : d?.op === 'delete' ? 'Deleting' : '';
      const label = d?.label || 'Transfer';
      setOptimistic({
        label: verb ? `${verb} ${label}` : label,
        until: Date.now() + 4_000,
      });
      pull();
    };
    window.addEventListener('bndz-transfer-started', onOptimistic as EventListener);
    return () => {
      unsub();
      window.clearInterval(poll);
      window.removeEventListener('bndz-transfer-started', onOptimistic as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!optimistic) return;
    const t = window.setTimeout(() => setOptimistic(null), Math.max(0, optimistic.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [optimistic]);

  const jobs = visibleTransferJobs(queue.jobs || []);
  const active = jobs.filter(jobIsActive);
  const recentDone = jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled').slice(0, 3);
  const showOptimistic = !!optimistic && active.length === 0 && recentDone.length === 0;
  const show = isTransferActive(queue) || active.length > 0 || recentDone.length > 0 || showOptimistic;

  if (!show) return null;

  const primary = active[0] || recentDone[0];
  const rawPct = Math.max(0, Math.min(100, Math.round(primary?.progress ?? (showOptimistic ? 12 : 0))));
  const isDelete = (primary?.action || '').toLowerCase() === 'delete' || (primary?.action || '').toLowerCase() === 'purge';
  const running = active.length > 0 || showOptimistic;
  // No fake 6% floor — small ops should not look mid-flight.
  const pct = running && rawPct <= 0 ? (showOptimistic ? 12 : 0) : rawPct;
  const showBar = running && !isDelete;

  return (
    <div
      className="bndz-xfer-toast"
      role="status"
      aria-live="polite"
      data-collapsed={collapsed ? '1' : '0'}
    >
      <button
        type="button"
        className="bndz-xfer-toast-header"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="bndz-xfer-toast-orb" aria-hidden>
          {running ? (
            <EmblemIcon id="state-sync" size={13} className="bndz-xfer-toast-spin" />
          ) : primary?.status === 'failed' ? (
            <EmblemIcon id="state-error" size={13} />
          ) : (
            <EmblemIcon id="state-ok" size={13} />
          )}
        </span>
        <span className="bndz-xfer-toast-title min-w-0 flex-1 truncate">
          {running
            ? (active.length > 1
              ? `${active.length} transfers`
              : (formatTransferAction(primary?.action || '') || optimistic?.label || 'Transfer'))
            : (primary?.status === 'failed' ? 'Transfer failed' : 'Transfer done')}
        </span>
        {running && showBar && (
          <span className="bndz-xfer-toast-pct tabular-nums">{pct}%</span>
        )}
        <span className="text-[10px] opacity-60">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="bndz-xfer-toast-body">
          {showBar && (
            <div className="bndz-xfer-toast-track" aria-hidden>
              <div className="bndz-xfer-toast-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
          )}
          <div className="bndz-xfer-toast-line truncate">
            {primary
              ? (formatTransferProgressLine(primary) || primary.label || primary.currentFile || 'Working…')
              : (optimistic?.label || 'Working…')}
          </div>
          {active.length > 1 && (
            <div className="bndz-xfer-toast-more">
              +{active.length - 1} more in queue
            </div>
          )}
          {running && primary?.operationId && (
            <button
              type="button"
              className="bndz-xfer-toast-cancel"
              onClick={() => void IPC.cancelFileTransfer(primary.operationId!)}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
