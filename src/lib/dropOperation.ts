/** Drive letter or UNC root for same-drive vs cross-drive drop defaults. */
export function dropRootKey(winPath: string): string {
  const p = (winPath || '').replace(/\//g, '\\').trim();
  if (!p) return '';
  if (p.startsWith('\\\\')) {
    const parts = p.split('\\').filter(Boolean);
    return parts.length >= 2 ? `\\\\${parts[0]}\\${parts[1]}`.toLowerCase() : p.toLowerCase();
  }
  const m = /^([A-Za-z]:)/.exec(p);
  return m ? m[1].toUpperCase() : p.toLowerCase();
}

function parseDropDefault(raw: unknown, fallback: 'copy' | 'move'): 'copy' | 'move' {
  const s = String(raw || '').toLowerCase();
  if (s.includes('copy')) return 'copy';
  if (s.includes('move')) return 'move';
  return fallback;
}

/**
 * Resolve drop operation from modifiers + Shell Integration defaults.
 * Ctrl/Alt (or explicit copy drag) always force copy; Shift can force move.
 * Otherwise same-drive vs different-drive defaults from Configuration apply.
 */
export function resolveDropOperation(opts: {
  payloadCopy?: boolean;
  dropModifierCopy?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  sourcePaths?: string[];
  destDir?: string;
  sameDriveDefault?: unknown;
  crossDriveDefault?: unknown;
}): 'copy' | 'move' {
  if (opts.payloadCopy || opts.dropModifierCopy || opts.ctrlKey || opts.altKey) return 'copy';
  if (opts.shiftKey) return 'move';

  const sources = opts.sourcePaths || [];
  const dest = opts.destDir || '';
  if (sources.length && dest) {
    const destRoot = dropRootKey(dest);
    const sameDrive = sources.every(sp => dropRootKey(sp) === destRoot && !!destRoot);
    return sameDrive
      ? parseDropDefault(opts.sameDriveDefault, 'move')
      : parseDropDefault(opts.crossDriveDefault, 'copy');
  }

  return 'move';
}
