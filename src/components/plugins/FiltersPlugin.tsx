import React, { useState } from 'react';
import { Filter, Pen, Plus, Trash2 } from 'lucide-react';
import { useAppConfig, VisualFilter } from '../../data/configContext';
import PluginPanelShell from './PluginPanelShell';

export const FiltersPluginDef = {
    id: 'filters',
    name: 'Visual Filters',
    icon: Filter,
    description: 'Color-code files by extension, regex, age, size, and file attributes.',
    isNative: false,
    targetPanel: 'bottom' as const,
};

export default function FiltersPlugin({ onFilterChange }: { onFilterChange?: (filters: VisualFilter[]) => void }) {
    const { config, updateConfig } = useAppConfig();
    const [editing, setEditing] = useState<VisualFilter | null>(null);
    const filters = config.visualFilters || [];

    const saveRule = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing) return;
        const next = [...filters];
        const idx = next.findIndex(f => f.id === editing.id);
        if (idx >= 0) next[idx] = editing;
        else next.push(editing);
        updateConfig({ visualFilters: next });
        onFilterChange?.(next);
        setEditing(null);
    };

    const toggleActive = (id: string, active: boolean) => {
        const next = filters.map(f => f.id === id ? { ...f, isActive: active } : f);
        updateConfig({ visualFilters: next });
        onFilterChange?.(next);
    };

    const removeRule = (id: string) => {
        const next = filters.filter(f => f.id !== id);
        updateConfig({ visualFilters: next });
        onFilterChange?.(next);
    };

    const startNew = () => setEditing({
        id: Date.now().toString(),
        isActive: true,
        name: 'New Rule',
        matchType: 'extension',
        matchValue: '',
        rowTint: 'rgba(0,122,204,0.12)',
        textColor: '#6db4e6',
    });

    return (
        <PluginPanelShell
            title="Visual Filters"
            icon={Filter}
            iconColor="#38bdf8"
            subtitle={`${filters.filter(f => f.isActive).length} active rules`}
            toolbar={
                <button onClick={startNew} className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded text-xs font-semibold">
                    <Plus size={12} /> New Rule
                </button>
            }
        >
            <div className="w-full h-full p-4 flex gap-4 overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-2 min-h-0">
                    {filters.length === 0 && (
                        <div className="text-center text-gray-600 text-xs py-12">No visual filter rules. Create one to color-code files in the list.</div>
                    )}
                    {filters.map(f => (
                        <div key={f.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${f.isActive ? 'bg-[#111] border-[#333]' : 'bg-[#0d0d0d] border-[#222] opacity-60'}`}>
                            <input type="checkbox" checked={f.isActive} onChange={e => toggleActive(f.id, e.target.checked)} className="accent-sky-500" />
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: f.badgeColor || f.textColor || '#6db4e6' }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-white truncate">{f.name}</div>
                                <div className="text-[10px] text-gray-500 font-mono truncate">{f.matchType}: {f.matchValue || '—'}</div>
                            </div>
                            <button onClick={() => setEditing(f)} className="p-1.5 hover:bg-[#222] rounded text-gray-500 hover:text-white"><Pen size={12} /></button>
                            <button onClick={() => removeRule(f.id)} className="p-1.5 hover:bg-red-950/30 rounded text-gray-500 hover:text-red-400"><Trash2 size={12} /></button>
                        </div>
                    ))}
                </div>

                {editing && (
                    <form onSubmit={saveRule} className="w-[280px] shrink-0 border border-[#333] bg-[#111] rounded-xl p-4 flex flex-col gap-3">
                        <div className="text-xs font-bold text-white">Edit Rule</div>
                        <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white" placeholder="Rule name" />
                        <select value={editing.matchType} onChange={e => setEditing({ ...editing, matchType: e.target.value as VisualFilter['matchType'] })} className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                            <option value="extension">Extension</option>
                            <option value="regex">Regex</option>
                            <option value="attribute">Attribute</option>
                            <option value="age">Age (days)</option>
                            <option value="size">Size</option>
                        </select>
                        <input value={editing.matchValue} onChange={e => setEditing({ ...editing, matchValue: e.target.value })} className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white font-mono" placeholder="Match value" />
                        <input type="color" value={editing.textColor || '#6db4e6'} onChange={e => setEditing({ ...editing, textColor: e.target.value })} className="w-full h-8 rounded cursor-pointer" title="Text color" />
                        <div className="flex gap-2 mt-auto">
                            <button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-xs py-1.5 rounded font-semibold">Save</button>
                            <button type="button" onClick={() => setEditing(null)} className="flex-1 border border-[#333] text-xs py-1.5 rounded text-gray-400 hover:text-white">Cancel</button>
                        </div>
                    </form>
                )}
            </div>
        </PluginPanelShell>
    );
}
