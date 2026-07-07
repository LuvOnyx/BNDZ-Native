import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const dest = path.join(root, 'BNDZBackend', 'Assets', 'legal');
const files = ['EULA.md', 'PRIVACY.md', 'THIRD_PARTY_LICENSES.md'];

await mkdir(dest, { recursive: true });
for (const name of files) {
  await copyFile(path.join(docs, name), path.join(dest, name));
}
console.log(`==> Legal docs copied to ${dest}`);
