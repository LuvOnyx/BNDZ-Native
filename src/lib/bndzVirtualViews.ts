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
export const BNDZ_TWIN_VOLUME = '/bndz/twin-volume';
export const BNDZ_TEMPORAL_DIFF = '/bndz/temporal-diff';
export const BNDZ_RAM_ROOT = '/bndz/ram';
export const BNDZ_PROBLEMS = '/bndz/problems';
export const BNDZ_INBOUND = '/bndz/inbound';
export const BNDZ_SANDBOX = '/bndz/sandbox';
export const BNDZ_PORTAL_ROOT = '/bndz/port';
export const BNDZ_PORTAL_HEALTH = '/bndz/port/health';
export const BNDZ_PORTAL_MAGNETS = '/bndz/port/magnets';
export const BNDZ_PORTAL_SANDBOXES = '/bndz/port/sandboxes';
export const BNDZ_PORTAL_CAPTURE = '/bndz/port/capture';

export type BndzPortalView = 'health' | 'magnets' | 'sandboxes' | 'capture';

export type BndzVirtualView = 'recent' | 'media' | 'audio' | 'documents' | 'large' | 'problems' | 'inbound';
export type BndzWorkspaceView = 'canvas' | 'automation' | 'twin-volume' | 'temporal-diff';

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

/** True when path is inside a RAM zone (writable mount), not the /bndz/ram picker. */
export function isBndzRamWritablePath(path: string): boolean {
  return !!parseBndzRamZoneId(path);
}

/**
 * Pane paths that accept copy/move/paste/drop onto a real filesystem.
 * Includes RAM staging zone mounts; excludes smart views and /bndz/ram root.
 */
export function isFsDropTargetPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  if (!n || n === '/' || n === '/this-pc') return false;
  if (isBndzRamWritablePath(n)) return true;
  if (isBndzVirtualPath(n)) return false;
  return true;
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

export function isBndzTwinVolumePath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_TWIN_VOLUME;
}

export function isBndzTemporalDiffPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_TEMPORAL_DIFF;
}

export function isBndzWorkspacePath(path: string): boolean {
  return isBndzCanvasPath(path) || isBndzAutomationPath(path) || isBndzTwinVolumePath(path) || isBndzTemporalDiffPath(path);
}

export function parseBndzWorkspaceView(path: string): BndzWorkspaceView | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n === BNDZ_CANVAS) return 'canvas';
  if (n === BNDZ_AUTOMATION) return 'automation';
  if (n === BNDZ_TWIN_VOLUME) return 'twin-volume';
  if (n === BNDZ_TEMPORAL_DIFF) return 'temporal-diff';
  return null;
}

export function parseBndzVirtualView(path: string): BndzVirtualView | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n === BNDZ_RECENT) return 'recent';
  if (n === BNDZ_MEDIA) return 'media';
  if (n === BNDZ_AUDIO) return 'audio';
  if (n === BNDZ_DOCUMENTS) return 'documents';
  if (n === BNDZ_LARGE) return 'large';
  if (n === BNDZ_PROBLEMS) return 'problems';
  if (n === BNDZ_INBOUND) return 'inbound';
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
    case 'problems': return 'Library problems';
    case 'inbound': return 'Inbound';
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

export function bndzWorkspaceLabel(view: BndzWorkspaceView): string {
  switch (view) {
    case 'canvas': return 'Spatial Canvas';
    case 'automation': return 'Automation';
    case 'twin-volume': return 'Twin Volume Chess';
    case 'temporal-diff': return 'Time Diff';
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

export function isBndzProblemsPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_PROBLEMS || n.startsWith(`${BNDZ_PROBLEMS}/`);
}

export function isBndzInboundPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_INBOUND || n.startsWith(`${BNDZ_INBOUND}/`);
}

export function isBndzSandboxPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_SANDBOX || n.startsWith(`${BNDZ_SANDBOX}/`);
}

export function isBndzPortalPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return n === BNDZ_PORTAL_ROOT || n.startsWith(`${BNDZ_PORTAL_ROOT}/`);
}

export function parseBndzPortalView(path: string): BndzPortalView | null {
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n === BNDZ_PORTAL_HEALTH) return 'health';
  if (n === BNDZ_PORTAL_MAGNETS) return 'magnets';
  if (n === BNDZ_PORTAL_SANDBOXES) return 'sandboxes';
  if (n === BNDZ_PORTAL_CAPTURE) return 'capture';
  return null;
}

export function bndzPortalVirtualView(view: BndzPortalView): string {
  return `${BNDZ_PORTAL_ROOT}/${view}`;
}
