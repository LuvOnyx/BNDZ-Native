import React, { useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { useSettingsRuntime } from '../../hooks/useSettingsRuntime';
import { useAppConfig } from '../../data/configContext';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginSidebar,
  PluginSectionTitle,
  PluginCard,
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginEmptyState,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';
import { toWindowsPath } from '../../lib/pathUtils';
import { requestNativePrompt } from '../../lib/nativeDialog';
import { listCatalogs, upsertCatalog, type CatalogEntry } from '../../lib/catalog';
import {
  loadSmartCollections,
  upsertSmartCollection,
  removeSmartCollection,
  type SmartCollection,
} from '../../lib/smartCollections';
import { pushToast } from '../ToastHost';

const PRESET_KEY = 'bndz-find-presets-v1';
const PROPERTY_CHIPS: Array<{ label: string; token: string }> = [
  { label: 'Images', token: 'ext:png;jpg;jpeg;gif;webp;svg' },
  { label: 'Docs', token: 'ext:pdf;doc;docx;txt;md' },
  { label: 'Video', token: 'ext:mp4;mkv;mov;avi' },
  { label: 'Audio', token: 'ext:mp3;wav;flac;m4a' },
  { label: '>10MB', token: 'size:>10mb' },
  { label: 'Today', token: 'dm:today' },
  { label: 'This week', token: 'dm:thisweek' },
];

type SearchMode = 'local' | 'global' | 'duplicates' | 'advanced';
type FindPreset = { name: string; query: string; mode: SearchMode; regex: boolean; content: boolean; roots: string };

export const FindPluginDef = {
    id: "find",
    name: "Fast Search",
    icon: 'find',
    targetPanel: "bottom"
};

const SEARCH_HISTORY_MAX = 15;

export default function FindPlugin({ config, focusedPath, isPluginTabActive, pluginLaunch }: any) {
    const rt = useSettingsRuntime();
    const { updateConfig } = useAppConfig();
    const [query, setQuery] = useState('');
    const [mode, setMode] = useState<SearchMode>('local');
    const [regexEnabled, setRegexEnabled] = useState(false);
    const [booleanMode, setBooleanMode] = useState(true);
    const [searchContent, setSearchContent] = useState(rt.search.searchContent);
    const [extraRoots, setExtraRoots] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [duplicateGroups, setDuplicateGroups] = useState<Array<{ hash: string; size: number; paths: string[] }>>([]);
    const [searching, setSearching] = useState(false);
    const [status, setStatus] = useState('');
    const [dupProgress, setDupProgress] = useState<{ percent: number; message?: string } | null>(null);
    const [savedCatalogs, setSavedCatalogs] = useState<CatalogEntry[]>([]);
    const [smartCollections, setSmartCollections] = useState<SmartCollection[]>(() => loadSmartCollections());
    const [selectedResultPaths, setSelectedResultPaths] = useState<Set<string>>(() => new Set());
    const [findPresets, setFindPresets] = useState<FindPreset[]>(() => {
        try {
            const raw = localStorage.getItem(PRESET_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    });
    const searchHistory: string[] = Array.isArray(config?.findSearchHistory)
        ? config.findSearchHistory.filter((q: unknown): q is string => typeof q === 'string')
        : [];

    useEffect(() => {
        void listCatalogs().then(cats => setSavedCatalogs(cats.filter(c => c.query?.trim())));
    }, []);

    const pushSearchHistory = (q: string) => {
        const trimmed = q.trim();
        if (!trimmed) return;
        const next = [trimmed, ...searchHistory.filter(h => h.toLowerCase() !== trimmed.toLowerCase())].slice(0, SEARCH_HISTORY_MAX);
        updateConfig({ findSearchHistory: next });
    };

    const clearSearchHistory = () => {
        updateConfig({ findSearchHistory: [] });
    };

    const scopePath = focusedPath?.startsWith('/') ? focusedPath : (focusedPath ? `/${focusedPath}` : '/C:');

    useEffect(() => {
        if (isPluginTabActive === false) return;
        const unsub = IPC.onDuplicateScanProgress(p => {
            setDupProgress({ percent: p.percent ?? 0, message: p.currentPath });
            if (p.percent >= 100) setSearching(false);
        });
        return unsub;
    }, [isPluginTabActive]);

    const parseExtraRoots = (): string[] =>
        extraRoots.split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(p =>
            p.startsWith('/') ? p : `/${p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`,
        );

    const doSearch = async (queryOverride?: string) => {
        const effectiveQuery = (queryOverride ?? query).trim();
        if (mode === 'duplicates') {
            if (!scopePath || scopePath === '/') {
                setStatus('Navigate to a folder to scan for duplicates.');
                return;
            }
            setSearching(true);
            setStatus('Scanning for duplicate files…');
            setDuplicateGroups([]);
            setResults([]);
            setDupProgress({ percent: 0, message: 'Starting…' });
            try {
                const res = await IPC.scanDuplicates(toWindowsPath(scopePath), true, 1024);
                if (res.error) setStatus(res.error);
                else {
                    setDuplicateGroups(res.groups || []);
                    setStatus(`${res.groups?.length ?? 0} duplicate group(s) found.`);
                }
            } catch {
                setStatus('Duplicate scan failed.');
            }
            setSearching(false);
            setDupProgress(null);
            return;
        }

        if (!effectiveQuery) return;
        pushSearchHistory(effectiveQuery);
        setSearching(true);
        setStatus('');
        setDuplicateGroups([]);
        try {
            if (IPC.isNative) {
                const isAdvanced = mode === 'advanced';
                const roots = isAdvanced ? [scopePath, ...parseExtraRoots()] : [];
                const rootPath = mode === 'global' ? '/C:' : scopePath;
                const { items, engine } = await IPC.performGlobalSearch(
                    effectiveQuery,
                    rt.search.limit,
                    regexEnabled,
                    rootPath,
                    config?.enableEverythingSearch !== false,
                    searchContent || isAdvanced,
                    isAdvanced || booleanMode
                        ? { booleanMode: isAdvanced || booleanMode, rootPaths: isAdvanced ? roots : undefined }
                        : undefined,
                );
                setResults(items || []);
                const scopeLabel = isAdvanced
                    ? `${roots.length} root(s)`
                    : mode === 'global' ? 'All drives' : 'Current folder';
                setStatus(`${items?.length ?? 0} result(s) · ${scopeLabel}${engine ? ` · ${engine}` : ''}`);
            } else {
                setResults([]);
                setStatus('Fast Search requires the BNDZ native host (Everything / indexer).');
            }
        } catch {
            setStatus('Search failed.');
        }
        setSearching(false);
    };

    const cancelDupScan = () => {
        IPC.cancelDuplicateScan();
        setSearching(false);
        setDupProgress(null);
        setStatus('Scan cancelled.');
    };

    useEffect(() => {
        if (isPluginTabActive === false) return;
        const q = pluginLaunch?.findQuery?.trim();
        if (!q) return;
        setQuery(q);
        setMode('local');
        void doSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pluginLaunch?.findQuery, isPluginTabActive]);

    const navigateTo = (path: string) => {
        if (path) window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path } }));
    };

    const toggleQueryToken = (token: string) => {
        setQuery(prev => {
            const parts = prev.split(/\s+/).filter(Boolean);
            if (parts.includes(token)) return parts.filter(p => p !== token).join(' ');
            return [...parts, token].join(' ').trim();
        });
    };

    const saveFindPreset = async () => {
        const name = await requestNativePrompt({ title: 'Save Find preset', message: 'Preset name', defaultValue: '' });
        if (!name?.trim()) return;
        const next = [
            ...findPresets.filter(p => p.name !== name.trim()),
            { name: name.trim(), query, mode, regex: regexEnabled, content: searchContent, roots: extraRoots },
        ];
        setFindPresets(next);
        localStorage.setItem(PRESET_KEY, JSON.stringify(next));
        pushToast({ kind: 'success', title: 'Preset saved', message: name.trim() });
    };

    const resultActions = async (action: 'dropstack' | 'catalog' | 'copy') => {
        const paths = [...selectedResultPaths];
        if (!paths.length) return;
        if (action === 'copy') {
            await navigator.clipboard.writeText(paths.join('\n'));
            pushToast({ kind: 'success', title: 'Copied', message: `${paths.length} path(s)` });
            return;
        }
        if (action === 'dropstack') {
            window.dispatchEvent(new CustomEvent('bndz-drop-stack-stage', { detail: { paths } }));
            return;
        }
        if (action === 'catalog') {
            const name = await requestNativePrompt({
                title: 'Save to catalog',
                message: 'Catalog name',
                defaultValue: `Find ${new Date().toLocaleDateString()}`,
            });
            if (!name?.trim()) return;
            await upsertCatalog({ name: name.trim(), paths: paths.map(p => toWindowsPath(p)) });
            pushToast({ kind: 'success', title: 'Catalog', message: `Saved ${paths.length} path(s)` });
        }
    };

    return (
        <PluginPanelShell
            title="Fast Search"
            icon="find"
            iconColor="#0078d4"
            variant="embedded"
            subtitle={mode === 'global' ? 'Global scope' : mode === 'advanced' ? 'Advanced / multi-root' : `Scope: ${scopePath}`}
            status={!IPC.isNative ? (
                <span className="text-amber-300/90 text-[11px]">Native host required for indexed search</span>
            ) : undefined}
            toolbar={
                mode === 'duplicates' && searching ? (
                    <PluginToolbarButton onClick={cancelDupScan}>Cancel scan</PluginToolbarButton>
                ) : undefined
            }
        >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
                <PluginHeroStrip
                    icon={<Icons8Icon id="find" size={52} className="opacity-90" />}
                    name={query.trim() || 'Fast search'}
                    typeLabel={mode === 'global' ? 'Global scope' : mode === 'advanced' ? 'Advanced find' : mode === 'duplicates' ? 'Duplicate finder' : 'Local folder'}
                    path={mode === 'local' ? scopePath : undefined}
                    meta={<span className="bndz-panel-muted text-xs">{status || (searching ? 'Searching…' : 'Enter a query and press Search')}</span>}
                    actions={
                        <PluginHeroActionButton
                            icon={searching ? 'loading' : 'play_ui'}
                            variant="primary"
                            onClick={() => void doSearch()}
                            disabled={searching}
                        >
                            {mode === 'duplicates' ? 'Scan' : 'Search'}
                        </PluginHeroActionButton>
                    }
                />
            <div className="flex w-full flex-1 min-h-0">
                <PluginSidebar>
                    <PluginSectionTitle icon="filters">Mode</PluginSectionTitle>
                    <div className="flex flex-col gap-1">
                        {([
                            { id: 'local' as const, label: 'Local folder', icon: 'find' },
                            { id: 'global' as const, label: 'Global (Everything)', icon: 'go_network' },
                            { id: 'advanced' as const, label: 'Advanced find', icon: 'code_ui' },
                            { id: 'duplicates' as const, label: 'Duplicate finder', icon: 'copy' },
                        ]).map(m => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setMode(m.id)}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                                    mode === m.id ? 'bg-[#094771]/50 text-[#cce4f7] border border-[#0078d4]/40' : 'text-gray-400 hover:bg-[#1a1a1a]'
                                }`}
                            >
                                <Icons8Icon id={m.icon} size={12} /> {m.label}
                            </button>
                        ))}
                    </div>
                    {searchHistory.length > 0 && mode !== 'duplicates' && (
                        <>
                            <div className="bndz-context-menu-sep opacity-30" />
                            <div className="flex items-center justify-between gap-2">
                                <PluginSectionTitle icon="clock_ui">Recent searches</PluginSectionTitle>
                                <button type="button" onClick={clearSearchHistory} className="text-xs bndz-panel-muted hover:text-gray-300">Clear</button>
                            </div>
                            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto bndz-scrollbar">
                                {searchHistory.map(h => (
                                    <button
                                        key={h}
                                        type="button"
                                        className="text-left text-xs px-2 py-1 rounded-md text-gray-400 hover:bg-[#094771]/30 hover:text-[#cce4f7] truncate"
                                        title={h}
                                        onClick={() => { setQuery(h); void doSearch(h); }}
                                    >
                                        {h}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {savedCatalogs.length > 0 && mode !== 'duplicates' && (
                        <>
                            <div className="bndz-context-menu-sep opacity-30" />
                            <PluginSectionTitle icon="bookmark">Saved catalog searches</PluginSectionTitle>
                            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto bndz-scrollbar">
                                {savedCatalogs.map(cat => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        className="text-left text-xs px-2 py-1 rounded-md text-gray-400 hover:bg-violet-900/30 hover:text-violet-200 truncate"
                                        title={cat.query || ''}
                                        onClick={() => {
                                            setQuery(cat.query || '');
                                            navigateTo(`/vf/${cat.id}`);
                                        }}
                                    >
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    {mode !== 'duplicates' && (
                        <>
                            <div className="bndz-context-menu-sep opacity-30" />
                            <div className="flex items-center justify-between gap-2">
                                <PluginSectionTitle icon="filters">Smart collections</PluginSectionTitle>
                                <button
                                    type="button"
                                    className="text-[10px] text-[#7eb8e8] hover:text-[#99c9f0]"
                                    title="Save current query as a smart collection"
                                    onClick={() => {
                                        void (async () => {
                                            const q = query.trim();
                                            if (!q) return;
                                            const name = await requestNativePrompt({
                                                title: 'Save smart collection',
                                                message: 'Collection name',
                                                defaultValue: q.slice(0, 40),
                                            });
                                            if (!name?.trim()) return;
                                            setSmartCollections(upsertSmartCollection({
                                                name: name.trim(),
                                                query: q,
                                                scopePath: mode === 'local' ? scopePath : undefined,
                                                searchContent,
                                            }));
                                        })();
                                    }}
                                >
                                    Save
                                </button>
                            </div>
                            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto bndz-scrollbar">
                                {smartCollections.length === 0 ? (
                                    <span className="text-[10px] text-gray-600 px-1">Save a query to pin a live collection.</span>
                                ) : smartCollections.map(sc => (
                                    <div key={sc.id} className="flex items-center gap-1 group">
                                        <button
                                            type="button"
                                            className="flex-1 text-left text-xs px-2 py-1 rounded-[8px] text-gray-400 hover:bg-[#094771]/30 hover:text-[#cce4f7] truncate"
                                            title={sc.query}
                                            onClick={() => {
                                                setQuery(sc.query);
                                                setSearchContent(!!sc.searchContent);
                                                void doSearch(sc.query);
                                            }}
                                        >
                                            {sc.name}
                                        </button>
                                        <button
                                            type="button"
                                            className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-600 hover:text-red-400 px-1"
                                            onClick={() => setSmartCollections(removeSmartCollection(sc.id))}
                                            title="Remove"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    {mode !== 'duplicates' && (
                        <>
                            <div className="bndz-context-menu-sep opacity-30" />
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={regexEnabled} onChange={e => setRegexEnabled(e.target.checked)} className="accent-[#0078d4]" />
                                Regular expressions
                            </label>
                            {mode !== 'advanced' && (
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input type="checkbox" checked={booleanMode} onChange={e => setBooleanMode(e.target.checked)} className="accent-[#0078d4]" />
                                    Boolean (AND / OR / NOT)
                                </label>
                            )}
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={searchContent} onChange={e => setSearchContent(e.target.checked)} className="accent-[#0078d4]" />
                                Search file content
                            </label>
                            {mode === 'advanced' && (
                                <div className="mt-1">
                                    <PluginSectionTitle icon="file_ui">Extra roots (; separated)</PluginSectionTitle>
                                    <textarea
                                        value={extraRoots}
                                        onChange={e => setExtraRoots(e.target.value)}
                                        placeholder="D:/Projects;E:/Archive"
                                        rows={3}
                                        className={`${PLUGIN_INPUT_CLASS} bndz-mono min-h-[64px] resize-y`}
                                    />
                                </div>
                            )}
                        </>
                    )}
                    {dupProgress && (
                        <div className="text-xs text-[#7eb8e8]">
                            {dupProgress.percent}% {dupProgress.message ? `· ${dupProgress.message}` : ''}
                        </div>
                    )}
                    <div className="text-xs bndz-panel-muted mt-auto leading-relaxed">
                        {status || `Limit: ${rt.search.limit}`}
                        {mode === 'advanced' && <div className="mt-1">Use quotes, OR, NOT — e.g. report OR invoice NOT draft</div>}
                    </div>
                </PluginSidebar>
                <div className="flex-1 flex flex-col min-w-0">
                    {mode !== 'duplicates' && (
                        <div className="p-3 border-b border-white/[0.06] shrink-0 space-y-2">
                            <div className="relative">
                                <Icons8Icon id="search" size={14} className="absolute left-3 top-2.5 opacity-60" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                                    placeholder={mode === 'advanced' ? 'Boolean query across multiple roots…' : mode === 'global' ? 'Search all drives…' : 'Search in current folder…'}
                                    className={`${PLUGIN_INPUT_CLASS} pl-9 py-2 text-sm`}
                                />
                            </div>
                            <div className="flex flex-wrap gap-1.5 items-center">
                                {PROPERTY_CHIPS.map(chip => {
                                    const on = query.split(/\s+/).includes(chip.token);
                                    return (
                                        <button
                                            key={chip.token}
                                            type="button"
                                            onClick={() => toggleQueryToken(chip.token)}
                                            className={`bndz-plugin-kind-pill text-[10px] ${on ? 'bg-sky-500/20 border-sky-400/40 text-sky-200' : 'text-slate-400 hover:bg-white/[0.06]'}`}
                                        >
                                            {chip.label}
                                        </button>
                                    );
                                })}
                                <PluginToolbarButton icon="bookmark" onClick={saveFindPreset}>Save preset</PluginToolbarButton>
                                {findPresets.length > 0 && (
                                    <select
                                        className={PLUGIN_SELECT_CLASS}
                                        defaultValue=""
                                        onChange={e => {
                                            const p = findPresets.find(x => x.name === e.target.value);
                                            if (!p) return;
                                            setQuery(p.query); setMode(p.mode); setRegexEnabled(p.regex);
                                            setSearchContent(p.content); setExtraRoots(p.roots);
                                            e.target.value = '';
                                        }}
                                    >
                                        <option value="">Presets…</option>
                                        {findPresets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                    </select>
                                )}
                            </div>
                            {selectedResultPaths.size > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    <PluginToolbarButton icon="folder_open_ui" onClick={() => {
                                        const first = [...selectedResultPaths][0];
                                        if (first) navigateTo(first.replace(/\\[^\\]+$/, '').replace(/^([A-Za-z]):/, '/$1:'));
                                    }}>Reveal</PluginToolbarButton>
                                    <PluginToolbarButton icon="dropstack" onClick={() => void resultActions('dropstack')}>Drop Stack</PluginToolbarButton>
                                    <PluginToolbarButton icon="bookmark" onClick={() => void resultActions('catalog')}>Catalog</PluginToolbarButton>
                                    <PluginToolbarButton icon="copy_path" onClick={() => void resultActions('copy')}>Copy paths</PluginToolbarButton>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto bndz-scrollbar">
                        {mode === 'duplicates' ? (
                            duplicateGroups.length === 0 ? (
                                <PluginEmptyState
                                  icon="copy"
                                  title={searching ? 'Scanning…' : 'No duplicates yet'}
                                  description={searching ? 'Hashing files in the current folder.' : 'Scan the current folder for duplicate files by content hash.'}
                                />
                            ) : (
                                <div className="p-2 space-y-3">
                                    {duplicateGroups.map(g => (
                                        <div key={g.hash} className="bndz-plugin-card overflow-hidden !p-0">
                                            <div className="px-3 py-2 border-b border-white/[0.06] text-xs bndz-panel-muted bndz-mono">
                                                {g.paths.length} copies · {g.size} bytes
                                            </div>
                                            {g.paths.map(p => (
                                                <div
                                                    key={p}
                                                    className="px-3 py-2 text-[11px] text-gray-300 hover:bg-white/[0.04] cursor-pointer truncate font-mono"
                                                    onDoubleClick={() => navigateTo(p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'))}
                                                    title={p}
                                                >
                                                    {p}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )
                        ) : results.length === 0 ? (
                            <PluginEmptyState
                              icon="find"
                              title="No results"
                              description="Enter a query and search — results open as finding tabs from the list."
                            />
                        ) : (
                            <div className="flex flex-col min-h-0">
                              <div className="sticky top-0 z-10 grid grid-cols-[24px_minmax(120px,1.1fr)_minmax(160px,2fr)_72px] gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-white/35 border-b border-white/[0.06]" style={{ background: 'var(--bndz-surface-chrome)' }}>
                                <span />
                                <span>Name</span>
                                <span>Path</span>
                                <span>Type</span>
                              </div>
                              <div className="flex-1">
                                {results.map((r, i) => {
                                  const path = String(r.path || '');
                                  const checked = selectedResultPaths.has(path);
                                  return (
                                  <div
                                    key={`${path}-${i}`}
                                    className={`grid grid-cols-[24px_minmax(120px,1.1fr)_minmax(160px,2fr)_72px] gap-2 px-3 py-2 text-xs border-b border-white/[0.04] hover:bg-[#094771]/18 cursor-pointer transition-colors ${checked ? 'bg-sky-500/[0.08]' : ''}`}
                                    onDoubleClick={() => navigateTo(path)}
                                    title={r.snippet ? `${path}\n${r.snippet}` : path}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        setSelectedResultPaths(prev => {
                                          const next = new Set(prev);
                                          if (next.has(path)) next.delete(path);
                                          else next.add(path);
                                          return next;
                                        });
                                      }}
                                      onClick={e => e.stopPropagation()}
                                      className="self-center"
                                    />
                                    <div className="min-w-0">
                                      <span className="text-gray-100 truncate font-medium block">{r.name}</span>
                                      {r.snippet && (
                                        <span className="text-[10px] text-white/35 truncate block mt-0.5 leading-snug">{r.snippet}</span>
                                      )}
                                    </div>
                                    <span className="text-white/40 font-mono text-[11px] truncate">{path}</span>
                                    <span className="bndz-plugin-kind-pill w-fit self-center">{r.matchType === 'content' || r.snippet ? 'grep' : r.isDirectory ? 'dir' : 'file'}</span>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>
        </PluginPanelShell>
    );
}
