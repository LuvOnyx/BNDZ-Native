/** BNDZ-native smart views — backed by local file cache, not external engines. */

export const BNDZ_VIEWS_ROOT = '/bndz';
export const BNDZ_RECENT = '/bndz/recent';
export const BNDZ_MEDIA = '/bndz/media';
export const BNDZ_AUDIO = '/bndz/audio';
export const BNDZ_DOCUMENTS = '/bndz/documents';
export const BNDZ_LARGE = '/bndz/large';

export type BndzVirtualView = 'recent' | 'media' | 'audio' | 'documents' | 'large';

export function isBndzVirtualPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_VIEWS_ROOT || n.startsWith(`${BNDZ_VIEWS_ROOT}/`);
}

export function parseBndzVirtualView(path: string): BndzVirtualView | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n === BNDZ_RECENT) return 'recent';
  if (n === BNDZ_MEDIA) return 'media';
  if (n === BNDZ_AUDIO) return 'audio';
  if (n === BNDZ_DOCUMENTS) return 'documents';
  if (n === BNDZ_LARGE) return 'large';
  return null;
}

export function bndzVirtualPath(view: BndzVirtualView): string {
  return `${BNDZ_VIEWS_ROOT}/${view}`;
}

export function bndzVirtualLabel(view: BndzVirtualView): string {
  switch (view) {
    case 'recent': return 'Recent files';
    case 'media': return 'Photos & videos';
    case 'audio': return 'Audio library';
    case 'documents': return 'Documents';
    case 'large': return 'Large files';
  }
}
