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
  PluginHeroStrip,
  PluginHeroActionButton,
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

function splitPath(full: string): { leaf: string; parent: string } {
    const normalized = full.replace(/[/\\]+$/, '');
    const parts = normalized.split(/[/\\]/);
    const leaf = parts.pop() || full;
    const parent = parts.join('\\');
    return { leaf, parent };
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
        try {
            const targetDir = toWindowsPath(focusedPath).replace(/\\$/, '');
            const operationId = `dropstack-${action}-${Date.now()}`;
            const label = `Drop stack ${action} (${stack.length} items)`;
            await IPC.executeFsOperation(operationId, action, stack, targetDir, false, label, 'normal');
            pushToast({ kind: 'success', title: action === 'copy' ? 'Copied' : 'Moved', message: `${stack.length} item(s) queued to ${targetDir}` });
            setStack([]);
        } catch {
            pushToast({ kind: 'error', title: 'Transfer failed', message: 'Could not queue drop stack transfer.' });
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
        >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
                <PluginHeroStrip
                    icon={<Icons8Icon id="dropstack" size={52} className="opacity-90" />}
                    name="Transfer staging area"
                    typeLabel="Batch queue"
                    path={focusedPath || undefined}
                    meta={<span className="bndz-panel-muted text-xs">{stack.length} staged · persisted locally</span>}
                    actions={
                        <>
                            <PluginHeroActionButton icon="plus_ui" variant="primary" onClick={addSelected} disabled={!selectedItems?.length}>Add selection</PluginHeroActionButton>
                            <PluginHeroActionButton icon="copy" onClick={() => void executeBatch('copy')} disabled={!stack.length || operating}>Copy all</PluginHeroActionButton>
                            <PluginHeroActionButton icon="chevron_right" onClick={() => void executeBatch('move')} disabled={!stack.length || operating}>Move all</PluginHeroActionButton>
                            <PluginHeroActionButton icon="delete" onClick={clearStack} disabled={!stack.length}>Clear</PluginHeroActionButton>
                        </>
                    }
                />
            <div className="flex flex-1 h-full gap-4 p-5 min-h-0">
                <PluginCard className="w-[300px] !p-0 flex flex-col overflow-hidden shrink-0">
                    <div className="px-3 py-2.5 border-b border-white/[0.06] flex justify-between items-center gap-2 bg-white/[0.02]">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="bndz-plugin-section-title">Stash</span>
                            <span className="bndz-plugin-kind-pill">{stack.length}</span>
                        </div>
                        <PluginToolbarButton icon="delete" onClick={clearStack} disabled={!stack.length}>Clear</PluginToolbarButton>
                    </div>
                    <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1.5 min-h-0">
                        {stack.length === 0 ? (
                            <PluginEmptyState icon="dropstack" title="Stack empty" description="Drop files in the zone on the right, or add the current selection." />
                        ) : stack.map((item, i) => {
                            const { leaf, parent } = splitPath(item);
                            const isDragging = dragIndex === i;
                            return (
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
                                    className={`flex items-center gap-2 rounded-lg px-2 py-2 group border transition-colors cursor-grab active:cursor-grabbing ${
                                        isDragging
                                            ? 'border-violet-400/40 bg-violet-500/10 opacity-70'
                                            : 'bg-black/25 border-white/[0.07] hover:border-violet-400/25 hover:bg-white/[0.03]'
                                    }`}
                                    title={item}
                                >
                                    <div className="flex flex-col items-center gap-0.5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity">
                                        <DragHandleGlyph size={11} className="text-violet-300/80" />
                                        <span className="text-[9px] tabular-nums bndz-panel-muted leading-none">{i + 1}</span>
                                    </div>
                                    <Icons8Icon id="file_ui" size={14} className="shrink-0 opacity-60" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-slate-100 truncate leading-tight">{leaf}</div>
                                        {parent && (
                                            <div className="text-[10px] bndz-panel-muted bndz-mono truncate mt-0.5 leading-tight">{parent}</div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeStackItem(item)}
                                        className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 shrink-0 p-1 rounded hover:bg-rose-500/10 transition-opacity"
                                        title="Remove from stack"
                                    >
                                        <Icons8Icon id="delete" size={11} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </PluginCard>

                <div
                    className={`bndz-plugin-dropzone flex-1 flex flex-col justify-center items-center gap-4 px-6 transition-all ${
                        dragOver ? 'bndz-plugin-dropzone-active scale-[1.01]' : ''
                    }`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                >
                    <div className={`rounded-2xl p-4 border border-dashed transition-colors ${
                        dragOver ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/10 bg-white/[0.02]'
                    }`}>
                        <Icons8Icon id="upload" size={36} className={dragOver ? 'opacity-70 text-violet-300' : 'opacity-30'} />
                    </div>
                    <div className="text-center space-y-1.5 max-w-sm">
                        <p className={`text-sm font-medium ${dragOver ? 'text-violet-200' : 'text-slate-300'}`}>
                            {dragOver ? 'Release to stage' : 'Drop files or folders here'}
                        </p>
                        <p className="text-xs bndz-panel-muted leading-relaxed">
                            Stage from anywhere, reorder by drag, then copy or move the whole stash to the active pane.
                        </p>
                    </div>
                    <PluginCard className="!py-2.5 !px-3 max-w-md w-full space-y-1">
                        <div className="bndz-plugin-section-title">Destination</div>
                        <p className="bndz-mono text-xs text-slate-300 truncate" title={focusedPath || undefined}>
                            {focusedPath || '— open a folder in the active pane —'}
                        </p>
                    </PluginCard>
                    <p className="text-[10px] bndz-panel-muted">Persisted between sessions · drag rows to reorder</p>
                </div>
            </div>
            </div>
        </PluginPanelShell>
    );
}
