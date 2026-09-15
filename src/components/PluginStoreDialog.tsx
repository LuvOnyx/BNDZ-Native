import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzPlaque } from './BndzPlaque';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { usePluginRegistry, PluginManifest } from '../data/PluginRegistryContext';
import { showNativeAlert } from '../lib/nativeDialog';

type HubFilter = 'all' | 'bottom' | 'sidebar' | 'installed' | 'available';
type DetailTab = 'overview' | 'capabilities' | 'versions';

const FILTERS: Array<{ id: HubFilter; label: string }> = [
  { id: 'all',       label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'bottom',    label: 'Bottom panel' },
  { id: 'sidebar',   label: 'Sidebar' },
  { id: 'available', label: 'Available' },
];

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'overview',      label: 'Overview' },
  { id: 'capabilities',  label: 'Capabilities' },
  { id: 'versions',      label: 'Versions' },
];

/** Capability copy derived from what each extension actually does in BNDZ. */
function capabilitiesFor(plugin: PluginManifest): string[] {
  const byId: Record<string, string[]> = {
    properties: [
      'Windows property sheets and ACL inspection',
      'Hash analysis and attribute editing',
      'Live selection sync with the active pane',
    ],
    'context-menu-manager': [
      'Design BNDZ and shell context menus',
      'Deploy verbs to the Windows registry',
      'Pin frequent actions into the list menu',
    ],
    'icon-studio': [
      'Folder and file icon libraries',
      'Drag-drop PNG / ICO apply workflows',
      'Native Folcolor-compatible folder colors',
    ],
    'batch-rename': [
      'Pattern, numbering, and case transforms',
      'Live preview against the current selection',
      'Drop magnets — rename, tag, and route on Explorer → BNDZ release',
      'Safe undo via the action log',
    ],
    find: [
      'Instant Everything / indexed search',
      'Scope to pane, drive, or whole PC',
      'Open hits as finding tabs',
    ],
    dropstack: [
      'Stage files from many folders',
      'Inbound intake — clipboard, OCR captures, folder watchers',
      'Drop policies that block, warn, or reroute',
      'Batch copy or move into the active pane',
    ],

    filters: [
      'Visual color filters for list rows',
      'Smart groups — cluster the folder into piles',
      'Persisted with workspace settings',
    ],
    metadata: [
      'Sidecar tags and custom columns',
      'Bulk edit across selections',
      'Image encode queue — JPEG, PNG, WebP',
    ],
    'storage-cleanup': [
      'Large-file discovery and deep clean',
      'Capacity what-if planning',
      'Library health — broken links, orphans, and repairs',
    ],
    'folder-sync': [
      'Robocopy-backed folder sync jobs',
      'Live watch and mirror modes',
      'Binary file compare and recursive folder diff',
      'Transfer queue integration',
    ],
    catalog: [
      'Virtual /vf collections of paths',
      'Add selections from any pane',
      'Browse catalogs like folders',
    ],
    'action-log': [
      'Reversible copy / move / rename history',
      'Undo and redo across sessions',
      'Browse and restore past file operations',
    ],
    'remote-mesh': [
      'SSH/SFTP browse, terminal, sync, and LAN drop',
      'Mesh VPS launch, import, start/stop, and Mesh bridge',
      'Ephemeral and persistent instances with cloud-init SSH',
    ],

    'project-sandbox': [
      'Isolated sandbox sessions with checkpoint/commit/discard',
      'Encrypted vault unlock/browse beside sandbox work',
      'Safe experimentation on live trees',
    ],
    'branching-time': [
      'Content branches and VSS shadows',
      'Compare and restore timeline paths',
      'Non-destructive experimentation',
    ],
  };
  return byId[plugin.id] || [
    plugin.isNative ? 'Native Windows host integration' : 'Hosted UI surface',
    plugin.targetPanel === 'bottom' ? 'Lives in the bottom plugin panel' : 'Lives in the sidebar',
    'Install and uninstall without restarting BNDZ',
  ];
}

function versionLabel(plugin: PluginManifest): string {
  return plugin.isNative ? '1.0 · Built-in' : '1.0 · Imported';
}

