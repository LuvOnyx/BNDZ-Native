import React, { useRef, useState } from 'react';
import { Check, Plus, Upload, Settings, Search, Filter, Database, Layers, Replace, Puzzle, Trash, Minus, Square, X, Star, Download, Globe, FolderSync, HardDrive, ScrollText, GitCompare, BookMarked, Sparkles, Palette } from 'lucide-react';
import { usePluginRegistry, PluginManifest } from '../data/PluginRegistryContext';

const iconRegistry: Record<string, React.ElementType> = {
    'properties': Settings,
    'context-menu-manager': ScrollText,
    'icon-studio': Palette,
    'batch-rename': Replace,
    'find': Search,
    'dropstack': Layers,
    'filters': Filter,
    'metadata': Database,
    'storage-cleanup': Trash,
    'folder-sync': FolderSync,
    'catalog': BookMarked,
    'action-log': HistoryIcon,
    'compare': GitCompare,
};

function HistoryIcon(props: React.ComponentProps<typeof Search>) {
    return <Sparkles {...props} />;
}

export function PluginStoreDialog({ onClose }: { onClose: () => void }) {
    const { pluginRegistry, togglePluginInstall, addPluginToRegistry } = usePluginRegistry() as any;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

    const handleImportPlugin = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (
                    typeof json === 'object' && json !== null &&
                    typeof json.id === 'string' &&
                    typeof json.name === 'string' &&
                    typeof json.description === 'string' &&
                    (json.targetPanel === 'bottom' || json.targetPanel === 'sidebar') &&
                    typeof json.isNative === 'boolean'
                ) {
                    const newPlugin: PluginManifest = { ...json, isInstalled: true };
                    addPluginToRegistry(newPlugin);
                } else {
                    alert('Invalid plugin manifest schema.');
                }
            } catch (err) {
                alert('Invalid JSON file.');
            }
        };
        reader.readAsText(file);
    };

    const filteredPlugins = pluginRegistry.filter(plugin => 
        plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        plugin.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const activePlugin = selectedPluginId ? pluginRegistry.find(p => p.id === selectedPluginId) : (filteredPlugins.length > 0 ? filteredPlugins[0] : null);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden">
            <div className="w-[1000px] h-[750px] bg-[#1e1e1e] border border-[#555] shadow-2xl flex flex-col font-sans select-none overflow-hidden rounded-t-[6px] ring-1 ring-black/50">
                {/* Title Bar */}
                <div className="bg-[#a475d4] px-3 py-[5px] flex items-center justify-between cursor-move rounded-t-lg">
                    <div className="text-[12px] text-black flex items-center gap-2 font-medium">
                        <Puzzle size={14} className="text-black" />
                        <span className="text-black font-bold text-[14px]">Extension Hub</span>
                    </div>
                    <div className="flex text-black gap-[1px] justify-center items-center h-full pb-1">
                        <button className="hover:bg-white/20 p-1 rounded-sm flex items-center justify-center">
                            <Minus size={14} strokeWidth={1.5} />
                        </button>
                        <button className="hover:bg-white/20 p-1 rounded-sm flex items-center justify-center">
                            <Square size={13} strokeWidth={1.5} />
                        </button>
                        <button className="hover:bg-red-500 hover:text-white p-1 rounded-sm flex items-center justify-center transition-colors" onClick={onClose}>
                            <X size={14} strokeWidth={1.5} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel: Search and List */}
                    <div className="w-[300px] bg-[#1a1a1a] border-r border-[#333] flex flex-col pt-4">
                        <div className="px-4 pb-4 border-b border-[#333]">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input 
                                    type="text" 
                                    placeholder="Search Extensions in Marketplace..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-[#252526] border border-[#3c3c3c] rounded px-8 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500 transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto styled-scrollbar p-2">
                            {filteredPlugins.map(plugin => {
                                const Icon = iconRegistry[plugin.id] || Puzzle;
                                return (
                                    <div 
                                        key={plugin.id}
                                        onClick={() => setSelectedPluginId(plugin.id)}
                                        className={`flex items-start gap-3 p-3 rounded cursor-pointer transition-colors ${activePlugin?.id === plugin.id ? 'bg-[#37373d] hover:bg-[#37373d]' : 'hover:bg-[#2a2d2e]'}`}
                                    >
                                        <Icon size={28} className={plugin.isInstalled ? 'text-sky-400' : 'text-gray-500'} />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-[13px] text-white truncate">{plugin.name}</div>
                                            <div className="text-[11px] text-gray-400 truncate mt-0.5" title={plugin.description}>{plugin.description}</div>
                                            <div className="flex items-center justify-between mt-2 text-[10px]">
                                                <div className="text-gray-500 flex gap-2">
                                                    <span>BNDZ Dev</span>
                                                    <span>★ 5.0</span>
                                                </div>
                                                {plugin.isInstalled && <span className="bg-sky-500/20 text-sky-400 px-1 rounded border border-sky-500/30 font-mono">INSTALLED</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right Panel: Extension Details */}
                    <div className="flex-1 bg-[#1e1e1e] flex flex-col relative overflow-hidden">
                        {activePlugin ? (
                            <>
                                <div className="p-8 border-b border-[#333] flex gap-6 shrink-0 bg-[#252526]">
                                    {/* Big Icon */}
                                    <div className={`w-28 h-28 rounded-xl flex items-center justify-center shrink-0 border border-[#444] shadow-lg ${activePlugin.isInstalled ? 'bg-gradient-to-br from-sky-900/40 to-[#111]' : 'bg-[#1a1a1a]'}`}>
                                        {React.createElement(iconRegistry[activePlugin.id] || Puzzle, { size: 64, className: activePlugin.isInstalled ? 'text-sky-400' : 'text-gray-500' })}
                                    </div>
                                    <div className="flex flex-col justify-center flex-1">
                                        <div className="flex items-baseline gap-3 mb-1">
                                            <h1 className="text-3xl font-bold text-white tracking-tight">{activePlugin.name}</h1>
                                            <span className="text-sm font-mono text-gray-500 bg-[#111] px-2 py-0.5 rounded border border-[#333]">v1.4.2</span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-[#007acc] mb-4">
                                            <span className="hover:underline cursor-pointer">BNDZ Dev</span>
                                            <div className="flex items-center gap-1 text-gray-400"><Download size={12} /> 1.2M</div>
                                            <div className="flex items-center gap-1 text-gray-400"><Star size={12} className="text-yellow-500" /> 1K+</div>
                                            <div className="flex items-center gap-1 text-gray-400"><Globe size={12} /> Registry</div>
                                        </div>
                                        <p className="text-[13px] text-gray-300 mb-6">{activePlugin.description}</p>
                                        <div className="flex gap-3">
                                            <button 
                                                onClick={() => togglePluginInstall(activePlugin.id)}
                                                className={`px-6 py-2 rounded text-[13px] font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                                                    activePlugin.isInstalled 
                                                        ? 'bg-[#333333] hover:bg-[#444444] text-white border border-[#555]' 
                                                        : 'bg-[#007acc] hover:bg-[#005c99] text-white border border-[#007acc]'
                                                }`}
                                            >
                                                {activePlugin.isInstalled ? 'Uninstall Extension' : 'Install Extension'}
                                            </button>
                                            <button 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="px-4 py-2 border border-[#444] bg-[#2a2a2a] hover:bg-[#333] rounded transition-colors text-xs font-semibold text-gray-300 shadow-sm"
                                            >
                                                Import .JSON
                                            </button>
                                            <input type="file" accept=".json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImportPlugin} />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 p-8 overflow-y-auto styled-scrollbar bg-[#1e1e1e]">
                                    <div className="max-w-3xl">
                                        <h2 className="text-lg font-bold text-white mb-4 border-b border-[#333] pb-2">Extension Overview</h2>
                                        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                                            This extension deeply integrates {activePlugin.name.toLowerCase()} capabilities directly into BNDZ. 
                                            Providing first-class citizen support for native OS level file modifications.
                                            {activePlugin.isNative && " Utilizes C# Native PInvoke bindings for ultra-fast COM interface calls."}
                                        </p>
                                        <h3 className="font-semibold text-white mb-2">Features</h3>
                                        <ul className="list-disc pl-5 text-sm text-gray-400 space-y-2 mb-8">
                                            <li>Seamless multi-threading execution.</li>
                                            <li>Instant state hydration without reloading.</li>
                                            <li>Global application context injection.</li>
                                        </ul>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-500">
                                Select an extension to view details.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
