export interface OrganizeBucketConfig {
  re: RegExp;
  color: string;
  icon: string;
}

export const ORGANIZE_BUCKETS: Record<string, OrganizeBucketConfig> = {
  Images: { re: /\.(png|jpe?g|gif|bmp|webp|svg|ico|heic|tiff?|raw)$/i, color: '#f472b6', icon: 'images_ui' },
  Videos: { re: /\.(mp4|mkv|avi|mov|wmv|webm|m4v)$/i, color: '#a78bfa', icon: 'film_ui' },
  Audio: { re: /\.(mp3|wav|flac|aac|ogg|m4a|wma)$/i, color: '#0078d4', icon: 'music_ui' },
  Documents: { re: /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|csv|md)$/i, color: '#fbbf24', icon: 'file_ui' },
  Archives: { re: /\.(zip|rar|7z|tar|gz|bz2)$/i, color: '#fb923c', icon: 'compress' },
  Code: { re: /\.(js|ts|jsx|tsx|py|cs|java|cpp|c|h|html|css|json|xml|sql)$/i, color: '#34d399', icon: 'code_ui' },
};

export interface OrganizePlanEntry {
  file: string;
  name: string;
  bucket: string;
  dest: string;
}

export function bucketForFile(name: string): string {
  for (const [bucket, cfg] of Object.entries(ORGANIZE_BUCKETS)) {
    if (cfg.re.test(name)) return bucket;
  }
  return 'Other';
}

export function panePathFromWin(winPath: string): string {
  const norm = winPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(norm)) return `/${norm}`;
  return norm.startsWith('/') ? norm : `/${norm}`;
}

export function winPathFromPane(panePath: string): string {
  if (!panePath || panePath === '/' || panePath === '/this-pc') return '';
  let p = panePath.replace(/\//g, '\\');
  if (p.startsWith('\\')) p = p.slice(1);
  if (/^[A-Za-z]:$/.test(p)) p += '\\';
  return p;
}

export type OrganizeMode = 'buckets' | 'flatten' | 'date-tree' | 'dedupe-folders';

export function fileWinPath(
  rootWinPath: string,
  file: { name?: string; path?: string },
): string {
  const root = rootWinPath.replace(/\\+$/, '');
  if (file.path) return file.path.replace(/\//g, '\\');
  return `${root}\\${file.name || ''}`;
}

export function buildOrganizePlan(
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string }>,
  _paneRoot?: string,
): OrganizePlanEntry[] {
  const root = rootWinPath.replace(/\\+$/, '');
  return entries
    .filter(e => e.type === 'file')
    .map(file => {
      const name = file.name || '';
      const bucket = bucketForFile(name);
      const src = fileWinPath(root, file);
      const dest = `${root}\\${bucket}\\${name}`;
      return { file: src, name, bucket, dest };
    })
    .filter(p => p.file.toLowerCase() !== p.dest.toLowerCase());
}

/** Move files from nested paths into the root folder (keeps basename). */
export function buildFlattenPlan(
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string }>,
): OrganizePlanEntry[] {
  const root = rootWinPath.replace(/\\+$/, '');
  const rootLower = root.toLowerCase();
  return entries
    .filter(e => e.type === 'file')
    .map(file => {
      const name = file.name || '';
      const src = fileWinPath(root, file);
      const parent = src.replace(/\\[^\\]+$/, '');
      if (parent.toLowerCase() === rootLower) return null;
      return { file: src, name, bucket: 'Root', dest: `${root}\\${name}` };
    })
    .filter((p): p is OrganizePlanEntry => !!p && p.file.toLowerCase() !== p.dest.toLowerCase());
}

/** Group files into YYYY\\MM date folders (uses mtime when provided). */
export function buildDateTreePlan(
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string; dateModified?: string | number | Date }>,
): OrganizePlanEntry[] {
  const root = rootWinPath.replace(/\\+$/, '');
  const now = new Date();
  return entries
    .filter(e => e.type === 'file')
    .map(file => {
      const name = file.name || '';
      const src = fileWinPath(root, file);
      let d = now;
      if (file.dateModified != null) {
        const parsed = new Date(file.dateModified);
        if (!Number.isNaN(parsed.getTime())) d = parsed;
      }
      const yyyy = String(d.getFullYear());
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const bucket = `${yyyy}\\${mm}`;
      return { file: src, name, bucket, dest: `${root}\\${yyyy}\\${mm}\\${name}` };
    })
    .filter(p => p.file.toLowerCase() !== p.dest.toLowerCase());
}