export function PluginStoreDialog({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const { pluginRegistry, togglePluginInstall, addPluginToRegistry } = usePluginRegistry() as any;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<HubFilter>('all');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => { setDetailTab('overview'); }, [selectedPluginId]);

  const stats = useMemo(() => {
    const total     = pluginRegistry.length;
    const installed = pluginRegistry.filter((p: PluginManifest) => p.isInstalled).length;
    const bottom    = pluginRegistry.filter((p: PluginManifest) => p.targetPanel === 'bottom').length;
    return { total, installed, bottom, available: total - installed };
  }, [pluginRegistry]);

  const filteredPlugins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pluginRegistry.filter((plugin: PluginManifest) => {
      if (filter === 'installed'  && !plugin.isInstalled)              return false;
      if (filter === 'available'  &&  plugin.isInstalled)              return false;
      if (filter === 'bottom'     && plugin.targetPanel !== 'bottom')  return false;
      if (filter === 'sidebar'    && plugin.targetPanel !== 'sidebar') return false;
      if (!q) return true;
      return (
        plugin.name.toLowerCase().includes(q)
        || plugin.description.toLowerCase().includes(q)
        || plugin.id.toLowerCase().includes(q)
      );
    });
  }, [pluginRegistry, searchQuery, filter]);

  const activePlugin: PluginManifest | null = selectedPluginId
    ? pluginRegistry.find((p: PluginManifest) => p.id === selectedPluginId) || null
    : (filteredPlugins[0] || null);

  useEffect(() => {
    if (!activePlugin && filteredPlugins[0]) {
      setSelectedPluginId(filteredPlugins[0].id);
    } else if (activePlugin && !filteredPlugins.some((p: PluginManifest) => p.id === activePlugin.id)) {
      setSelectedPluginId(filteredPlugins[0]?.id || null);
    }
  }, [filteredPlugins, activePlugin]);

  const handleImportPlugin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (
          typeof json === 'object' && json !== null
          && typeof json.id === 'string'
          && typeof json.name === 'string'
          && typeof json.description === 'string'
          && (json.targetPanel === 'bottom' || json.targetPanel === 'sidebar')
          && typeof json.isNative === 'boolean'
        ) {
          const builtIn = pluginRegistry.find((p: PluginManifest) => p.id === json.id);
          if (!builtIn?.component && json.isNative !== false) {
            showNativeAlert(
              'This manifest describes a built-in extension that must ship with BNDZ — use Install in the catalog instead of JSON import.',
              'Extension Hub',
              'error',
            );
            return;
          }
          if (!builtIn && json.isNative === true) {
            showNativeAlert('Imported manifests cannot register native host plugins — set isNative to false or use a built-in id.', 'Extension Hub', 'error');
            return;
          }
          const newPlugin: PluginManifest = { ...json, isInstalled: true };
          addPluginToRegistry(newPlugin);
          setSelectedPluginId(newPlugin.id);
          setFilter('installed');
        } else {
          showNativeAlert('Invalid plugin manifest schema.', 'Extension Hub', 'error');
        }
      } catch {
        showNativeAlert('Invalid JSON file.', 'Extension Hub', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const caps = activePlugin ? capabilitiesFor(activePlugin) : [];

  // Split catalog into installed/available groups for section labels
  const installedPlugins  = filteredPlugins.filter((p: PluginManifest) =>  p.isInstalled);
  const availablePlugins  = filteredPlugins.filter((p: PluginManifest) => !p.isInstalled);
  const showGroupLabels   = filter === 'all' && !searchQuery.trim();

  const hubBody = (
    <div className={`bndz-hub flex-1 flex flex-col min-h-0 overflow-hidden ${embedded ? 'h-full' : ''}`}>

      {/* ── Command strip ── */}
      <div className="bndz-hub-command shrink-0 px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]">
        <div className="relative flex-1 min-w-0 max-w-[380px]">
          <Icons8Icon id="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search by name, id, or description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bndz-native-input w-full !py-1.5 !pl-8 !pr-3 !text-[12px]"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`bndz-hub-chip ${filter === f.id ? 'bndz-hub-chip--active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Import action */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="bndz-hub-btn-ghost text-[11px] font-semibold px-3 py-1.5 flex items-center gap-1.5"
          >
            <Icons8Icon id="folder_open_ui" size={12} />
            Import JSON
          </button>
          <input type="file" accept=".json" ref={fileInputRef} className="hidden" onChange={handleImportPlugin} />
        </div>
      </div>

      {/* ── Stats band ── */}
      <div className="bndz-hub-stats shrink-0 px-4 py-2 flex items-center gap-4 border-b border-white/[0.04]">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/35">
          <span className="bndz-hub-stat-orb bndz-hub-stat-orb--total">{stats.total}</span>
          extensions
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/35">
          <span className="bndz-hub-stat-orb bndz-hub-stat-orb--installed">{stats.installed}</span>
          installed
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-white/35">
          <span className="bndz-hub-stat-orb bndz-hub-stat-orb--available">{stats.available}</span>
          available
        </span>
        <span className="ml-auto text-[10px] tracking-[0.08em] uppercase text-white/20 font-medium">
          BNDZ Extension Hub
        </span>
      </div>

      {/* ── Body — catalog + detail ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Catalog list */}
        <div className="bndz-hub-catalog-panel w-[320px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto styled-scrollbar p-2 min-h-0">
            {filteredPlugins.length === 0 ? (
              <div className="bndz-hub-empty">
                <BndzPlaque tone="panel" size="md" />
                <p className="text-[12px] text-center leading-relaxed max-w-[200px]">
                  {searchQuery.trim()
                    ? 'No extensions match your search.'
                    : 'No extensions in this filter.'}
                </p>
              </div>
            ) : showGroupLabels ? (
              <>
                {installedPlugins.length > 0 && (
                  <>
                    <div className="bndz-hub-section-label">Installed</div>
                    {installedPlugins.map((plugin: PluginManifest) => (
                      <CatalogRow
                        key={plugin.id}
                        plugin={plugin}
                        isActive={activePlugin?.id === plugin.id}
                        onSelect={() => setSelectedPluginId(plugin.id)}
                      />
                    ))}
                  </>
                )}
                {availablePlugins.length > 0 && (
                  <>
                    <div className="bndz-hub-section-label" style={{ marginTop: installedPlugins.length > 0 ? 8 : 0 }}>
                      Available
                    </div>
                    {availablePlugins.map((plugin: PluginManifest) => (
                      <CatalogRow
                        key={plugin.id}
                        plugin={plugin}
                        isActive={activePlugin?.id === plugin.id}
                        onSelect={() => setSelectedPluginId(plugin.id)}
                      />
                    ))}
                  </>
                )}
              </>
            ) : (
              filteredPlugins.map((plugin: PluginManifest) => (
                <CatalogRow
                  key={plugin.id}
                  plugin={plugin}
                  isActive={activePlugin?.id === plugin.id}
                  onSelect={() => setSelectedPluginId(plugin.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Detail surface */}
        <div className="bndz-hub-detail-panel flex-1 flex flex-col min-h-0 min-w-0">
          {activePlugin ? (
            <>
              {/* Hero */}
              <div className="bndz-hub-hero shrink-0 px-7 py-6 flex gap-6 items-start">
                <div className={`bndz-hub-hero-icon ${activePlugin.isInstalled ? 'bndz-hub-hero-icon--on' : ''}`}>
                  <Icons8Icon id={activePlugin.icon || 'extension_hub'} size={54} disabled={!activePlugin.isInstalled} />
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center gap-2.5 pt-1">
                  {/* Name + id badge */}
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <h1 className="text-[21px] font-semibold text-white tracking-tight leading-none">
                      {activePlugin.name}
                    </h1>
                    <code className="text-[10px] font-mono text-white/35 bg-black/30 px-2 py-0.5 rounded border border-white/[0.07]">
                      {activePlugin.id}
                    </code>
                  </div>

                  {/* Meta chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="bndz-hub-chip bndz-hub-chip--static">
                      {activePlugin.targetPanel === 'bottom' ? 'Bottom panel' : 'Sidebar'}
                    </span>
                    <span className="bndz-hub-chip bndz-hub-chip--static">
                      {activePlugin.isNative ? 'Native host' : 'Hosted UI'}
                    </span>
                    <span className="bndz-hub-chip bndz-hub-chip--static">{versionLabel(activePlugin)}</span>
                    {activePlugin.isInstalled && (
                      <span className="bndz-hub-pill">Active in workspace</span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-[12.5px] text-white/50 leading-relaxed max-w-2xl">
                    {activePlugin.description}
                  </p>

                  {/* Action row */}
                  <div className="flex items-center gap-2.5 mt-1">
                    <button
                      type="button"
                      onClick={() => togglePluginInstall(activePlugin.id)}
                      className={
                        activePlugin.isInstalled
                          ? 'bndz-hub-btn-danger px-4 py-2 text-[12px] font-semibold'
                          : 'bndz-hub-btn-primary px-5 py-2 text-[12px] font-semibold'
                      }
                    >
                      {activePlugin.isInstalled ? 'Uninstall extension' : 'Install extension'}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="bndz-hub-btn-ghost px-3 py-2 text-[12px] font-semibold"
                    >
                      Replace via import…
                    </button>
                  </div>
                </div>
              </div>

              {/* Tab strip */}
              <div className="bndz-plugin-tabstrip flex items-stretch shrink-0 border-y border-white/[0.06]">
                {DETAIL_TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDetailTab(tab.id)}
                    className={`bndz-plugin-tab ${detailTab === tab.id ? 'bndz-plugin-tab-active' : ''}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto styled-scrollbar min-h-0 px-7 py-6">

                {/* Overview */}
                {detailTab === 'overview' && (
                  <div className="max-w-2xl space-y-6">
                    <section>
                      <h2 className="bndz-plugin-section-title mb-2">What it does</h2>
                      <p className="text-[12.5px] text-white/50 leading-relaxed">
                        {activePlugin.description}
                        {activePlugin.isNative
                          ? ' This extension runs against the native BNDZ host for filesystem, shell, and Windows integration.'
                          : ' This extension loads as hosted UI inside the BNDZ workspace.'}
                      </p>
                    </section>

                    <section className="bndz-plugin-card">
                      <h2 className="bndz-plugin-section-title mb-3">Placement</h2>
                      <div className="bndz-plugin-field-grid">
                        <div className="bndz-plugin-field-label">Surface</div>
                        <div className="bndz-plugin-field-value">
                          {activePlugin.targetPanel === 'bottom' ? 'Bottom plugin panel tab' : 'Sidebar module'}
                        </div>
                        <div className="bndz-plugin-field-label">Runtime</div>
                        <div className="bndz-plugin-field-value">
                          {activePlugin.isNative ? 'Native C# / WebView bridge' : 'Web UI'}
                        </div>
                        <div className="bndz-plugin-field-label">Status</div>
                        <div className="bndz-plugin-field-value">
                          {activePlugin.isInstalled ? 'Installed — available in the workspace' : 'Not installed'}
                        </div>
                      </div>
                    </section>

                    <section>
                      <h2 className="bndz-plugin-section-title mb-3">Highlights</h2>
                      <div className="space-y-2">
                        {caps.slice(0, 3).map(c => (
                          <div key={c} className="bndz-hub-cap-item">
                            <span className="bndz-hub-cap-dot" />
                            <span className="text-[12.5px] text-white/65 leading-snug">{c}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {/* Capabilities */}
                {detailTab === 'capabilities' && (
                  <div className="max-w-2xl space-y-4">
                    <div>
                      <h2 className="bndz-plugin-section-title mb-1">Capabilities</h2>
                      <p className="text-[11.5px] text-white/35 mb-4 leading-relaxed">
                        What this extension unlocks inside BNDZ — not marketing fluff.
                      </p>
                    </div>
                    <div className="space-y-2">
                      {caps.map((c, i) => (
                        <div
                          key={c}
                          className="bndz-hub-cap-item"
                          style={{ animationDelay: `${i * 0.04}s` }}
                        >
                          <Icons8Icon id="check" size={13} className="shrink-0 mt-0.5 text-sky-400 opacity-80" />
                          <span className="text-[12.5px] text-white/70 leading-snug">{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Versions */}
                {detailTab === 'versions' && (
                  <div className="max-w-2xl space-y-5">
                    <div>
                      <h2 className="bndz-plugin-section-title mb-1">Version history</h2>
                      <p className="text-[11.5px] text-white/35 mb-5 leading-relaxed">
                        Built-in extensions update with BNDZ releases. Imported JSON manifests can be
                        replaced via <em className="not-italic text-white/50">Import JSON</em> without
                        clearing workspace settings.
                      </p>
                    </div>

                    <div className="bndz-hub-version-card">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <div className="text-[13px] font-semibold text-white/90">{versionLabel(activePlugin)}</div>
                          <div className="text-[11px] text-white/38 mt-0.5">
                            {activePlugin.isNative
                              ? 'Shipped with BNDZ · updated with the app'
                              : 'Imported manifest · replace any time'}
                          </div>
                        </div>
                        {activePlugin.isInstalled && <span className="bndz-hub-pill">Current</span>}
                      </div>

                      <div className="bndz-plugin-field-grid text-[12px]">
                        <div className="bndz-plugin-field-label">Channel</div>
                        <div className="bndz-plugin-field-value">
                          {activePlugin.isNative ? 'Stable / built-in' : 'Local import'}
                        </div>
                        <div className="bndz-plugin-field-label">Manifest id</div>
                        <div className="bndz-plugin-field-value font-mono text-[11px]">{activePlugin.id}</div>
                        <div className="bndz-plugin-field-label">Distribution</div>
                        <div className="bndz-plugin-field-value">
                          {activePlugin.isNative
                            ? 'Bundled with BNDZ install'
                            : 'JSON manifest import'}
                        </div>
                      </div>
                    </div>

                    <p className="text-[10.5px] text-white/25 leading-relaxed">
                      Advanced plugins as external installable packages are planned for a future BNDZ release.
                    </p>
                  </div>
                )}

              </div>
            </>
          ) : (
            <div className="bndz-hub-empty h-full">
              <BndzPlaque tone="panel" size="lg" />
              <p className="text-[13px] text-center">Select an extension to inspect details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden" style={{ background: '#16181f' }}>
        {hubBody}
      </div>
    );
  }

  return (
    <BndzWindowFrame
      title="Extension Hub"
      subtitle="Install, manage, and import BNDZ panel extensions"
      iconId="extension_hub"
      onClose={onClose ?? (() => {})}
      widthClass="w-[min(1080px,calc(100vw-2rem))]"
      heightClass="h-[min(780px,calc(100vh-2rem))]"
    >
      {hubBody}
    </BndzWindowFrame>
  );
}

/* ── CatalogRow extracted for cleaner code ── */
function CatalogRow({
  plugin,
  isActive,
  onSelect,
}: {
  plugin: PluginManifest;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`bndz-hub-row w-full text-left flex items-start gap-3 p-3 mb-1 ${isActive ? 'bndz-hub-row--active' : ''}`}
    >
      <div className={`bndz-hub-row-icon ${plugin.isInstalled ? 'bndz-hub-row-icon--on' : ''}`}>
        <Icons8Icon id={plugin.icon || 'extension_hub'} size={22} disabled={!plugin.isInstalled} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-white/92 truncate">{plugin.name}</span>
          {plugin.isInstalled && (
            <span className="bndz-hub-pill shrink-0">On</span>
          )}
        </div>
        <p className="text-[11px] text-white/38 truncate mt-0.5 leading-snug">{plugin.description}</p>
        <div className="flex items-center gap-2 mt-1.5 text-[9.5px] text-white/25 font-medium tracking-wide uppercase">
          <span>{plugin.targetPanel === 'bottom' ? 'Bottom panel' : 'Sidebar'}</span>
          <span className="opacity-40">·</span>
          <span>{plugin.isNative ? 'Native' : 'Web'}</span>
        </div>
      </div>
    </button>
  );
}
