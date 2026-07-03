import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';

/** Resolve pane-style or Windows paths to an absolute filesystem path. */
export function resolveFsPath(input: string): string {
  if (!input || input === '/' || input === '') return process.cwd();
  let p = String(input).trim().replace(/\//g, path.sep);
  if (p.startsWith(path.sep) && /^[A-Za-z]:/.test(p.slice(1))) {
    p = p.slice(1);
  }
  if (/^[A-Za-z]:/.test(p)) return p;
  return path.resolve(p.startsWith(path.sep) ? p.slice(1) : p);
}

export async function listDirectory(dirPath: string) {
  const resolvedPath = resolveFsPath(dirPath);
  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    try {
      const full = path.join(resolvedPath, entry.name);
      const stat = await fs.stat(full);
      result.push({
        id: full,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified: stat.mtimeMs,
        extension: entry.isDirectory() ? '' : path.extname(entry.name).replace('.', ''),
        path: full,
      });
    } catch {
      // skip broken entries
    }
  }
  return { items: result, parent: path.dirname(resolvedPath) };
}

export async function executeFsOperation(
  action: string,
  source: string | string[],
  target: string,
): Promise<void> {
  switch (action) {
    case 'create-dir': {
      const dir = resolveFsPath(target || (typeof source === 'string' ? source : ''));
      await fs.mkdir(dir, { recursive: true });
      return;
    }
    case 'create-file': {
      const file = resolveFsPath(target || (typeof source === 'string' ? source : ''));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '', { flag: 'a' });
      return;
    }
    case 'move': {
      const src = resolveFsPath(typeof source === 'string' ? source : source[0] || '');
      const dest = resolveFsPath(target);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(src, dest);
      return;
    }
    case 'delete': {
      const src = resolveFsPath(typeof source === 'string' ? source : source[0] || '');
      const stat = await fs.stat(src);
      if (stat.isDirectory()) await fs.rm(src, { recursive: true, force: true });
      else await fs.unlink(src);
      return;
    }
    default:
      throw new Error(`Unsupported web FS action: ${action}`);
  }
}

async function walkFiles(root: string, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export async function scanDuplicates(
  rootPath: string,
  recursive = true,
  minSizeBytes = 1024,
): Promise<{ groups: Array<{ hash: string; size: number; paths: string[] }> }> {
  const root = resolveFsPath(rootPath);
  const files = recursive ? await walkFiles(root) : (await fs.readdir(root, { withFileTypes: true }))
    .filter(e => e.isFile())
    .map(e => path.join(root, e.name));

  const byHash = new Map<string, { size: number; paths: string[] }>();

  for (const file of files) {
    const stat = await fs.stat(file);
    if (stat.size < minSizeBytes) continue;
    const buf = await fs.readFile(file);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = byHash.get(hash);
    if (existing) existing.paths.push(file);
    else byHash.set(hash, { size: stat.size, paths: [file] });
  }

  const groups = [...byHash.entries()]
    .filter(([, g]) => g.paths.length > 1)
    .map(([hash, g]) => ({ hash, size: g.size, paths: g.paths }));

  return { groups };
}

export function ensurePathExists(p: string): boolean {
  return fsSync.existsSync(resolveFsPath(p));
}
