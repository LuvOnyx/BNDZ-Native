import { isMeshPath, normalizeMeshPath } from './meshPaths';
import { toWindowsPath } from './pathUtils';

/** Canonical Windows path for equality checks (trim trailing slashes; drive roots keep `\`). */
export function normalizeWinPathForCompare(path: string): string {
  let p = toWindowsPath(path).trim();
  if (!p) return '';
  // Collapse duplicate separators
  while (p.includes('\\\\') && !p.startsWith('\\\\')) p = p.replace(/\\\\/g, '\\');
  const unc = p.startsWith('\\\\');
  p = p.replace(/[/\\]+$/g, '');
  if (unc && !p.startsWith('\\\\')) p = '\\\\' + p.replace(/^\\+/, '');
  if (/^[A-Za-z]:$/i.test(p)) p += '\\';
  return p.toLowerCase();
}

/** Parent directory of a file/folder Windows path. */
export function getParentWinPath(filePath: string): string {
  let win = toWindowsPath(filePath).replace(/[/\\]+$/g, '');
  if (!win) return '';
  if (/^[A-Za-z]:$/i.test(win)) return win.toUpperCase() + '\\';
  const idx = Math.max(win.lastIndexOf('\\'), win.lastIndexOf('/'));
  if (idx <= 0) return win;
  const parent = win.slice(0, idx);
  if (/^[A-Za-z]:$/i.test(parent)) return parent.toUpperCase() + '\\';
  return parent;
}

function meshParentPath(filePath: string): string {
  const n = normalizeMeshPath(filePath);
  const idx = n.lastIndexOf('/');
  if (idx <= 0) return n;
  const parent = n.slice(0, idx);
  return parent === '/mesh' ? parent : parent || '/';
}

/** True when every source already lives directly in destDir (Explorer put-back / no-op move). */
export function isSameDropLocation(sourcePaths: string[], destDir: string): boolean {
  if (!sourcePaths.length || !destDir) return false;

  // Mesh pane paths must not go through toWindowsPath (yields mesh\host\… garbage).
  if (isMeshPath(destDir)) {
    if (!sourcePaths.every(isMeshPath)) return false;
    const dest = normalizeMeshPath(destDir).toLowerCase();
    return sourcePaths.every(sp => meshParentPath(sp).toLowerCase() === dest);
  }
  if (sourcePaths.some(isMeshPath)) return false;

  const dest = normalizeWinPathForCompare(destDir);
  if (!dest) return false;
  return sourcePaths.every(sp => normalizeWinPathForCompare(getParentWinPath(sp)) === dest);
}

/**
 * True when dest is one of the sources or nested inside a dragged folder
 * (would move a folder into itself).
 */
export function isDropIntoDraggedSource(sourcePaths: string[], destDir: string): boolean {
  if (!sourcePaths.length || !destDir) return false;

  if (isMeshPath(destDir) || sourcePaths.some(isMeshPath)) {
    if (!isMeshPath(destDir) || !sourcePaths.every(isMeshPath)) return false;
    const dest = normalizeMeshPath(destDir).toLowerCase();
    return sourcePaths.some(sp => {
      const src = normalizeMeshPath(sp).toLowerCase();
      return dest === src || dest.startsWith(`${src}/`);
    });
  }

  const dest = normalizeWinPathForCompare(destDir);
  if (!dest) return false;
  return sourcePaths.some(sp => {
    const src = normalizeWinPathForCompare(sp);
    if (!src) return false;
    return dest === src || dest.startsWith(src + '\\');
  });
}

/**
 * Whether an internal list drag should commit a file operation on pointer-up.
 * Put-back / cancel: release near start without an intentional foreign target,
 * or drop onto same folder / into a dragged item.
 */
export function shouldCommitInternalFileDrop(opts: {
  sourcePaths: string[];
  destDir: string;
  op: 'copy' | 'move';
  /** Nav tree, breadcrumb, other tab, or a folder that is not part of the drag selection. */
  hasForeignTarget: boolean;
  /** Pointer distance from drag start (px). */
  pointerTravelPx: number;
  /** Max travel treated as "put back" when there is no foreign target. */
  putBackSlopPx?: number;
  /** Tree/breadcrumb/folder target from hover memory — commit even when pointer-up coords lie. */
  explicitDropTarget?: boolean;
}): boolean {
  const {
    sourcePaths,
    destDir,
    op,
    hasForeignTarget,
    pointerTravelPx,
    putBackSlopPx = 14,
    explicitDropTarget = false,
  } = opts;

  if (!sourcePaths.length || !destDir) return false;
  if (isDropIntoDraggedSource(sourcePaths, destDir)) return false;

  const srcMesh = sourcePaths.some(isMeshPath);
  const destMesh = isMeshPath(destDir);
  // Local ↔ mesh is always a real transfer — never treat as put-back.
  if (srcMesh !== destMesh) return true;

  const same = isSameDropLocation(sourcePaths, destDir);
  if (op === 'move' && same) return false;

  // Explicit tree/breadcrumb/folder target from last good hover — never cancel as put-back.
  if (explicitDropTarget && hasForeignTarget) return op === 'copy' || !same;

  // Picked up and released in place — do not treat background as a drop.
  if (!hasForeignTarget && pointerTravelPx < putBackSlopPx) return false;

  if (op === 'copy') return true;
  return !same;
}
