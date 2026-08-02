import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';

type Session = {
  id: string;
  role?: string;
  state?: string;
  label?: string;
  bytesSent?: number;
  bytesReceived?: number;
  bytesTotal?: number;
  speedBps?: number;
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

export default function MeshDropSessionPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    const r = await IPC.meshDropListSessions();
    setSessions((r.sessions as Session[]) ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
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
        const moved = (s.bytesSent || 0) + (s.bytesReceived || 0);
        const total = s.bytesTotal || 0;
        const pct = total > 0 ? (moved / total) * 100 : (s.state === 'transferring' ? 8 : 2);
        return (
          <div key={s.id} className="bndz-meshdrop-session-row flex items-center gap-2 py-1.5">
            <ThroughputRing pct={pct} speedBps={s.speedBps || 0} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-gray-200 truncate">{s.label || s.id}</div>
              <div className="text-[10px] text-gray-500 truncate">
                {s.state}
                {total > 0 ? ` · ${formatBytes(moved)} / ${formatBytes(total)}` : ''}
                {s.speedBps ? ` · ${formatBytes(s.speedBps)}/s` : ''}
              </div>
            </div>
            <button
              type="button"
              className="bndz-meshdrop-btn text-[10px] shrink-0"
              onClick={() => void IPC.meshDropCancel(s.id)}
            >
              Cancel
            </button>
          </div>
        );
      })}
    </div>
  );
}
