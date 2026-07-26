import React, { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Icons8Icon } from './Icons8Icon';
import MediaSeekBar from './MediaSeekBar';
import { toWindowsPath, normalizePanePath } from '../lib/pathUtils';
import {
  consumeMediaHandoff,
  onMediaHandoffRequest,
  onMediaHandoffResume,
  publishMediaHandoff,
  type MediaHandoff,
} from '../lib/mediaPlaybackBridge';

export type MediaPreviewPlayerHandle = {
  stashPlayback: () => MediaHandoff | null;
};

interface MediaPreviewPlayerProps {
  src: string;
  type: 'audio' | 'video';
  title?: string;
  poster?: string;
  filePath?: string | null;
  extension?: string;
  autoplay?: boolean;
  preferBlob?: boolean;
  /** Opens BNDZ floating Quick Look overlay for the current media file. */
  onOpenFloating?: () => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function sameMediaPath(a: string, b: string): boolean {
  return normalizePanePath(a).toLowerCase() === normalizePanePath(b).toLowerCase();
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MediaPreviewPlayer = forwardRef<MediaPreviewPlayerHandle, MediaPreviewPlayerProps>(function MediaPreviewPlayer({
  src, type, title, poster, filePath, extension = '', autoplay = false, preferBlob = false, onOpenFloating,
}, ref) {
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triedBlob, setTriedBlob] = useState(false);
  const handoffAppliedRef = useRef(false);

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

  const stashPlayback = useCallback((): MediaHandoff | null => {
    const el = mediaRef.current;
    if (!el || !filePath) return null;
    const handoff: MediaHandoff = {
      path: filePath,
      currentTime: el.currentTime,
      playing: !el.paused && !el.ended,
      volume: el.volume,
      muted: el.muted,
      playbackRate: el.playbackRate,
    };
    publishMediaHandoff(handoff);
    if (!el.paused) el.pause();
    return handoff;
  }, [filePath]);

  const applyHandoff = useCallback(() => {
    if (!filePath || handoffAppliedRef.current) return false;
    const handoff = consumeMediaHandoff(filePath);
    const el = mediaRef.current;
    if (!handoff || !el) return false;
    handoffAppliedRef.current = true;
    const apply = () => {
      if (!Number.isFinite(handoff.currentTime)) return;
      try {
        el.currentTime = handoff.currentTime;
      } catch { /* seek may fail before metadata */ }
      el.volume = handoff.volume;
      el.muted = handoff.muted;
      el.playbackRate = handoff.playbackRate;
      syncState();
      if (handoff.playing) void el.play().catch(() => {});
    };
    if (el.readyState >= 1) apply();
    else {
      const onMeta = () => { apply(); el.removeEventListener('loadedmetadata', onMeta); };
      el.addEventListener('loadedmetadata', onMeta);
    }
    return true;
  }, [filePath, syncState]);

  useImperativeHandle(ref, () => ({ stashPlayback }), [stashPlayback]);

  useEffect(() => {
    if (!filePath) return;
    return onMediaHandoffRequest(requestedPath => {
      if (!filePath || !sameMediaPath(requestedPath, filePath)) return;
      stashPlayback();
    });
  }, [filePath, stashPlayback]);

  useEffect(() => {
    if (!filePath) return;
    return onMediaHandoffResume(resumePath => {
      if (!filePath || !sameMediaPath(resumePath, filePath)) return;
      handoffAppliedRef.current = false;
      applyHandoff();
    });
  }, [filePath, applyHandoff]);

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
    handoffAppliedRef.current = false;
    setResolvedSrc(isNativeHost && (preferBlob || type === 'audio') ? '' : src);
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
  }, [resolvedSrc]);

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
    const clamped = Math.max(0, Math.min(1, v));
    el.volume = clamped;
    el.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  };

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const cycleRate = () => {
    const el = mediaRef.current;
    if (!el) return;
    const idx = RATES.indexOf(playbackRate);
    const next = RATES[(idx + 1) % RATES.length];
    el.playbackRate = next;
    setPlaybackRate(next);
  };

  const toggleFullscreen = useCallback(() => {
    const el = mediaRef.current as HTMLVideoElement | null;
    if (!el || type !== 'video') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, [type]);

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
      if (!applyHandoff()) tryAutoplay();
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onWaiting: () => setBuffering(true),
    onCanPlay: () => {
      setBuffering(false);
      if (!applyHandoff()) tryAutoplay();
    },
    onError: handleMediaError,
  };

  const volValue = muted ? 0 : volume;

  return (
    <div className={`bndz-media-root ${type === 'video' ? 'bndz-media-root--video' : 'bndz-media-root--audio'}`}>
      <div className={`bndz-media-stage bndz-preview-stage ${type === 'audio' ? 'bndz-media-stage--audio' : ''}`}>
        {loadError ? (
          <div className="bndz-media-error">
            <Icons8Icon id="warning" size={36} className="opacity-80" />
            <p>{loadError}</p>
            {filePath && (
              <button
                type="button"
                onClick={() => import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(filePath), 'open'))}
                className="bndz-media-btn-primary"
              >
                <Icons8Icon id="external_link" size={12} />
                Open in default player
              </button>
            )}
          </div>
        ) : type === 'video' ? (
          <video
            key={resolvedSrc}
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            className="bndz-media-video"
            poster={poster}
            onClick={togglePlay}
            {...mediaProps}
          />
        ) : (
          <>
            <audio key={resolvedSrc} ref={mediaRef as React.RefObject<HTMLAudioElement>} className="hidden" {...mediaProps} />
            <div className="bndz-media-audio-art">
              <div className="bndz-media-audio-icon">
                <Icons8Icon id="music_ui" size={40} />
              </div>
              {title && <p className="bndz-media-audio-title">{title}</p>}
            </div>
          </>
        )}

        {buffering && !loadError && (
          <div className="bndz-media-buffering" aria-hidden>
            <div className="bndz-media-spinner" />
          </div>
        )}
      </div>

      <div className="bndz-media-transport">
        <div className="bndz-media-transport-meta">
          <div className="bndz-media-transport-title truncate">{title || (type === 'video' ? 'Video' : 'Audio')}</div>
          <div className="bndz-media-transport-time bndz-mono">
            {formatTime(current)}
            <span className="opacity-40"> / </span>
            {formatTime(duration)}
          </div>
        </div>

        <div className="bndz-media-seek-row">
          <MediaSeekBar value={current} max={duration || 0} disabled={!!loadError} onChange={seek} />
        </div>

        <div className="bndz-media-transport-controls">
          <div className="bndz-media-transport-cluster">
            <button type="button" onClick={() => skip(-10)} disabled={!!loadError} className="bndz-media-transport-btn" title="Back 10s">
              <Icons8Icon id="skip_back_ui" size={15} />
            </button>
            <button type="button" onClick={togglePlay} disabled={!!loadError} className="bndz-media-transport-btn bndz-media-transport-btn--primary" title={playing ? 'Pause' : 'Play'}>
              {playing ? <Icons8Icon id="pause_ui" size={16} /> : <Icons8Icon id="play_ui" size={16} className="ml-0.5" />}
            </button>
            <button type="button" onClick={() => skip(10)} disabled={!!loadError} className="bndz-media-transport-btn" title="Forward 10s">
              <Icons8Icon id="skip_forward_ui" size={15} />
            </button>
          </div>

          <div className="bndz-media-transport-cluster bndz-media-transport-cluster--end">
            <button type="button" onClick={cycleRate} disabled={!!loadError} className="bndz-media-transport-btn bndz-media-rate-btn" title="Playback speed">
              {playbackRate}×
            </button>

            <button type="button" onClick={toggleMute} disabled={!!loadError} className="bndz-media-transport-btn" title={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0 ? <Icons8Icon id="volume_off_ui" size={15} /> : <Icons8Icon id="volume_ui" size={15} />}
            </button>
            <MediaSeekBar
              value={volValue}
              max={1}
              step={0.05}
              disabled={!!loadError}
              onChange={setVol}
              className="bndz-media-volume"
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

            {onOpenFloating && (
              <>
                <span className="bndz-image-preview-sep" aria-hidden />
                <button
                  type="button"
                  onClick={() => {
                    if (filePath) stashPlayback();
                    onOpenFloating?.();
                  }}
                  disabled={!!loadError}
                  className="bndz-media-transport-btn bndz-media-transport-btn--accent"
                  title="Open floating preview (Space)"
                >
                  <Icons8Icon id="eye_ui" size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default MediaPreviewPlayer;
