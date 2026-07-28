/**
 * Catches missing imports in view/workspace components (runtime ReferenceError class).
 * Run: node scripts/audit-view-imports.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLOBS = [
  'src/components/views',
  'src/components/workspace',
];

function collectFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(p));
    else if (/\.(tsx|ts)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function parseImports(src) {
  const names = new Set();
  const re = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const clause = m[1].replace(/\n/g, ' ').trim();
    const defaultBeforeNamed = clause.match(/^([\w$]+)\s*,\s*\{/);
    if (defaultBeforeNamed) names.add(defaultBeforeNamed[1]);
    const defaultOnly = clause.match(/^([\w$]+)\s*$/);
    if (defaultOnly) names.add(defaultOnly[1]);
    const chunks = clause.includes('{')
      ? [clause.split('{')[0], ...(clause.match(/\{([^}]+)\}/)?.[1]?.split(',') ?? [])]
      : clause.split(',');
    for (let p of chunks) {
      p = p.trim().replace(/^type\s+/, '');
      if (!p || p === '{' || p === '}') continue;
      const name = p.split(/\s+as\s+/).pop().trim();
      if (/^[\w$]+$/.test(name)) names.add(name);
    }
  }
  return names;
}

function jsxComponents(src) {
  const ids = new Set();
  // Opening JSX tags only (not TypeScript generics like useRef<HTMLDivElement>).
  const re = /<([A-Z][a-zA-Z][\w]*)\s*(?:\/|>|\{)/g;
  let m;
  while ((m = re.exec(src)) !== null) ids.add(m[1]);
  return ids;
}

const builtins = new Set([
  'React', 'Fragment', 'Suspense', 'StrictMode', 'Profiler',
  'Handle', 'Panel', 'Background', 'Controls', 'MiniMap', 'ReactFlow',
  'SelectionMode', 'Position',
]);

let failed = false;
for (const rel of GLOBS) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) continue;
  for (const file of collectFiles(dir)) {
    const src = fs.readFileSync(file, 'utf8');
    const imports = parseImports(src);
    const used = jsxComponents(src);
    for (const id of used) {
      if (builtins.has(id)) continue;
      if (imports.has(id)) continue;
      if (/Element$/.test(id) || id === 'NodeData' || id === 'NodeDef') continue;
      if (new RegExp(`(?:function|const|type|interface)\\s+${id}\\b`).test(src)) continue;
      console.error(`MISSING IMPORT: ${path.relative(ROOT, file)} uses <${id}> but does not import it`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('View import audit passed.');