/** Place each extension family into its own folder (lighter than full buckets). */
export function buildDedupeFolderPlan(
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string }>,
): OrganizePlanEntry[] {
  const root = rootWinPath.replace(/\\+$/, '');
  return entries
    .filter(e => e.type === 'file')
    .map(file => {
      const name = file.name || '';
      const src = fileWinPath(root, file);
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'no-ext';
      const bucket = `.${ext}`;
      return { file: src, name, bucket, dest: `${root}\\${bucket}\\${name}` };
    })
    .filter(p => p.file.toLowerCase() !== p.dest.toLowerCase());
}

export function buildOrganizePlanForMode(
  mode: OrganizeMode,
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string; dateModified?: string | number | Date }>,
): OrganizePlanEntry[] {
  switch (mode) {
    case 'flatten': return buildFlattenPlan(rootWinPath, entries);
    case 'date-tree': return buildDateTreePlan(rootWinPath, entries);
    case 'dedupe-folders': return buildDedupeFolderPlan(rootWinPath, entries);
    case 'buckets':
    default: return buildOrganizePlan(rootWinPath, entries);
  }
}

export async function applyOrganizePlan(
  plan: OrganizePlanEntry[],
  executeFs: (id: string, op: string, src: string, dest: string) => Promise<unknown>,
): Promise<number> {
  let moved = 0;
  const mkdirDone = new Set<string>();
  for (const entry of plan) {
    const destDir = entry.dest.replace(/\\[^\\]+$/, '');
    const key = destDir.toLowerCase();
    if (!mkdirDone.has(key)) {
      await executeFs(`org-mkdir-${destDir}`, 'create-dir', destDir, '');
      mkdirDone.add(key);
    }
    await executeFs(`org-move-${entry.name}-${moved}`, 'move', entry.file, entry.dest);
    moved++;
  }
  return moved;
}

export function groupOrganizePlanByBucket(plan: OrganizePlanEntry[]): Record<string, OrganizePlanEntry[]> {
  const groups: Record<string, OrganizePlanEntry[]> = {};
  for (const entry of plan) {
    if (!groups[entry.bucket]) groups[entry.bucket] = [];
    groups[entry.bucket].push(entry);
  }
  return groups;
}

export function formatStorageSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0))} ${sizes[i]}`;
}

export type DupKeepRule = 'first' | 'newest' | 'oldest' | 'shortest';

export interface DupGroup {
  hash: string;
  size: number;
  paths: string[];
}

export function pickKeepIndex(paths: string[], rule: DupKeepRule): number {
  if (paths.length < 2) return 0;
  if (rule === 'first') return 0;
  if (rule === 'shortest') {
    let best = 0;
    for (let i = 1; i < paths.length; i++) {
      if (paths[i].length < paths[best].length) best = i;
    }
    return best;
  }
  const sorted = paths.map((p, i) => ({ p, i })).sort((a, b) => a.p.localeCompare(b.p));
  return (rule === 'oldest' ? sorted[0] : sorted[sorted.length - 1]).i;
}

export interface DuplicateCleanupPreview {
  hash: string;
  size: number;
  paths: string[];
  keepPath: string;
  deletePaths: string[];
  reclaimable: number;
}

export function buildDuplicateCleanupPreview(
  groups: Array<{ hash: string; size: number; paths: string[] }>,
  keepRule: DupKeepRule,
): DuplicateCleanupPreview[] {
  return groups.map(g => {
    const keepIdx = pickKeepIndex(g.paths, keepRule);
    const keepPath = g.paths[keepIdx];
    const deletePaths = g.paths.filter((_, i) => i !== keepIdx);
    return {
      hash: g.hash,
      size: g.size,
      paths: g.paths,
      keepPath,
      deletePaths,
      reclaimable: g.size * deletePaths.length,
    };
  });
}
