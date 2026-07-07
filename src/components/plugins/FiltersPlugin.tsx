import React, { useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { useAppConfig, VisualFilter } from '../../data/configContext';
import { FILTER_MATCH_HINTS } from '../../lib/visualFilterEngine';
import PluginPanelShell from './PluginPanelShell';

export const FiltersPluginDef = {
    id: 'filters',
    name: 'Visual Filters',
    icon: 'filters',
    description: 'Color-code files by extension, regex, age, size, and file attributes.',
    isNative: false,
    targetPanel: 'bottom' as const,
};

const SAMPLE_ENTITY = {
    name: 'example-report.pdf',
    extension: 'pdf',
    type: 'file',
    size: 2_500_000,
    modified: new Date().toISOString(),
    attributes: ['archive'],
};

export default function FiltersPlugin({ onFilterChange }: { onFilterChange?: (filters: VisualFilter[]) => void }) {
    const { config, updateConfig } = useAppConfig();
    const [editing, setEditing] = useState<VisualFilter | null>(null);
    const filters = config.visualFilters || [];

    const persist = (next: VisualFilter[]) => {
        updateConfig({ visualFilters: next });
        onFilterChange?.(next);
    };

    const saveRule = (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing) return;
        const next = [...filters];
        const idx = next.findIndex(f => f.id === editing.id);
        if (idx >= 0) next[idx] = editing;
        else next.push(editing);
        persist(next);
        setEditing(null);
    };

    const toggleActive = (id: string, active: boolean) => {
        persist(filters.map(f => f.id === id ? { ...f, isActive: active } : f));
    };

    const removeRule = (id: string) => {
        persist(filters.filter(f => f.id !== id));
        if (editing?.id === id) setEditing(null);
    };

    const startNew = () => setEditing({
        id: Date.now().toString(),
        isActive: true,
        name: 'New Rule',
        matchType: 'extension',
        matchValue: '',
        rowTint: 'rgba(0,122,204,0.12)',
        textColor: '#6db4e6',
        badgeColor: '#38bdf8',
    });

    const previewStyle = editing ? {
        color: editing.textColor || '#e8e8ec',
        backgroundColor: editing.rowTint || 'transparent',
    } : {};

    return (
        <PluginPanelShell
            title="Visual Filters"
            icon="filters"
            iconColor="#38bdf8"
            variant="embedded"
            subtitle={`${filters.filter(f => f.isActive).length} active rules`}
            toolbar={
                <button type="button" onClick={startNew} className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded text-xs font-semibold">
                    <Icons8Icon id="plus_ui" size={12} /> New Rule
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
                            <button type="button" onClick={() => setEditing(f)} className="p-1.5 hover:bg-[#222] rounded text-gray-500 hover:text-white"><Icons8Icon id="pencil_ui" size={12} /></button>
                            <button type="button" onClick={() => removeRule(f.id)} className="p-1.5 hover:bg-red-950/30 rounded text-gray-500 hover:text-red-400"><Icons8Icon id="delete" size={12} /></button>
                        </div>
                    ))}
                </div>

                <div className="w-[300px] shrink-0 flex flex-col gap-3 min-h-0">
                    {editing ? (
                        <form onSubmit={saveRule} className="border border-[#333] bg-[#111] rounded-xl p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
                            <div className="text-xs font-bold text-white">Edit Rule</div>
                            <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white" placeholder="Rule name" />
                            <select value={editing.matchType} onChange={e => setEditing({ ...editing, matchType: e.target.value as VisualFilter['matchType'] })} className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white">
                                <option value="extension">Extension</option>
                                <option value="regex">Regex</option>
                                <option value="attribute">Attribute</option>
                                <option value="age">Age (days)</option>
                                <option value="size">Size (MB)</option>
                                <option value="event">Event</option>
                            </select>
                            <input
                                value={editing.matchValue}
                                onChange={e => setEditing({ ...editing, matchValue: e.target.value })}
                                className="bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs text-white font-mono"
                                placeholder={FILTER_MATCH_HINTS[editing.matchType]}
                            />
                            <div className="grid grid-cols-3 gap-2">
                                <label className="text-[10px] text-gray-500">
                                    Text
                                    <input type="color" value={editing.textColor || '#6db4e6'} onChange={e => setEditing({ ...editing, textColor: e.target.value })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                                <label className="text-[10px] text-gray-500">
                                    Row tint
                                    <input type="color" value={editing.rowTint?.startsWith('#') ? editing.rowTint : '#007acc'} onChange={e => setEditing({ ...editing, rowTint: `${e.target.value}22` })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                                <label className="text-[10px] text-gray-500">
                                    Badge
                                    <input type="color" value={editing.badgeColor || '#38bdf8'} onChange={e => setEditing({ ...editing, badgeColor: e.target.value })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                            </div>
                            <div className="rounded-lg border border-[#333] p-2 bg-[#0a0a0a]">
                                <div className="text-[9px] uppercase tracking-wider text-gray-600 mb-1.5">Live preview</div>
                                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs" style={previewStyle}>
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: editing.badgeColor || '#38bdf8' }} />
                                    {SAMPLE_ENTITY.name}
                                </div>
                            </div>
                            <div className="flex gap-2 mt-auto">
                                <button type="submit" className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-xs py-1.5 rounded font-semibold">Save</button>
                                <button type="button" onClick={() => setEditing(null)} className="flex-1 border border-[#333] text-xs py-1.5 rounded text-gray-400 hover:text-white">Cancel</button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-600 text-xs border border-dashed border-[#333] rounded-xl p-4">
                            Select a rule to edit or create a new one.
                        </div>
                    )}
                </div>
            </div>
        </PluginPanelShell>
    );
}
