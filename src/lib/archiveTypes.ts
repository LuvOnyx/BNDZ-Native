/** Archive extensions BNDZ can list in preview */
export const ARCHIVE_EXTENSIONS = [
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab', 'iso', 'jar', 'war',
] as const;

export const TORRENT_EXTENSIONS = ['torrent'] as const;

export type ArchiveFormat = 'zip' | '7z' | 'tar' | 'gz';

export function isArchiveExt(ext: string): boolean {
  const e = ext.toLowerCase().replace(/^\./, '');
  return ARCHIVE_EXTENSIONS.includes(e as any);
}

export function isTorrentExt(ext: string): boolean {
  return ext.toLowerCase().replace(/^\./, '') === 'torrent';
}

export function formatArchiveSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  modified?: string;
}

export interface TorrentFileEntry {
  path: string;
  size: number;
}

export interface TorrentInfo {
  name: string;
  announce?: string;
  comment?: string;
  createdBy?: string;
  pieceLength: number;
  pieceCount: number;
  totalSize: number;
  files: TorrentFileEntry[];
}
