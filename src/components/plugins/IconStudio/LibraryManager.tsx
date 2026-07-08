import React, { useState } from 'react';
import { Icons8Icon } from '../../Icons8Icon';
import { CloseGlyph } from '../../ChromeGlyphs';
import { useIconStudio } from './IconStudioContext';
import styles from './IconStudio.module.css';
import { PluginToolbarButton, PLUGIN_INPUT_CLASS } from '../PluginPanelPrimitives';

export default function LibraryManager() {
    const { libraries, activeLibraryId, setActiveLibraryId, createLibrary, deleteLibrary, renameLibrary, importLibraryFromFolder, isImporting, resyncLibrary, exportLibrary } = useIconStudio();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    const startRename = (e: React.MouseEvent, id: string, currentName: string) => {
        e.stopPropagation();
        setEditingId(id);
        setEditName(currentName);
    };

    const submitRename = (e: React.MouseEvent | React.FormEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        if (editName.trim()) renameLibrary(id, editName.trim());
        setEditingId(null);
    };

    return (
        <div className={`${styles.sidebar} relative`}>
            {isImporting && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 pointer-events-none">
                    <div className={`${styles.spinnerRing}`} />
                </div>
            )}
            <div className="px-3 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Icons8Icon id="layers_ui" size={14} className="text-gray-400 shrink-0" />
                    <div className="min-w-0">
                        <div className="text-xs font-semibold text-white">Libraries</div>
                        <div className="text-xs bndz-panel-muted">{libraries.length} collection{libraries.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-0.5 min-h-0">
                {libraries.length === 0 ? (
                    <div className="text-center py-8 px-3 bndz-panel-muted text-xs leading-relaxed">
                        No libraries yet.<br />Import or create one below.
                    </div>
                ) : libraries.map(lib => (
                    <div
                        key={lib.id}
                        onClick={() => { if (editingId !== lib.id) setActiveLibraryId(lib.id); }}
                        className={`${styles.libItem} group flex items-center justify-between p-2 cursor-pointer ${
                            activeLibraryId === lib.id ? `${styles.libItemActive} text-white` : 'text-gray-400 hover:bg-white/[0.03] hover:text-gray-200'
                        }`}
                    >
                        <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                            <Icons8Icon id="layers_ui" size={13} className={activeLibraryId === lib.id ? 'text-sky-400 shrink-0' : 'text-gray-600 shrink-0'} />
                            {editingId === lib.id ? (
                                <form onSubmit={(e) => submitRename(e, lib.id)} className="flex-1" onClick={e => e.stopPropagation()}>
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className={`${PLUGIN_INPUT_CLASS} !py-1`}
                                    />
                                </form>
                            ) : (
                                <div className="min-w-0">
                                    <div className="font-medium text-xs truncate">{lib.name}</div>
                                    <div className="text-xs bndz-panel-muted">{lib.icons.length} icons</div>
                                </div>
                            )}
                        </div>
                        <div className={`flex gap-0.5 shrink-0 ${editingId === lib.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                            {editingId === lib.id ? (
                                <>
                                    <button type="button" className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded" onClick={(e) => submitRename(e, lib.id)}><Icons8Icon id="check" size={12} /></button>
                                    <button type="button" className="p-1 text-gray-500 hover:bg-white/5 rounded" onClick={(e) => { e.stopPropagation(); setEditingId(null); }}><CloseGlyph size={12} /></button>
                                </>
                            ) : (
                                <>
                                    <button type="button" className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded" onClick={(e) => startRename(e, lib.id, lib.name)}><Icons8Icon id="pencil_ui" size={12} /></button>
                                    <button type="button" className="p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete library "${lib.name}"?`)) deleteLibrary(lib.id); }}><Icons8Icon id="trash_ui" size={12} /></button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-2 border-t border-white/[0.06] flex flex-col gap-1.5">
                {activeLibraryId && (
                    <div className="flex gap-1.5">
                        <PluginToolbarButton icon="refresh" onClick={() => void resyncLibrary(activeLibraryId)} title="Resync from source folder">
                            Resync
                        </PluginToolbarButton>
                        <PluginToolbarButton icon="download" onClick={() => exportLibrary(activeLibraryId)} title="Export library JSON">
                            Export
                        </PluginToolbarButton>
                    </div>
                )}
                <PluginToolbarButton icon="folder_open_ui" onClick={importLibraryFromFolder} active>
                    Import folder
                </PluginToolbarButton>
                <PluginToolbarButton icon="plus_ui" onClick={() => createLibrary('New Library')}>
                    New library
                </PluginToolbarButton>
            </div>
        </div>
    );
}
