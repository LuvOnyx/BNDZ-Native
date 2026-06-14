import React, { useState } from 'react';
import { Layers, Trash2, ArrowRightCircle, Copy, Plus } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';

export const DropStackPluginDef = {
    id: "dropstack",
    name: "Drop Stack",
    icon: Layers,
    description: 'Stage files from multiple directories, then batch copy or move to the active pane.',
    targetPanel: "bottom"
};

export default function DropStackPlugin({ focusedPath, selectedItems }: { focusedPath?: string; selectedItems?: string[] }) {
    const [stack, setStack] = useState<string[]>([]);
    const [operating, setOperating] = useState(false);

    const addSelected = () => {
        if (!selectedItems?.length) return;
        setStack(prev => [...new Set([...prev, ...selectedItems.map(toWindowsPath)])]);
    };

    const clearStack = () => setStack([]);
    const removeStackItem = (item: string) => setStack(prev => prev.filter(i => i !== item));

    const executeBatch = async (action: 'copy' | 'move') => {
        if (!stack.length || !focusedPath || operating) return;
        setOperating(true);
        try {
            const targetDir = toWindowsPath(focusedPath).replace(/\\$/, '');
            for (const item of stack) {
                const sourcePath = toWindowsPath(item);
                const fileName = sourcePath.split(/[/\\]/).pop() || item;
                const destPath = `${targetDir}\\${fileName}`;
                await IPC.executeFsOperation(`stack-${action}-${Date.now()}-${fileName}`, action, sourcePath, destPath);
            }
            setStack([]);
        } catch (e) {
            console.error('Drop stack operation failed:', e);
        }
        setOperating(false);
    };

    return (
        <PluginPanelShell
            title="Drop Stack"
            icon={Layers}
            iconColor="#a78bfa"
            subtitle="Stage files from multiple locations, then batch transfer"
            toolbar={
                <>
                    <button onClick={addSelected} disabled={!selectedItems?.length} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-[#333] hover:border-violet-500/40 disabled:opacity-40">
                        <Plus size={12} /> Add Selection
                    </button>
                    <button onClick={() => executeBatch('copy')} disabled={!stack.length || operating} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-40">
                        <Copy size={12} /> Copy All
                    </button>
                    <button onClick={() => executeBatch('move')} disabled={!stack.length || operating} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-amber-600/80 hover:bg-amber-500 text-white disabled:opacity-40">
                        <ArrowRightCircle size={12} /> Move All
                    </button>
                </>
            }
        >
            <div className="flex h-full gap-4 p-4 min-h-0">
                <div className="w-[280px] border border-[#222] bg-[#111] rounded-xl flex flex-col overflow-hidden shrink-0">
                    <div className="p-3 border-b border-[#222] flex justify-between items-center">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Stash ({stack.length})</span>
                        <button onClick={clearStack} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1">
                            <Trash2 size={10} /> Clear
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1">
                        {stack.length === 0 ? (
                            <div className="text-center text-gray-600 text-xs py-8">Stack is empty</div>
                        ) : stack.map(item => (
                            <div key={item} className="flex items-center gap-2 bg-[#0d0d0d] border border-[#222] rounded px-2 py-1.5 group">
                                <span className="text-[10px] font-mono text-gray-400 truncate flex-1" title={item}>{item.split(/[/\\]/).pop()}</span>
                                <button onClick={() => removeStackItem(item)} className="opacity-0 group-hover:opacity-100 text-red-400"><Trash2 size={10} /></button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 flex flex-col justify-center items-center text-gray-600 text-xs gap-2 border border-dashed border-[#333] rounded-xl">
                    <Layers size={32} className="opacity-20" />
                    <p>Destination: <span className="text-gray-400 font-mono">{focusedPath || '—'}</span></p>
                    <p className="text-[10px] text-gray-700">Add items from the file list, then Copy All or Move All.</p>
                </div>
            </div>
        </PluginPanelShell>
    );
}
