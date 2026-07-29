/** BNDZ-native smart views — backed by local file cache, not external engines. */

export const BNDZ_VIEWS_ROOT = '/bndz';
export const BNDZ_HOME = '/bndz/home';
export const BNDZ_RECENT = '/bndz/recent';
export const BNDZ_MEDIA = '/bndz/media';
export const BNDZ_AUDIO = '/bndz/audio';
export const BNDZ_DOCUMENTS = '/bndz/documents';
export const BNDZ_LARGE = '/bndz/large';
export const BNDZ_CANVAS = '/bndz/canvas';
export const BNDZ_AUTOMATION = '/bndz/automation';
export const BNDZ_RAM_ROOT = '/bndz/ram';

export type BndzVirtualView = 'recent' | 'media' | 'audio' | 'documents' | 'large';
export type BndzWorkspaceView = 'canvas' | 'automation';

export function isBndzVirtualPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_VIEWS_ROOT || n.startsWith(`${BNDZ_VIEWS_ROOT}/`);
}

export function isBndzRamPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return n === BNDZ_RAM_ROOT || n.startsWith(`${BNDZ_RAM_ROOT}/`);
}

export function parseBndzRamZoneId(path: string): string | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!n.startsWith(`${BNDZ_RAM_ROOT}/`)) return null;
  const zoneId = n.slice(BNDZ_RAM_ROOT.length + 1).split('/')[0];
  return zoneId || null;
}

export function bndzRamVirtualPath(zoneId: string): string {
  return `${BNDZ_RAM_ROOT}/${zoneId}`;
}

export function isBndzHomePath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_HOME;
}

export function isBndzCanvasPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_CANVAS;
}

export function isBndzAutomationPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_AUTOMATION;
}

export function isBndzWorkspacePath(path: string): boolean {
  return isBndzCanvasPath(path) || isBndzAutomationPath(path);
}

export function parseBndzWorkspaceView(path: string): BndzWorkspaceView | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n === BNDZ_CANVAS) return 'canvas';
  if (n === BNDZ_AUTOMATION) return 'automation';
  return null;
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

export function bndzWorkspaceLabel(view: BndzWorkspaceView): string {
  switch (view) {
    case 'canvas': return 'Spatial Canvas';
    case 'automation': return 'Automation';
  }
}
