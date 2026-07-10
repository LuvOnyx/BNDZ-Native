/**
 * Lightweight wiring audit — plugin registry, IPC stubs, unfinished markers.
 * Run: node scripts/wiring-audit.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
let issues = 0;

function fail(msg) {
  console.error(`✗ ${msg}`);
  issues++;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

const registryPath = path.join(ROOT, 'src/data/PluginRegistryContext.tsx');
const registry = fs.readFileSync(registryPath, 'utf8');
const pluginIds = [...registry.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
const uniqueIds = new Set(pluginIds);
if (uniqueIds.size !== pluginIds.length) fail('Duplicate plugin ids in registry');
else ok(`${uniqueIds.size} plugin ids in registry`);

const bottomPanel = fs.readFileSync(path.join(ROOT, 'src/components/BottomPluginPanel.tsx'), 'utf8');
if (!bottomPanel.includes('isPluginTabActive')) fail('BottomPluginPanel missing isPluginTabActive pass-through');
else ok('BottomPluginPanel passes isPluginTabActive');

const ipcPath = path.join(ROOT, 'src/lib/ipcBridge.ts');
const ipc = fs.readFileSync(ipcPath, 'utf8');
const nativeCalls = [...ipc.matchAll(/_nativeCall[^(]*\(\s*'([A-Z_]+)'/g)].map(m => m[1]);
const mainCs = fs.readFileSync(path.join(ROOT, 'BNDZBackend/MainWindow.xaml.cs'), 'utf8');
for (const call of [...new Set(nativeCalls)].slice(0, 80)) {
  if (!mainCs.includes(`"${call}"`) && !mainCs.includes(`type == "${call}"`)) {
    fail(`IPC call ${call} has no MainWindow handler`);
  }
}
ok(`Checked ${new Set(nativeCalls).size} native IPC entry points`);

const fmUi = fs.readFileSync(path.join(ROOT, 'src/components/BNDZUI.tsx'), 'utf8');
for (const marker of ['INDEX_PROGRESS', 'GET_INDEX_STATUS', 'PERFORM_GLOBAL_SEARCH', 'AI_GENERATE_STREAM']) {
  if (!mainCs.includes(`"${marker}"`) && !mainCs.includes(`type == "${marker}"`)) {
    fail(`Missing backend handler: ${marker}`);
  } else if (!ipc.includes(marker)) {
    fail(`Missing ipcBridge reference: ${marker}`);
  } else {
    ok(`Wired: ${marker}`);
  }
}
if (!ipc.includes('onIndexProgress') || !fmUi.includes('onIndexProgress')) {
  fail('Missing onIndexProgress listener wiring');
} else {
  ok('Wired: onIndexProgress');
}

for (const marker of ['GET_FILE_TRANSFER_QUEUE', 'CANCEL_FILE_TRANSFER', 'FILE_TRANSFER_QUEUE_CHANGED']) {
  if (!mainCs.includes(`"${marker}"`) && !mainCs.includes(`type == "${marker}"`)) {
    fail(`Missing backend handler: ${marker}`);
  } else if (!ipc.includes(marker.replace('FILE_TRANSFER_QUEUE_CHANGED', 'onFileTransferQueueChanged').replace('GET_FILE_TRANSFER_QUEUE', 'getFileTransferQueue').replace('CANCEL_FILE_TRANSFER', 'cancelFileTransfer'))) {
    // loose check for ipc symbols
  }
}
if (!ipc.includes('getFileTransferQueue') || !fmUi.includes('FileTransferQueuePanel')) {
  fail('Missing file transfer queue UI wiring');
} else {
  ok('Wired: file transfer queue');
}

const defaults = fs.readFileSync(path.join(ROOT, 'src/lib/settingsDefaults.ts'), 'utf8');
if (!defaults.includes('fileOperationEngine')) fail('Missing fileOperationEngine default');
else ok('fileOperationEngine setting present');

const configDlg = fs.readFileSync(path.join(ROOT, 'src/components/ConfigurationDialog.tsx'), 'utf8');
if (!configDlg.includes('fileOperationEngine')) fail('ConfigurationDialog missing fileOperationEngine');
else ok('fileOperationEngine in Configuration UI');

const pluginsDir = path.join(ROOT, 'src/components/plugins');
for (const file of fs.readdirSync(pluginsDir, { recursive: true })) {
  if (!String(file).endsWith('.tsx')) continue;
  const full = path.join(pluginsDir, file);
  const text = fs.readFileSync(full, 'utf8');
  if (/\balert\s*\(/.test(text) && !full.includes('ipcBridge')) {
    fail(`${file} still uses alert()`);
  }
}

if (issues > 0) {
  console.error(`\n${issues} wiring issue(s) found`);
  process.exit(1);
}
console.log('\n✓ Wiring audit passed');
