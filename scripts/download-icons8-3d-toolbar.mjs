/**
 * Cross-platform Icons8 3D Fluency toolbar icon downloader.
 * Slug map is parsed from scripts/download-icons8-3d-toolbar.ps1 (single source of truth).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public', 'launcher-icons');
const size = Number(process.env.ICONS8_SIZE || 48);

function parseSlugMapFromPs1() {
  const ps1 = readFileSync(path.join(root, 'scripts', 'download-icons8-3d-toolbar.ps1'), 'utf8');
  const map = {};
  for (const m of ps1.matchAll(/^\s+([a-z0-9_]+)\s*=\s*'([^']+)'/gim)) {
    map[m[1]] = m[2];
  }
  return map;
}

const map = parseSlugMapFromPs1();
const only = process.argv.slice(2);
const entries = only.length
  ? Object.entries(map).filter(([id]) => only.includes(id))
  : Object.entries(map);

await mkdir(dest, { recursive: true });

let ok = 0;
let fail = 0;

for (const [id, slug] of entries) {
  const url = `https://img.icons8.com/3d-fluency/${size}/${slug}.png`;
  const out = path.join(dest, `${id}.png`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf);
    ok++;
  } catch (err) {
    console.warn(`Failed ${id} <- ${slug}:`, err.message || err);
    fail++;
  }
}

console.log(`==> Icons8 3D toolbar icons: ${ok} ok, ${fail} failed -> ${dest}`);
if (fail > 0) process.exitCode = 1;
