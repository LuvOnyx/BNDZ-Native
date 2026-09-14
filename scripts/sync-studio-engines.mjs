#!/usr/bin/env node
/**
 * Cross-platform sync of studio engines + editor HTML into BNDZBackend Assets.
 * Replaces scripts/sync-studio-engines.ps1 for Linux CI / Cloud Agents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcEditors = path.join(root, 'public', 'editors');
const dstEditors = path.join(root, 'BNDZBackend', 'Assets', 'ui', 'editors');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(from, to);
    else copyFile(from, to);
  }
}

if (!fs.existsSync(srcEditors)) die(`Missing ${srcEditors}`);
fs.mkdirSync(dstEditors, { recursive: true });

console.log('==> Sync editor HTML');
for (const name of ['bndz-design-board.html', 'bndz-photo-studio.html']) {
  const src = path.join(srcEditors, name);
  if (!fs.existsSync(src)) die(`Missing ${src}`);
  copyFile(src, path.join(dstEditors, name));
}

const vendorSrc = path.join(srcEditors, 'vendor');
if (fs.existsSync(vendorSrc)) {
  copyTree(vendorSrc, path.join(dstEditors, 'vendor'));
}

const engineSrc = path.join(srcEditors, 'engines');
const engineDst = path.join(dstEditors, 'engines');
if (!fs.existsSync(engineSrc)) die(`Missing ${engineSrc} - build OpenPencil/OpenShop first`);

console.log('==> Sync engines (OpenPencil + OpenShop)');
fs.rmSync(engineDst, { recursive: true, force: true });
copyTree(engineSrc, engineDst);
console.log('  engines synced');
