import { isArchiveExt } from '../lib/archiveTypes';
import { isAudioExt, isImageExt, isVideoExt } from '../lib/mediaTypes';
import { isCodeExt } from '../lib/textFileTypes';

export type MediaKind = 'image' | 'video' | 'audio' | 'archive' | 'code' | 'folder' | 'generic';

export type SelectionSignature =
  | { kind: 'empty' }
  | { kind: 'single'; media: MediaKind; path: string; name: string }
  | { kind: 'multi'; count: number; dominantMedia: MediaKind; paths: string[] };

type FocusEntity = {
  name?: string;
  extension?: string;
  type?: string;
  path?: string;
} | null;

function extFromPath(path: string): string {
  const base = path.split(/[/\\]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function classifyMedia(path: string, typeHint?: string): MediaKind {
  const t = (typeHint || '').toLowerCase();
  if (t === 'directory' || t === 'folder') return 'folder';
  const ext = extFromPath(path);
  if (isImageExt(ext)) return 'image';
  if (isVideoExt(ext)) return 'video';
  if (isAudioExt(ext)) return 'audio';
  if (isArchiveExt(ext)) return 'archive';
  if (isCodeExt(ext)) return 'code';
  return 'generic';
}

export function deriveSelectionSignature(
  paths: string[],
  types: string[] = [],
  focused: FocusEntity = null,
): SelectionSignature {
  const clean = paths.filter(Boolean);
  if (!clean.length) return { kind: 'empty' };

  if (clean.length === 1) {
    const path = clean[0];
    const media = classifyMedia(path, types[0]);
    const name = focused?.name || path.split(/[/\\]/).pop() || path;
    return { kind: 'single', media, path, name };
  }

  const mediaCounts = new Map<MediaKind, number>();
  clean.forEach((p, i) => {
    const m = classifyMedia(p, types[i]);
    mediaCounts.set(m, (mediaCounts.get(m) || 0) + 1);
  });
  let dominantMedia: MediaKind = 'generic';
  let max = 0;
  mediaCounts.forEach((n, m) => {
    if (n > max) { max = n; dominantMedia = m; }
  });

  return { kind: 'multi', count: clean.length, dominantMedia, paths: clean };
}

export function signatureLayoutVariant(sig: SelectionSignature): 'collapsed' | 'compact' | 'wide' | 'fan' {
  if (sig.kind === 'empty') return 'collapsed';
  if (sig.kind === 'multi') return 'fan';
  if (sig.media === 'audio' || sig.media === 'video') return 'wide';
  if (sig.media === 'image') return 'wide';
  return 'compact';
}
