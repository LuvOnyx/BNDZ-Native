import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon, DragHandleGlyph } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';

const STACK_KEY = 'bndz-dropstack-v1';

export const DropStackPluginDef = {
    id: "dropstack",
    name: "Drop Stack",
    icon: 'dropstack',
    description: 'Stage files from multiple directories, then batch copy or move to the active pane.',
    targetPanel: "bottom"
};

function loadStack(): string[] {
    try {
        const raw = localStorage.getItem(STACK_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
    } catch {
        return [];
    }
}

export default function DropStackPlugin({ focusedPath, selectedItems }: { focusedPath?: string; selectedItems?: string[] }) {
    const [stack, setStack] = useState<string[]>(loadStack);
    const [operating, setOperating] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);

    useEffect(() => {
        localStorage.setItem(STACK_KEY, JSON.stringify(stack));
    }, [stack]);

    const addPaths = useCallback((paths: string[]) => {
        const normalized = paths.map(toWindowsPath).filter(Boolean);
        if (!normalized.length) return;
        setStack(prev => [...new Set([...prev, ...normalized])]);
        pushToast({ kind: 'success', title: 'Added to stack', message: `${normalized.length} item(s) staged.` });
    }, []);

    const addSelected = () => {
        if (!selectedItems?.length) return;
        addPaths(selectedItems);
    };

    const clearStack = () => setStack([]);
    const removeStackItem = (item: string) => setStack(prev => prev.filter(i => i !== item));

    const moveItem = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0 || from >= stack.length || to >= stack.length) return;
        setStack(prev => {
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
        });
    };

    const extractDropPaths = (e: React.DragEvent): string[] => {
        const paths: string[] = [];
        const files = Array.from(e.dataTransfer.files) as Array<File & { path?: string }>;
        for (const f of files) {
            if (f.path) paths.push(f.path);
        }
        const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (uri) {
            uri.split(/\r?\n/).forEach(line => {
                const t = line.trim();
                if (!t || t.startsWith('#')) return;
                paths.push(decodeURIComponent(t.replace(/^file:\/\/\//i, '').replace(/\//g, '\\')));
            });
        }
        return [...new Set(paths.map(toWindowsPath))];
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const paths = extractDropPaths(e);
        if (paths.length) addPaths(paths);
    };

    const executeBatch = async (action: 'copy' | 'move') => {
        if (!stack.length || !focusedPath || operating) return;
        setOperating(true);
        let ok = 0;
        let failed = 0;
        try {
            const targetDir = toWindowsPath(focusedPath).replace(/\\$/, '');
            for (const item of stack) {
                const sourcePath = toWindowsPath(item);
                const fileName = sourcePath.split(/[/\\]/).pop() || item;
                const destPath = `${targetDir}\\${fileName}`;
                try {
                    await IPC.executeFsOperation(`stack-${action}-${Date.now()}-${fileName}`, action, sourcePath, destPath);
                    ok++;
                } catch {
                    failed++;
                }
            }
            if (failed === 0) {
                pushToast({ kind: 'success', title: action === 'copy' ? 'Copied' : 'Moved', message: `${ok} item(s) to ${targetDir}` });
                setStack([]);
            } else {
                pushToast({ kind: 'warning', title: 'Partial transfer', message: `${ok} succeeded, ${failed} failed.` });
            }
        } finally {
            setOperating(false);
        }
    };

    return (
        <PluginPanelShell
            title="Drop Stack"
            icon="dropstack"
            iconColor="#a78bfa"
            variant="embedded"
            subtitle="Stage files from multiple locations, then batch transfer"
            toolbar={
                <>
                    <button type="button" onClick={addSelected} disabled={!selectedItems?.length} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-[#333] hover:border-violet-500/40 disabled:opacity-40">
                        <Icons8Icon id="plus_ui" size={12} /> Add Selection
                    </button>
                    <button type="button" onClick={() => void executeBatch('copy')} disabled={!stack.length || operating} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-40">
                        <Icons8Icon id="copy" size={12} /> Copy All
                    </button>
                    <button type="button" onClick={() => void executeBatch('move')} disabled={!stack.length || operating} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-amber-600/80 hover:bg-amber-500 text-white disabled:opacity-40">
                        <Icons8Icon id="chevron_right" size={12} /> Move All
                    </button>
                </>
            }
        >
            <div className="flex h-full gap-4 p-4 min-h-0">
                <div className="w-[300px] border border-[#222] bg-[#111] rounded-xl flex flex-col overflow-hidden shrink-0">
                    <div className="p-3 border-b border-[#222] flex justify-between items-center">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Stash ({stack.length})</span>
                        <button type="button" onClick={clearStack} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1">
                            <Icons8Icon id="delete" size={10} /> Clear
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1">
                        {stack.length === 0 ? (
                            <div className="text-center text-gray-600 text-xs py-8">Stack is empty — drop files here →</div>
                        ) : stack.map((item, i) => (
                            <div
                                key={item}
                                draggable
                                onDragStart={() => setDragIndex(i)}
                                onDragOver={e => { e.preventDefault(); }}
                                onDrop={e => {
                                    e.preventDefault();
                                    if (dragIndex != null) moveItem(dragIndex, i);
                                    setDragIndex(null);
                                }}
                                onDragEnd={() => setDragIndex(null)}
                                className="flex items-center gap-2 bg-[#0d0d0d] border border-[#222] rounded px-2 py-1.5 group"
                            >
                                <DragHandleGlyph size={10} className="text-gray-600 shrink-0 cursor-grab" />
                                <span className="text-[10px] font-mono text-gray-400 truncate flex-1" title={item}>{item.split(/[/\\]/).pop()}</span>
                                <button type="button" onClick={() => removeStackItem(item)} className="text-red-400 opacity-70 hover:opacity-100 shrink-0"><Icons8Icon id="delete" size={10} /></button>
                            </div>
                        ))}
                    </div>
                </div>
                <div
                    className={`flex-1 flex flex-col justify-center items-center text-gray-600 text-xs gap-3 border border-dashed rounded-xl transition-colors ${dragOver ? 'border-violet-400/50 bg-violet-500/5' : 'border-[#333]'}`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                >
                    <Icons8Icon id="upload" size={32} className="opacity-30" />
                    <p>Drop files or folders here to stage</p>
                    <p>Destination: <span className="text-gray-400 font-mono">{focusedPath || '—'}</span></p>
                    <p className="text-[10px] text-gray-700">Persisted between sessions · drag to reorder</p>
                </div>
            </div>
        </PluginPanelShell>
    );
}
