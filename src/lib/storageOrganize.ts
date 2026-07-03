export interface OrganizeBucketConfig {
  re: RegExp;
  color: string;
  icon: string;
}

export const ORGANIZE_BUCKETS: Record<string, OrganizeBucketConfig> = {
  Images: { re: /\.(png|jpe?g|gif|bmp|webp|svg|ico|heic|tiff?|raw)$/i, color: '#f472b6', icon: '🖼' },
  Videos: { re: /\.(mp4|mkv|avi|mov|wmv|webm|m4v)$/i, color: '#a78bfa', icon: '🎬' },
  Audio: { re: /\.(mp3|wav|flac|aac|ogg|m4a|wma)$/i, color: '#38bdf8', icon: '🎵' },
  Documents: { re: /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|csv|md)$/i, color: '#fbbf24', icon: '📄' },
  Archives: { re: /\.(zip|rar|7z|tar|gz|bz2)$/i, color: '#fb923c', icon: '📦' },
  Code: { re: /\.(js|ts|jsx|tsx|py|cs|java|cpp|c|h|html|css|json|xml|sql)$/i, color: '#34d399', icon: '💻' },
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

export function buildOrganizePlan(
  rootWinPath: string,
  entries: Array<{ type?: string; name?: string; path?: string }>,
  paneRoot: string,
): OrganizePlanEntry[] {
  const root = rootWinPath.replace(/\\+$/, '');
  return entries
    .filter(e => e.type === 'file')
    .map(file => {
      const name = file.name || '';
      const bucket = bucketForFile(name);
      const src = file.path
        ? file.path.replace(/\//g, '\\')
        : `${root}\\${name}`;
      const dest = `${root}\\${bucket}\\${name}`;
      return { file: src, name, bucket, dest };
    })
    .filter(p => p.file.toLowerCase() !== p.dest.toLowerCase());
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
