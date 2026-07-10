import React, { useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { useAppConfig, VisualFilter } from '../../data/configContext';
import { FILTER_MATCH_HINTS } from '../../lib/visualFilterEngine';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginSectionTitle,
  PluginCard,
  PluginFieldLabel,
  PluginEmptyState,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from './PluginPanelPrimitives';

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
        badgeColor: '#0078d4',
    });

    const previewStyle = editing ? {
        color: editing.textColor || '#e8e8ec',
        backgroundColor: editing.rowTint || 'transparent',
    } : {};

    return (
        <PluginPanelShell
            title="Visual Filters"
            icon="filters"
            iconColor="#0078d4"
            variant="embedded"
            subtitle={`${filters.filter(f => f.isActive).length} active rules`}
            toolbar={
                <PluginToolbarButton icon="plus_ui" onClick={startNew}>New rule</PluginToolbarButton>
            }
        >
            <div className="w-full h-full p-4 flex gap-4 overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-2 min-h-0">
                    {filters.length === 0 && (
                        <PluginEmptyState
                            icon="filters"
                            title="No filter rules"
                            description="Create a rule to color-code files in the file list by extension, size, age, and more."
                        />
                    )}
                    {filters.map(f => (
                        <PluginCard key={f.id} className={`flex items-center gap-3 !py-3 ${!f.isActive ? 'opacity-60' : ''}`}>
                            <input type="checkbox" checked={f.isActive} onChange={e => toggleActive(f.id, e.target.checked)} className="accent-[#0078d4]" />
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: f.badgeColor || f.textColor || '#6db4e6' }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-white truncate">{f.name}</div>
                                <div className="text-xs bndz-panel-muted bndz-mono truncate">{f.matchType}: {f.matchValue || '—'}</div>
                            </div>
                            <PluginToolbarButton icon="pencil_ui" onClick={() => setEditing(f)} title="Edit" />
                            <PluginToolbarButton icon="delete" onClick={() => removeRule(f.id)} title="Remove" />
                        </PluginCard>
                    ))}
                </div>

                <div className="w-[280px] shrink-0 flex flex-col gap-3 min-h-0">
                    {editing ? (
                        <form onSubmit={saveRule} className="bndz-plugin-card flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto bndz-scrollbar">
                            <PluginSectionTitle>Edit rule</PluginSectionTitle>
                            <div>
                                <PluginFieldLabel>Rule name</PluginFieldLabel>
                                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={PLUGIN_INPUT_CLASS} placeholder="Rule name" />
                            </div>
                            <div>
                                <PluginFieldLabel>Match type</PluginFieldLabel>
                                <select value={editing.matchType} onChange={e => setEditing({ ...editing, matchType: e.target.value as VisualFilter['matchType'] })} className={`${PLUGIN_SELECT_CLASS} w-full`}>
                                    <option value="extension">Extension</option>
                                    <option value="regex">Regex</option>
                                    <option value="attribute">Attribute</option>
                                    <option value="age">Age (days)</option>
                                    <option value="size">Size (MB)</option>
                                    <option value="event">Event</option>
                                </select>
                            </div>
                            <div>
                                <PluginFieldLabel>Match value</PluginFieldLabel>
                                <input
                                    value={editing.matchValue}
                                    onChange={e => setEditing({ ...editing, matchValue: e.target.value })}
                                    className={`${PLUGIN_INPUT_CLASS} bndz-mono`}
                                    placeholder={FILTER_MATCH_HINTS[editing.matchType]}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <label>
                                    <PluginFieldLabel>Text</PluginFieldLabel>
                                    <input type="color" value={editing.textColor || '#6db4e6'} onChange={e => setEditing({ ...editing, textColor: e.target.value })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                                <label>
                                    <PluginFieldLabel>Row tint</PluginFieldLabel>
                                    <input type="color" value={editing.rowTint?.startsWith('#') ? editing.rowTint : '#007acc'} onChange={e => setEditing({ ...editing, rowTint: `${e.target.value}22` })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                                <label>
                                    <PluginFieldLabel>Badge</PluginFieldLabel>
                                    <input type="color" value={editing.badgeColor || '#0078d4'} onChange={e => setEditing({ ...editing, badgeColor: e.target.value })} className="w-full h-7 rounded cursor-pointer mt-0.5" />
                                </label>
                            </div>
                            <PluginCard className="!p-2 bg-black/20">
                                <PluginFieldLabel>Live preview</PluginFieldLabel>
                                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs" style={previewStyle}>
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: editing.badgeColor || '#0078d4' }} />
                                    {SAMPLE_ENTITY.name}
                                </div>
                            </PluginCard>
                            <div className="flex gap-2 mt-auto">
                                <button type="submit" className="bndz-plugin-btn flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium bg-[#094771]/35 border-[#0078d4]/40 text-[#99c9f0]">
                                    Save
                                </button>
                                <PluginToolbarButton onClick={() => setEditing(null)}>Cancel</PluginToolbarButton>
                            </div>
                        </form>
                    ) : (
                        <PluginEmptyState icon="pencil_ui" description="Select a rule to edit or create a new one." />
                    )}
                </div>
            </div>
        </PluginPanelShell>
    );
}
