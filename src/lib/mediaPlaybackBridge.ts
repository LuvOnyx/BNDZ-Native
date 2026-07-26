import { normalizePanePath } from './pathUtils';

export type MediaHandoff = {
  path: string;
  currentTime: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
};

const HANDOFF_REQUEST = 'bndz-media-handoff-request';
const HANDOFF_RESUME = 'bndz-media-handoff-resume';

function mediaPathKey(path: string): string {
  return normalizePanePath(path).toLowerCase();
}

let pendingHandoff: MediaHandoff | null = null;

export function publishMediaHandoff(handoff: MediaHandoff): void {
  pendingHandoff = { ...handoff, path: mediaPathKey(handoff.path) };
}

export function consumeMediaHandoff(path: string): MediaHandoff | null {
  if (!pendingHandoff || pendingHandoff.path !== mediaPathKey(path)) return null;
  const handoff = pendingHandoff;
  pendingHandoff = null;
  return handoff;
}

export function peekMediaHandoff(path: string): MediaHandoff | null {
  if (!pendingHandoff || pendingHandoff.path !== mediaPathKey(path)) return null;
  return pendingHandoff;
}

/** Ask any mounted MediaPreviewPlayer for the given path to pause and stash playback. */
export function requestMediaHandoff(path: string): void {
  window.dispatchEvent(new CustomEvent(HANDOFF_REQUEST, { detail: { path } }));
}

/** Signal panel player to resume after quick preview closes. */
export function requestMediaResume(path: string): void {
  window.dispatchEvent(new CustomEvent(HANDOFF_RESUME, { detail: { path } }));
}

export function onMediaHandoffRequest(listener: (path: string) => void): () => void {
  const handler = (e: Event) => {
    const path = (e as CustomEvent<{ path: string }>).detail?.path;
    if (path) listener(path);
  };
  window.addEventListener(HANDOFF_REQUEST, handler);
  return () => window.removeEventListener(HANDOFF_REQUEST, handler);
}

export function onMediaHandoffResume(listener: (path: string) => void): () => void {
  const handler = (e: Event) => {
    const path = (e as CustomEvent<{ path: string }>).detail?.path;
    if (path) listener(path);
  };
  window.addEventListener(HANDOFF_RESUME, handler);
  return () => window.removeEventListener(HANDOFF_RESUME, handler);
}
