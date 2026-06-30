/** XYplorer-style selection info strip */

export type SelectionSummary = {
  count: number;
  files: number;
  folders: number;
  totalBytes: number;
  types: string;
};

export function summarizeSelection(
  entities: Array<{ type?: string; size?: number; extension?: string }>,
): SelectionSummary {
  let files = 0;
  let folders = 0;
  let totalBytes = 0;
  const extSet = new Set<string>();
  for (const e of entities) {
    if (e.type === 'directory') {
      folders++;
    } else {
      files++;
      totalBytes += e.size ?? 0;
      if (e.extension) extSet.add(e.extension.toLowerCase());
    }
  }
  const extList = [...extSet].slice(0, 4);
  const types = extList.length
    ? extList.join(', ') + (extSet.size > 4 ? '…' : '')
    : '';
  return { count: entities.length, files, folders, totalBytes, types };
}

export function formatSelectionSummaryLine(summary: SelectionSummary, formatSize: (n: number) => string): string {
  const parts: string[] = [`${summary.count} selected`];
  if (summary.folders) parts.push(`${summary.folders} folder${summary.folders === 1 ? '' : 's'}`);
  if (summary.files) parts.push(`${summary.files} file${summary.files === 1 ? '' : 's'}`);
  if (summary.totalBytes > 0) parts.push(formatSize(summary.totalBytes));
  if (summary.types) parts.push(summary.types);
  return parts.join(' · ');
}
