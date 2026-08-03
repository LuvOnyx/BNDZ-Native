/**
 * Pre-flight audit for BNDZUI.tsx — catches missing imports and TDZ in useEffect deps.
 * Run: node scripts/audit-bndzui.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'src/components/BNDZUI.tsx');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

const importNames = new Set();
const importBlockRe = /import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
let im;
while ((im = importBlockRe.exec(src)) !== null) {
  const clause = im[1].replace(/\n/g, ' ').trim();
  const defaultBeforeNamed = clause.match(/^([\w$]+)\s*,\s*\{/);
  if (defaultBeforeNamed) importNames.add(defaultBeforeNamed[1]);
  const defaultOnly = clause.match(/^([\w$]+)\s*$/);
  if (defaultOnly) importNames.add(defaultOnly[1]);
  const chunks = clause.includes('{')
    ? [clause.split('{')[0], ...(clause.match(/\{([^}]+)\}/)?.[1]?.split(',') ?? [])]
    : clause.split(',');
  for (let p of chunks) {
    p = p.trim().replace(/^type\s+/, '');
    if (!p || p === '{' || p === '}') continue;
    const name = p.split(/\s+as\s+/).pop().trim();
    if (/^[\w$]+$/.test(name)) importNames.add(name);
  }
}

const lazyDefault = [...src.matchAll(/const\s+(\w+)\s*=\s*lazy\(/g)].map(m => m[1]);
lazyDefault.forEach(n => importNames.add(n));

const jsx = new Set();
for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) jsx.add(m[1]);

const skip = new Set([
  'React', 'Suspense', 'Fragment', 'AnimatePresence', 'motion',
  'ToolbarButton', 'Spinner', 'InlineRenameInput', 'Icon',
  'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'HTMLUListElement',
  'Record', 'Set', 'Map', 'ReturnType', 'PaneState', 'KeyboardEvent', 'MouseEvent',
  'RenameOperation', 'VisualFilter', 'TabState', 'DriveInfo', 'ShortcutInfo',
  'VirtualDirectory', 'FSEntity', 'ToastKind', 'PaletteAction', 'ListColumnId',
  'SortColumnId', 'NavTreeBuildNode',
]);
const missingJsx = [...jsx].filter(n => !importNames.has(n) && !skip.has(n)).sort();

/** Find const/let/function line numbers for identifiers */
const declLine = new Map();
const declRe = /^\s*(?:export\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/;
lines.forEach((line, i) => {
  const m = line.match(declRe);
  if (m) declLine.set(m[1], i + 1);
});

/** useEffect dependency arrays that reference identifiers declared later */
const tdzIssues = [];
const effectRe = /useEffect\s*\(/g;
let em;
while ((em = effectRe.exec(src)) !== null) {
  const start = em.index;
  const slice = src.slice(start, start + 4000);
  const depMatch = slice.match(/\},\s*\[([\s\S]*?)\]\s*\)/);
  if (!depMatch) continue;
  const effectStartLine = src.slice(0, start).split(/\r?\n/).length;
  const deps = depMatch[1]
    .split(',')
    .map(s => s.trim().replace(/\.\w+$/, ''))
    .filter(Boolean);
  for (const dep of deps) {
    if (!/^[A-Za-z_$][\w$]*$/.test(dep)) continue;
    const line = declLine.get(dep);
    if (line && line > effectStartLine) {
      tdzIssues.push({ dep, effectLine: effectStartLine, declLine: line });
    }
  }
}

/** Ref sync before const ref = useRef — runtime TDZ crash in production bundles */
const refTdz = [];
for (const m of src.matchAll(/^(\s*)(\w+Ref)\.current\s*=/gm)) {
  const refName = m[2];
  const useLine = src.slice(0, m.index).split(/\r?\n/).length + 1;
  const decl = declLine.get(refName);
  if (decl && decl > useLine) {
    refTdz.push({ refName, useLine, declLine: decl });
  }
}

