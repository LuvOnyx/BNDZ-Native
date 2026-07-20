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
  PluginHeroStrip,
  PluginHeroActionButton,
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

const MATCH_LABELS: Record<string, string> = {
    extension: 'Extension',
    regex: 'Regex',
    attribute: 'Attribute',
    age: 'Age (days)',
    size: 'Size (MB)',
    event: 'Event',
};

export default function FiltersPlugin({ onFilterChange }: { onFilterChange?: (filters: VisualFilter[]) => void }) {
    const { config, updateConfig } = useAppConfig();
    const [editing, setEditing] = useState<VisualFilter | null>(null);
    const filters = config.visualFilters || [];
    const activeCount = filters.filter(f => f.isActive).length;

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

    const isNewRule = editing ? !filters.some(f => f.id === editing.id) : false;

    return (
        <PluginPanelShell
            title="Visual Filters"
            icon="filters"
            iconColor="#38bdf8"
            variant="embedded"
            subtitle={`${activeCount} active of ${filters.length} rules`}
        >
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
                <PluginHeroStrip
                    icon={<Icons8Icon id="filters" size={52} className="opacity-90" />}
                    name="Rules studio"
                    typeLabel="Visual filters"
                    meta={
                        <span className="bndz-panel-muted text-xs">
                            {activeCount} active · {filters.length} total
                            {editing ? ` · editing “${editing.name}”` : ''}
                        </span>
                    }
                    actions={<PluginHeroActionButton icon="plus_ui" variant="primary" onClick={startNew}>New rule</PluginHeroActionButton>}
                />

            <div className="w-full flex-1 p-4 flex gap-4 overflow-hidden min-h-0">
                {/* Rules list */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-2.5 shrink-0 px-0.5">
                        <PluginSectionTitle icon="filters">Filter rules</PluginSectionTitle>
                        <span className="bndz-plugin-kind-pill">{filters.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto bndz-scrollbar space-y-2 min-h-0 pr-0.5">
                        {filters.length === 0 && (
                            <PluginEmptyState
                                icon="filters"
                                title="No filter rules"
                                description="Create a rule to color-code files in the list by extension, size, age, and more."
                            />
                        )}
                        {filters.map(f => {
                            const selected = editing?.id === f.id;
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => setEditing(f)}
                                    className={`w-full text-left bndz-plugin-card !py-3 flex items-center gap-3 transition-colors ${
                                        selected
                                            ? 'border-sky-400/40 bg-sky-500/[0.08] ring-1 ring-sky-400/20'
                                            : !f.isActive
                                                ? 'opacity-55 hover:opacity-80'
                                                : 'hover:border-sky-400/25'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={f.isActive}
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => toggleActive(f.id, e.target.checked)}
                                        className="accent-[#38bdf8] shrink-0"
                                        title={f.isActive ? 'Disable rule' : 'Enable rule'}
                                    />
                                    <div
                                        className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-white/10 shadow-sm"
                                        style={{ backgroundColor: f.badgeColor || f.textColor || '#6db4e6' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs font-semibold text-white truncate">{f.name}</span>
                                            {!f.isActive && (
                                                <span className="bndz-plugin-kind-pill !text-[9px] text-slate-400 border-white/10 bg-white/[0.03]">Off</span>
                                            )}
                                        </div>
                                        <div className="text-[11px] bndz-panel-muted mt-0.5 flex items-center gap-1.5 min-w-0">
                                            <span className="bndz-plugin-kind-pill !text-[9px] shrink-0">
                                                {MATCH_LABELS[f.matchType] || f.matchType}
                                            </span>
                                            <span className="bndz-mono truncate">{f.matchValue || '—'}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                        <PluginToolbarButton icon="pencil_ui" onClick={() => setEditing(f)} title="Edit" />
                                        <PluginToolbarButton icon="delete" onClick={() => removeRule(f.id)} title="Remove" />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Editor panel */}
                <div className="w-[300px] shrink-0 flex flex-col min-h-0">
                    {editing ? (
                        <form
                            onSubmit={saveRule}
                            className="bndz-plugin-card flex flex-col gap-3 flex-1 min-h-0 overflow-hidden !p-0"
                        >
                            <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-gradient-to-r from-sky-500/[0.07] to-transparent shrink-0">
                                <div className="flex items-center gap-2">
                                    <Icons8Icon id="pencil_ui" size={14} className="opacity-80" />
                                    <span className="text-xs font-semibold text-white">
                                        {isNewRule ? 'New rule' : 'Edit rule'}
                                    </span>
                                    <span className="bndz-plugin-kind-pill !text-[9px] ml-auto">
                                        {MATCH_LABELS[editing.matchType] || editing.matchType}
                                    </span>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto bndz-scrollbar px-3.5 py-3 space-y-3 min-h-0">
                                <div>
                                    <PluginFieldLabel>Rule name</PluginFieldLabel>
                                    <input
                                        value={editing.name}
                                        onChange={e => setEditing({ ...editing, name: e.target.value })}
                                        className={PLUGIN_INPUT_CLASS}
                                        placeholder="Rule name"
                                    />
                                </div>
                                <div>
                                    <PluginFieldLabel>Match type</PluginFieldLabel>
                                    <select
                                        value={editing.matchType}
                                        onChange={e => setEditing({ ...editing, matchType: e.target.value as VisualFilter['matchType'] })}
                                        className={`${PLUGIN_SELECT_CLASS} w-full`}
                                    >
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

                                <div>
                                    <PluginFieldLabel>Colors</PluginFieldLabel>
                                    <div className="grid grid-cols-3 gap-2 mt-1">
                                        <label className="bndz-plugin-card !p-2 !rounded-lg space-y-1">
                                            <span className="text-[10px] bndz-panel-muted block">Text</span>
                                            <input
                                                type="color"
                                                value={editing.textColor || '#6db4e6'}
                                                onChange={e => setEditing({ ...editing, textColor: e.target.value })}
                                                className="w-full h-7 rounded cursor-pointer"
                                            />
                                        </label>
                                        <label className="bndz-plugin-card !p-2 !rounded-lg space-y-1">
                                            <span className="text-[10px] bndz-panel-muted block">Row tint</span>
                                            <input
                                                type="color"
                                                value={editing.rowTint?.startsWith('#') ? editing.rowTint : '#007acc'}
                                                onChange={e => setEditing({ ...editing, rowTint: `${e.target.value}22` })}
                                                className="w-full h-7 rounded cursor-pointer"
                                            />
                                        </label>
                                        <label className="bndz-plugin-card !p-2 !rounded-lg space-y-1">
                                            <span className="text-[10px] bndz-panel-muted block">Badge</span>
                                            <input
                                                type="color"
                                                value={editing.badgeColor || '#0078d4'}
                                                onChange={e => setEditing({ ...editing, badgeColor: e.target.value })}
                                                className="w-full h-7 rounded cursor-pointer"
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
                                    <PluginFieldLabel>Live preview</PluginFieldLabel>
                                    <div className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs mt-1" style={previewStyle}>
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/20"
                                            style={{ backgroundColor: editing.badgeColor || '#0078d4' }}
                                        />
                                        <span className="font-medium">{SAMPLE_ENTITY.name}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="shrink-0 px-3.5 py-2.5 border-t border-white/[0.06] flex gap-2 bg-black/20">
                                <button
                                    type="submit"
                                    className="bndz-plugin-btn flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold bg-sky-500/15 border-sky-400/35 text-sky-300 hover:bg-sky-500/25"
                                >
                                    <Icons8Icon id="check" size={12} />
                                    Save rule
                                </button>
                                <PluginToolbarButton onClick={() => setEditing(null)}>Cancel</PluginToolbarButton>
                            </div>
                        </form>
                    ) : (
                        <PluginCard className="flex-1 flex flex-col items-center justify-center !p-6">
                            <PluginEmptyState
                                icon="pencil_ui"
                                title="Rule editor"
                                description="Select a rule on the left, or create a new one to open the studio panel."
                            />
                            <PluginToolbarButton icon="plus_ui" onClick={startNew}>New rule</PluginToolbarButton>
                        </PluginCard>
                    )}
                </div>
            </div>
            </div>
        </PluginPanelShell>
    );
}
