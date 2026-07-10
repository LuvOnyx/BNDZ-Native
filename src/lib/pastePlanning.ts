import type { AppConfig } from '../data/configContext';

function normalizeWin(path: string): string {
  let p = path.replace(/\//g, '\\').replace(/\\+$/, '');
  if (p.length === 2 && p[1] === ':') p += '\\';
  return p;
}

function parentDir(path: string): string {
  const n = normalizeWin(path);
  const ix = n.lastIndexOf('\\');
  if (ix <= 0) return n;
  return n.slice(0, ix);
}

/** True when clipboard sources span more than one parent folder (structure would change on flat paste). */
export function needsRecreateSourceStructure(sources: string[]): boolean {
  if (sources.length <= 1) return false;
  const parents = new Set(sources.map(s => parentDir(s).toLowerCase()));
  return parents.size > 1;
}

export function readRecreateStructureSetting(config: AppConfig): 'Ask' | 'Never' | 'Always' {
  const raw = config.recreateSourceFolderStructure;
  if (raw === 'Always' || raw === 'Never' || raw === 'Ask') return raw;
  return 'Ask';
}

/** Resolve whether paste should recreate source folder structure. */
export function resolveRecreateStructureForPaste(
  config: AppConfig,
  sources: string[],
  askUser: (message: string) => boolean,
): boolean {
  if (!needsRecreateSourceStructure(sources)) return false;
  const mode = readRecreateStructureSetting(config);
  if (mode === 'Never') return false;
  if (mode === 'Always') return true;
  return askUser(
    'Paste items from different folders?\n\nRecreate the source folder structure under the destination.',
  );
}
