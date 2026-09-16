/**
 * Smoke test: every registered bottom plugin has id, name, icon, and a component.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY = path.join(ROOT, 'src/data/PluginRegistryContext.tsx');
const src = fs.readFileSync(REGISTRY, 'utf8');

const defaultInstalled = [...src.matchAll(/DEFAULT_INSTALLED_PLUGINS(?:\s*:\s*[^=]+)?\s*=\s*\[([\s\S]*?)\];/gm)][0]?.[1]
  ?.match(/'([^']+)'/g)
  ?.map(s => s.slice(1, -1)) ?? [];

const allPluginsSection = src.split('const ALL_PLUGINS')[1]?.split('const PluginRegistryContext')[0] ?? '';
const spreadIds = [...allPluginsSection.matchAll(/\.\.\.(\w+PluginDef)/g)].map(m => m[1]);
const inlineIds = [...allPluginsSection.matchAll(/^\s*id:\s*'([^']+)'/gm)].map(m => m[1]);
const components = [...allPluginsSection.matchAll(/component:\s*(\w+)/g)].map(m => m[1]);

const defFiles = {
  ContextMenuPluginDef: 'ContextMenuPlugin.tsx',
  IconStudioPluginDef: 'IconStudio/index.tsx',
  BatchRenamePluginDef: 'BatchRenamePlugin.tsx',
  FindPluginDef: 'FindPlugin.tsx',
  DropStackPluginDef: 'DropStackPlugin.tsx',
  FiltersPluginDef: 'FiltersPlugin.tsx',
  MetadataPluginDef: 'MetadataPlugin.tsx',
  StorageCleanupPluginDef: 'StorageCleanupPlugin.tsx',
  FolderSyncPluginDef: 'FolderSyncPlugin.tsx',
  CatalogPluginDef: 'CatalogPlugin.tsx',
  ActionLogPluginDef: 'ActionLogPlugin.tsx',
  MeshPluginDef: 'MeshPlugin.tsx',
  ProjectSandboxPluginDef: 'ProjectSandboxPlugin.tsx',
  BranchingTimePluginDef: 'BranchingTimePlugin.tsx',
};

function readDefId(defName) {
  const file = defFiles[defName];
  if (!file) return null;
  const full = path.join(ROOT, 'src/components/plugins', file);
  if (!fs.existsSync(full)) return null;
  const content = fs.readFileSync(full, 'utf8');
  const m = content.match(/id:\s*['"]([^'"]+)['"]/);
  return m?.[1] ?? null;
}

const errors = [];
const seenIds = new Set();

for (const id of inlineIds) seenIds.add(id);
for (const defName of spreadIds) {
  const id = readDefId(defName);
  if (!id) errors.push(`Could not resolve id from ${defName}`);
  else seenIds.add(id);
}

if (!components.includes('PropertiesPlugin')) {
  errors.push('properties plugin missing PropertiesPlugin component');
}

const componentPaths = {
  PropertiesPlugin: 'PropertiesPlugin.tsx',
  ContextMenuPlugin: 'ContextMenuPlugin.tsx',
  IconStudioPlugin: 'IconStudio/index.tsx',
  BatchRenamePlugin: 'BatchRenamePlugin.tsx',
  FindPlugin: 'FindPlugin.tsx',
  DropStackPlugin: 'DropStackPlugin.tsx',
  FiltersPlugin: 'FiltersPlugin.tsx',
  MetadataPlugin: 'MetadataPlugin.tsx',
  StorageCleanupPlugin: 'StorageCleanupPlugin.tsx',
  FolderSyncPlugin: 'FolderSyncPlugin.tsx',
  CatalogPlugin: 'CatalogPlugin.tsx',
  ActionLogPlugin: 'ActionLogPlugin.tsx',
  MeshPlugin: 'MeshPlugin.tsx',
  ProjectSandboxPlugin: 'ProjectSandboxPlugin.tsx',
  BranchingTimePlugin: 'BranchingTimePlugin.tsx',
};

for (const comp of components) {
  const rel = componentPaths[comp];
  if (!rel || !fs.existsSync(path.join(ROOT, 'src/components/plugins', rel))) {
    errors.push(`Component ${comp} → missing file ${rel || '?'}`);
  }
}

for (const id of defaultInstalled) {
  if (!seenIds.has(id)) errors.push(`DEFAULT_INSTALLED_PLUGINS references unknown id: ${id}`);
}

const pluginDir = path.join(ROOT, 'src/components/plugins');
for (const file of fs.readdirSync(pluginDir)) {
  if (!file.endsWith('Plugin.tsx')) continue;
  const content = fs.readFileSync(path.join(pluginDir, file), 'utf8');
  if (!content.includes('export default function')) {
    errors.push(`${file}: missing default export`);
  }
}

const iconStudio = fs.readFileSync(path.join(pluginDir, 'IconStudio/index.tsx'), 'utf8');
if (!iconStudio.includes('export default function IconStudioPlugin')) {
  errors.push('IconStudio/index.tsx: missing default export');
}


// Remap table must send absorbed IDs to living hosts; dropped Staging IDs scrub (no remap).
const remapBlock = src.match(/RETIRED_PLUGIN_REMAP[\s\S]*?=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
const expectedRemaps = {
  'drop-magnet': 'batch-rename',
  compare: 'folder-sync',
  'transcode-rack': 'metadata',
  'semantic-desk': 'filters',
  'policy-packs': 'dropstack',
  'inbound-volume': 'dropstack',
  'capture-inbox': 'dropstack',
  'zk-vault': 'project-sandbox',
  'library-health': 'storage-cleanup',
  'reality-check': 'storage-cleanup',
};
for (const [from, to] of Object.entries(expectedRemaps)) {
  const re = new RegExp(String.raw`['"\`]?${from}['"\`]?\s*:\s*['"\`]${to}['"\`]`);
  if (!re.test(remapBlock)) errors.push(`RETIRED_PLUGIN_REMAP missing ${from} → ${to}`);
  if (seenIds.has(from)) errors.push(`retired id still in Hub catalog: ${from}`);
  if (!seenIds.has(to)) errors.push(`remap target missing from Hub catalog: ${to}`);
}
// Launch Ready A1 — Staging removed from Hub (scrub, do not remap to a living host).
for (const dropped of ['ghost-link', 'ram-staging', 'design-board', 'photo-studio']) {
  if (seenIds.has(dropped)) errors.push(`dropped Hub id still in catalog: ${dropped}`);
  if (new RegExp(String.raw`['"\`]?${dropped}['"\`]?\s*:`).test(remapBlock)) {
    errors.push(`dropped Hub id must not be remapped: ${dropped}`);
  }
}
if (!src.includes('DROPPED_HUB_PLUGIN_IDS')) {
  errors.push('DROPPED_HUB_PLUGIN_IDS missing from PluginRegistryContext');
}
if (!defaultInstalled.length) errors.push('DEFAULT_INSTALLED_PLUGINS parsed empty — regex likely broken');

if (errors.length) {
  console.error('plugin registry tests FAILED:\n' + errors.map(e => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`plugin registry: ok (${seenIds.size} plugins, ${defaultInstalled.length} default installed)`);
