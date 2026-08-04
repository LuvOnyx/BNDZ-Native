import React, { useEffect, useRef, useState } from 'react';
import { IPC } from '../lib/ipcBridge';
import {
  formatGpuHudLine,
  mergeGpuStatus,
  probeClientGpuStatus,
  type GpuStatus,
} from '../lib/gpuStatus';

type PerfStats = {
  iconL1Hits?: number;
  iconL2Hits?: number;
  iconExtracts?: number;
  thumbL1Hits?: number;
  thumbL2Hits?: number;
  thumbExtracts?: number;
  thumbNegHits?: number;
  thumbExtractsPerSec?: number;
  iconLruCount?: number;
  thumbLruCount?: number;
  thumbNegCount?: number;
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
  const [queueDepth, setQueueDepth] = useState(0);
  const [fps, setFps] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [gpu, setGpu] = useState<GpuStatus | null>(null);
  const framesRef = useRef(0);
  const lastFpsAtRef = useRef(performance.now());

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
    if (!open) return;
    let raf = 0;
    const tick = (now: number) => {
      framesRef.current += 1;
      const elapsed = now - lastFpsAtRef.current;
      if (elapsed >= 500) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastFpsAtRef.current = now;
        setScrolling(document.documentElement.classList.contains('bndz-scrolling'));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setGpu(null);
      return;
    }
    let alive = true;
    const refreshGpu = async () => {
      const client = probeClientGpuStatus();
      if (!IPC.isNative) {
        if (alive) setGpu(client);
        return;
      }
      try {
        const host = await IPC.getGpuStatus();
        if (alive) setGpu(mergeGpuStatus(host as any, client));
      } catch {
        if (alive) setGpu(client);
      }
    };
    refreshGpu();
    const id = window.setInterval(refreshGpu, 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, [open]);

  useEffect(() => {
    if (!open || !IPC.isNative) {
      setStats(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const s = await IPC.getPerfStats();
        if (alive) setStats(s || null);
      } catch { /* ignore */ }
      try {
        const { getIconQueueDepth } = await import('../lib/iconRequestQueue');
        if (alive) setQueueDepth(getIconQueueDepth());
      } catch { /* ignore */ }
    };
    tick();
    const id = window.setInterval(tick, 1200);
    return () => { alive = false; window.clearInterval(id); };
  }, [open]);

  if (!open) return null;

  const row = (label: string, value: number | string | undefined) => (
    <div className="flex justify-between gap-3">
      <span className="text-[#8b919a]">{label}</span>
      <span className="text-[#e5e7eb] tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : (value ?? '0')}
      </span>
    </div>
  );

  const gpuLine = gpu ? formatGpuHudLine(gpu) : '…';
  const gpuColor =
    gpu?.compositing === 'gpu' && gpu.hardwareAccelerated
      ? '#34d399'
      : gpu?.compositing === 'software' || gpu?.hardwareAccelerated === false
        ? '#f87171'
        : '#fbbf24';

  const adapterShort = (() => {
    const raw = (gpu?.adapter || gpu?.renderer || '').trim();
    if (!raw) return '—';
    return raw.length > 42 ? `${raw.slice(0, 40)}…` : raw;
  })();

  return (
    <div
      className="fixed bottom-3 right-3 z-[99990] pointer-events-none select-none rounded-[10px] border border-[#3a3a3a] bg-[#1a1c20]/95 px-3 py-2 shadow-lg"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 10, lineHeight: 1.45, minWidth: 200 }}
    >
      <div className="text-[#60a5fa] font-semibold tracking-wide mb-1">BNDZ PERF</div>
      {row('fps', fps)}
      <div className="flex justify-between gap-3">
        <span className="text-[#8b919a]">gpu</span>
        <span className="tabular-nums font-semibold" style={{ color: gpuColor }}>{gpuLine}</span>
      </div>
      {row('adapter', adapterShort)}
      {row('scroll', scrolling ? 'active' : 'idle')}
      {row('icon L1', stats?.iconL1Hits)}
      {row('icon L2', stats?.iconL2Hits)}
      {row('icon extract', stats?.iconExtracts)}
      {row('thumb L1', stats?.thumbL1Hits)}
      {row('thumb L2', stats?.thumbL2Hits)}
      {row('thumb extract', stats?.thumbExtracts)}
      {row('thumb neg', stats?.thumbNegHits)}
      {row('thumb/s', stats?.thumbExtractsPerSec)}
      {row('icon queue', queueDepth)}
      {row('icon LRU', stats?.iconLruCount)}
      {row('thumb LRU', stats?.thumbLruCount)}
      <div className="text-[#6b7280] mt-1.5">Ctrl+Shift+Alt+P</div>
    </div>
  );
}
