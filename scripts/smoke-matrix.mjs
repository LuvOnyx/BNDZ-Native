/**
 * Sprint 4 smoke gate — lint, UI audit, full production build.
 * Run: node scripts/smoke-matrix.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, args) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(npm, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

console.log('BNDZ smoke matrix — Sprint 4 gate');
run('TypeScript lint', ['run', 'lint']);
run('Wiring audit', ['run', 'audit:wiring']);
run('BNDZUI audit', ['run', 'audit:ui']);
run('Production build (FM + Launcher)', ['run', 'build:all']);
console.log('\n✓ Smoke matrix passed — restart BNDZ to load new assets.');
