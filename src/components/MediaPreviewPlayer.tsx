import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, SkipBack, SkipForward, AlertCircle } from 'lucide-react';
import { toWindowsPath } from '../lib/pathUtils';
import { getMimeType } from '../lib/mediaTypes';

interface MediaPreviewPlayerProps {
  src: string;
  type: 'audio' | 'video';
  title?: string;
  poster?: string;
  /** Windows path for IPC blob fallback when virtual stream fails */
  filePath?: string | null;
  extension?: string;
  autoplay?: boolean;
  /** Prefer IPC blob load in WebView2 (most reliable for audio) */
  preferBlob?: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MediaPreviewPlayer({
  src, type, title, poster, filePath, extension = '', autoplay = false, preferBlob = false,
}: MediaPreviewPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const isNativeHost = typeof window !== 'undefined' && !!(window as any).chrome?.webview;
  const [resolvedSrc, setResolvedSrc] = useState(() => (isNativeHost && type === 'audio' ? '' : src));
  const [mimeType, setMimeType] = useState(getMimeType(extension));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triedBlob, setTriedBlob] = useState(false);

  const syncState = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    setCurrent(el.currentTime);
    setDuration(el.duration || 0);
    setPlaying(!el.paused && !el.ended);
    setVolume(el.volume);
    setMuted(el.muted);
  }, []);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const loadViaBlob = useCallback(async (): Promise<boolean> => {
    if (!filePath) return false;
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const winPath = toWindowsPath(filePath);
      const result = await IPC.getMediaBlob(winPath);
      if (result.base64 && result.mime) {
        const binary = atob(result.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: result.mime });
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setMimeType(result.mime);
        setResolvedSrc(url);
        setLoadError(null);
        setBuffering(true);
        return true;
      }
      if (!triedBlob) setLoadError(result.error || 'Could not load media file.');
      return false;
    } catch (err: any) {
      if (!triedBlob) setLoadError(err?.message || 'Media load failed.');
      return false;
    }
  }, [filePath, triedBlob]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setBuffering(true);
    setLoadError(null);
    setTriedBlob(false);
    setResolvedSrc(isNativeHost && (preferBlob || type === 'audio') ? '' : src);
    setMimeType(getMimeType(extension));
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    let cancelled = false;
    const init = async () => {
      const isNative = !!(window as any).chrome?.webview;
      if (isNative && filePath && (preferBlob || type === 'audio')) {
        setTriedBlob(true);
        const ok = await loadViaBlob();
        if (cancelled) return;
        if (ok) return;
      }
      if (!cancelled) setResolvedSrc(src);
    };
    void init();
    return () => { cancelled = true; };
  }, [src, extension, filePath, preferBlob, type, loadViaBlob]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !resolvedSrc) return;
    el.load();
  }, [resolvedSrc, mimeType]);

  const tryBlobFallback = useCallback(async () => {
    if (triedBlob || !filePath) return;
    setTriedBlob(true);
    await loadViaBlob();
  }, [filePath, triedBlob, loadViaBlob]);

  const handleMediaError = () => {
    if (!triedBlob && filePath) {
      void tryBlobFallback();
      return;
    }
    setLoadError('Unable to play this media file. Try opening it in your default player.');
    setBuffering(false);
  };

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el || loadError) return;
    if (el.paused || el.ended) {
      void el.play().catch(() => handleMediaError());
    } else {
      el.pause();
    }
  }, [loadError]);

  const seek = useCallback((t: number) => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(t)) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    setCurrent(el.currentTime);
  }, []);

  const skip = useCallback((delta: number) => seek((mediaRef.current?.currentTime || 0) + delta), [seek]);

  const setVol = (v: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  };

  const toggleMute = () => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const toggleFullscreen = () => {
    const el = mediaRef.current as HTMLVideoElement | null;
    if (!el || type !== 'video') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-5); }
      if (e.code === 'ArrowRight') { e.preventDefault(); skip(5); }
      if (e.code === 'KeyF' && type === 'video') { e.preventDefault(); toggleFullscreen(); }
      if (e.code === 'KeyM') { e.preventDefault(); toggleMute(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [type, loadError, togglePlay, skip, toggleFullscreen, toggleMute]);

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  const tryAutoplay = useCallback(() => {
    if (!autoplay) return;
    const el = mediaRef.current;
    if (!el || loadError) return;
    void el.play().catch(() => { /* user gesture may be required */ });
  }, [autoplay, loadError]);

  const mediaProps = {
    src: resolvedSrc,
    preload: 'auto' as const,
    onTimeUpdate: syncState,
    onLoadedMetadata: () => {
      syncState();
      setBuffering(false);
      setLoadError(null);
      tryAutoplay();
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onWaiting: () => setBuffering(true),
    onCanPlay: () => { setBuffering(false); tryAutoplay(); },
    onError: handleMediaError,
  };

  return (
    <div className={`w-full h-full flex flex-col bndz-glass-panel overflow-hidden ${type === 'video' ? '' : 'justify-center'}`}>
      <div className={`relative flex-1 flex items-center justify-center min-h-0 ${type === 'audio' ? 'py-6' : ''}`}>
        {loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <AlertCircle size={40} className="text-amber-500 opacity-80" />
            <p className="text-xs text-gray-400 max-w-[240px] leading-relaxed">{loadError}</p>
            {filePath && (
              <button
                type="button"
                onClick={() => import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(filePath), 'open'))}
                className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 bg-sky-600/20 border border-sky-500/40 text-sky-400 rounded hover:bg-sky-600/30"
              >
                Open in Default Player
              </button>
            )}
          </div>
        ) : type === 'video' ? (
          <video
            key={resolvedSrc}
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            className="w-full h-full object-contain bg-black"
            poster={poster}
            onClick={togglePlay}
            {...mediaProps}
          />
        ) : (
          <>
            <audio
              key={resolvedSrc}
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              className="hidden"
              {...mediaProps}
            />
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <div className="w-24 h-24 rounded-3xl bndz-glass-surface border border-sky-500/20 flex items-center justify-center shadow-lg">
                <Volume2 size={40} className="text-sky-400" />
              </div>
              {title && <p className="text-sm font-semibold text-white truncate max-w-full">{title}</p>}
            </div>
          </>
        )}

        {buffering && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
            <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 py-2.5 flex flex-col gap-2 backdrop-blur-md bg-black/20">
        {type === 'video' && title && (
          <div className="text-[11px] text-gray-400 truncate font-medium">{title}</div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => skip(-10)} disabled={!!loadError} className="p-1.5 hover:bg-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30" title="Back 10s">
            <SkipBack size={14} />
          </button>
          <button type="button" onClick={togglePlay} disabled={!!loadError} className="p-2 bg-sky-500/90 hover:bg-sky-400 rounded-full text-white shadow-lg disabled:opacity-30" title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={16} fill="white" /> : <Play size={16} fill="white" className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => skip(10)} disabled={!!loadError} className="p-1.5 hover:bg-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30" title="Forward 10s">
            <SkipForward size={14} />
          </button>

          <span className="text-[10px] font-mono text-gray-500 w-[72px] text-right shrink-0">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={current}
            onChange={e => seek(parseFloat(e.target.value))}
            disabled={!!loadError}
            className="flex-1 h-1 accent-sky-500 cursor-pointer min-w-0 disabled:opacity-30"
            style={{ background: `linear-gradient(to right, #0ea5e9 ${progress}%, #333 ${progress}%)` }}
          />

          <button type="button" onClick={toggleMute} disabled={!!loadError} className="p-1.5 hover:bg-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30">
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={e => setVol(parseFloat(e.target.value))}
            disabled={!!loadError}
            className="w-16 h-1 accent-sky-500 cursor-pointer shrink-0 disabled:opacity-30"
          />

          {type === 'video' && (
            <button type="button" onClick={toggleFullscreen} disabled={!!loadError} className="p-1.5 hover:bg-[#2a2a2a] rounded text-gray-400 hover:text-white disabled:opacity-30" title="Fullscreen">
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
