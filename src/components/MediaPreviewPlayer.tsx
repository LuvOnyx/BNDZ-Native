import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Icons8Icon } from './Icons8Icon';
import MediaSeekBar from './MediaSeekBar';
import { toWindowsPath } from '../lib/pathUtils';
import { getMimeType } from '../lib/mediaTypes';

interface MediaPreviewPlayerProps {
  src: string;
  type: 'audio' | 'video';
  title?: string;
  poster?: string;
  filePath?: string | null;
  extension?: string;
  autoplay?: boolean;
  preferBlob?: boolean;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
  const [playbackRate, setPlaybackRate] = useState(1);
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
    setPlaybackRate(el.playbackRate);
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
  }, [src, extension, filePath, preferBlob, type, loadViaBlob, isNativeHost]);

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

  const cycleRate = () => {
    const el = mediaRef.current;
    if (!el) return;
    const idx = RATES.indexOf(playbackRate);
    const next = RATES[(idx + 1) % RATES.length];
    el.playbackRate = next;
    setPlaybackRate(next);
  };

  const toggleFullscreen = () => {
    const el = mediaRef.current as HTMLVideoElement | null;
    if (!el || type !== 'video') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const togglePiP = async () => {
    const el = mediaRef.current as HTMLVideoElement | null;
    if (!el || type !== 'video' || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch { /* unsupported */ }
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
  }, [type, togglePlay, skip, toggleFullscreen, toggleMute]);

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
    <div className={`w-full h-full flex flex-col overflow-hidden bg-[#0a0a0e] ${type === 'video' ? '' : 'justify-center'}`}>
      <div className={`relative flex-1 flex items-center justify-center min-h-0 bndz-preview-stage ${type === 'audio' ? 'py-8' : ''}`}>
        {loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Icons8Icon id="warning" size={40} className="opacity-80" />
            <p className="text-sm text-gray-400 max-w-[260px] leading-relaxed">{loadError}</p>
            {filePath && (
              <button
                type="button"
                onClick={() => import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(filePath), 'open'))}
                className="text-xs font-semibold px-3 py-1.5 bg-sky-600/20 border border-sky-500/40 text-sky-300 rounded-md hover:bg-sky-600/30"
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
            <audio key={resolvedSrc} ref={mediaRef as React.RefObject<HTMLAudioElement>} className="hidden" {...mediaProps} />
            <div className="flex flex-col items-center gap-4 px-8 text-center">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-sky-500/15 to-violet-500/10 border border-white/10 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <Icons8Icon id="music_ui" size={44} />
              </div>
              {title && <p className="text-sm font-semibold text-white truncate max-w-full">{title}</p>}
            </div>
          </>
        )}

        {buffering && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
            <div className="w-9 h-9 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="shrink-0 bndz-media-transport px-3 py-2.5 flex flex-col gap-2">
        {(type === 'video' || title) && (
          <div className="flex items-center justify-between gap-2 min-h-[18px]">
            <div className="text-xs text-gray-300 truncate font-medium">{title || 'Media'}</div>
            <div className="bndz-mono text-[11px] text-gray-500 shrink-0">
              {formatTime(current)} / {formatTime(duration)}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => skip(-10)} disabled={!!loadError} className="bndz-media-transport-btn" title="Back 10s">
            <Icons8Icon id="skip_back_ui" size={15} />
          </button>
          <button type="button" onClick={togglePlay} disabled={!!loadError} className="bndz-media-transport-btn bndz-media-transport-btn--primary" title={playing ? 'Pause' : 'Play'}>
            {playing ? <Icons8Icon id="pause_ui" size={16} /> : <Icons8Icon id="play_ui" size={16} className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => skip(10)} disabled={!!loadError} className="bndz-media-transport-btn" title="Forward 10s">
            <Icons8Icon id="skip_forward_ui" size={15} />
          </button>

          <MediaSeekBar value={current} max={duration || 0} disabled={!!loadError} onChange={seek} />

          <button type="button" onClick={cycleRate} disabled={!!loadError} className="bndz-media-transport-btn w-10 text-[11px] font-semibold bndz-mono" title="Playback speed">
            {playbackRate}x
          </button>

          <button type="button" onClick={toggleMute} disabled={!!loadError} className="bndz-media-transport-btn" title={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? <Icons8Icon id="volume_off_ui" size={15} /> : <Icons8Icon id="volume_ui" size={15} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={e => setVol(parseFloat(e.target.value))}
            disabled={!!loadError}
            className="w-14 h-1 accent-sky-500 cursor-pointer shrink-0 disabled:opacity-30"
            aria-label="Volume"
          />

          {type === 'video' && (
            <>
              <button type="button" onClick={togglePiP} disabled={!!loadError} className="bndz-media-transport-btn" title="Picture in picture">
                <Icons8Icon id="picture_ui" size={15} />
              </button>
              <button type="button" onClick={toggleFullscreen} disabled={!!loadError} className="bndz-media-transport-btn" title="Fullscreen">
                <Icons8Icon id="maximize_ui" size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
