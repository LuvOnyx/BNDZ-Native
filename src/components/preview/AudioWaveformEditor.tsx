import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';

type Props = {
  path: string;
  title?: string;
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioWaveformEditor({ path, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [region, setRegion] = useState<{ start: number; end: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void import('../../lib/ipcBridge').then(({ IPC }) => IPC.ensureFfmpegTools());
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !path) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;
    const ws = WaveSurfer.create({
      container: el,
      height: 96,
      waveColor: 'rgba(126, 184, 232, 0.45)',
      progressColor: '#7eb8e8',
      cursorColor: '#c4a35a',
      barWidth: 2,
      barGap: 1,
      normalize: true,
      url: toVirtualStreamUrl(path),
      plugins: [regions],
    });
    wsRef.current = ws;

    ws.on('ready', () => {
      const d = ws.getDuration();
      setDuration(d);
      const r = regions.addRegion({
        start: 0,
        end: Math.min(d, d > 30 ? 30 : d),
        color: 'rgba(196, 163, 90, 0.22)',
        drag: true,
        resize: true,
      });
      setRegion({ start: r.start, end: r.end });
    });
    ws.on('audioprocess', () => setCurrent(ws.getCurrentTime()));
    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));
    regions.on('region-updated', (r: { start: number; end: number }) => {
      setRegion({ start: r.start, end: r.end });
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, [path]);

  const togglePlay = () => {
    const ws = wsRef.current;
    if (!ws) return;
    void ws.playPause();
  };

  const playRegion = () => {
    const ws = wsRef.current;
    if (!ws || !region) return;
    ws.setTime(region.start);
    void ws.play();
    const stopAt = region.end;
    const onTime = () => {
      if (ws.getCurrentTime() >= stopAt) {
        ws.pause();
        ws.un('timeupdate', onTime);
      }
    };
    ws.on('timeupdate', onTime);
  };

  const exportSelection = async () => {
    if (!region || !path) return;
    setBusy(true);
    setStatus(null);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      const dest = await IPC.trimAudioFile(toWindowsPath(path), region.start, region.end);
      if (dest?.ok) setStatus(`Exported → ${dest.path?.split(/[/\\]/).pop() || 'clip'}`);
      else setStatus(dest?.error || 'Export failed — preparing audio tools…');
    } catch {
      setStatus('Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bndz-wave-editor flex flex-col gap-2 p-3 h-full min-h-[200px]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-white truncate">{title || path.split(/[/\\]/).pop()}</div>
          <div className="text-[10px] text-[#7a8088]">Zero-Launch waveform · drag handles to trim</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" className="bndz-lens-chip" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" className="bndz-lens-chip" disabled={!region} onClick={playRegion}>Loop region</button>
          <button type="button" className="bndz-lens-chip" disabled={!region || busy} onClick={() => void exportSelection()}>
            {busy ? 'Exporting…' : 'Export clip'}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="rounded-md bg-[#12141a] border border-white/[0.06] min-h-[96px]" />
      <div className="flex items-center justify-between text-[10px] text-[#7a8088] bndz-mono">
        <span>{formatTime(current)} / {formatTime(duration)}</span>
        {region && <span>Selection {formatTime(region.start)} – {formatTime(region.end)}</span>}
        {status && <span className="text-[#7eb8e8]">{status}</span>}
      </div>
    </div>
  );
}
