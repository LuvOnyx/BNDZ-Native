import React, { useState } from 'react';
import { Search, Filter, History, Play } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { useSettingsRuntime } from '../../hooks/useSettingsRuntime';
import PluginPanelShell from './PluginPanelShell';

export const FindPluginDef = {
    id: "find",
    name: "Fast Search",
    icon: Search,
    targetPanel: "bottom"
};

export default function FindPlugin({ config, focusedPath }: any) {
    const rt = useSettingsRuntime();
    const [query, setQuery] = useState('');
    const [regexEnabled, setRegexEnabled] = useState(false);
    const [searchContent, setSearchContent] = useState(rt.search.searchContent);
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    const doSearch = async () => {
        if (!query.trim()) return;
        setSearching(true);
        try {
            if (IPC.isNative) {
                const rootPath = focusedPath?.startsWith('/') ? focusedPath : (focusedPath ? `/${focusedPath}` : '/C:');
                const { items } = await IPC.performGlobalSearch(
                    query,
                    rt.search.limit,
                    regexEnabled,
                    rootPath,
                    config?.enableEverythingSearch !== false,
                );
                setResults(items || []);
            } else {
                setResults([]);
            }
        } catch (e) {
            console.error(e);
        }
        setSearching(false);
    };

    return (
        <PluginPanelShell
            title="Fast Search"
            icon={Search}
            iconColor="#38bdf8"
            subtitle={focusedPath ? `Scope: ${focusedPath}` : 'Global scope'}
            toolbar={
                <button onClick={doSearch} disabled={searching} className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-semibold">
                    {searching ? <History size={12} className="animate-spin" /> : <Play size={12} />} Search
                </button>
            }
        >
            <div className="flex w-full h-full min-h-0">
                <div className="w-[220px] border-r border-[#222] bg-[#111] p-4 flex flex-col gap-3 shrink-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                        <Filter size={12} className="text-sky-500" /> Parameters
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={regexEnabled} onChange={e => setRegexEnabled(e.target.checked)} className="accent-sky-500" />
                        Regular expressions
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={searchContent} onChange={e => setSearchContent(e.target.checked)} className="accent-sky-500" />
                        Search file content
                    </label>
                    <div className="text-[10px] text-gray-600 mt-auto">Limit: {rt.search.limit} results</div>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="p-3 border-b border-[#222]">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
                            <input
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && doSearch()}
                                placeholder="Search files and folders..."
                                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sky-500"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto bndz-scrollbar">
                        {results.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-gray-600 text-xs">No results — enter a query and search.</div>
                        ) : (
                            <table className="w-full text-left text-[12px]">
                                <thead className="bg-[#111] sticky top-0 border-b border-[#222] z-10">
                                    <tr>
                                        <th className="px-4 py-2 font-medium text-gray-500">Name</th>
                                        <th className="px-4 py-2 font-medium text-gray-500">Path</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r, i) => (
                                        <tr key={i} className="border-b border-[#1a1a1a] hover:bg-[#151515] cursor-pointer" onDoubleClick={() => {
                                            if (r.path) window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: r.path } }));
                                        }}>
                                            <td className="px-4 py-2 text-gray-200 max-w-[200px] truncate">{r.name}</td>
                                            <td className="px-4 py-2 text-gray-500 font-mono text-[11px] truncate">{r.path}</td>
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
