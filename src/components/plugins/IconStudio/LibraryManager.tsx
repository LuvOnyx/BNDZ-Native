import React, { useState } from 'react';
import { Palette, Layers, Edit2, Trash2, Plus, Check, X, FolderOpen } from 'lucide-react';
import { useIconStudio } from './IconStudioContext';
import styles from './IconStudio.module.css';

export default function LibraryManager() {
    const { libraries, activeLibraryId, setActiveLibraryId, createLibrary, deleteLibrary, renameLibrary, importLibraryFromFolder } = useIconStudio();
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
        <div className={styles.sidebar}>
            <div className="px-4 py-3.5 border-b border-white/6">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500/25 to-purple-600/20 flex items-center justify-center ring-1 ring-pink-500/20">
                        <Palette size={16} className="text-pink-300" />
                    </div>
                    <div>
                        <div className="text-sm font-bold text-white tracking-tight">Libraries</div>
                        <div className="text-[10px] text-gray-500">{libraries.length} collection{libraries.length !== 1 ? 's' : ''}</div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1 min-h-0">
                {libraries.length === 0 ? (
                    <div className="text-center py-8 px-3 text-gray-600 text-[11px] leading-relaxed">
                        No libraries yet.<br />Import or create one below.
                    </div>
                ) : libraries.map(lib => (
                    <div
                        key={lib.id}
                        onClick={() => { if (editingId !== lib.id) setActiveLibraryId(lib.id); }}
                        className={`${styles.libItem} group flex items-center justify-between p-2.5 rounded-xl cursor-pointer ${
                            activeLibraryId === lib.id ? styles.libItemActive + ' text-white' : 'text-gray-400 hover:bg-white/4 hover:text-gray-200'
                        }`}
                    >
                        <div className="flex items-center gap-2.5 overflow-hidden flex-1 min-w-0">
                            <Layers size={14} className={activeLibraryId === lib.id ? 'text-pink-400 shrink-0' : 'text-gray-600 shrink-0'} />
                            {editingId === lib.id ? (
                                <form onSubmit={(e) => submitRename(e, lib.id)} className="flex-1" onClick={e => e.stopPropagation()}>
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="w-full bg-black/30 text-white text-xs px-2 py-1 outline-none border border-pink-500/30 rounded-md"
                                    />
                                </form>
                            ) : (
                                <div className="min-w-0">
                                    <div className="font-medium text-xs truncate">{lib.name}</div>
                                    <div className="text-[9px] text-gray-600">{lib.icons.length} icons</div>
                                </div>
                            )}
                        </div>
                        <div className={`flex gap-0.5 shrink-0 ${editingId === lib.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                            {editingId === lib.id ? (
                                <>
                                    <button type="button" className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded" onClick={(e) => submitRename(e, lib.id)}><Check size={12} /></button>
                                    <button type="button" className="p-1 text-gray-500 hover:bg-white/5 rounded" onClick={(e) => { e.stopPropagation(); setEditingId(null); }}><X size={12} /></button>
                                </>
                            ) : (
                                <>
                                    <button type="button" className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded" onClick={(e) => startRename(e, lib.id, lib.name)}><Edit2 size={12} /></button>
                                    <button type="button" className="p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete library "${lib.name}"?`)) deleteLibrary(lib.id); }}><Trash2 size={12} /></button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-3 border-t border-white/6 flex flex-col gap-2">
                <button type="button" onClick={importLibraryFromFolder} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600/90 to-purple-600/90 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-semibold py-2.5 rounded-lg shadow-md shadow-pink-900/15 transition-all">
                    <FolderOpen size={14} /> Import folder
                </button>
                <button type="button" onClick={() => createLibrary('New Library')} className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/8 text-gray-300 text-xs font-medium py-2 rounded-lg transition-colors">
                    <Plus size={14} /> New empty library
                </button>
            </div>
        </div>
    );
}
