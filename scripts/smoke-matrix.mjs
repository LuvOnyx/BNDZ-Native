/**
 * Sprint 4 smoke gate — lint, UI audit, full production build, unit + E2E tests.
 * Run: node scripts/smoke-matrix.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

function run(label, args, opts = {}) {
  console.log(`\n▶ ${label}`);
  const env = {
    ...process.env,
    NUGET_PACKAGES: process.env.NUGET_PACKAGES || path.join(process.env.USERPROFILE || process.env.HOME || '', '.nuget', 'packages'),
    ...opts.env,
  };
  const r = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: ROOT, stdio: 'inherit', env, ...opts })
    : spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', env, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

function runNode(label, script, extraArgs = []) {
  console.log(`\n▶ ${label}`);
  const runner = script.includes('test-index-finding') ? process.platform === 'win32'
    ? ['npx.cmd', 'tsx', script, ...extraArgs]
    : ['npx', 'tsx', script, ...extraArgs]
    : [process.execPath, script, ...extraArgs];
  const r = spawnSync(runner[0], runner.slice(1), { cwd: ROOT, stdio: 'inherit', shell: script.includes('test-index-finding') });
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
run('Production build (FM)', ['run', 'build']);

runNode('Interaction smoke tests', 'scripts/test-interaction.mjs');
runNode('Index/finding unit tests', 'scripts/test-index-finding.mjs');
runNode('Storage organize unit tests', 'scripts/test-storage-organize.mjs');

console.log('\n▶ Playwright E2E (critical paths)');
const playwrightBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'ms-playwright');
const pwEnv = { ...process.env, CI: '1', PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers };
const pwCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const pwInstall = spawnSync(process.execPath, [pwCli, 'install', 'chromium'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: pwEnv,
});
if (pwInstall.status !== 0) {
  console.error(`\n✗ Playwright browser install failed (exit ${pwInstall.status})`);
  process.exit(pwInstall.status ?? 1);
}
run('Playwright E2E', ['run', 'test:e2e'], { env: pwEnv });

console.log('\n▶ .NET backend build (Release)');
const userNuget = path.join(process.env.USERPROFILE || process.env.HOME || '', '.nuget', 'packages');
const dotnetEnv = {
  ...process.env,
  NUGET_PACKAGES: userNuget,
};
const backendDir = path.join(ROOT, 'BNDZBackend');
const dotnetRestore = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'dotnet', 'restore'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: dotnetEnv,
    })
  : spawnSync('dotnet', ['restore'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: dotnetEnv,
    });
if (dotnetRestore.status !== 0) {
  console.error(`\n✗ .NET restore failed (exit ${dotnetRestore.status})`);
  process.exit(dotnetRestore.status ?? 1);
}
const dotnet = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'dotnet', 'build', '-c', 'Release', '--no-restore'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: dotnetEnv,
    })
  : spawnSync('dotnet', ['build', '-c', 'Release', '--no-restore'], {
      cwd: backendDir,
      stdio: 'inherit',
      env: dotnetEnv,
    });
if (dotnet.status !== 0) {
  console.error(`\n✗ .NET backend build failed (exit ${dotnet.status})`);
  process.exit(dotnet.status ?? 1);
}
console.log('✓ .NET backend build');

console.log('\n✓ Smoke matrix passed — restart BNDZ to load new assets.');
