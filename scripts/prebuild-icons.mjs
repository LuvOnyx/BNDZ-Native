/**
 * Cross-platform prebuild step: copy/download toolbar icons before Vite build.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform === 'win32') {
  const ps = spawnSync(
    'powershell',
    ['-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'copy-launcher-toolbar-icons.ps1')],
    { cwd: root, stdio: 'inherit' },
  );
  if (ps.status !== 0) process.exit(ps.status ?? 1);
} else {
  console.log('prebuild-icons: downloading Icons8 toolbar icons via Node');
  const dl = spawnSync(process.execPath, [path.join(root, 'scripts', 'download-icons8-3d-toolbar.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (dl.status !== 0) process.exit(dl.status ?? 1);
}
