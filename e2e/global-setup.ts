import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const E2E_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(E2E_ROOT, '.work');

export default async function globalSetup() {
  await fs.rm(WORK, { recursive: true, force: true });

  const organizeDir = path.join(WORK, 'organize-fixture');
  await fs.mkdir(organizeDir, { recursive: true });
  await fs.writeFile(path.join(organizeDir, 'readme.md'), '# organize e2e fixture\n');
  await fs.writeFile(path.join(organizeDir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(organizeDir, 'script.js'), 'export const ok = true;\n');

  const dupDir = path.join(WORK, 'dup-fixture');
  await fs.mkdir(dupDir, { recursive: true });
  const dupPayload = 'bndz-e2e-duplicate-payload-'.padEnd(5000, 'x');
  await fs.writeFile(path.join(dupDir, 'copy-a.dat'), dupPayload);
  await fs.writeFile(path.join(dupDir, 'copy-b.dat'), dupPayload);
  await fs.writeFile(path.join(dupDir, 'unique.dat'), 'only-one-copy');

  process.env.BNDZ_E2E_WORK = WORK;
}
