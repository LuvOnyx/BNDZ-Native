/** Archive extensions BNDZ can list in preview */
export const ARCHIVE_EXTENSIONS = [
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'lz', 'cab', 'iso', 'jar', 'war', 'ear',
  'cbz', 'cbr', 'cbt', 'cb7', 'nupkg', 'snupkg', 'vsix', 'crx', 'whl', 'egg', 'apk',
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

/** Normalize archive internal paths to forward slashes without trailing slash (except root). */
export function normalizeArchivePath(p: string): string {
  const n = (p || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (n === '/') return '';
  return n.endsWith('/') ? n.slice(0, -1) : n;
}

/** List direct children of a folder inside a flat archive entry list. */
export function listArchiveFolder(entries: ArchiveEntry[], folderPath: string): ArchiveEntry[] {
  const base = folderPath ? `${normalizeArchivePath(folderPath)}/` : '';
  const childMap = new Map<string, ArchiveEntry>();

  for (const raw of entries) {
    const full = normalizeArchivePath(raw.path);
    if (!full) continue;
    const isDirEntry = raw.isDirectory || full.endsWith('/') || !raw.name;
    const path = isDirEntry && !full.endsWith('/') ? `${full}/` : full;
    if (base && !path.startsWith(base)) continue;
    const remainder = base ? path.slice(base.length) : path;
    if (!remainder) continue;
    const parts = remainder.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    if (parts.length === 1) {
      const key = base + parts[0] + (raw.isDirectory || path.endsWith('/') ? '/' : '');
      childMap.set(key, {
        ...raw,
        path: key,
        name: parts[0],
        isDirectory: raw.isDirectory || key.endsWith('/'),
      });
    } else {
      const folderKey = `${base}${parts[0]}/`;
      if (!childMap.has(folderKey)) {
        childMap.set(folderKey, {
          path: folderKey,
          name: parts[0],
          size: 0,
          compressedSize: 0,
          isDirectory: true,
        });
      }
    }
  }

  return Array.from(childMap.values()).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function archiveBreadcrumb(folderPath: string): { label: string; path: string }[] {
  const crumbs = [{ label: 'Archive', path: '' }];
  const norm = normalizeArchivePath(folderPath);
  if (!norm) return crumbs;
  const parts = norm.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  modified?: string;
}

export interface ArchiveTreeNode {
  path: string;
  name: string;
  children: ArchiveTreeNode[];
}

/** Build a folder tree from a flat archive entry list (WinRAR-style navigation). */
export function buildArchiveFolderTree(entries: ArchiveEntry[]): ArchiveTreeNode[] {
  const childMap = new Map<string, Set<string>>();

  const link = (parent: string, child: string) => {
    if (!childMap.has(parent)) childMap.set(parent, new Set());
    childMap.get(parent)!.add(child);
  };

  for (const raw of entries) {
    const norm = normalizeArchivePath(raw.path).replace(/\/$/, '');
    if (!norm) {
      if (raw.isDirectory && raw.name) link('', raw.name);
      continue;
    }
    const parts = norm.split('/').filter(Boolean);
    let parent = '';
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      if (isLast && !raw.isDirectory) break;
      link(parent, parts[i]);
      parent = parent ? `${parent}/${parts[i]}` : parts[i];
    }
  }

  const build = (parentPath: string): ArchiveTreeNode[] => {
    const kids = childMap.get(parentPath);
    if (!kids?.size) return [];
    return [...kids]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(name => {
        const path = parentPath ? `${parentPath}/${name}` : name;
        return { path, name, children: build(path) };
      });
  };

  return build('');
}

export type ArchiveSortKey = 'name' | 'size' | 'compressed' | 'modified';

export function sortArchiveEntries(items: ArchiveEntry[], key: ArchiveSortKey, asc = true): ArchiveEntry[] {
  const dir = asc ? 1 : -1;
  return [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    switch (key) {
      case 'size':
        return (a.size - b.size) * dir;
      case 'compressed':
        return (a.compressedSize - b.compressedSize) * dir;
      case 'modified': {
        const ta = a.modified ? Date.parse(a.modified) : 0;
        const tb = b.modified ? Date.parse(b.modified) : 0;
        return (ta - tb) * dir;
      }
      default:
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
    }
  });
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
