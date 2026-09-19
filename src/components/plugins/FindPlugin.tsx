import React, { useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
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
import { appendDropStackPaths } from '../../lib/dropStackStore';

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
    /** Windows path override; blank = follow the list's current folder. */
    const [scopeFolder, setScopeFolder] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [duplicateGroups, setDuplicateGroups] = useState<Array<{ hash: string; size: number; paths: string[] }>>([]);
    const [searching, setSearching] = useState(false);
    const [status, setStatus] = useState('');
    const [dupProgress, setDupProgress] = useState<{ percent: number; message?: string } | null>(null);
    const [savedCatalogs, setSavedCatalogs] = useState<CatalogEntry[]>([]);
    const [smartCollections, setSmartCollections] = useState<SmartCollection[]>(() => loadSmartCollections());
    const [selectedResultPaths, setSelectedResultPaths] = useState<Set<string>>(() => new Set());
    const [activeResultIndex, setActiveResultIndex] = useState(-1);
    const [hasSearched, setHasSearched] = useState(false);
    const [lastSearchEngine, setLastSearchEngine] = useState<string | null>(null);
    const resultsListRef = useRef<HTMLDivElement | null>(null);

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

    const toPaneRoot = (raw: string): string => {
        const s = raw.trim();
        if (!s) return '';
        return s.startsWith('/') ? s : `/${s.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`;
    };

    const focusedPane = focusedPath?.startsWith('/')
        ? focusedPath
        : (focusedPath ? `/${focusedPath}` : '/C:');
    const scopePath = toPaneRoot(scopeFolder) || focusedPane;

    useEffect(() => {
        if (isPluginTabActive === false) return;
        const unsub = IPC.onDuplicateScanProgress(p => {
            setDupProgress({ percent: p.percent ?? 0, message: p.currentPath });
            if (p.percent >= 100) setSearching(false);
        });
        return unsub;
    }, [isPluginTabActive]);

    const parseExtraRoots = (): string[] =>
        extraRoots.split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(toPaneRoot);

    const pickScopeFolder = async () => {
        const picked = await IPC.openFolderDialog('Folder to search');
        if (!picked) return;
        setScopeFolder(toWindowsPath(toPaneRoot(picked)).replace(/\//g, '\\'));
        if (mode === 'global') setMode('local');
    };

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
                    {
                      booleanMode: isAdvanced || booleanMode,
                      rootPaths: isAdvanced ? roots : (mode === 'local' ? [rootPath] : undefined),
                      matchCase: !!rt.search.matchCase,
                    },
                );
                setResults(items || []);
                setHasSearched(true);
                setLastSearchEngine(engine ? String(engine) : null);
                setActiveResultIndex((items || []).length ? 0 : -1);
                if (rt.search.cacheSearchResults && Array.isArray(items)) {
                    try {
                        sessionStorage.setItem(
                            `bndz-find-cache:${mode}:${effectiveQuery}`,
                            JSON.stringify({ at: Date.now(), count: items.length }),
                        );
                    } catch { /* ignore quota */ }
                }
                const scopeLabel = mode === 'global'
                    ? 'All drives'
                    : isAdvanced && roots.length > 1
                        ? `${roots.length} folder(s)`
                        : formatUiPath(rootPath);
                const indent = rt.search.levelIndentWidthInPixels || rt.search.levelIndent || 12;
                setStatus(`${items?.length ?? 0} result(s) · ${scopeLabel}${engine ? ` · ${engine}` : ''} · indent ${indent}px`);
            } else {
                setResults([]);
                setHasSearched(true);
                setLastSearchEngine(null);
                setActiveResultIndex(-1);
                setStatus('Fast Search requires the BNDZ native host (Everything / indexer).');
            }
        } catch {
            setStatus('Search failed.');
            setHasSearched(true);
            setActiveResultIndex(-1);
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

    const openResultAt = (index: number) => {
        const item = results[index];
        const path = String(item?.path || '');
        if (!path) return;
        const isDirectory = !!(item as { isDirectory?: boolean })?.isDirectory;
        window.dispatchEvent(new CustomEvent('bndz-open-in-bndz', {
          detail: { path, isDirectory },
        }));
    };

    const onResultsKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setActiveResultIndex(-1);
            (document.querySelector('.bndz-find-query-input') as HTMLInputElement | null)?.focus();
            return;
        }
        if (!results.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveResultIndex(i => Math.min(results.length - 1, (i < 0 ? 0 : i) + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeResultIndex <= 0) {
                setActiveResultIndex(-1);
                (document.querySelector('.bndz-find-query-input') as HTMLInputElement | null)?.focus();
                return;
            }
            setActiveResultIndex(i => Math.max(0, (i < 0 ? 0 : i) - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const idx = activeResultIndex >= 0 ? activeResultIndex : 0;
            openResultAt(idx);
        } else if (e.key === 'PageDown') {
            e.preventDefault();
            setActiveResultIndex(i => Math.min(results.length - 1, Math.max(0, i) + 10));
        } else if (e.key === 'PageUp') {
            e.preventDefault();
            setActiveResultIndex(i => Math.max(0, (i < 0 ? 0 : i) - 10));
        } else if (e.key === 'Home') {
            e.preventDefault();
            setActiveResultIndex(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            setActiveResultIndex(results.length - 1);
        }
    };

    useEffect(() => {
        if (activeResultIndex < 0) return;
        const root = resultsListRef.current;
        if (!root) return;
        const row = root.querySelector(`[data-find-result-index="${activeResultIndex}"]`) as HTMLElement | null;
        row?.scrollIntoView({ block: 'nearest' });
    }, [activeResultIndex]);

    const everythingEnabled = config?.enableEverythingSearch !== false;
    const emptyTitle = searching
        ? 'Searching…'
        : !hasSearched
            ? 'Search your PC'
            : 'No results';
    const emptyDescription = searching
        ? 'Looking for matches…'
        : !hasSearched
            ? (everythingEnabled
                ? 'Type a query and press Enter. Everything mode searches all drives instantly; Folder mode stays in the current path.'
                : 'Type a query and press Enter. Everything is off in Settings — searches use the BNDZ index / Windows Search when available.')
            : (everythingEnabled
                ? (lastSearchEngine
                    ? `No matches via ${lastSearchEngine}. Try a broader query, another mode, or check spelling.`
                    : 'No matches. Try a broader query, switch mode, or search a different folder.')
                : 'No matches. Everything is disabled — enable it in Settings for instant all-drive search, or build/refresh the BNDZ index.');


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
            appendDropStackPaths(paths);
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
            iconColor="#a855f7"
            variant="embedded"
            subtitle={mode === 'global' ? 'Search all drives' : mode === 'advanced' ? 'Search several folders with AND / OR' : mode === 'duplicates' ? 'Find same files in this folder' : `This folder · ${formatUiPath(scopePath)}`}
            status={!IPC.isNative ? (
                <span className="text-amber-300/90 text-[11px]">Needs the BNDZ app for indexed search</span>
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
                    name={query.trim() || 'Fast Search'}
                    typeLabel={mode === 'global' ? 'Everything' : mode === 'advanced' ? 'Advanced' : mode === 'duplicates' ? 'Duplicates' : 'Easy'}
                    path={mode === 'local' ? scopePath : undefined}
                    meta={<span className="bndz-panel-muted text-xs">{status || (searching ? 'Searching…' : 'Easy · Everything · Advanced')}</span>}
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
                <div className="px-4 pt-3 grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
                    {([
                        { id: 'local' as const, label: 'Easy', hint: 'This folder', icon: 'find' },
                        { id: 'global' as const, label: 'Everything', hint: 'All drives · instant', icon: 'go_network' },
                        { id: 'advanced' as const, label: 'Advanced', hint: 'AND / OR · several folders', icon: 'code_ui' },
                        { id: 'duplicates' as const, label: 'Duplicates', hint: 'Same files in this folder', icon: 'copy' },
                    ]).map(card => (
                        <button
                            key={card.id}
                            type="button"
                            onClick={() => setMode(card.id)}
                            data-mode={card.id}
                            className={`bndz-find-mode-chip text-left px-2.5 py-2 transition-colors ${
                                mode === card.id ? 'is-active' : ''
                            }`}
                        >
                            <div className="bndz-find-mode-chip-label flex items-center gap-1.5 text-[12px] font-semibold">
                                <Icons8Icon id={card.icon} size={13} /> {card.label}
                            </div>
                            <p className="bndz-find-mode-chip-hint text-[10px] mt-0.5 leading-snug">{card.hint}</p>
                        </button>
                    ))}
                </div>
            <div className="flex w-full flex-1 min-h-0">
                <PluginSidebar>
                    <PluginSectionTitle icon="filters">Mode</PluginSectionTitle>
                    <div className="flex flex-col gap-1">
                        {([
                            { id: 'local' as const, label: 'Easy — this folder', icon: 'find' },
                            { id: 'global' as const, label: 'Everything', icon: 'go_network' },
                            { id: 'advanced' as const, label: 'Advanced', icon: 'code_ui' },
                            { id: 'duplicates' as const, label: 'Duplicates', icon: 'copy' },
                        ]).map(m => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => setMode(m.id)}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                                    mode === m.id ? 'bg-violet-500/20 text-violet-100 border border-violet-400/35' : 'text-gray-400 hover:bg-[#1a1a1a]'
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
                                Match patterns (advanced)
                            </label>
                            {mode !== 'advanced' && (
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input type="checkbox" checked={booleanMode} onChange={e => setBooleanMode(e.target.checked)} className="accent-[#0078d4]" />
                                    Match with AND / OR / NOT
                                </label>
                            )}
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={searchContent} onChange={e => setSearchContent(e.target.checked)} className="accent-[#0078d4]" />
                                Search file content
                            </label>
                            {mode === 'advanced' && (
                                  <div className="mt-1">
                                      <PluginSectionTitle icon="file_ui">Extra folders (separate with ;)</PluginSectionTitle>
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
                    {mode === 'duplicates' && (
                        <div className="p-3 border-b border-white/[0.06] shrink-0">
                            <div className="flex items-center gap-1.5">
                                <input
                                    value={scopeFolder}
                                    onChange={e => setScopeFolder(e.target.value)}
                                    placeholder={`Current · ${formatUiPath(focusedPane)}`}
                                    title="Folder to scan. Leave blank to use the folder open in the list."
                                    className={`flex-1 min-w-0 ${PLUGIN_INPUT_CLASS} bndz-mono text-[11px]`}
                                />
                                <button
                                    type="button"
                                    className="shrink-0 w-[30px] h-7 rounded-md border border-white/10 bg-white/[0.04] text-[13px] font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white"
                                    title="Choose folder"
                                    onClick={() => void pickScopeFolder()}
                                >
                                    …
                                </button>
                            </div>
                        </div>
                    )}
                    {mode !== 'duplicates' && (
                        <div className="p-3 border-b border-white/[0.06] shrink-0 space-y-2">
                            {mode !== 'global' && (
                                <div className="flex items-center gap-1.5">
                                    <input
                                        value={scopeFolder}
                                        onChange={e => setScopeFolder(e.target.value)}
                                        placeholder={`Current · ${formatUiPath(focusedPane)}`}
                                        title="Folder to search. Leave blank to use the folder open in the list."
                                        className={`flex-1 min-w-0 ${PLUGIN_INPUT_CLASS} bndz-mono text-[11px]`}
                                    />
                                    <button
                                        type="button"
                                        className="shrink-0 w-[30px] h-7 rounded-md border border-white/10 bg-white/[0.04] text-[13px] font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white"
                                        title="Choose folder"
                                        onClick={() => void pickScopeFolder()}
                                    >
                                        …
                                    </button>
                                </div>
                            )}
                            <div className="relative">
                                <Icons8Icon id="search" size={14} className="absolute left-3 top-2.5 opacity-60" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            if (query) setQuery('');
                                            else (e.currentTarget as HTMLInputElement).blur();
                                            return;
                                        }
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            void doSearch().then(() => {
                                                requestAnimationFrame(() => resultsListRef.current?.focus());
                                            });
                                        } else if (e.key === 'ArrowDown' && results.length) {
                                            e.preventDefault();
                                            resultsListRef.current?.focus();
                                            setActiveResultIndex(0);
                                        }
                                    }}
                                    placeholder={mode === 'advanced' ? 'Search several folders — try report OR invoice NOT draft…' : mode === 'global' ? 'Search all drives…' : 'Search this folder…'}
                                    className={`${PLUGIN_INPUT_CLASS} pl-9 py-2 text-sm bndz-find-query-input`}
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
                                  description={searching ? 'Comparing files in the current folder…' : 'Scan this folder for files that are exact copies of each other.'}
                                />
                            ) : (
                                <div
                                  className="p-2 space-y-3 outline-none"
                                  tabIndex={0}
                                  role="listbox"
                                  aria-label="Duplicate groups"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      (document.querySelector('.bndz-find-query-input') as HTMLInputElement | null)?.focus();
                                      return;
                                    }
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      const first = duplicateGroups[0]?.paths?.[0];
                                      if (!first) return;
                                      e.preventDefault();
                                      navigateTo(first.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'));
                                    }
                                  }}
                                >
                                    {duplicateGroups.map(g => (
                                        <div key={g.hash} className="bndz-plugin-card overflow-hidden !p-0" role="group">
                                            <div className="px-3 py-2 border-b border-white/[0.06] text-xs bndz-panel-muted bndz-mono">
                                                {g.paths.length} copies · {g.size} bytes
                                            </div>
                                            {g.paths.map(p => (
                                                <div
                                                    key={p}
                                                    role="option"
                                                    tabIndex={0}
                                                    className="px-3 py-2 text-[11px] text-gray-300 hover:bg-white/[0.04] cursor-pointer truncate font-mono outline-none focus:bg-white/[0.08]"
                                                    onClick={() => navigateTo(p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'))}
                                                    onDoubleClick={() => navigateTo(p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'))}
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        navigateTo(p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'));
                                                      }
                                                    }}
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
                              title={emptyTitle}
                              description={emptyDescription}
                            />
                        ) : (
                            <div
                              className="flex flex-col min-h-0 outline-none"
                              tabIndex={0}
                              ref={resultsListRef}
                              onKeyDown={onResultsKeyDown}
                              role="listbox"
                              aria-label="Search results"
                            >
                              <div className="sticky top-0 z-10 grid grid-cols-[24px_minmax(120px,1.1fr)_minmax(160px,2fr)_72px] gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-white/35 border-b border-white/[0.06]" style={{ background: 'var(--bndz-surface-chrome)' }}>
                                <span />
                                <span>Name</span>
                                <span>Path</span>
                                <span>Type</span>
                              </div>
                              <div className="flex-1">
                                {results.map((r, i) => {
                                  const path = String(r.path || '');
                                  const shown = formatUiPath(path) || path;
                                  const checked = selectedResultPaths.has(path);
                                  const active = i === activeResultIndex;
                                  return (
                                  <div
                                    key={`${path}-${i}`}
                                    role="option"
                                    data-find-result-index={i}
                                    aria-selected={active || checked}
                                    className={`grid grid-cols-[24px_minmax(120px,1.1fr)_minmax(160px,2fr)_72px] gap-2 px-3 py-2 text-xs border-b border-white/[0.04] hover:bg-[color-mix(in_srgb,var(--accent,#0078d4)_18%,transparent)] cursor-pointer transition-colors ${checked ? 'bg-sky-500/[0.08]' : ''} ${active ? 'bg-[color-mix(in_srgb,var(--accent,#0078d4)_28%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent,#0078d4)_45%,transparent)]' : ''}`}
                                    onClick={() => setActiveResultIndex(i)}
                                    onDoubleClick={() => openResultAt(i)}
                                    title={r.snippet ? `${shown}\n${r.snippet}` : shown}
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
                                    <span className="text-white/40 font-mono text-[11px] truncate">{formatUiPath(path) || path}</span>
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
