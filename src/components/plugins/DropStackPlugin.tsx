import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon, DragHandleGlyph } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
} from './PluginPanelPrimitives';

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
                    <PluginToolbarButton icon="plus_ui" onClick={addSelected} disabled={!selectedItems?.length}>Add selection</PluginToolbarButton>
                    <PluginToolbarButton icon="copy" onClick={() => void executeBatch('copy')} disabled={!stack.length || operating}>Copy all</PluginToolbarButton>
                    <PluginToolbarButton icon="chevron_right" onClick={() => void executeBatch('move')} disabled={!stack.length || operating}>Move all</PluginToolbarButton>
                </>
            }
        >
            <div className="flex h-full gap-4 p-4 min-h-0">
                <PluginCard className="w-[280px] !p-0 flex flex-col overflow-hidden shrink-0">
                    <div className="px-3 py-2.5 border-b border-white/[0.06] flex justify-between items-center gap-2">
                        <span className="bndz-plugin-section-title">Stash ({stack.length})</span>
                        <PluginToolbarButton icon="delete" onClick={clearStack} disabled={!stack.length}>Clear</PluginToolbarButton>
                    </div>
                    <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1 min-h-0">
                        {stack.length === 0 ? (
                            <PluginEmptyState icon="dropstack" description="Stack is empty — drop files in the zone on the right." />
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
                                className="flex items-center gap-2 bg-black/20 border border-white/[0.06] rounded-md px-2 py-1.5 group"
                            >
                                <DragHandleGlyph size={10} className="text-gray-600 shrink-0 cursor-grab" />
                                <span className="text-xs bndz-mono text-gray-400 truncate flex-1" title={item}>{item.split(/[/\\]/).pop()}</span>
                                <button type="button" onClick={() => removeStackItem(item)} className="text-red-400 opacity-70 hover:opacity-100 shrink-0"><Icons8Icon id="delete" size={10} /></button>
                            </div>
                        ))}
                    </div>
                </PluginCard>
                <div
                    className={`flex-1 flex flex-col justify-center items-center text-xs gap-3 border border-dashed rounded-lg transition-colors ${dragOver ? 'border-violet-400/50 bg-violet-500/5' : 'border-white/10'}`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                >
                    <Icons8Icon id="upload" size={32} className="opacity-30" />
                    <p className="text-gray-400">Drop files or folders here to stage</p>
                    <p>Destination: <span className="bndz-mono text-gray-300">{focusedPath || '—'}</span></p>
                    <p className="text-xs bndz-panel-muted">Persisted between sessions · drag to reorder</p>
                </div>
            </div>
        </PluginPanelShell>
    );
}
