/**
 * Scan TSX files for hook dependency arrays referencing identifiers declared later.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

function scanFile(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const declLine = new Map();
  const declRe = /^\s*(?:export\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/;
  lines.forEach((line, i) => {
    const m = line.match(declRe);
    if (m) declLine.set(m[1], i + 1);
  });

  const issues = [];
  const hookRe = /use(?:Effect|Callback|Memo)\s*\(/g;
  let hm;
  while ((hm = hookRe.exec(src)) !== null) {
    const start = hm.index;
    let i = start;
    let depth = 0;
    let inString = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inString) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        inString = c;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    const hookSlice = src.slice(start, i);
    const depMatch = hookSlice.match(/,\s*\[([\s\S]*?)\]\s*\)\s*;?\s*$/);
    if (!depMatch) continue;
    const hookLine = src.slice(0, start).split(/\r?\n/).length;
    const hookType = src.slice(start, start + 15).match(/use(\w+)/)[1];
    const deps = depMatch[1]
      .split(',')
      .map(s => s.trim().replace(/\.\w+$/, ''))
      .filter(Boolean);
    for (const dep of deps) {
      if (!/^[A-Za-z_$][\w$]*$/.test(dep)) continue;
      const dl = declLine.get(dep);
      if (dl && dl > hookLine) {
        issues.push({ file: rel, hookType, dep, hookLine, declLine: dl });
      }
    }
  }
  return issues;
}

const targets = [
  'src/components/BNDZUI.tsx',
  'src/data/configContext.tsx',
  'src/data/PluginRegistryContext.tsx',
  'src/components/ModalProvider.tsx',
  'src/components/plugins/DesignBoardPlugin.tsx',
  'src/components/views/BndzSpatialCanvasView.tsx',
  'src/components/views/BndzAutomationView.tsx',
];

const all = targets.flatMap(scanFile);
if (all.length) {
  console.error('Hook TDZ issues:');
  for (const x of all) {
    console.error(`  ${x.file}:${x.hookLine} use${x.hookType} dep ${x.dep} declared line ${x.declLine}`);
  }
  process.exit(1);
}
console.log('No hook TDZ issues in scanned files.');
