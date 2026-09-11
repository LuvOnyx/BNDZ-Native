import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';

type Session = {
  sessionId?: string;
  id?: string;
  role?: string;
  state?: string;
  label?: string;
  totalBytes?: number;
  transferredBytes?: number;
  speedBytesPerSecond?: number;
  fileCount?: number;
  filesCompleted?: number;
  error?: string;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function ThroughputRing({ pct, speedBps }: { pct: number; speedBps: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className="bndz-meshdrop-ring relative w-11 h-11 shrink-0" title={`${clamped.toFixed(0)}% · ${formatBytes(speedBps)}/s`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="block -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(34,211,238,0.15)" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="url(#bndzMeshDropRing)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className="transition-[stroke-dasharray] duration-300"
        />
        <defs>
          <linearGradient id="bndzMeshDropRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#c4a35a" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-cyan-200/90">
        {clamped >= 99 ? '✓' : `${Math.round(clamped)}`}
      </span>
    </div>
  );
}

function normalizeSession(raw: Record<string, unknown>): Session {
  return {
    sessionId: String(raw.sessionId ?? raw.SessionId ?? raw.id ?? ''),
    id: String(raw.sessionId ?? raw.SessionId ?? raw.id ?? ''),
    role: String(raw.role ?? raw.Role ?? ''),
    state: String(raw.state ?? raw.State ?? '').toLowerCase(),
    label: raw.label != null ? String(raw.label) : (raw.Label != null ? String(raw.Label) : undefined),
    totalBytes: Number(raw.totalBytes ?? raw.TotalBytes ?? 0),
    transferredBytes: Number(raw.transferredBytes ?? raw.TransferredBytes ?? 0),
    speedBytesPerSecond: Number(raw.speedBytesPerSecond ?? raw.SpeedBytesPerSecond ?? 0),
    fileCount: Number(raw.fileCount ?? raw.FileCount ?? 0),
    filesCompleted: Number(raw.filesCompleted ?? raw.FilesCompleted ?? 0),
    error: raw.error != null ? String(raw.error) : (raw.Error != null ? String(raw.Error) : undefined),
  };
}

export default function MeshDropSessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    const r = await IPC.meshDropListSessions();
    const list = Array.isArray(r.sessions) ? r.sessions : [];
    setSessions(list.map((s: Record<string, unknown>) => normalizeSession(s)));
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'object') {
        const next = normalizeSession(detail as Record<string, unknown>);
        if (next.sessionId) {
          setSessions(prev => {
            const i = prev.findIndex(s => s.sessionId === next.sessionId);
            if (i < 0) return [next, ...prev];
            const copy = prev.slice();
            copy[i] = { ...copy[i], ...next };
            return copy;
          });
        }
      }
      void refresh();
    };
    window.addEventListener('bndz-mesh-drop-session', onChange);
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => {
      window.removeEventListener('bndz-mesh-drop-session', onChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const active = useMemo(
    () => sessions.filter(s => s.state && !['completed', 'cancelled', 'failed'].includes(s.state)),
    [sessions],
  );

  return (
    <div
      className="bndz-meshdrop-sessions px-3 py-2 border-b border-white/[0.06]"
      data-mesh-drop-inbox="1"
      title="Drop files here to start a Mesh Drop"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <EmblemIcon id="share-check" size={12} />
        <div className="text-[10px] uppercase tracking-wider text-cyan-300/80">
          {active.length ? 'Mesh Drop sessions' : 'Mesh Drop inbox'}
        </div>
        {!active.length && (
          <span className="text-[10px] text-gray-500 truncate">Drop files to pair &amp; stream</span>
        )}
      </div>
      {active.map(s => {
        const id = s.sessionId || s.id || '';
        const moved = s.transferredBytes || 0;
        const total = s.totalBytes || 0;
        const speed = s.speedBytesPerSecond || 0;
        const pct = total > 0 ? (moved / total) * 100 : (s.state === 'transferring' ? 8 : 2);
        return (
          <div key={id || s.label} className="bndz-meshdrop-session-row flex items-center gap-2 py-1.5">
            <ThroughputRing pct={pct} speedBps={speed} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-gray-200 truncate">{s.label || id}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {s.state}
                {total > 0 ? ` · ${formatBytes(moved)} / ${formatBytes(total)}` : ''}
                {speed ? ` · ${formatBytes(speed)}/s` : ''}
                {s.error ? ` · ${s.error}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="bndz-meshdrop-btn text-[10px] shrink-0"
              onClick={() => { if (id) void IPC.meshDropCancel(id); }}
            >
              Cancel
            </button>
          </div>
        );
      })}
    </div>
  );
}
