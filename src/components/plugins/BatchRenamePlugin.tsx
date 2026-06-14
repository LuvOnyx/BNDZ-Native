import React, { useState, useEffect } from 'react';
import { Replace, Search, Type, Hash, ArrowRight, CaseSensitive, FileInput, Plus, Trash2 } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';

export const BatchRenamePluginDef = {
    id: "batch-rename",
    name: "Batch Rename",
    icon: Replace
};

export default function BatchRenamePlugin({ activeTab, drives, config, entity, focusedPath, selectedItems }: any) {
    const [findStr, setFindStr] = useState("");
    const [replaceStr, setReplaceStr] = useState("");
    const [useRegex, setUseRegex] = useState(false);
    
    const [prefix, setPrefix] = useState("");
    const [suffix, setSuffix] = useState("");
    const [casing, setCasing] = useState<"none" | "lower" | "upper" | "title" | "camel">("none");
    const [useSequence, setUseSequence] = useState(false);
    const [seqStart, setSeqStart] = useState<number>(1);
    const [seqPad, setSeqPad] = useState<number>(3);
    const [seqSeparator, setSeqSeparator] = useState<string>("_");
    
    // Extracted targets
    const items = selectedItems || [];

    const applyCasing = (str: string, type: string) => {
        if (type === "lower") return str.toLowerCase();
        if (type === "upper") return str.toUpperCase();
        if (type === "title") return str.replace(/\b\w/g, c => c.toUpperCase());
        if (type === "camel") return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (m, i) => {
            if (+m === 0) return ""; 
            return i === 0 ? m.toLowerCase() : m.toUpperCase();
        }).replace(/\s+/g, '');
        return str;
    };

    const processItem = (oldName: string, index: number) => {
        let baseName = oldName;
        let extension = "";
        const dotIndex = oldName.lastIndexOf('.');
        if (dotIndex > 0) {
            baseName = oldName.substring(0, dotIndex);
            extension = oldName.substring(dotIndex);
        }

        let newBase = baseName;

        // 1. Find and Replace
        if (findStr) {
            if (useRegex) {
                try {
                    const regex = new RegExp(findStr, 'g');
                    newBase = newBase.replace(regex, replaceStr);
                } catch { /* Ignore invalid regex during typing */ }
            } else {
                newBase = newBase.split(findStr).join(replaceStr);
            }
        }

        // 2. Casing
        if (casing !== "none") {
            newBase = applyCasing(newBase, casing);
        }

        // 3. Prepend / Append
        if (prefix) newBase = prefix + newBase;
        if (suffix) newBase = newBase + suffix;

        // 4. Sequential Numbering
        if (useSequence) {
            const numStr = (seqStart + index).toString().padStart(seqPad, '0');
            newBase = newBase + seqSeparator + numStr;
        }

        return newBase + extension;
    };

    const previews = items.map((oldName: string, i: number) => ({
        oldName,
        newName: processItem(oldName, i)
    }));

    const handleCommit = () => {
        if (!focusedPath) return;
        previews.forEach((p: any, idx: number) => {
            if (p.oldName !== p.newName) {
                IPC.executeFsOperation(`rename-batch-${idx}`, 'move', `${focusedPath}/${p.oldName}`, `${focusedPath}/${p.newName}`);
            }
        });
    };

    return (
        <div className="w-full h-full flex flex-col bg-[#0a0a0a] text-gray-200 text-xs font-sans">
            <div className="flex border-b border-[#222] bg-[#111] p-3 shrink-0 items-center justify-between shadow-sm">
                <div className="flex items-center gap-2 text-[13px] font-bold tracking-tight text-white">
                    <Replace size={16} className="text-emerald-400" /> Advanced Batch Rename
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-[11px] text-gray-500 font-mono bg-[#000] px-2 py-1 rounded border border-[#222]">
                        {items.length} items selected
                    </div>
                    <button onClick={handleCommit} disabled={items.length === 0} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900/30 disabled:text-gray-600 disabled:border-emerald-900/50 rounded text-white font-semibold transition-all shadow-sm border border-emerald-500">
                        Apply Renames
                    </button>
                </div>
            </div>
            
            <div className="flex flex-1 overflow-hidden">
                {/* Left Panel: Controls */}
                <div className="w-[320px] bg-[#141414] border-r border-[#222] flex flex-col overflow-y-auto bndz-scrollbar">
                    
                    {/* Find & Replace */}
                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><Search size={12}/> Find & Replace</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[#888] text-[10px] mb-1 block">Find Context</label>
                                <div className="flex gap-1 relative">
                                    <input type="text" value={findStr} onChange={e => setFindStr(e.target.value)} placeholder="Text to find..." className="flex-1 bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                                    <button onClick={() => setUseRegex(!useRegex)} className={`px-2 py-1 flex items-center justify-center rounded-sm border ${useRegex ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-[#1a1a1a] text-gray-400 border-[#333] hover:bg-[#222]'}`} title="Use Regular Expressions">
                                        .*
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="text-[#888] text-[10px] mb-1 block">Replace With</label>
                                <input type="text" value={replaceStr} onChange={e => setReplaceStr(e.target.value)} placeholder="Replacement text..." className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                        </div>
                    </div>

                    {/* Prepend & Append */}
                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><FileInput size={12}/> Affixes</h3>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="text-[#888] text-[10px] mb-1 block">Prefix</label>
                                <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="prepend_" className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                            <div className="flex-1">
                                <label className="text-[#888] text-[10px] mb-1 block">Suffix</label>
                                <input type="text" value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="_append" className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white" />
                            </div>
                        </div>
                    </div>

                    {/* Transformations */}
                    <div className="p-4 border-b border-[#222]">
                        <h3 className="text-gray-400 font-semibold mb-3 flex items-center gap-1 uppercase tracking-wider text-[10px]"><CaseSensitive size={12}/> Formatting</h3>
                        <div>
                            <label className="text-[#888] text-[10px] mb-1 block">Casing Rule</label>
                            <select value={casing} onChange={e => setCasing(e.target.value as any)} className="w-full bg-[#090909] border border-[#333] px-2 py-1.5 outline-none focus:border-emerald-500 rounded-sm transition-colors text-white">
                                <option value="none">No Change</option>
                                <option value="lower">lowercase (all)</option>
                                <option value="upper">UPPERCASE (all)</option>
                                <option value="title">Title Case</option>
                                <option value="camel">camelCase</option>
                            </select>
                        </div>
                    </div>

                    {/* Serialization */}
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-gray-400 font-semibold flex items-center gap-1 uppercase tracking-wider text-[10px]"><Hash size={12}/> Sequential Numbering</h3>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={useSequence} onChange={e => setUseSequence(e.target.checked)} className="sr-only peer" />
                                <div className="w-7 h-4 bg-gray-700 rounded-full peer peer-checked:bg-emerald-500 peer-focus:outline-none transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-full"></div>
                            </label>
                        </div>
                        {useSequence && (
                            <div className="space-y-3 bg-[#0a0a0a] p-3 rounded border border-[#222]">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-[#666] text-[10px] mb-1 block">Start at</label>
                                        <input type="number" min="0" value={seqStart} onChange={e => setSeqStart(parseInt(e.target.value)||0)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[#666] text-[10px] mb-1 block">Padding (0s)</label>
                                        <input type="number" min="1" max="10" value={seqPad} onChange={e => setSeqPad(parseInt(e.target.value)||1)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[#666] text-[10px] mb-1 block">Separator</label>
                                    <input type="text" value={seqSeparator} onChange={e => setSeqSeparator(e.target.value)} className="w-full bg-[#111] border border-[#333] px-2 py-1 outline-none focus:border-emerald-500 rounded-sm" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Live Preview */}
                <div className="flex-1 overflow-y-auto bg-[#0a0a0a] relative bndz-scrollbar">
                    {items.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-600 flex-col gap-2 pointer-events-none">
                            <Replace size={48} className="opacity-20" />
                            <span className="font-medium text-sm">Select files to preview renames</span>
                            <span className="text-[10px] text-gray-500">Hold CTRL or SHIFT in the list to select multiple files.</span>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#111] sticky top-0 border-b border-[#222] shadow-sm z-10">
                                <tr>
                                    <th className="p-2.5 font-semibold text-[#888] w-1/2 uppercase tracking-wide text-[10px]">Original Name</th>
                                    <th className="p-2.5 w-8"></th>
                                    <th className="p-2.5 font-semibold text-[#888] w-1/2 uppercase tracking-wide text-[10px]">New Name</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previews.map((p: any, i: number) => {
                                    const changed = p.oldName !== p.newName;
                                    return (
                                    <tr key={i} className="border-b border-[#181818] hover:bg-[#111] group">
                                        <td className="p-2.5 truncate max-w-xs transition-colors" style={{ color: changed ? '#888' : '#ccc' }} title={p.oldName}>
                                            <span className={changed ? 'line-through decoration-red-500/50' : ''}>{p.oldName}</span>
                                        </td>
                                        <td className="p-2.5 flex justify-center text-gray-600 group-hover:text-emerald-500/50 transition-colors">
                                            {changed ? <ArrowRight size={14} /> : <div className="w-3" />}
                                        </td>
                                        <td className="p-2.5 truncate max-w-xs transition-colors" style={{ color: changed ? '#34d399' : '#ccc' }} title={p.newName}>
                                            {p.newName}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
