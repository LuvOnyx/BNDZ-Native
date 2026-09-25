import React, { useEffect, useRef, useState } from 'react';
import { EmblemIcon } from './EmblemIcon';
import { IPC, type FileTransferJobDto, type FileTransferQueueState } from '../lib/ipcBridge';
import { useAppConfig } from '../data/configContext';
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

function osTransferToastsEnabled(config: Record<string, unknown>): boolean {
  const raw = String(config.toastDelivery || '').toLowerCase();
  if (raw === 'inapp' || raw === 'in-app') return false;
  if (config.nativeActionCenterToasts === false || config.useNativeWindowsNotifications === false) return false;
  const cats = (config.windowsNotificationCategories || {}) as { transfers?: boolean };
  if (cats.transfers === false) return false;
  return true;
}

/**
 * Floating transfer loader -- push-first; light fallback poll only while idle.
 * Small ops should appear instantly via `bndz-transfer-started` and leave quickly.
 */
export default function TransferActivityToast() {
  const { config } = useAppConfig();
  const [queue, setQueue] = useState<FileTransferQueueState>(EMPTY_QUEUE);
  const [collapsed, setCollapsed] = useState(false);
  const [optimistic, setOptimistic] = useState<{ label: string; until: number } | null>(null);
  const osGate = useRef({ posted: false, lastAt: 0, lastKey: '' });

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
      const label = d?.label || 'Transfer';
      const isRename = /^rename:/i.test(label);
      const verb = isRename
        ? 'Renaming'
        : d?.op === 'move' ? 'Moving'
        : d?.op === 'copy' ? 'Copying'
        : d?.op === 'delete' ? 'Deleting'
        : '';
      setOptimistic({
        label: verb ? (isRename ? label.replace(/^Rename:\s*/i, 'Renaming ') : `${verb} ${label}`) : label,
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

  // Tick while recent terminal jobs are visible so the toast drops without waiting for the idle poll.
  const [, setTick] = useState(0);
  useEffect(() => {
    const jobs = queue.jobs || [];
    const needsTick = jobs.some(j =>
      j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled',
    ) || !!optimistic;
    if (!needsTick) return;
    const id = window.setInterval(() => setTick(n => n + 1), 400);
    return () => window.clearInterval(id);
  }, [queue.jobs, optimistic]);

  const jobs = visibleTransferJobs(queue.jobs || []);
  const active = jobs.filter(jobIsActive);
  const recentDone = jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled').slice(0, 3);
  const showOptimistic = !!optimistic && active.length === 0 && recentDone.length === 0;
  const show = isTransferActive(queue) || active.length > 0 || recentDone.length > 0 || showOptimistic;

  useEffect(() => {
    if (!IPC.isNative) return;
    const enabled = osTransferToastsEnabled(config as Record<string, unknown>);
    const live = active;
    const doneJob = live.length ? undefined : recentDone[0];
    const clear = () => {
      if (!osGate.current.posted) return;
      osGate.current.posted = false;
      osGate.current.lastKey = '';
      IPC.showAppNotification('BNDZ', '', 'bndz-xfer', { transferPhase: 'clear' });
    };
    if (!enabled || (!live.length && !doneJob)) {
      clear();
      return;
    }
    const job = (live[0] || doneJob)!;
    const phase = live.length
      ? 'update'
      : job.status === 'failed' ? 'failed' : 'complete';
    const rawPct = Math.max(0, Math.min(100, Math.round(job.progress ?? 0)));
    const title = live.length > 1
      ? `${live.length} transfers`
      : (formatTransferAction(job.action || '') || 'Transfer');
    const detail = formatTransferProgressLine(job) || job.currentFile || job.label || title;
    const key = `${phase}|${job.operationId}|${rawPct}|${job.status}|${detail}`;
    const now = Date.now();
    if (key === osGate.current.lastKey) return;
    if (phase === 'update' && osGate.current.posted && now - osGate.current.lastAt < 400) return;
    osGate.current.lastKey = key;
    osGate.current.lastAt = now;
    osGate.current.posted = true;
    IPC.showAppNotification(title, detail, 'bndz-xfer', {
      transferPhase: phase,
      progress: phase === 'complete' ? 100 : rawPct,
      progressTitle: job.currentFile || job.label || title,
      progressStatus: phase === 'failed' ? 'Failed' : phase === 'complete' ? 'Done' : title,
      progressValue: detail,
    });
  }, [config, active, recentDone]);

  if (!show) return null;

  const primary = active[0] || recentDone[0];
  const rawPct = Math.max(0, Math.min(100, Math.round(primary?.progress ?? (showOptimistic ? 12 : 0))));
  const isDelete = (primary?.action || '').toLowerCase() === 'delete' || (primary?.action || '').toLowerCase() === 'purge';
  const running = active.length > 0 || showOptimistic;
  const pct = running && rawPct <= 0 ? (showOptimistic ? 12 : 0) : rawPct;
  const showBar = running && !isDelete;
  const indeterminate = showBar && pct <= 0;
  const stats = primary ? formatTransferProgressLine(primary) : '';
  const nameLine = primary
    ? (primary.currentFile || primary.label || formatTransferProgressLine(primary, false) || 'Working')
    : (optimistic?.label || 'Working');
  const state = running ? 'running' : primary?.status === 'failed' ? 'failed' : 'done';
  const title = running
    ? (active.length > 1
      ? `${active.length} transfers`
      : (formatTransferAction(primary?.action || '') || optimistic?.label || 'Transfer'))
    : (primary?.status === 'failed' ? 'Transfer failed' : 'Transfer done');

  return (
    <div
      className="bndz-xfer-toast"
      role="status"
      aria-live="polite"
      data-collapsed={collapsed ? '1' : '0'}
      data-state={state}
    >
      <button
        type="button"
        className="bndz-xfer-toast-header"
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="bndz-xfer-toast-orb" aria-hidden>
          {running ? (
            <EmblemIcon id="state-sync" size={14} className="bndz-xfer-toast-spin" />
          ) : primary?.status === 'failed' ? (
            <EmblemIcon id="state-error" size={14} />
          ) : (
            <EmblemIcon id="state-ok" size={14} />
          )}
        </span>
        <span className="bndz-xfer-toast-title min-w-0 flex-1 truncate">
          {title}
        </span>
        {running && showBar && !indeterminate && (
          <span className="bndz-xfer-toast-pct tabular-nums">{pct}%</span>
        )}
        <span className="bndz-xfer-toast-chevron" aria-hidden>{collapsed ? '\u25B8' : '\u25BE'}</span>
      </button>

      {showBar && (
        <div className={`bndz-xfer-toast-track${indeterminate ? ' is-indeterminate' : ''}`} aria-hidden>
          <div
            className="bndz-xfer-toast-fill"
            style={indeterminate ? undefined : { width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      )}

      {!collapsed && (
        <div className="bndz-xfer-toast-body">
          <div className="bndz-xfer-toast-line truncate" title={nameLine}>
            {nameLine}
          </div>
          {stats && stats !== nameLine && (
            <div className="bndz-xfer-toast-stats truncate">{stats}</div>
          )}
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
