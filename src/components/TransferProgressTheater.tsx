/**
 * TransferProgressTheater — floating progress HUD for long-running file transfers.
 * Appears automatically when any transfer is active; self-manages IPC subscription.
 * Anchored bottom-right above the plugin panel.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IPC, type FileTransferJobDto } from '../lib/ipcBridge';
import {
  formatTransferAction,
  formatTransferBytes,
  formatTransferSpeed,
  formatTransferEta,
} from '../lib/fileTransferQueue';

// Only show the theater for transfers that have substantial size or have been running >3s.
const THEATER_SIZE_THRESHOLD = 8 * 1024 * 1024; // 8 MB
const THEATER_ELAPSED_MS = 3_000;

function getActionVerb(action: string) {
  switch ((action || '').toLowerCase()) {
    case 'copy': return 'Copying';
    case 'move': return 'Moving';
    case 'delete': return 'Deleting';
    case 'extract': return 'Extracting';
    case 'archive': return 'Archiving';
    case 'sync': return 'Syncing';
    case 'undo': return 'Undoing';
    case 'redo': return 'Redoing';
    default: return formatTransferAction(action) || 'Processing';
  }
}

function getAccentColor(action: string): [string, string] {
  switch ((action || '').toLowerCase()) {
    case 'delete': return ['#ff6b6b', '#ff4444'];
    case 'move': return ['#b48fff', '#8b5cf6'];
    case 'extract': return ['#5bf0e0', '#22d3ee'];
    case 'archive': return ['#fbbf24', '#f59e0b'];
    case 'undo':
    case 'redo': return ['#a78bfa', '#7c3aed'];
    case 'copy':
    default: return ['#c084fc', '#a855f7'];
  }
}

function isJobTheaterWorthy(job: FileTransferJobDto): boolean {
  if (job.status !== 'running' && job.status !== 'queued') return false;
  if (job.totalBytes != null && job.totalBytes > THEATER_SIZE_THRESHOLD) return true;
  if (job.startedUtc) {
    const elapsed = Date.now() - Date.parse(job.startedUtc);
    if (!Number.isNaN(elapsed) && elapsed > THEATER_ELAPSED_MS) return true;
  }
  // Always show for multi-item operations
  if (job.itemsTotal != null && job.itemsTotal > 5) return true;
  return false;
}

function shortenPath(p?: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

function JobTheaterCard({
  job,
  extra,
  onCancel,
  onPause,
  onResume,
  onDismiss,
}: {
  job: FileTransferJobDto;
  extra: number;
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDismiss: () => void;
}) {
  const [accentA, accentB] = getAccentColor(job.action);
  const pct = Math.min(100, Math.max(0, job.progress || 0));
  const verb = getActionVerb(job.action);
  const speed = formatTransferSpeed(job.speedBytesPerSecond);
  const eta = formatTransferEta(job.etaSeconds);
  const fileName = shortenPath(job.currentFile) || shortenPath(job.destinationPath) || job.label;
  const byteInfo = job.bytesTransferred != null && job.totalBytes != null && job.totalBytes > 0
    ? `${formatTransferBytes(job.bytesTransferred)} / ${formatTransferBytes(job.totalBytes)}`
    : job.itemsCompleted != null && job.itemsTotal != null && job.itemsTotal > 0
      ? `${job.itemsCompleted} / ${job.itemsTotal} items`
      : '';

  const canPause = job.status === 'running';
  const canResume = job.status === 'paused';
  const canCancel = job.status === 'running' || job.status === 'queued' || job.status === 'paused';
  const isDone = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';

  return (
    <div
      className="relative overflow-hidden select-none"
      style={{
        width: 300,
        borderRadius: 14,
        background: 'linear-gradient(160deg, #1a1a24 0%, #12121a 100%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)',
        backdropFilter: 'blur(18px)',
      }}
    >
      {/* Accent glow behind the card */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 0%, ${accentA}18 0%, transparent 70%)`,
        }}
      />

      {/* Top strip progress rail */}
      <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[14px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${accentA}, ${accentB})`,
            boxShadow: `0 0 8px ${accentA}88`,
          }}
        />
      </div>

      <div className="px-4 pt-4 pb-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[10.5px] font-bold uppercase tracking-widest"
                style={{ color: accentA, letterSpacing: '0.12em' }}
              >
                {isDone ? (job.status === 'failed' ? 'Failed' : job.status === 'cancelled' ? 'Cancelled' : 'Done') : verb}
              </span>
              {extra > 0 && (
                <span
                  className="inline-flex items-center justify-center text-[9px] font-bold px-1.5 min-w-[18px] h-[18px]"
                  style={{ borderRadius: 7, background: 'rgba(255,255,255,0.08)', color: 'rgba(200,200,220,0.7)' }}
                >
                  +{extra}
                </span>
              )}
            </div>
            <div
              className="text-[12px] font-medium mt-0.5 truncate"
              style={{ color: '#d8d8e8', maxWidth: 200 }}
              title={fileName}
            >
              {fileName || job.label}
            </div>
          </div>

          {/* Close / dismiss */}
          <button
            className="shrink-0 w-6 h-6 flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity"
            style={{ borderRadius: 7, background: 'rgba(255,255,255,0.06)' }}
            onClick={onDismiss}
            title="Dismiss"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        {!isDone && (
          <div className="mb-2 relative h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <div
              className="h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${accentA}cc, ${accentB})`,
              }}
            >
              {/* shimmer effect */}
              <div
                className="absolute inset-y-0 w-1/3"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                  animation: 'theater-shimmer 1.8s ease-in-out infinite',
                }}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {byteInfo && (
              <span className="text-[10px]" style={{ color: 'rgba(170,170,190,0.7)' }}>{byteInfo}</span>
            )}
            {speed && !isDone && (
              <span className="text-[10px]" style={{ color: accentA + 'bb' }}>{speed}</span>
            )}
            {eta && !isDone && (
              <span className="text-[10px]" style={{ color: 'rgba(150,150,170,0.6)' }}>{eta}</span>
            )}
            {pct > 0 && !isDone && (
              <span className="text-[10px] ml-auto font-mono" style={{ color: 'rgba(180,180,200,0.5)' }}>{pct}%</span>
            )}
          </div>

          {/* Controls */}
          {!isDone && (
            <div className="flex items-center gap-1 ml-2 shrink-0">
              {canPause && (
                <button
                  className="w-6 h-6 flex items-center justify-center rounded-[5px] opacity-50 hover:opacity-90 transition-opacity"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                  onClick={() => onPause(job.operationId)}
                  title="Pause"
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <rect x="1.5" y="1" width="2" height="7" rx="0.75" fill="currentColor" />
                    <rect x="5.5" y="1" width="2" height="7" rx="0.75" fill="currentColor" />
                  </svg>
                </button>
              )}
              {canResume && (
                <button
                  className="w-6 h-6 flex items-center justify-center rounded-[5px] opacity-50 hover:opacity-90 transition-opacity"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                  onClick={() => onResume(job.operationId)}
                  title="Resume"
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <path d="M2 1.5l5.5 3L2 7.5V1.5z" fill="currentColor" />
                  </svg>
                </button>
              )}
              {canCancel && (
                <button
                  className="w-6 h-6 flex items-center justify-center rounded-[5px] opacity-40 hover:opacity-80 hover:text-rose-300 transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)' }}
                  onClick={() => onCancel(job.operationId)}
                  title="Cancel"
                >
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error message */}
        {job.status === 'failed' && job.error && (
          <div
            className="mt-2 text-[10px] rounded-[6px] px-2 py-1.5 truncate"
            style={{ background: 'rgba(255,80,80,0.1)', color: 'rgb(255,120,120)', border: '1px solid rgba(255,80,80,0.2)' }}
            title={job.error}
          >
            {job.error}
          </div>
        )}
      </div>
    </div>
  );
}

const THEATER_DISMISSED_KEY = 'bndz-theater-dismissed-ops';

export default function TransferProgressTheater() {
  const [jobs, setJobs] = useState<FileTransferJobDto[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!IPC.isNative) return;
    const unsub = IPC.onFileTransferQueueChanged(state => {
      const worthy = state.jobs.filter(j => isJobTheaterWorthy(j));
      // Clear dismissed set when jobs are fully gone
      if (worthy.length === 0 && state.jobs.every(j => j.status === 'completed' || j.status === 'cancelled' || j.status === 'failed')) {
        dismissedRef.current = new Set();
        setDismissed(new Set());
      }
      const visible = worthy.filter(j => !dismissedRef.current.has(j.operationId));
      setJobs(visible);
      setVisible(visible.length > 0);
    });
    return unsub;
  }, []);

  const handleDismiss = useCallback((opId: string) => {
    dismissedRef.current = new Set([...dismissedRef.current, opId]);
    setDismissed(prev => new Set([...prev, opId]));
    setJobs(prev => prev.filter(j => j.operationId !== opId));
  }, []);

  const handleCancel = useCallback((opId: string) => {
    IPC.cancelFileTransfer(opId).catch(() => {});
    handleDismiss(opId);
  }, [handleDismiss]);

  const handlePause = useCallback((opId: string) => {
    IPC.pauseFileTransfer(opId).catch(() => {});
  }, []);

  const handleResume = useCallback((opId: string) => {
    IPC.resumeFileTransfer(opId).catch(() => {});
  }, []);

  if (!visible || jobs.length === 0) return null;

  // Show primary job + count badge for extras
  const primary = jobs[0];
  const extra = jobs.length - 1;

  return (
    <>
      {/* Keyframe for shimmer animation */}
      <style>{`
        @keyframes theater-shimmer {
          0% { transform: translateX(-100%); }
          60% { transform: translateX(300%); }
          100% { transform: translateX(300%); }
        }
        @keyframes theater-slide-up {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        className="fixed z-[9999] pointer-events-none"
        style={{ bottom: 58, right: 12 }}
      >
        <div
          className="pointer-events-auto"
          style={{ animation: 'theater-slide-up 0.22s cubic-bezier(0.22,1,0.36,1) forwards' }}
        >
          <JobTheaterCard
            job={primary}
            extra={extra}
            onCancel={handleCancel}
            onPause={handlePause}
            onResume={handleResume}
            onDismiss={() => handleDismiss(primary.operationId)}
          />
        </div>
      </div>
    </>
  );
}
