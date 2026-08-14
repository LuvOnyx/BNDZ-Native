import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';
import { IPC } from '../../lib/ipcBridge';
import { audioPlaybackSession } from '../../lib/audioPlaybackSession';
import { toWindowsPath } from '../../lib/pathUtils';
import { getExtendedMetadataCached } from '../../lib/extendedMetadataCache';

type Props = {
  path: string;
  title?: string;
};

type MusicAnalysis = {
  bpm?: number;
  key?: string;
  mode?: string;
  keyConfidence?: number;
  camelot?: string;
  peakDb?: number;
  suggestedHalfTime?: number;
  suggestedDoubleTime?: number;
  artist?: string;
  title?: string;
};

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Ableton-style — light peaks on saturated track. */
const WAVE_TRACK = '#e11d48';
const WAVE_FILL = '#fecdd3';
const WAVE_PROGRESS = '#fff1f2';
const REGION = 'rgba(255, 255, 255, 0.22)';

async function blobUrlFromIpc(winPath: string): Promise<string | null> {
  const result = await IPC.getMediaBlob(winPath);
  if (!result.base64 || !result.mime) return null;
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: result.mime }));
}

/** Downsample channel data so WaveSurfer gets drawable peaks without megabyte arrays. */
function channelPeaks(channel: Float32Array, buckets = 2048): number[] {
  const out: number[] = [];
  const block = Math.max(1, Math.floor(channel.length / buckets));
  for (let i = 0; i < buckets; i++) {
    const start = i * block;
    let min = 1;
    let max = -1;
    for (let j = start; j < start + block && j < channel.length; j++) {
      const v = channel[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out.push(min, max);
  }
  return out;
}

export default function AudioWaveformEditor({ path, title }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [playing, setPlaying] = useState(() => audioPlaybackSession.getSnapshot().playing);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(() => audioPlaybackSession.getSnapshot().currentTime);
  const [region, setRegion] = useState<{ start: number; end: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MusicAnalysis | null>(null);
  const [ready, setReady] = useState(false);
  const [vZoom, setVZoom] = useState(1);

  useEffect(() => {
    void IPC.ensureFfmpegTools();
  }, []);

  useEffect(() => {
    setAnalysis(null);
    setStatus(null);
    setReady(false);

    let active = true;
    const winPath = toWindowsPath(path);
    void getExtendedMetadataCached(winPath, { priority: 900 }).then(entry => {
      if (!active) return;
      const bpmStr = entry.meta['BPM'];
      const keyStr = entry.meta['Musical Key'];
      const camelotStr = entry.meta['Camelot'];
      if (!bpmStr && !keyStr) return;
      const bpm = bpmStr ? parseFloat(bpmStr) : undefined;
      let key: string | undefined;
      let mode: string | undefined;
      if (keyStr) {
        if (keyStr.endsWith('m')) {
          key = keyStr.slice(0, -1);
          mode = 'minor';
        } else {
          key = keyStr;
          mode = 'major';
        }
      }
      setAnalysis(prev => prev ?? {
        bpm: bpm && bpm > 0 ? bpm : undefined,
        key,
        mode,
        camelot: camelotStr || undefined,
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    return audioPlaybackSession.subscribe(() => {
      const snap = audioPlaybackSession.getSnapshot();
      if (!audioPlaybackSession.samePath(path)) return;
      setPlaying(snap.playing);
      setCurrent(snap.currentTime);
      if (snap.duration > 0) setDuration(snap.duration);
      if (snap.error) setStatus(snap.error);
    });
  }, [path]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !path) return;
    let cancelled = false;
    let ws: WaveSurfer | null = null;

    const setup = async () => {
      el.replaceChildren();
      setStatus(null);

      // Resolve ONE live blob — never bndz-stream for peaks (fetch/decode fails silently).
      let blobUrl = '';
      const snap = audioPlaybackSession.getSnapshot();
      if (audioPlaybackSession.samePath(path) && snap.resolvedSrc.startsWith('blob:')) {
        blobUrl = snap.resolvedSrc;
      } else {
        try {
          const created = await blobUrlFromIpc(toWindowsPath(path));
          if (cancelled) return;
          if (!created) {
            setStatus('Could not load audio for waveform');
            return;
          }
          blobUrl = created;
          audioPlaybackSession.load(path, blobUrl, { force: true });
        } catch (e) {
          if (!cancelled) setStatus(e instanceof Error ? e.message : 'Waveform load failed');
          return;
        }
      }

      if (cancelled || !blobUrl) return;

      // Decode peaks ourselves — WaveSurfer `media`-only does not draw bars.
      let peaks: number[][] = [];
      let peakDuration = 0;
      try {
        const ab = await (await fetch(blobUrl)).arrayBuffer();
        if (cancelled) return;
        const ctx = new AudioContext();
        try {
          const audioBuffer = await ctx.decodeAudioData(ab.slice(0));
          peakDuration = audioBuffer.duration;
          const chans = Math.min(2, audioBuffer.numberOfChannels);
          for (let ch = 0; ch < chans; ch++) {
            peaks.push(channelPeaks(audioBuffer.getChannelData(ch)));
          }
        } finally {
          void ctx.close();
        }
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : 'Could not decode waveform peaks');
        }
        return;
      }

      if (cancelled || !peaks.length || !(peakDuration > 0)) {
        setStatus('Waveform decode produced no peaks');
        return;
      }

      const media = audioPlaybackSession.getMediaElement();
      const regions = RegionsPlugin.create();
      regionsRef.current = regions;
      ws = WaveSurfer.create({
        container: el,
        height: Math.round(140 * vZoom),
        waveColor: WAVE_FILL,
        progressColor: WAVE_PROGRESS,
        cursorColor: '#fff',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 0,
        barRadius: 0,
        normalize: true,
        fillParent: true,
        media,
        peaks,
        duration: peakDuration,
        plugins: [regions],
      });
      wsRef.current = ws;
      el.style.setProperty('--bndz-wave-track', WAVE_TRACK);

      const finishReady = () => {
        if (!ws) return;
        const d = ws.getDuration() || peakDuration || audioPlaybackSession.getSnapshot().duration;
        setDuration(d);
        setReady(true);
        setCurrent(media.currentTime || 0);
        setPlaying(!media.paused && !media.ended);
        regions.clearRegions();
        const r = regions.addRegion({
          start: 0,
          end: Math.min(d || 1, (d || 1) > 30 ? 30 : (d || 1)),
          color: REGION,
          drag: true,
          resize: true,
        });
        setRegion({ start: r.start, end: r.end });
      };

      ws.on('ready', finishReady);
      // peaks+duration often fire ready immediately; also sync if already ready
      try {
        if (ws.getDuration() > 0) finishReady();
      } catch { /* */ }

      ws.on('audioprocess', () => { if (ws) setCurrent(ws.getCurrentTime()); });
      ws.on('timeupdate', () => { if (ws) setCurrent(ws.getCurrentTime()); });
      ws.on('play', () => setPlaying(true));
      ws.on('pause', () => setPlaying(false));
      ws.on('finish', () => setPlaying(false));
      regions.on('region-updated', (r: { start: number; end: number }) => {
        setRegion({ start: r.start, end: r.end });
      });
    };

    void setup();

    return () => {
      cancelled = true;
      const snap = audioPlaybackSession.getSnapshot();
      const keepPlaying = snap.playing && audioPlaybackSession.samePath(path);
      const t = snap.currentTime;
      // Detach WaveSurfer from the shared <audio> without pausing/clearing src.
      // destroy() on an external media element can stall Space Quick Look handoff.
      try {
        const media = audioPlaybackSession.getMediaElement();
        const wasPaused = media.paused;
        try { ws?.unAll?.(); } catch { /* */ }
        try { ws?.destroy(); } catch { /* */ }
        if (keepPlaying && wasPaused) {
          /* media may have been paused by destroy — restore below */
        }
      } catch { /* */ }
      wsRef.current = null;
      regionsRef.current = null;
      if (keepPlaying) {
        audioPlaybackSession.seek(t);
        audioPlaybackSession.play();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready) return;
    try {
      ws.setOptions({ height: Math.round(140 * vZoom) });
    } catch { /* */ }
  }, [vZoom, ready]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;

    const zoomTimeline = (deltaY: number) => {
      const ws = wsRef.current;
      if (!ws || !ready) return;
      const dur = ws.getDuration() || 1;
      const el = containerRef.current;
      const fit = el ? Math.max(1, Math.floor(el.clientWidth / dur)) : 1;
      const opts = (ws as unknown as { options?: { minPxPerSec?: number } }).options;
      const cur = opts?.minPxPerSec || fit;
      const next = Math.max(fit, Math.min(640, cur * (deltaY > 0 ? 0.82 : 1.22)));
      try {
        ws.zoom(next);
        if (opts) opts.minPxPerSec = next;
      } catch { /* */ }
    };

    const zoomVertical = (deltaY: number) => {
      const dir = deltaY > 0 ? -0.1 : 0.1;
      setVZoom(z => Math.max(0.55, Math.min(2.8, +(z + dir).toFixed(2))));
    };

    const onWheel = (e: WheelEvent) => {
      // Producer desk: Shift+wheel = timeline zoom, Ctrl+Shift+wheel = amplitude zoom.
      // Also keep Ctrl+wheel (vertical) and Alt+wheel (timeline) as aliases.
      const timeline = (e.shiftKey && !e.ctrlKey && !e.metaKey) || e.altKey;
      const vertical = (e.shiftKey && (e.ctrlKey || e.metaKey)) || (e.ctrlKey && !e.shiftKey);
      if (!timeline && !vertical) return;
      e.preventDefault();
      e.stopPropagation();
      if (timeline) zoomTimeline(e.deltaY);
      else zoomVertical(e.deltaY);
    };
    root.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => root.removeEventListener('wheel', onWheel, { capture: true });
  }, [ready]);

  const togglePlay = () => {
    audioPlaybackSession.clearError();
    audioPlaybackSession.toggle();
  };

  const skip = (delta: number) => {
    audioPlaybackSession.skip(delta);
  };

  const playRegion = () => {
    const ws = wsRef.current;
    if (!ws || !region) return;
    audioPlaybackSession.seek(region.start);
    audioPlaybackSession.play();
    const stopAt = region.end;
    const unsub = audioPlaybackSession.subscribe(() => {
      const t = audioPlaybackSession.getSnapshot().currentTime;
      if (t >= stopAt) {
        audioPlaybackSession.pause();
        unsub();
      }
    });
  };

  const exportSelection = async () => {
    if (!region || !path) return;
    setBusy(true);
    setStatus(null);
    try {
      const dest = await IPC.trimAudioFile(toWindowsPath(path), region.start, region.end);
      if (dest?.ok) setStatus(`Exported → ${dest.path?.split(/[/\\]/).pop() || 'clip'}`);
      else setStatus(dest?.error || 'Export failed — preparing audio tools…');
    } catch {
      setStatus('Export failed');
    } finally {
      setBusy(false);
    }
  };

  const detectMusic = async () => {
    if (!path) return;
    setAnalyzing(true);
    setStatus(null);
    try {
      const r = await IPC.analyzeMusicFile(toWindowsPath(path));
      if (!r?.ok) {
        setStatus(r?.error || 'Analysis failed');
        setAnalysis(null);
        return;
      }
      setAnalysis({
        bpm: r.bpm,
        key: r.key,
        mode: r.mode,
        keyConfidence: r.keyConfidence,
        camelot: r.camelot,
        peakDb: r.peakDb,
        suggestedHalfTime: r.suggestedHalfTime,
        suggestedDoubleTime: r.suggestedDoubleTime,
        artist: r.artist,
        title: r.title,
      });
      if (r.sidecarTags?.length) {
        try {
          const sc = await IPC.getTagSidecar(toWindowsPath(path));
          const existing = sc?.tags?.filter(Boolean) ?? [];
          const merged = [...new Set([
            ...existing.filter(t => !/^(bpm|key|camelot)(?:\s|:|$|\d)/i.test(String(t).trim())),
            ...r.sidecarTags,
          ])];
          await IPC.setTagMeta(toWindowsPath(path), sc?.label, sc?.comment, merged);
        } catch { /* sidecar optional */ }
      }
      setStatus(`Detected ${r.bpm} BPM · ${r.key} ${r.mode}${r.camelot ? ` · Camelot ${r.camelot}` : ''}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const keyLabel = analysis?.key
    ? `${analysis.key} ${analysis.mode === 'minor' ? 'min' : 'maj'}`
    : null;

  const displayTitle = title || analysis?.title || path.split(/[/\\]/).pop();

  return (
    <div ref={editorRef} className="bndz-wave-editor flex flex-col p-3 h-full min-h-[260px]">
      <div className="bndz-wave-editor-head">
        <div className="min-w-0">
          <div className="bndz-wave-editor-kicker">Producer desk</div>
          <div className="bndz-wave-editor-title truncate">{displayTitle}</div>
          <div className="bndz-wave-editor-sub">
            {analysis?.artist ? `${analysis.artist} · ` : ''}
            Shift+wheel timeline · Ctrl+Shift+wheel amplitude · shared playback
          </div>
        </div>
        <div className="bndz-wave-editor-tools">
          <button
            type="button"
            className="bndz-wave-btn is-primary"
            disabled={analyzing}
            onClick={() => void detectMusic()}
          >
            <Icons8Icon id="music_ui" size={12} />
            {analyzing ? 'Detecting…' : 'Detect BPM + Key'}
          </button>
          <button
            type="button"
            className="bndz-wave-btn is-accent"
            disabled={!region || busy}
            onClick={() => void exportSelection()}
          >
            <Icons8Icon id="download" size={12} />
            {busy ? 'Exporting…' : 'Export clip'}
          </button>
        </div>
      </div>

      {analysis && (
        <div className="bndz-music-analysis-strip" role="status">
          <div className="bndz-music-stat">
            <span className="bndz-music-stat-label">BPM</span>
            <span className="bndz-music-stat-value">{analysis.bpm?.toFixed(1)}</span>
          </div>
          <div className="bndz-music-stat">
            <span className="bndz-music-stat-label">Key</span>
            <span className="bndz-music-stat-value">{keyLabel}</span>
          </div>
          <div className="bndz-music-stat">
            <span className="bndz-music-stat-label">Camelot</span>
            <span className="bndz-music-stat-value">{analysis.camelot || '—'}</span>
          </div>
          <div className="bndz-music-stat">
            <span className="bndz-music-stat-label">Peak</span>
            <span className="bndz-music-stat-value">{analysis.peakDb != null ? `${analysis.peakDb.toFixed(1)} dB` : '—'}</span>
          </div>
          <div className="bndz-music-stat bndz-music-stat--wide">
            <span className="bndz-music-stat-label">Half / Double</span>
            <span className="bndz-music-stat-value">
              {analysis.suggestedHalfTime?.toFixed(1)} · {analysis.suggestedDoubleTime?.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      <div className="bndz-wave-transport">
        <button type="button" className="bndz-wave-btn" disabled={!ready} onClick={() => skip(-5)} title="Back 5s">
          <EmblemIcon id="media-seek-backward" size={12} />
          −5s
        </button>
        <button type="button" className="bndz-wave-btn is-primary" disabled={!ready} onClick={togglePlay}>
          <EmblemIcon id={playing ? 'media-playback-paused' : 'media-playback-playing'} size={12} />
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="bndz-wave-btn" disabled={!ready} onClick={() => skip(5)} title="Forward 5s">
          <EmblemIcon id="media-seek-forward" size={12} />
          +5s
        </button>
        <button type="button" className="bndz-wave-btn" disabled={!region || !ready} onClick={playRegion}>
          Loop region
        </button>
      </div>

      <div ref={wrapRef} className="bndz-wave-canvas-wrap bndz-wave-canvas-wrap--daw">
        <div ref={containerRef} className="bndz-wave-canvas" />
        {!ready && (
          <div className="bndz-wave-canvas-loading" aria-live="polite">
            {status || 'Decoding waveform…'}
          </div>
        )}
      </div>

      <div className="bndz-wave-meter">
        <span className="bndz-wave-meter-time bndz-mono">
          {formatTime(current)} / {formatTime(duration)}
        </span>
        {region && (
          <span className="bndz-wave-meter-sel bndz-mono">
            Selection {formatTime(region.start)} – {formatTime(region.end)}
            {' · '}
            {(region.end - region.start).toFixed(1)}s
          </span>
        )}
        <span className="bndz-wave-meter-levels" aria-hidden>
          {[0.35, 0.55, 0.8, 0.62, 0.9, 0.7, 0.45].map((h, i) => (
            <span
              key={i}
              className="bndz-wave-meter-bar"
              style={{ height: `${Math.round(h * 16 * (playing ? 0.7 + (i % 3) * 0.15 : 0.45))}px` }}
            />
          ))}
        </span>
        {status && ready && <span className="text-[#fda4af]">{status}</span>}
      </div>
    </div>
  );
}
