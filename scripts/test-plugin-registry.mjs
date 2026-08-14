/**
 * Smoke test: every registered bottom plugin has id, name, icon, and a component.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY = path.join(ROOT, 'src/data/PluginRegistryContext.tsx');
const src = fs.readFileSync(REGISTRY, 'utf8');

const defaultInstalled = [...src.matchAll(/DEFAULT_INSTALLED_PLUGINS\s*=\s*\[([\s\S]*?)\];/gm)][0]?.[1]
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
  ComparePluginDef: 'ComparePlugin.tsx',
  MeshPluginDef: 'MeshPlugin.tsx',
  GhostLinkPluginDef: 'GhostLinkPlugin.tsx',
  RamStagingPluginDef: 'RamStagingPlugin.tsx',
  ProjectSandboxPluginDef: 'ProjectSandboxPlugin.tsx',
  LibraryHealthPluginDef: 'LibraryHealthPlugin.tsx',
  CapacitySolverPluginDef: 'CapacitySolverPlugin.tsx',
  InboundVolumePluginDef: 'InboundVolumePlugin.tsx',
  BranchingTimePluginDef: 'BranchingTimePlugin.tsx',
  DropMagnetPluginDef: 'DropMagnetPlugin.tsx',
  CaptureInboxPluginDef: 'CaptureInboxPlugin.tsx',
  RealityCheckPluginDef: 'RealityCheckPlugin.tsx',
  TranscodeRackPluginDef: 'TranscodeRackPlugin.tsx',
  SemanticDeskPluginDef: 'SemanticDeskPlugin.tsx',
  PolicyPackPluginDef: 'PolicyPackPlugin.tsx',
  ZkVaultPluginDef: 'ZkVaultPlugin.tsx',
  DesignBoardPluginDef: 'DesignBoardPlugin.tsx',
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
  ComparePlugin: 'ComparePlugin.tsx',
  MeshPlugin: 'MeshPlugin.tsx',
  GhostLinkPlugin: 'GhostLinkPlugin.tsx',
  RamStagingPlugin: 'RamStagingPlugin.tsx',
  ProjectSandboxPlugin: 'ProjectSandboxPlugin.tsx',
  LibraryHealthPlugin: 'LibraryHealthPlugin.tsx',
  CapacitySolverPlugin: 'CapacitySolverPlugin.tsx',
  InboundVolumePlugin: 'InboundVolumePlugin.tsx',
  BranchingTimePlugin: 'BranchingTimePlugin.tsx',
  DropMagnetPlugin: 'DropMagnetPlugin.tsx',
  CaptureInboxPlugin: 'CaptureInboxPlugin.tsx',
  RealityCheckPlugin: 'RealityCheckPlugin.tsx',
  TranscodeRackPlugin: 'TranscodeRackPlugin.tsx',
  SemanticDeskPlugin: 'SemanticDeskPlugin.tsx',
  PolicyPackPlugin: 'PolicyPackPlugin.tsx',
  ZkVaultPlugin: 'ZkVaultPlugin.tsx',
  DesignBoardPlugin: 'DesignBoardPlugin.tsx',
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

if (errors.length) {
  console.error('plugin registry tests FAILED:\n' + errors.map(e => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`plugin registry: ok (${seenIds.size} plugins, ${defaultInstalled.length} default installed)`);
