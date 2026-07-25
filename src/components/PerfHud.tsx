import React, { useEffect, useState } from 'react';
import { IPC } from '../lib/ipcBridge';

type PerfStats = {
  iconL1Hits?: number;
  iconL2Hits?: number;
  iconExtracts?: number;
  thumbL1Hits?: number;
  thumbL2Hits?: number;
  thumbExtracts?: number;
  iconLruCount?: number;
  thumbLruCount?: number;
};

function readEnabled(): boolean {
  try {
    return localStorage.getItem('bndz-perf-hud') === '1';
  } catch {
    return false;
  }
}

/** Dev/perf overlay — Ctrl+Shift+Alt+P or localStorage bndz-perf-hud=1. */
export default function PerfHud() {
  const [open, setOpen] = useState(readEnabled);
  const [stats, setStats] = useState<PerfStats | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && e.altKey)) return;
      if (e.key !== 'P' && e.key !== 'p') return;
      e.preventDefault();
      setOpen(prev => {
        const next = !prev;
        try { localStorage.setItem('bndz-perf-hud', next ? '1' : '0'); } catch { /* ignore */ }
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open || !IPC.isNative) {
      setStats(null);
      return;
    }
    let alive = true;
    const tick = () => {
      IPC.getPerfStats().then(s => { if (alive) setStats(s || null); }).catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => { alive = false; window.clearInterval(id); };
  }, [open]);

  if (!open) return null;

  const row = (label: string, value: number | undefined) => (
    <div className="flex justify-between gap-3">
      <span className="text-[#8b919a]">{label}</span>
      <span className="text-[#e5e7eb] tabular-nums">{(value ?? 0).toLocaleString()}</span>
    </div>
  );

  return (
    <div
      className="fixed bottom-3 right-3 z-[99990] pointer-events-none select-none rounded-[10px] border border-[#3a3a3a] bg-[#1a1c20]/95 backdrop-blur-sm px-3 py-2 shadow-lg"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 10, lineHeight: 1.45, minWidth: 168 }}
    >
      <div className="text-[#60a5fa] font-semibold tracking-wide mb-1">BNDZ PERF</div>
      {row('icon L1', stats?.iconL1Hits)}
      {row('icon L2', stats?.iconL2Hits)}
      {row('icon extract', stats?.iconExtracts)}
      {row('thumb L1', stats?.thumbL1Hits)}
      {row('thumb L2', stats?.thumbL2Hits)}
      {row('thumb extract', stats?.thumbExtracts)}
      {row('icon LRU', stats?.iconLruCount)}
      {row('thumb LRU', stats?.thumbLruCount)}
      <div className="text-[#6b7280] mt-1.5">Ctrl+Shift+Alt+P</div>
    </div>
  );
}