/** useState destructure setters/getters */
for (const m of src.matchAll(/\[\s*(\w+)\s*,\s*(set\w+)\s*\]/g)) {
  declLine.set(m[1], declLine.get(m[1]) ?? 0);
  declLine.set(m[2], declLine.get(m[2]) ?? 0);
}
/** Hook / object destructures: const { a, b: c } = ... */
for (const m of src.matchAll(/const\s*\{([^}]+)\}\s*=/g)) {
  for (const part of m[1].split(',')) {
    const raw = part.trim();
    if (!raw || raw.startsWith('...')) continue;
    let name = raw;
    if (raw.includes(':')) {
      // { publish: publishLiveShare } → publishLiveShare; { peers } → peers
      name = raw.split(':').pop().trim();
    }
    name = name.split('=')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) declLine.set(name, declLine.get(name) ?? 0);
  }
}

/** Undeclared identifiers in useEffect / useCallback / useMemo dependency arrays */
const undeclaredDeps = [];
const hookRe = /use(?:Effect|Callback|Memo)\s*\(/g;
let hm;
while ((hm = hookRe.exec(src)) !== null) {
  const start = hm.index;
  const slice = src.slice(start, start + 8000);
  const depMatch = slice.match(/\},\s*\[([\s\S]*?)\]\s*\)/);
  if (!depMatch) continue;
  const effectStartLine = src.slice(0, start).split(/\r?\n/).length;
  const deps = depMatch[1]
    .split(',')
    .map(s => s.trim().replace(/\.\w+$/, ''))
    .filter(Boolean);
  for (const dep of deps) {
    if (!/^[A-Za-z_$][\w$]*$/.test(dep)) continue;
    if (importNames.has(dep)) continue;
    if (declLine.has(dep)) continue;
    if (/^(true|false|null|undefined)$/.test(dep)) continue;
    undeclaredDeps.push({ dep, effectLine: effectStartLine });
  }
}

/** Folder load must not serialize HELLO_GATE_CHECK before GET_DIR_CONTENTS (timeout blocks panes). */
const beginFetchGateBlocked = /helloGateCheck\s*\([\s\S]{0,400}?getDirContents\s*\(/;

let failed = false;
if (beginFetchGateBlocked.test(src)) {
  failed = true;
  console.error('Hello Gate must not block getDirContents — use DIR_CONTENTS HELLO_GATE_BLOCKED handling instead.');
}
const criticalSymbols = ['IPC'];
for (const sym of criticalSymbols) {
  const used = new RegExp(`\\b${sym}\\.`).test(src);
  if (used && !importNames.has(sym)) {
    failed = true;
    console.error(`Missing import for ${sym} (referenced in BNDZUI.tsx)`);
  }
}
if (missingJsx.length) {
  failed = true;
  console.error('Missing imports for JSX components:');
  missingJsx.forEach(n => console.error(`  - ${n}`));
}
if (tdzIssues.length) {
  failed = true;
  console.error('Temporal dead zone risks (useEffect deps before declaration):');
  for (const { dep, effectLine, declLine: dl } of tdzIssues) {
    console.error(`  - ${dep}: used in effect ~line ${effectLine}, declared line ${dl}`);
  }
}
if (refTdz.length) {
  failed = true;
  console.error('Ref sync before useRef declaration (runtime TDZ):');
  for (const { refName, useLine, declLine: dl } of refTdz) {
    console.error(`  - ${refName}: assigned line ${useLine}, declared line ${dl}`);
  }
}
if (undeclaredDeps.length) {
  failed = true;
  console.error('Undeclared hook dependency identifiers (runtime ReferenceError risk):');
  for (const { dep, effectLine } of undeclaredDeps) {
    console.error(`  - ${dep}: used in deps ~line ${effectLine}`);
  }
}

/** Stale Assets/ui drift: shipped bundle must not serialize helloGateCheck before listing. */
const assetsDir = path.join(ROOT, 'BNDZBackend/Assets/ui/assets');
try {
  const indexes = fs.readdirSync(assetsDir)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (indexes.length) {
    const latest = fs.readFileSync(path.join(assetsDir, indexes[0].f), 'utf8');
    if (/helloGateCheck\([^)]*\)\.then/.test(latest)) {
      failed = true;
      console.error(`Stale UI bundle ${indexes[0].f}: still serializes helloGateCheck before dir load — run npm run build.`);
    }
  }
} catch {
  /* assets may be absent in pure lint environments */
}

if (!failed) {
  console.log('BNDZUI audit passed (imports + TDZ + refs + undeclared deps + hello-gate + assets).');
  process.exit(0);
}
process.exit(1);
