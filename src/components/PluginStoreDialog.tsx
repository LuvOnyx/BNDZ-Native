import React, { useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { usePluginRegistry, PluginManifest } from '../data/PluginRegistryContext';
import { showNativeAlert } from '../lib/nativeDialog';

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
                    showNativeAlert('Invalid plugin manifest schema.', 'Plugin Store', 'error');
                }
            } catch (err) {
                showNativeAlert('Invalid JSON file.', 'Plugin Store', 'error');
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
        <BndzWindowFrame
            title="Extension Hub"
            subtitle="Installed extensions and import"
            iconId="extension_hub"
            onClose={onClose}
            widthClass="w-[min(1000px,calc(100vw-2rem))]"
            heightClass="h-[min(750px,calc(100vh-2rem))]"
        >
            <div className="flex-1 flex overflow-hidden min-h-0">
                <div className="w-[300px] bg-[#1a1a1a] border-r border-[#333] flex flex-col pt-4 min-h-0">
                    <div className="px-4 pb-4 border-b border-[#333]">
                        <div className="relative">
                            <Icons8Icon id="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2" />
                            <input 
                                type="text" 
                                placeholder="Search installed extensions…" 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bndz-native-input w-full pl-8 py-1.5 text-xs"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto styled-scrollbar p-2 min-h-0">
                        {filteredPlugins.map(plugin => (
                            <div 
                                key={plugin.id}
                                onClick={() => setSelectedPluginId(plugin.id)}
                                className={`flex items-start gap-3 p-3 rounded cursor-pointer transition-colors ${activePlugin?.id === plugin.id ? 'bg-[#37373d]' : 'hover:bg-[#2a2d2e]'}`}
                            >
                                <Icons8Icon id={plugin.icon || 'extension_hub'} size={28} disabled={!plugin.isInstalled} />
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-[13px] text-white truncate">{plugin.name}</div>
                                    <div className="text-[11px] text-gray-400 truncate mt-0.5" title={plugin.description}>{plugin.description}</div>
                                    <div className="flex items-center justify-between mt-2 text-[10px]">
                                        <div className="text-gray-500 truncate">
                                            {plugin.targetPanel === 'bottom' ? 'Bottom panel' : 'Sidebar'} · {plugin.isNative ? 'Native' : 'Web'}
                                        </div>
                                        {plugin.isInstalled && <span className="bg-[#094771]/40 text-[#9cdcfe] px-1.5 py-px rounded border border-[#0078d4]/30 font-mono text-[9px]">INSTALLED</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 bg-[#1e1e1e] flex flex-col relative overflow-hidden min-h-0">
                    {activePlugin ? (
                        <>
                            <div className="p-8 border-b border-[#333] flex gap-6 shrink-0 bg-[#252526]">
                                <div className={`w-28 h-28 rounded-xl flex items-center justify-center shrink-0 border border-[#444] ${activePlugin.isInstalled ? 'bg-[#1a2430]' : 'bg-[#1a1a1a]'}`}>
                                    <Icons8Icon id={activePlugin.icon || 'extension_hub'} size={64} disabled={!activePlugin.isInstalled} />
                                </div>
                                <div className="flex flex-col justify-center flex-1">
                                    <div className="flex items-baseline gap-3 mb-1">
                                        <h1 className="text-2xl font-semibold text-white tracking-tight">{activePlugin.name}</h1>
                                        <span className="text-[11px] font-mono text-gray-500 bg-[#111] px-2 py-0.5 rounded border border-[#333]">{activePlugin.id}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-3">
                                        <span>{activePlugin.targetPanel === 'bottom' ? 'Bottom panel extension' : 'Sidebar extension'}</span>
                                        <span>·</span>
                                        <span>{activePlugin.isNative ? 'Native host' : 'Hosted UI'}</span>
                                    </div>
                                    <p className="text-[13px] text-gray-300 mb-5 leading-relaxed">{activePlugin.description}</p>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => togglePluginInstall(activePlugin.id)}
                                            className={`px-5 py-1.5 rounded text-[12px] font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-[#0078d4]/50 ${
                                                activePlugin.isInstalled 
                                                    ? 'bg-[#333333] hover:bg-[#444444] text-white border border-[#555]' 
                                                    : 'bg-[#0078d4] hover:bg-[#006cbd] text-white border border-[#0078d4]'
                                            }`}
                                        >
                                            {activePlugin.isInstalled ? 'Uninstall Extension' : 'Install Extension'}
                                        </button>
                                        <button 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-4 py-2 border border-[#444] bg-[#2a2a2a] hover:bg-[#333] rounded transition-colors text-xs font-semibold text-gray-300"
                                        >
                                            Import .JSON
                                        </button>
                                        <input type="file" accept=".json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImportPlugin} />
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 p-8 overflow-y-auto styled-scrollbar bg-[#1e1e1e] min-h-0">
                                <div className="max-w-3xl">
                                    <h2 className="text-[13px] font-semibold text-white mb-3 border-b border-[#333] pb-2">About this extension</h2>
                                    <p className="text-[12px] text-gray-400 mb-4 leading-relaxed">
                                        {activePlugin.description}
                                        {activePlugin.isNative && ' This extension uses native Windows integration for file operations.'}
                                    </p>
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
        </BndzWindowFrame>
    );
}
