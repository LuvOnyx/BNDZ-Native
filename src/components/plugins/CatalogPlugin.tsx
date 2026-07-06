import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookMarked, Plus, Trash2, FolderInput, RefreshCw, Loader2, Download, Upload, Pencil } from 'lucide-react';
import PluginPanelShell from './PluginPanelShell';
import { listCatalogs, upsertCatalog, deleteCatalog, type CatalogEntry } from '../../lib/catalog';
import { VF_ROOT } from '../../lib/virtualPaths';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';

function notifyCatalogChanged() {
  window.dispatchEvent(new CustomEvent('bndz-catalog-changed'));
}

export const CatalogPluginDef = {
  id: 'catalog',
  name: 'Catalog',
  icon: BookMarked,
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
      icon={BookMarked}
      iconColor="#38bdf8"
      variant="embedded"
      subtitle="Virtual collections — browse as /vf"
      toolbar={
        <div className="flex gap-1.5">
          <button type="button" onClick={exportCatalogs} className="text-[10px] px-2 py-1 rounded border border-[#444] hover:bg-[#222] flex items-center gap-1">
            <Download size={11} /> Export
          </button>
          <button type="button" onClick={() => importRef.current?.click()} className="text-[10px] px-2 py-1 rounded border border-[#444] hover:bg-[#222] flex items-center gap-1">
            <Upload size={11} /> Import
          </button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importCatalogs(f); e.target.value = ''; }} />
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[12px] text-gray-300 h-full min-h-0">
        <div className="flex gap-2 shrink-0">
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="New catalog name…"
            className="flex-1 bg-[#111] border border-[#444] rounded-lg px-3 py-2 outline-none focus:border-sky-500/50 text-sm"
            onKeyDown={e => { if (e.key === 'Enter') void createCatalog(); }}
          />
          <button type="button" onClick={() => void createCatalog()} className="px-4 py-2 rounded-lg bg-sky-700/40 border border-sky-500/30 hover:bg-sky-600/40 flex items-center gap-1.5 font-semibold text-sm">
            <Plus size={14} /> Create
          </button>
          <button type="button" onClick={() => void load()} className="p-2 rounded-lg border border-[#444] hover:bg-[#222]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {selectedPaths.length > 0 && (
          <div className="text-[10px] text-amber-300/90 border border-amber-500/20 rounded-lg px-3 py-2 bg-amber-950/20 shrink-0">
            {selectedPaths.length} selected — add to a catalog or create one above.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>
        ) : catalogs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 gap-2 py-8">
            <BookMarked size={32} className="opacity-20 text-sky-400" />
            <p>No catalogs yet. Create one to build virtual folders at <code className="text-sky-400">/vf</code>.</p>
          </div>
        ) : (
          <div className="flex-1 space-y-2 overflow-y-auto bndz-scrollbar min-h-0">
            {catalogs.map(cat => (
              <div key={cat.id} className="border border-[#333] rounded-xl bg-[#141414] overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-[#1a1a1a] border-b border-[#333]">
                  <BookMarked size={14} className="text-sky-400 shrink-0" />
                  <button type="button" className="font-semibold text-white hover:underline truncate flex-1 text-left" onClick={() => onNavigate?.(`/vf/${cat.id}`)}>
                    {cat.name}
                  </button>
                  {cat.query?.trim() && (
                    <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 shrink-0" title={cat.query}>
                      Search
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500 shrink-0">{(cat.paths || []).length}</span>
                  {selectedPaths.length > 0 && (
                    <button type="button" title="Add selection" onClick={() => void addSelectionTo(cat)} className="p-1 rounded hover:bg-[#333] text-emerald-400">
                      <FolderInput size={14} />
                    </button>
                  )}
                  <button type="button" onClick={() => editing?.id === cat.id ? setEditing(null) : openEdit(cat)} className="text-[10px] px-2 py-0.5 rounded border border-[#444] hover:bg-[#333] flex items-center gap-1">
                    <Pencil size={10} /> {editing?.id === cat.id ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" onClick={() => void deleteCatalog(cat.id).then(() => { load(); notifyCatalogChanged(); })} className="p-1 rounded hover:bg-red-950/40 text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
                {editing?.id === cat.id && (
                  <div className="px-3 py-3 space-y-2 border-b border-[#333] bg-[#111]">
                    <input value={renameDraft} onChange={e => setRenameDraft(e.target.value)} placeholder="Catalog name" className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs" />
                    <input value={queryDraft} onChange={e => setQueryDraft(e.target.value)} placeholder="Search query (optional XYplorer-style filter)" className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs font-mono" />
                    <button type="button" onClick={() => void saveEditing()} className="text-xs px-3 py-1 rounded bg-sky-600/80 text-white font-semibold">Save</button>
                  </div>
                )}
                {editing?.id === cat.id && (
                  <ul className="px-3 py-2 space-y-1 max-h-[160px] overflow-y-auto bndz-scrollbar">
                    {(cat.paths || []).length === 0 && <li className="text-gray-500 italic text-[11px]">No paths</li>}
                    {(cat.paths || []).map(p => (
                      <li key={p} className="flex items-center gap-2 font-mono text-[10px]">
                        <span className="truncate flex-1" title={p}>{p}</span>
                        <button type="button" onClick={() => void removePath(cat, p)} className="text-red-400 hover:underline shrink-0">remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={() => onNavigate?.(VF_ROOT)} className="text-sky-400 hover:underline text-left text-[11px] shrink-0">
          Open catalog root (/vf) in active pane
        </button>
      </div>
    </PluginPanelShell>
  );
}
