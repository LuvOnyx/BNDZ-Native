import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { usePluginRegistry, PluginManifest } from '../data/PluginRegistryContext';
import { showNativeAlert } from '../lib/nativeDialog';

type HubFilter = 'all' | 'bottom' | 'sidebar' | 'installed' | 'available';
type DetailTab = 'overview' | 'capabilities' | 'versions';

const FILTERS: Array<{ id: HubFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'bottom', label: 'Bottom panel' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'available', label: 'Available' },
];

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'versions', label: 'Versions' },
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
      'Safe undo via the action log',
    ],
    find: [
      'Instant Everything / indexed search',
      'Scope to pane, drive, or whole PC',
      'Open hits as finding tabs',
    ],
    dropstack: [
      'Stage files from many folders',
      'Batch copy or move into the active pane',
      'Clear or reorder the stack mid-session',
    ],
    'drop-magnet': [
      'Named landing pads during Explorer → BNDZ drops',
      'Rename patterns, tags, and target folders in one release',
      'Test recipes against the current list selection',
    ],
    'design-board': [
      'Infinite Fabric canvas with ProDesign chrome',
      'Place images via Explorer drop onto the board',
      'Expand to fill the workspace without leaving BNDZ',
    ],
    filters: [
      'Visual color filters for list rows',
      'Quick toggles from the bottom panel',
      'Persisted with workspace settings',
    ],
    metadata: [
      'Sidecar tags and custom columns',
      'Bulk edit across selections',
      'Surfaces in list and preview panes',
    ],
    'storage-cleanup': [
      'Large-file discovery',
      'Smart organize and cleanup passes',
      'Safe delete with recycle / permanent paths',
    ],
    'folder-sync': [
      'Robocopy-backed folder sync jobs',
      'Live watch and mirror modes',
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
      'XYplorer-style operation journal',
    ],
    compare: [
      'Binary file compare',
      'Recursive folder diff',
      'Branch-compare parity for dual pane',
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

export function PluginStoreDialog({ onClose }: { onClose: () => void }) {
  const { pluginRegistry, togglePluginInstall, addPluginToRegistry } = usePluginRegistry() as any;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<HubFilter>('all');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setDetailTab('overview');
  }, [selectedPluginId]);

  const stats = useMemo(() => {
    const total = pluginRegistry.length;
    const installed = pluginRegistry.filter((p: PluginManifest) => p.isInstalled).length;
    const bottom = pluginRegistry.filter((p: PluginManifest) => p.targetPanel === 'bottom').length;
    return { total, installed, bottom, available: total - installed };
  }, [pluginRegistry]);

  const filteredPlugins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pluginRegistry.filter((plugin: PluginManifest) => {
      if (filter === 'installed' && !plugin.isInstalled) return false;
      if (filter === 'available' && plugin.isInstalled) return false;
      if (filter === 'bottom' && plugin.targetPanel !== 'bottom') return false;
      if (filter === 'sidebar' && plugin.targetPanel !== 'sidebar') return false;
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

  return (
    <BndzWindowFrame
      title="Extension Hub"
      subtitle="Install, manage, and import BNDZ panel extensions"
      iconId="extension_hub"
      onClose={onClose}
      widthClass="w-[min(1080px,calc(100vw-2rem))]"
      heightClass="h-[min(780px,calc(100vh-2rem))]"
    >
      <div className="bndz-hub flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Command strip */}
        <div className="bndz-hub-command shrink-0 px-4 py-3 flex items-center gap-3 border-b border-white/[0.06]">
          <div className="relative flex-1 min-w-0 max-w-[420px]">
            <Icons8Icon id="search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-55 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search extensions by name, id, or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bndz-native-input w-full !py-2 !pl-8 !pr-3 !text-[12px]"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
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

        {/* Stats */}
        <div className="bndz-hub-stats shrink-0 px-4 py-2 flex items-center gap-5 text-[10px] uppercase tracking-[0.12em] text-white/35 border-b border-white/[0.04]">
          <span><strong className="text-white/70 font-semibold normal-case tracking-normal text-[12px]">{stats.total}</strong> extensions</span>
          <span><strong className="text-[#7dd3fc] font-semibold normal-case tracking-normal text-[12px]">{stats.installed}</strong> installed</span>
          <span><strong className="text-white/70 font-semibold normal-case tracking-normal text-[12px]">{stats.bottom}</strong> bottom panel</span>
          <span><strong className="text-white/55 font-semibold normal-case tracking-normal text-[12px]">{stats.available}</strong> available</span>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Catalog list */}
          <div className="w-[340px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0 bg-black/20">
            <div className="flex-1 overflow-y-auto styled-scrollbar p-2 min-h-0">
              {filteredPlugins.length === 0 ? (
                <div className="px-4 py-12 text-center text-[12px] text-white/35">
                  {searchQuery.trim() ? 'No extensions match your search.' : 'No extensions in this filter.'}
                </div>
              ) : (
                filteredPlugins.map((plugin: PluginManifest) => {
                  const selected = activePlugin?.id === plugin.id;
                  return (
                    <button
                      key={plugin.id}
                      type="button"
                      onClick={() => setSelectedPluginId(plugin.id)}
                      className={`bndz-hub-row w-full text-left flex items-start gap-3 p-3 mb-1 ${selected ? 'bndz-hub-row--active' : ''}`}
                    >
                      <div className={`bndz-hub-row-icon shrink-0 ${plugin.isInstalled ? 'bndz-hub-row-icon--on' : ''}`}>
                        <Icons8Icon id={plugin.icon || 'extension_hub'} size={22} disabled={!plugin.isInstalled} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-white/95 truncate">{plugin.name}</span>
                          {plugin.isInstalled && (
                            <span className="bndz-hub-pill shrink-0">Installed</span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/40 truncate mt-0.5 leading-snug">{plugin.description}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-white/30">
                          <span>{plugin.targetPanel === 'bottom' ? 'Bottom panel' : 'Sidebar'}</span>
                          <span className="opacity-40">·</span>
                          <span>{plugin.isNative ? 'Native' : 'Web'}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail surface */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#1a1c22]">
            {activePlugin ? (
              <>
                <div className="bndz-hub-hero shrink-0 px-7 py-6 flex gap-5">
                  <div className={`bndz-hub-hero-icon shrink-0 ${activePlugin.isInstalled ? 'bndz-hub-hero-icon--on' : ''}`}>
                    <Icons8Icon id={activePlugin.icon || 'extension_hub'} size={52} disabled={!activePlugin.isInstalled} />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <h1 className="text-[22px] font-semibold text-white tracking-tight leading-none">{activePlugin.name}</h1>
                      <span className="text-[10px] font-mono text-white/40 bg-black/35 px-2 py-0.5 rounded border border-white/[0.08]">{activePlugin.id}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bndz-hub-chip bndz-hub-chip--static">
                        {activePlugin.targetPanel === 'bottom' ? 'Bottom panel' : 'Sidebar'}
                      </span>
                      <span className="bndz-hub-chip bndz-hub-chip--static">
                        {activePlugin.isNative ? 'Native host' : 'Hosted UI'}
                      </span>
                      <span className="bndz-hub-chip bndz-hub-chip--static">{versionLabel(activePlugin)}</span>
                      {activePlugin.isInstalled && <span className="bndz-hub-pill">Active in workspace</span>}
                    </div>
                    <p className="text-[13px] text-white/55 leading-relaxed max-w-2xl mt-1">{activePlugin.description}</p>
                    <div className="flex items-center gap-2.5 mt-2">
                      <button
                        type="button"
                        onClick={() => togglePluginInstall(activePlugin.id)}
                        className={activePlugin.isInstalled ? 'bndz-hub-btn-danger px-4 py-2 text-[12px] font-semibold' : 'bndz-hub-btn-primary px-5 py-2 text-[12px] font-semibold'}
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

                <div className="flex-1 overflow-y-auto styled-scrollbar min-h-0 px-7 py-5">
                  {detailTab === 'overview' && (
                    <div className="max-w-2xl space-y-5">
                      <section>
                        <h2 className="bndz-plugin-section-title mb-2">What it does</h2>
                        <p className="text-[12.5px] text-white/55 leading-relaxed">
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
                          <div className="bndz-plugin-field-value">{activePlugin.isNative ? 'Native C# / WebView bridge' : 'Web UI'}</div>
                          <div className="bndz-plugin-field-label">Status</div>
                          <div className="bndz-plugin-field-value">
                            {activePlugin.isInstalled ? 'Installed — available in the workspace' : 'Not installed'}
                          </div>
                        </div>
                      </section>
                      <section>
                        <h2 className="bndz-plugin-section-title mb-2">Highlights</h2>
                        <ul className="space-y-2">
                          {caps.slice(0, 3).map(c => (
                            <li key={c} className="flex items-start gap-2 text-[12.5px] text-white/60">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#38bdf8]/80 shrink-0" />
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                  )}

                  {detailTab === 'capabilities' && (
                    <div className="max-w-2xl space-y-3">
                      <h2 className="bndz-plugin-section-title mb-1">Capabilities</h2>
                      <p className="text-[12px] text-white/40 mb-4">
                        What this extension unlocks inside BNDZ — not marketing fluff.
                      </p>
                      <div className="grid gap-2.5">
                        {caps.map(c => (
                          <div key={c} className="bndz-plugin-card flex items-start gap-3 !py-3">
                            <Icons8Icon id="check" size={14} className="shrink-0 mt-0.5 opacity-80" />
                            <span className="text-[12.5px] text-white/75 leading-snug">{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailTab === 'versions' && (
                    <div className="max-w-2xl space-y-4">
                      <h2 className="bndz-plugin-section-title mb-1">Versions</h2>
                      <div className="bndz-plugin-card">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <div className="text-[13px] font-semibold text-white/90">{versionLabel(activePlugin)}</div>
                            <div className="text-[11px] text-white/40 mt-0.5">
                              {activePlugin.isNative ? 'Shipped with BNDZ · updated with the app' : 'Imported manifest'}
                            </div>
                          </div>
                          {activePlugin.isInstalled && <span className="bndz-hub-pill">Current</span>}
                        </div>
                        <div className="bndz-plugin-field-grid text-[12px]">
                          <div className="bndz-plugin-field-label">Channel</div>
                          <div className="bndz-plugin-field-value">{activePlugin.isNative ? 'Stable / built-in' : 'Local import'}</div>
                          <div className="bndz-plugin-field-label">Manifest id</div>
                          <div className="bndz-plugin-field-value font-mono text-[11px]">{activePlugin.id}</div>
                        </div>
                      </div>
                      <p className="text-[11px] text-white/35 leading-relaxed">
                        Built-in extensions update with BNDZ releases. Imported JSON manifests can be replaced via Import JSON without clearing your workspace settings.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-white/35 px-6">
                <Icons8Icon id="extension_hub" size={36} className="opacity-40" />
                <p className="text-[13px]">Select an extension to inspect details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </BndzWindowFrame>
  );
}
