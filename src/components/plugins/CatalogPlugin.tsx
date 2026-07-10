import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { listCatalogs, upsertCatalog, deleteCatalog, type CatalogEntry } from '../../lib/catalog';
import { VF_ROOT } from '../../lib/virtualPaths';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
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

export default function CatalogPlugin({ selectedPaths = [], onNavigate }: Props) {
  const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [queryDraft, setQueryDraft] = useState('');
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

  const createCatalog = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (!selectedPaths.length) {
      pushToast({ kind: 'warning', title: 'Empty catalog', message: 'Select items first, or add paths after creating.' });
    }
    const paths = selectedPaths.map(p => toWindowsPath(p));
    await upsertCatalog({ name, paths });
    setDraftName('');
    await load();
    notifyCatalogChanged();
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
      toolbar={
        <>
          <PluginToolbarButton icon="download" onClick={exportCatalogs}>Export</PluginToolbarButton>
          <PluginToolbarButton icon="upload" onClick={() => importRef.current?.click()}>Import</PluginToolbarButton>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCatalogs(f); e.target.value = ''; }} />
        </>
      }
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="bookmark" size={52} className="opacity-90" />}
          name={catalogs.length ? `${catalogs.length} catalog${catalogs.length === 1 ? '' : 's'}` : 'Virtual catalogs'}
          typeLabel="VF collections"
          meta={<span className="bndz-panel-muted text-xs">Browse at {VF_ROOT} · {selectedPaths.length ? `${selectedPaths.length} selected` : 'Select items to add'}</span>}
          actions={
            <>
              <PluginHeroActionButton icon="plus_ui" variant="primary" onClick={() => void createCatalog()} disabled={!draftName.trim()}>Create</PluginHeroActionButton>
              <PluginHeroActionButton icon="download" onClick={exportCatalogs}>Export</PluginHeroActionButton>
            </>
          }
        />
      <div className="flex flex-col gap-3 p-4 text-xs text-gray-300 flex-1 min-h-0 overflow-hidden">
        <div className="flex gap-2 shrink-0">
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="New catalog name…"
            className={`${PLUGIN_INPUT_CLASS} flex-1 text-sm`}
            onKeyDown={e => { if (e.key === 'Enter') void createCatalog(); }}
          />
          <PluginToolbarButton icon="plus_ui" onClick={() => void createCatalog()}>Create</PluginToolbarButton>
          <PluginToolbarButton icon="refresh" onClick={() => void load()} title="Refresh" />
        </div>

        {selectedPaths.length > 0 && (
          <PluginCard className="!py-2 border-amber-500/20 bg-amber-950/15 text-amber-200/90 text-xs">
            {selectedPaths.length} selected — add to a catalog or create one above.
          </PluginCard>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500"><Icons8Icon id="loading" size={16} spin className="mr-2" /> Loading…</div>
        ) : catalogs.length === 0 ? (
          <PluginEmptyState
            icon="bookmark"
            title="No catalogs yet"
            description="Create a catalog to build virtual folders at /vf."
          />
        ) : (
          <div className="flex-1 space-y-2 overflow-y-auto bndz-scrollbar min-h-0">
            {catalogs.map(cat => (
              <PluginCard key={cat.id} className="!p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
                  <Icons8Icon id="bookmark" size={14} className="shrink-0" />
                  <button type="button" className="font-semibold text-white hover:underline truncate flex-1 text-left text-sm" onClick={() => onNavigate?.(`/vf/${cat.id}`)}>
                    {cat.name}
                  </button>
                  {cat.query?.trim() && (
                    <span className="bndz-plugin-kind-pill shrink-0" title={cat.query}>Search</span>
                  )}
                  <span className="text-xs bndz-panel-muted shrink-0">{(cat.paths || []).length}</span>
                  {selectedPaths.length > 0 && (
                    <PluginToolbarButton icon="explorer" onClick={() => void addSelectionTo(cat)} title="Add selection" />
                  )}
                  <PluginToolbarButton
                    icon="pencil_ui"
                    onClick={() => editing?.id === cat.id ? setEditing(null) : openEdit(cat)}
                  >
                    {editing?.id === cat.id ? 'Close' : 'Edit'}
                  </PluginToolbarButton>
                  <PluginToolbarButton icon="delete" onClick={() => void deleteCatalog(cat.id).then(() => { load(); notifyCatalogChanged(); })} />
                </div>
                {editing?.id === cat.id && (
                  <div className="px-3 py-3 space-y-2 border-b border-white/[0.06]">
                    <input value={renameDraft} onChange={e => setRenameDraft(e.target.value)} placeholder="Catalog name" className={PLUGIN_INPUT_CLASS} />
                    <input value={queryDraft} onChange={e => setQueryDraft(e.target.value)} placeholder="Search query (optional XYplorer-style filter)" className={`${PLUGIN_INPUT_CLASS} bndz-mono`} />
                    <PluginToolbarButton icon="check" active onClick={() => void saveEditing()}>Save</PluginToolbarButton>
                  </div>
                )}
                {editing?.id === cat.id && (
                  <ul className="px-3 py-2 space-y-1 max-h-[160px] overflow-y-auto bndz-scrollbar">
                    {(cat.paths || []).length === 0 && <li className="bndz-panel-muted italic text-xs">No paths</li>}
                    {(cat.paths || []).map(p => (
                      <li key={p} className="flex items-center gap-2 bndz-mono text-xs">
                        <span className="truncate flex-1" title={p}>{p}</span>
                        <button type="button" onClick={() => void removePath(cat, p)} className="text-red-400 hover:underline shrink-0">remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </PluginCard>
            ))}
          </div>
        )}

        <button type="button" onClick={() => onNavigate?.(VF_ROOT)} className="text-[#7eb8e8] hover:underline text-left text-xs shrink-0">
          Open catalog root (/vf) in active pane
        </button>
      </div>
      </div>
    </PluginPanelShell>
  );
}
