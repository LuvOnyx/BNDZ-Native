export const BNDZ_FILE_MIME = 'application/bndz-file';
export const BNDZ_TREE_REORDER_MIME = 'application/bndz-tree-reorder';

export interface BndzFileDragPayload {
  sourcePaneId?: string;
  sourcePath?: string;
  entityId?: string;
  paths: string[];
  fromTree?: boolean;
}

export function setBndzFileDragData(e: React.DragEvent, payload: BndzFileDragPayload) {
  e.dataTransfer.setData(BNDZ_FILE_MIME, JSON.stringify(payload));
  if (payload.paths?.length) {
    e.dataTransfer.setData('text/plain', payload.paths.join('\n'));
  }
  e.dataTransfer.effectAllowed = 'copyMove';
}

export function readBndzFileDragData(e: React.DragEvent): BndzFileDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(BNDZ_FILE_MIME);
    if (!raw) return null;
    const data = JSON.parse(raw) as BndzFileDragPayload;
    if (!data?.paths?.length) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasBndzFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(BNDZ_FILE_MIME);
}
