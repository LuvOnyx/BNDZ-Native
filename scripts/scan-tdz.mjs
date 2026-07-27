import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const declLine = new Map();
  const declRe = /^\s*(?:export\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/;
  lines.forEach((line, i) => {
    const m = line.match(declRe);
    if (m) declLine.set(m[1], i + 1);
  });

  const issues = [];
  for (const hook of ['useEffect', 'useMemo', 'useCallback']) {
    const re = new RegExp(`${hook}\\s*\\(`, 'g');
    let em;
    while ((em = re.exec(src))) {
      const start = em.index;
      let depth = 0;
      let i = start;
      let depStart = -1;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            const between = src.slice(start, i + 1);
            const depMatch = between.match(/,\s*\[([\s\S]*)\]\s*\)\s*$/);
            if (depMatch) {
              const effectStartLine = src.slice(0, start).split(/\r?\n/).length;
              const deps = depMatch[1]
                .split(',')
                .map(s => s.trim().replace(/\.\w+$/, ''))
                .filter(Boolean);
              for (const dep of deps) {
                if (!/^[A-Za-z_$][\w$]*$/.test(dep)) continue;
                const line = declLine.get(dep);
                if (line && line > effectStartLine) {
                  issues.push({ hook, dep, effectLine: effectStartLine, declLine: line });
                }
              }
            }
            break;
          }
        }
        i++;
      }
    }
  }
  return issues;
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const allIssues = [];
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  for (const issue of scanFile(file)) {
    allIssues.push({ file: rel, ...issue });
  }
}

if (allIssues.length) {
  console.error('TDZ risks:');
  for (const i of allIssues) {
    console.error(`  ${i.file}:${i.effectLine} ${i.hook} dep "${i.dep}" declared line ${i.declLine}`);
  }
  process.exit(1);
}
console.log('No TDZ hook dep issues found.');
