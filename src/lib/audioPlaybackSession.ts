/**
 * Single shared HTMLAudioElement for BNDZ preview surfaces.
 * Panel + floating Quick Look bind to the same decoder so Space pop-out
 * never stops / reloads audio mid-playback.
 */

import { normalizePanePath } from './pathUtils';

export type AudioSessionSnapshot = {
  path: string | null;
  currentTime: number;
  duration: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  buffering: boolean;
  error: string | null;
  resolvedSrc: string;
};

type Listener = () => void;

function pathKey(path: string | null | undefined): string {
  if (!path) return '';
  return normalizePanePath(path).toLowerCase();
}

class AudioPlaybackSession {
  private el: HTMLAudioElement | null = null;
  private path: string | null = null;
  private blobUrl: string | null = null;
  private resolvedSrc = '';
  private buffering = false;
  private error: string | null = null;
  private listeners = new Set<Listener>();
  private bound = false;

  private ensureEl(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.style.display = 'none';
    document.body.appendChild(el);
    this.el = el;
    this.bindEl(el);
    return el;
  }

  private bindEl(el: HTMLAudioElement) {
    if (this.bound) return;
    this.bound = true;
    const bump = () => this.emit();
    el.addEventListener('timeupdate', bump);
    el.addEventListener('play', bump);
    el.addEventListener('pause', bump);
    el.addEventListener('ended', bump);
    el.addEventListener('volumechange', bump);
    el.addEventListener('ratechange', bump);
    el.addEventListener('waiting', () => { this.buffering = true; this.emit(); });
    el.addEventListener('canplay', () => { this.buffering = false; this.emit(); });
    el.addEventListener('loadedmetadata', () => { this.buffering = false; this.error = null; this.emit(); });
    el.addEventListener('error', () => {
      this.buffering = false;
      this.error = 'Unable to play this media file. Try opening it in your default player.';
      this.emit();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  getSnapshot(): AudioSessionSnapshot {
    const el = this.el;
    return {
      path: this.path,
      currentTime: el?.currentTime ?? 0,
      duration: el?.duration && Number.isFinite(el.duration) ? el.duration : 0,
      playing: !!el && !el.paused && !el.ended,
      volume: el?.volume ?? 0.85,
      muted: el?.muted ?? false,
      playbackRate: el?.playbackRate ?? 1,
      buffering: this.buffering,
      error: this.error,
      resolvedSrc: this.resolvedSrc,
    };
  }

  samePath(path: string | null | undefined): boolean {
    return pathKey(this.path) === pathKey(path) && !!path;
  }

  /**
   * Attach a new source. Same path keeps the current decoder/timeline.
   * Returns true when a reload happened.
   */
  load(path: string, src: string, opts?: { force?: boolean }): boolean {
    const el = this.ensureEl();
    if (!opts?.force && this.samePath(path) && this.resolvedSrc) {
      // Never replace a live blob with a stream URL — peaks / decoder break (ERR_FILE_NOT_FOUND).
      if (
        this.resolvedSrc.startsWith('blob:')
        && src.includes('bndz-stream://')
      ) {
        this.error = null;
        this.emit();
        return false;
      }
      this.error = null;
      this.emit();
      return false;
    }

    const wasPlaying = el && !el.paused && !el.ended;
    this.path = path;
    this.error = null;
    this.buffering = true;

    if (this.blobUrl && this.blobUrl !== src) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (src.startsWith('blob:')) this.blobUrl = src;

    this.resolvedSrc = src;
    el.src = src;
    el.load();
    this.emit();

    // Preserve play intent when swapping files only if previously playing —
    // callers decide autoplay for first load.
    void wasPlaying;
    return true;
  }

  markBlobUrl(url: string) {
    // Never revoke the URL currently bound to the media element.
    if (this.blobUrl && this.blobUrl !== url && this.blobUrl !== this.resolvedSrc) {
      try { URL.revokeObjectURL(this.blobUrl); } catch { /* */ }
    }
    this.blobUrl = url;
  }

  play() {
    const el = this.ensureEl();
    if (!this.resolvedSrc) return;
    // Allow retry after a transient decode/blob error once src is live again.
    if (this.error && this.resolvedSrc.startsWith('blob:')) this.error = null;
    if (this.error) return;
    void el.play().catch(() => {
      this.error = 'Unable to play this media file. Try opening it in your default player.';
      this.emit();
    });
  }

  pause() {
    this.el?.pause();
  }

  toggle() {
    const el = this.el;
    if (!el || this.error) return;
    if (el.paused || el.ended) this.play();
    else this.pause();
  }

  seek(t: number) {
    const el = this.el;
    if (!el || !Number.isFinite(t)) return;
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    this.emit();
  }

  skip(delta: number) {
    this.seek((this.el?.currentTime || 0) + delta);
  }

  setVolume(v: number) {
    const el = this.ensureEl();
    const clamped = Math.max(0, Math.min(1, v));
    el.volume = clamped;
    el.muted = clamped === 0;
    this.emit();
  }

  setMuted(muted: boolean) {
    const el = this.ensureEl();
    el.muted = muted;
    this.emit();
  }

  toggleMute() {
    const el = this.ensureEl();
    el.muted = !el.muted;
    this.emit();
  }

  setPlaybackRate(rate: number) {
    const el = this.ensureEl();
    el.playbackRate = rate;
    this.emit();
  }

  clearError() {
    this.error = null;
    this.emit();
  }

  /** Soft release — keep element alive for next surface binding. */
  releaseUi() {
    this.emit();
  }

  /** Shared decoder for WaveSurfer / preview / Quick Look — never dual-decode. */
  getMediaElement(): HTMLAudioElement {
    return this.ensureEl();
  }
}

export const audioPlaybackSession = new AudioPlaybackSession();
