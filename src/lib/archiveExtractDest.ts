/** Shared archive extract destination helpers. */

/** `<parent>\<archiveBaseName>\` — Quick Extract target. */
export function archiveQuickExtractDest(winArchivePath: string): string {
  const normalized = winArchivePath.replace(/\//g, '\\');
  const parent = normalized.replace(/\\[^\\]+$/, '');
  const file = normalized.split('\\').pop() || 'archive';
  const base = file.includes('.') ? file.replace(/\.[^.]+$/, '') : file;
  return `${parent}\\${base || 'extracted'}`;
}

export function archiveParentDir(winArchivePath: string): string {
  return winArchivePath.replace(/\//g, '\\').replace(/\\[^\\]+$/, '');
}
