import React, { useEffect, useState } from 'react';
import { Search, Filter, History, Play, Copy, Globe, FolderSearch, FileText, Braces, BookMarked } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { useSettingsRuntime } from '../../hooks/useSettingsRuntime';
import PluginPanelShell from './PluginPanelShell';
import { toWindowsPath } from '../../lib/pathUtils';
import { listCatalogs, type CatalogEntry } from '../../lib/catalog';

export const FindPluginDef = {
    id: "find",
    name: "Fast Search",
    icon: Search,
    targetPanel: "bottom"
};

type SearchMode = 'local' | 'global' | 'duplicates' | 'advanced';

export default function FindPlugin({ config, focusedPath, isPluginTabActive, pluginLaunch }: any) {
    const rt = useSettingsRuntime();
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

    useEffect(() => {
        void listCatalogs().then(cats => setSavedCatalogs(cats.filter(c => c.query?.trim())));
    }, []);

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

    return (
        <PluginPanelShell
            title="Fast Search"
            icon={Search}
            iconColor="#38bdf8"
            variant="embedded"
            subtitle={mode === 'global' ? 'Global scope' : mode === 'advanced' ? 'Advanced / multi-root' : `Scope: ${scopePath}`}
            status={!IPC.isNative ? (
                <span className="text-amber-300/90 text-[11px]">Native host required for indexed search</span>
            ) : undefined}
            toolbar={
                <div className="flex items-center gap-2">
                    {mode === 'duplicates' && searching && (
                        <button type="button" onClick={cancelDupScan} className="text-xs text-red-400 hover:underline">Cancel</button>
                    )}
                    <button onClick={() => void doSearch()} disabled={searching} className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-semibold">
                        {searching ? <History size={12} className="animate-spin" /> : <Play size={12} />} {mode === 'duplicates' ? 'Scan' : 'Search'}
                    </button>
                </div>
            }
        >
            <div className="flex w-full h-full min-h-0 relative pt-1">
                <div className="w-[240px] border-r border-[#222] bg-[#111] p-4 flex flex-col gap-3 shrink-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                        <Filter size={12} className="text-sky-500" /> Mode
                    </div>
                    <div className="flex flex-col gap-1">
                        {([
                            { id: 'local' as const, label: 'Local folder', icon: FolderSearch },
                            { id: 'global' as const, label: 'Global (Everything)', icon: Globe },
                            { id: 'advanced' as const, label: 'Advanced find', icon: Braces },
                            { id: 'duplicates' as const, label: 'Duplicate finder', icon: Copy },
                        ]).map(m => {
                            const Icon = m.icon;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => setMode(m.id)}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                                        mode === m.id ? 'bg-sky-900/50 text-sky-200 border border-sky-700/50' : 'text-gray-400 hover:bg-[#1a1a1a]'
                                    }`}
                                >
                                    <Icon size={12} /> {m.label}
                                </button>
                            );
                        })}
                    </div>
                    {savedCatalogs.length > 0 && mode !== 'duplicates' && (
                        <>
                            <div className="bndz-context-menu-sep opacity-30" />
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                                <BookMarked size={10} className="text-violet-400" /> Saved catalog searches
                            </div>
                            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto bndz-scrollbar">
                                {savedCatalogs.map(cat => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        className="text-left text-[10px] px-2 py-1 rounded text-gray-400 hover:bg-violet-900/30 hover:text-violet-200 truncate"
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
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={regexEnabled} onChange={e => setRegexEnabled(e.target.checked)} className="accent-sky-500" />
                                Regular expressions
                            </label>
                            {mode !== 'advanced' && (
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input type="checkbox" checked={booleanMode} onChange={e => setBooleanMode(e.target.checked)} className="accent-sky-500" />
                                    Boolean (AND / OR / NOT)
                                </label>
                            )}
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={searchContent} onChange={e => setSearchContent(e.target.checked)} className="accent-sky-500" />
                                Search file content
                            </label>
                            {mode === 'advanced' && (
                                <div className="mt-1">
                                    <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-1"><FileText size={10} /> Extra roots (; separated)</div>
                                    <textarea
                                        value={extraRoots}
                                        onChange={e => setExtraRoots(e.target.value)}
                                        placeholder="D:/Projects;E:/Archive"
                                        rows={3}
                                        className="w-full bg-[#0d0d0d] border border-[#333] rounded text-[10px] font-mono text-gray-300 p-1.5 outline-none focus:border-sky-500/50"
                                    />
                                </div>
                            )}
                        </>
                    )}
                    {dupProgress && (
                        <div className="text-[10px] text-sky-400">
                            {dupProgress.percent}% {dupProgress.message ? `· ${dupProgress.message}` : ''}
                        </div>
                    )}
                    <div className="text-[10px] text-gray-600 mt-auto leading-relaxed">
                        {status || `Limit: ${rt.search.limit}`}
                        {mode === 'advanced' && <div className="mt-1 text-gray-700">Use quotes, OR, NOT — e.g. report OR invoice NOT draft</div>}
                    </div>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                    {mode !== 'duplicates' && (
                        <div className="p-3 border-b border-[#222]">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
                                <input
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && doSearch()}
                                    placeholder={mode === 'advanced' ? 'Boolean query across multiple roots…' : mode === 'global' ? 'Search all drives…' : 'Search in current folder…'}
                                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sky-500"
                                />
                            </div>
                        </div>
                    )}
                    <div className="flex-1 overflow-y-auto bndz-scrollbar">
                        {mode === 'duplicates' ? (
                            duplicateGroups.length === 0 ? (
                                <div className="flex h-full items-center justify-center text-gray-600 text-xs p-4 text-center">
                                    {searching ? 'Scanning…' : 'Scan the current folder for duplicate files by content hash.'}
                                </div>
                            ) : (
                                <div className="p-2 space-y-3">
                                    {duplicateGroups.map(g => (
                                        <div key={g.hash} className="border border-[#222] rounded-lg overflow-hidden">
                                            <div className="px-3 py-1.5 bg-[#111] text-[10px] text-gray-500 font-mono">
                                                {g.paths.length} copies · {g.size} bytes
                                            </div>
                                            {g.paths.map(p => (
                                                <div
                                                    key={p}
                                                    className="px-3 py-2 text-[11px] text-gray-300 hover:bg-[#151515] cursor-pointer truncate font-mono"
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
                            <div className="flex h-full items-center justify-center text-gray-600 text-xs">No results — enter a query and search.</div>
                        ) : (
                            <table className="w-full text-left text-[12px]">
                                <thead className="bg-[#111] sticky top-0 border-b border-[#222] z-10">
                                    <tr>
                                        <th className="px-4 py-2 font-medium text-gray-500">Name</th>
                                        <th className="px-4 py-2 font-medium text-gray-500">Path</th>
                                        <th className="px-4 py-2 font-medium text-gray-500 w-16">Type</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r, i) => (
                                        <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#151515] cursor-pointer" onDoubleClick={() => navigateTo(r.path)}>
                                            <td className="px-4 py-2 text-gray-200 max-w-[200px] truncate">{r.name}</td>
                                            <td className="px-4 py-2 text-gray-500 font-mono text-[11px] truncate">{r.path}</td>
                                            <td className="px-4 py-2 text-gray-600 text-[10px]">{r.matchType === 'content' ? 'grep' : r.isDirectory ? 'dir' : 'file'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </PluginPanelShell>
    );
}
