import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { listCatalogs, upsertCatalog, deleteCatalog, type CatalogEntry } from '../../lib/catalog';
import { VF_ROOT } from '../../lib/virtualPaths';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import { IPC } from '../../lib/ipcBridge';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginFieldLabel,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

function notifyCatalogChanged() {
  window.dispatchEvent(new CustomEvent('bndz-catalog-changed'));
}

export const CatalogPluginDef = {
  id: 'catalog',
  name: 'Catalog',
  icon: 'bookmark',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type Props = {
  currentPath?: string;
  selectedPaths?: string[];
  onNavigate?: (path: string) => void;
};

function pathLeaf(p: string) {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function pathParent(p: string) {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  parts.pop();
  return parts.join('\\');
}

export default function CatalogPlugin({ selectedPaths = [], onNavigate }: Props) {
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCatalogs(await listCatalogs());
    } catch {
      setCatalogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selectedId && !catalogs.some(c => c.id === selectedId)) {
      setSelectedId(catalogs[0]?.id ?? null);
    } else if (!selectedId && catalogs.length) {
      setSelectedId(catalogs[0].id);
    }
  }, [catalogs, selectedId]);

  const selected = catalogs.find(c => c.id === selectedId) ?? null;
  const editingActive = editing && selected && editing.id === selected.id;

  const createCatalog = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (!selectedPaths.length) {
      pushToast({ kind: 'warning', title: 'Empty catalog', message: 'Select items first, or add paths after creating.' });
    }
    const paths = selectedPaths.map(p => toWindowsPath(p));
    const created = await upsertCatalog({ name, paths });
    setDraftName('');
    await load();
    notifyCatalogChanged();
    if (created?.id) setSelectedId(created.id);
    pushToast({ kind: 'success', title: 'Catalog created', message: name });
  };

  const saveEditing = async () => {
    if (!editing) return;
    await upsertCatalog({
      id: editing.id,
      name: renameDraft.trim() || editing.name,
      paths: editing.paths,
      query: queryDraft.trim() || null,
    });
    setEditing(null);
    await load();
    notifyCatalogChanged();
  };

  const openEdit = (cat: CatalogEntry) => {
    setSelectedId(cat.id);
    setEditing(cat);
    setRenameDraft(cat.name);
    setQueryDraft(cat.query || '');
  };

  const addSelectionTo = async (cat: CatalogEntry) => {
    const winPaths = selectedPaths.map(p => toWindowsPath(p));
    const merged = [...new Set([...(cat.paths || []), ...winPaths])];
    await upsertCatalog({ id: cat.id, name: cat.name, paths: merged, query: cat.query });
    await load();
    notifyCatalogChanged();
    pushToast({ kind: 'success', title: 'Paths added', message: `${winPaths.length} item(s) → ${cat.name}` });
  };

  const removePath = async (cat: CatalogEntry, path: string) => {
    const nextPaths = (cat.paths || []).filter(p => p !== path);
    await upsertCatalog({ id: cat.id, name: cat.name, paths: nextPaths, query: cat.query });
    await load();
    notifyCatalogChanged();
    if (editing?.id === cat.id) setEditing(prev => prev ? { ...prev, paths: nextPaths } : null);
  };

  const refreshQuery = async (cat: CatalogEntry) => {
    const q = (cat.query || '').trim();
    if (!q) {
      pushToast({ kind: 'warning', title: 'No query', message: 'Set a search query on this catalog first.' });
      return;
    }
    try {
      const { items } = await IPC.performGlobalSearch(q, 2000, false, '', true, false);
      const paths = (items || []).map((i: any) => toWindowsPath(i.path || i.fullPath || '')).filter(Boolean);
      await upsertCatalog({ id: cat.id, name: cat.name, paths, query: cat.query });
      await load();
      notifyCatalogChanged();
      pushToast({ kind: 'success', title: 'Query refreshed', message: `${paths.length} path(s) from live search.` });
    } catch {
      pushToast({ kind: 'error', title: 'Refresh failed', message: 'Could not run catalog query.' });
    }
  };

  const setOp = async (op: 'union' | 'intersect' | 'subtract') => {
    if (!selected) return;
    const otherId = window.prompt('Other catalog id or name');
    if (!otherId?.trim()) return;
    const other = catalogs.find(c => c.id === otherId.trim() || c.name.toLowerCase() === otherId.trim().toLowerCase());
    if (!other) {
      pushToast({ kind: 'warning', title: 'Not found', message: 'No matching catalog.' });
      return;
    }
    const a = new Set(selected.paths || []);
    const b = new Set(other.paths || []);
    let next: string[] = [];
    if (op === 'union') next = [...new Set([...a, ...b])];
    else if (op === 'intersect') next = [...a].filter(p => b.has(p));
    else next = [...a].filter(p => !b.has(p));
    await upsertCatalog({ id: selected.id, name: selected.name, paths: next, query: selected.query });
    await load();
    notifyCatalogChanged();
    pushToast({ kind: 'success', title: `Set ${op}`, message: `${next.length} path(s) in ${selected.name}` });
  };

  const bulkRemoveSelected = async () => {
    if (!selected || !selectedPaths.length) return;
    const remove = new Set(selectedPaths.map(p => toWindowsPath(p).toLowerCase()));
    const next = (selected.paths || []).filter(p => !remove.has(p.toLowerCase()));
    await upsertCatalog({ id: selected.id, name: selected.name, paths: next, query: selected.query });
    await load();
    notifyCatalogChanged();
  };

  const exportCatalogs = () => {
    const blob = new Blob([JSON.stringify(catalogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bndz-catalogs.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCatalogs = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as CatalogEntry[];
      if (!Array.isArray(data)) throw new Error('Invalid format');
      for (const c of data) {
        if (c.name) await upsertCatalog({ id: c.id, name: c.name, paths: c.paths || [], query: c.query });
      }
      await load();
      notifyCatalogChanged();
      pushToast({ kind: 'success', title: 'Imported', message: `${data.length} catalog(s).` });
    } catch {
      pushToast({ kind: 'error', title: 'Import failed', message: 'Invalid catalog JSON file.' });
    }
  };

  return (
    <PluginPanelShell
      title="Catalog"
      icon="bookmark"
      iconColor="#0078d4"
      variant="embedded"
      subtitle="Virtual collections — browse as /vf"
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="bookmark" size={52} className="opacity-90" />}
          name={selected ? selected.name : (catalogs.length ? `${catalogs.length} catalog${catalogs.length === 1 ? '' : 's'}` : 'Virtual catalogs')}
          typeLabel="VF collections"
          path={selected ? `${VF_ROOT}/${selected.id}` : undefined}
          meta={
            <span className="bndz-panel-muted text-xs">
              {selected
                ? `${(selected.paths || []).length} path(s)${selected.query?.trim() ? ' · search-backed' : ''}`
                : `Browse at ${VF_ROOT} · ${selectedPaths.length ? `${selectedPaths.length} selected` : 'Select items to add'}`}
            </span>
          }
          actions={
            <>
              {selected && (
                <PluginHeroActionButton icon="explorer" variant="primary" onClick={() => onNavigate?.(`/vf/${selected.id}`)}>
                  Open
                </PluginHeroActionButton>
              )}
              {selected?.query?.trim() && (
                <PluginHeroActionButton icon="refresh" onClick={() => void refreshQuery(selected)}>Refresh query</PluginHeroActionButton>
              )}
              {selected && (
                <>
                  <PluginHeroActionButton icon="layers_ui" onClick={() => void setOp('union')}>Union</PluginHeroActionButton>
                  <PluginHeroActionButton icon="filters" onClick={() => void setOp('intersect')}>Intersect</PluginHeroActionButton>
                  <PluginHeroActionButton icon="delete" onClick={() => void setOp('subtract')}>Subtract</PluginHeroActionButton>
                </>
              )}
              {selected && selectedPaths.length > 0 && (
                <PluginHeroActionButton icon="delete" onClick={() => void bulkRemoveSelected()}>Remove sel</PluginHeroActionButton>
              )}
              <PluginHeroActionButton icon="upload" onClick={() => importRef.current?.click()}>Import</PluginHeroActionButton>
              <PluginHeroActionButton icon="download" onClick={exportCatalogs}>Export</PluginHeroActionButton>
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCatalogs(f); e.target.value = ''; }} />
            </>
          }
        />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Collection list */}
          <div className="w-[240px] shrink-0 border-r border-white/[0.06] flex flex-col min-h-0 bg-black/15">
            <div className="p-3 border-b border-white/[0.06] space-y-2 shrink-0">
              <PluginSectionTitle icon="plus_ui">New collection</PluginSectionTitle>
              <div className="flex gap-1.5">
                <input
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder="Name…"
                  className={`${PLUGIN_INPUT_CLASS} flex-1 !py-1.5`}
                  onKeyDown={e => { if (e.key === 'Enter') void createCatalog(); }}
                />
                <PluginToolbarButton icon="plus_ui" onClick={() => void createCatalog()} disabled={!draftName.trim()} />
              </div>
            </div>

            {selectedPaths.length > 0 && (
              <div className="mx-2 mt-2 shrink-0">
                <PluginCard className="!py-2 !px-2.5 border-amber-500/20 bg-amber-950/15 text-amber-200/90 text-[11px] leading-snug">
                  {selectedPaths.length} selected — pick a catalog to add them.
                </PluginCard>
              </div>
            )}

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1 min-h-0">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-gray-500 text-xs gap-2">
                  <Icons8Icon id="loading" size={14} spin /> Loading…
                </div>
              ) : catalogs.length === 0 ? (
                <PluginEmptyState
                  icon="bookmark"
                  title="No catalogs"
                  description="Create a collection to build virtual folders at /vf."
                />
              ) : (
                catalogs.map(cat => {
                  const active = cat.id === selectedId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => { setSelectedId(cat.id); if (editing && editing.id !== cat.id) setEditing(null); }}
                      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
                        active
                          ? 'border-sky-400/35 bg-sky-500/10 shadow-[inset_0_1px_0_rgba(56,189,248,0.1)]'
                          : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icons8Icon id="bookmark" size={13} className={`shrink-0 ${active ? 'opacity-90' : 'opacity-50'}`} />
                        <span className={`text-xs font-semibold truncate flex-1 ${active ? 'text-white' : 'text-slate-300'}`}>
                          {cat.name}
                        </span>
                        <span className="bndz-plugin-kind-pill !text-[9px] shrink-0">{(cat.paths || []).length}</span>
                      </div>
                      {cat.query?.trim() && (
                        <div className="mt-1 text-[10px] bndz-panel-muted truncate pl-5">Search · {cat.query}</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => onNavigate?.(VF_ROOT)}
              className="shrink-0 m-2 text-[11px] text-sky-300/90 hover:text-sky-200 flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/[0.03]"
            >
              <Icons8Icon id="folder" size={12} />
              Open catalog root (/vf)
            </button>
          </div>

          {/* Designer pane */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            {!selected ? (
              <PluginEmptyState
                icon="bookmark"
                title="Select a collection"
                description="Pick a catalog on the left to inspect paths, edit metadata, or open it as a virtual folder."
              />
            ) : (
              <>
                <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center gap-2 flex-wrap bg-gradient-to-r from-sky-500/[0.06] to-transparent">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{selected.name}</div>
                    <div className="text-[11px] bndz-panel-muted bndz-mono truncate mt-0.5">
                      {VF_ROOT}/{selected.id}
                    </div>
                  </div>
                  {selectedPaths.length > 0 && (
                    <PluginToolbarButton icon="plus_ui" onClick={() => void addSelectionTo(selected)} title="Add selection">
                      Add selection
                    </PluginToolbarButton>
                  )}
                  <PluginToolbarButton
                    icon="pencil_ui"
                    active={!!editingActive}
                    onClick={() => editingActive ? setEditing(null) : openEdit(selected)}
                  >
                    {editingActive ? 'Close' : 'Edit'}
                  </PluginToolbarButton>
                  <PluginToolbarButton
                    icon="delete"
                    onClick={() => void deleteCatalog(selected.id).then(() => { load(); notifyCatalogChanged(); })}
                  />
                  <PluginToolbarButton icon="refresh" onClick={() => void load()} title="Refresh" />
                </div>

                {editingActive && (
                  <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] space-y-2 bg-black/20">
                    <PluginSectionTitle icon="pencil_ui">Collection details</PluginSectionTitle>
                    <div>
                      <PluginFieldLabel>Name</PluginFieldLabel>
                      <input value={renameDraft} onChange={e => setRenameDraft(e.target.value)} placeholder="Catalog name" className={PLUGIN_INPUT_CLASS} />
                    </div>
                    <div>
                      <PluginFieldLabel>Search query (optional)</PluginFieldLabel>
                      <input
                        value={queryDraft}
                        onChange={e => setQueryDraft(e.target.value)}
                        placeholder="XYplorer-style filter…"
                        className={`${PLUGIN_INPUT_CLASS} bndz-mono`}
                      />
                    </div>
                    <PluginToolbarButton icon="check" active onClick={() => void saveEditing()}>Save changes</PluginToolbarButton>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto bndz-scrollbar p-4 min-h-0">
                  <PluginSectionTitle
                    icon="file_ui"
                    action={<span className="bndz-plugin-kind-pill">{(selected.paths || []).length}</span>}
                  >
                    Paths
                  </PluginSectionTitle>

                  {(selected.paths || []).length === 0 ? (
                    <PluginEmptyState
                      icon="folder"
                      title="No paths yet"
                      description="Select files in the list and click Add selection, or open Edit to manage this collection."
                    />
                  ) : (
                    <div className="space-y-1.5">
                      {(selected.paths || []).map(p => {
                        const leaf = pathLeaf(p);
                        const parent = pathParent(p);
                        return (
                          <PluginCard key={p} className="!py-2 !px-3 flex items-center gap-2.5 group">
                            <Icons8Icon id="file_ui" size={14} className="shrink-0 opacity-55" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-slate-100 truncate">{leaf}</div>
                              {parent && (
                                <div className="text-[10px] bndz-panel-muted bndz-mono truncate mt-0.5" title={p}>{parent}</div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => void removePath(selected, p)}
                              className="opacity-0 group-hover:opacity-100 text-[10px] text-rose-400 hover:text-rose-300 shrink-0 px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-opacity"
                            >
                              remove
                            </button>
                          </PluginCard>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PluginPanelShell>
  );
}
