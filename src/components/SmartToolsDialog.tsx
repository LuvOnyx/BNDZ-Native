import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { toWindowsPath } from '../lib/pathUtils';
import BndzAssistantPanel from './assistant/BndzAssistantPanel';
import BndzDuplicatesPanel from './duplicates/BndzDuplicatesPanel';

export type SmartToolsTab = 'assistant' | 'organize' | 'duplicates';

interface SmartToolsDialogProps {
    isOpen?: boolean;
    onClose: () => void;
    selectedItems?: string[];
    selectedFiles?: Array<{ path?: string; name?: string }>;
    currentPath?: string;
    initialPrompt?: string;
    initialTab?: SmartToolsTab | 'agent' | 'organize' | 'tasks' | 'memories';
    onNavigate?: (path: string) => void;
}

function resolveSelectedPaths(props: SmartToolsDialogProps): string[] {
    if (props.selectedItems?.length) {
        return props.selectedItems.map(p => toWindowsPath(p));
    }
    if (props.selectedFiles?.length) {
        const base = toWindowsPath(props.currentPath || '');
        return props.selectedFiles.map(f => {
            if (f.path) return toWindowsPath(f.path);
            if (f.name && base) return `${base}\\${f.name}`;
            return '';
        }).filter(Boolean);
    }
    return [];
}

function normalizeTab(tab?: SmartToolsDialogProps['initialTab']): SmartToolsTab {
    if (tab === 'agent' || tab === 'tasks' || tab === 'memories') return 'assistant';
    if (tab === 'duplicates') return 'duplicates';
    if (tab === 'assistant') return 'assistant';
    return 'assistant';
}

export default function SmartToolsDialog({
    isOpen = true,
    onClose,
    selectedItems,
    selectedFiles,
    currentPath,
    initialPrompt,
    initialTab = 'assistant',
    onNavigate,
}: SmartToolsDialogProps) {
    const [tab, setTab] = useState<SmartToolsTab>(normalizeTab(initialTab));

    useEffect(() => {
        if (isOpen) setTab(normalizeTab(initialTab));
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const paths = resolveSelectedPaths({ isOpen, onClose, selectedItems, selectedFiles, currentPath });

    const handleOrganize = () => {
        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
            detail: { id: 'storage-cleanup', currentPath, paths, wizardMode: 'organize' },
        }));
        window.dispatchEvent(new CustomEvent('bndz-storage-wizard', { detail: { mode: 'organize', currentPath } }));
        onClose();
    };

    const selectionLabel = paths.length > 0 ? `${paths.length} selected` : undefined;

    return (
        <BndzWindowFrame
            title="Smart Tools"
            subtitle={selectionLabel}
            iconId="smart_tools"
            onClose={onClose}
            widthClass="w-[min(640px,calc(100vw-2rem))]"
            heightClass="h-[min(560px,calc(100vh-2rem))]"
            zIndexClass="z-[100]"
        >
            <div className="bndz-plugin-tabstrip flex border-b border-white/[0.06] shrink-0">
                {([
                    { id: 'organize' as const, label: 'Organize', iconId: 'category_ui' },
                    { id: 'assistant' as const, label: 'Assistant', iconId: 'sparkles_ui' },
                    { id: 'duplicates' as const, label: 'Duplicates', iconId: 'copy' },
                ]).map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`bndz-plugin-tab flex items-center gap-1.5 ${tab === t.id ? 'bndz-plugin-tab-active' : ''}`}
                    >
                        <Icons8Icon id={t.iconId} size={12} /> {t.label}
                    </button>
                ))}
            </div>

            <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0 bg-black/15">
                        {tab === 'organize' && (
                            <div className="flex flex-col gap-2.5">
                                <button
                                    type="button"
                                    onClick={handleOrganize}
                                    className="bndz-plugin-card !py-3 flex items-center gap-3 text-left hover:border-[rgba(56,189,248,0.28)] transition-colors"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-[#094771]/35 border border-[#0078d4]/25 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="category_ui" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Auto-Organize Folder</h3>
                                        <p className="text-[11px] text-white/40 mt-0.5">Sort into Images, Documents, Audio, Video, and more.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                                            detail: { id: 'batch-rename', paths, currentPath },
                                        }));
                                        onClose();
                                    }}
                                    className="bndz-plugin-card !py-3 flex items-center gap-3 text-left hover:border-[rgba(56,189,248,0.28)] transition-colors"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-emerald-900/30 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="sparkles_ui" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Batch Rename</h3>
                                        <p className="text-[11px] text-white/40 mt-0.5">Pattern rename and AI-assisted renaming for selected files.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-tag-assignment'));
                                        onClose();
                                    }}
                                    className="bndz-plugin-card !py-3 flex items-center gap-3 text-left hover:border-[rgba(56,189,248,0.28)] transition-colors"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-pink-900/30 border border-pink-500/20 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="tag_manager" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Quick Tag</h3>
                                        <p className="text-[11px] text-white/40 mt-0.5">Keyboard-driven tagging overlay for the current selection.</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', {
                                            detail: { id: 'storage-cleanup', currentPath, paths },
                                        }));
                                        onClose();
                                    }}
                                    className="bndz-plugin-card !py-3 flex items-center gap-3 text-left hover:border-[rgba(56,189,248,0.28)] transition-colors"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-amber-900/20 border border-amber-500/20 flex items-center justify-center shrink-0">
                                        <Icons8Icon id="storage_cleanup" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="text-[13px] font-semibold text-gray-100">Storage Cleanup</h3>
                                        <p className="text-[11px] text-white/40 mt-0.5">Find large files, empty folders, and reclaim disk space.</p>
                                    </div>
                                </button>
                            </div>
                        )}

                        {tab === 'assistant' && (
                            <BndzAssistantPanel
                                selectedPaths={paths}
                                currentPath={currentPath ? toWindowsPath(currentPath) : undefined}
                                initialPrompt={initialPrompt}
                            />
                        )}

                        {tab === 'duplicates' && (
                            <BndzDuplicatesPanel
                                folderPath={currentPath || '/'}
                                onReveal={p => {
                                    onNavigate?.(p.startsWith('/') ? p : `/${p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`);
                                    onClose();
                                }}
                            />
                        )}
                    </div>
        </BndzWindowFrame>
    );
}
