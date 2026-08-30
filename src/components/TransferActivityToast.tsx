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
 * Floating transfer loader — visible while copy/move/delete/empty-recycle run,
 * so background processing is never a silent minute-long wait.
 */
export default function TransferActivityToast() {
  const [queue, setQueue] = useState<FileTransferQueueState>(EMPTY_QUEUE);
  const [collapsed, setCollapsed] = useState(false);
  const [optimistic, setOptimistic] = useState<{ label: string; until: number } | null>(null);

  useEffect(() => {
    IPC.init();
    const unsub = IPC.onFileTransferQueueChanged((state: FileTransferQueueState) => {
      setQueue(state);
      if (isTransferActive(state)) setOptimistic(null);
    });
    const pull = () => {
      void IPC.getFileTransferQueue().then((state) => {
        if (state) setQueue(state);
      }).catch(() => {});
    };
    pull();
    // Always poll — do not gate on isTransferActive (that hid fast paste jobs forever
    // when a push was coalesced or dropped before the first paint).
    const poll = window.setInterval(pull, 450);
    const onOptimistic = (e: Event) => {
      const d = (e as CustomEvent<{ label?: string }>).detail;
      setOptimistic({
        label: d?.label || 'Transfer',
        until: Date.now() + 12_000,
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
  const pct = Math.max(0, Math.min(100, Math.round(primary?.progress ?? (showOptimistic ? 8 : 0))));
  const running = active.length > 0 || showOptimistic;

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
            <EmblemIcon id="state-sync" size={16} className="bndz-xfer-toast-spin" />
          ) : primary?.status === 'failed' ? (
            <EmblemIcon id="state-error" size={16} />
          ) : (
            <EmblemIcon id="state-ok" size={16} />
          )}
        </span>
        <span className="bndz-xfer-toast-title min-w-0 flex-1 truncate">
          {running
            ? (active.length > 1
              ? `${active.length} transfers`
              : (formatTransferAction(primary?.action || '') || optimistic?.label || 'Transfer'))
            : (primary?.status === 'failed' ? 'Transfer failed' : 'Transfer done')}
        </span>
        {running && (
          <span className="bndz-xfer-toast-pct tabular-nums">{pct}%</span>
        )}
        <span className="text-[10px] opacity-60">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="bndz-xfer-toast-body">
          {running && (
            <div className="bndz-xfer-toast-track" aria-hidden>
              <div className="bndz-xfer-toast-fill" style={{ width: `${Math.max(pct, 6)}%` }} />
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
