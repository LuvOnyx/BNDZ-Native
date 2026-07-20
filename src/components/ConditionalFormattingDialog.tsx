import React, { useEffect, useState } from 'react';
import { useAppConfig, VisualFilter } from '../data/configContext';
import { Icons8Icon } from './Icons8Icon';
import { BndzWindowFrame } from './native/BndzWindowFrame';

export default function ConditionalFormattingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { config, updateConfig } = useAppConfig();
  const [rules, setRules] = useState<VisualFilter[]>(config.visualFilters || []);

  useEffect(() => {
    if (open) setRules(config.visualFilters || []);
  }, [open, config.visualFilters]);

  if (!open) return null;

  const handleSave = () => {
    updateConfig({ visualFilters: rules });
    onOpenChange(false);
  };

  const addRule = () => {
    setRules([
      ...rules,
      {
        id: Date.now().toString(),
        isActive: true,
        name: 'New Rule',
        matchType: 'event',
        matchValue: 'modifiedToday',
        rowTint: '',
        textColor: '',
        badgeColor: '',
        targetScope: '',
      },
    ]);
  };

  const updateRule = (id: string, updates: Partial<VisualFilter>) => {
    setRules(rules.map(r => (r.id === id ? { ...r, ...updates } : r)));
  };

  const removeRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  return (
    <BndzWindowFrame
      title="Conditional Formatting"
      subtitle={`${rules.length} rule${rules.length === 1 ? '' : 's'} · tint rows by pattern`}
      iconId="filters"
      onClose={() => onOpenChange(false)}
      widthClass="w-[min(820px,calc(100vw-2rem))]"
      heightClass="h-[min(560px,calc(100vh-2rem))]"
      zIndexClass="z-[250]"
    >
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar p-4 space-y-3">
          {rules.length === 0 && (
            <div className="bndz-plugin-card flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Icons8Icon id="filters" size={22} className="opacity-40" />
              <div className="text-sm text-gray-300 font-medium">No formatting rules yet</div>
              <div className="text-[11px] text-gray-500 max-w-sm">
                Color-code list rows by time, extension, regex, or size — same engine as Visual Filters.
              </div>
            </div>
          )}

          {rules.map((rule, idx) => (
            <div key={rule.id} className="bndz-plugin-card space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="font-mono text-[10px] text-gray-500 w-5 shrink-0">#{idx + 1}</div>
                <input
                  className="bndz-native-input h-8 w-44 text-xs"
                  placeholder="Rule name"
                  value={rule.name}
                  onChange={e => updateRule(rule.id, { name: e.target.value })}
                />

                <select
                  className="bndz-native-input h-8 w-40 text-xs"
                  value={rule.matchType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    updateRule(rule.id, { matchType: e.target.value as VisualFilter['matchType'], matchValue: '' })
                  }
                >
                  <option value="event">Event / Timeframe</option>
                  <option value="extension">Extension</option>
                  <option value="regex">Regex Name</option>
                  <option value="size">Size</option>
                </select>

                {rule.matchType === 'event' ? (
                  <select
                    className="bndz-native-input h-8 w-48 text-xs"
                    value={rule.matchValue}
                    onChange={e => updateRule(rule.id, { matchValue: e.target.value })}
                  >
                    <option value="" disabled hidden>
                      Select event
                    </option>
                    <option value="modifiedToday">Modified Today</option>
                    <option value="createdWithin24Hours">Created Within 24h</option>
                    <option value="isReadOnly">Is Read-Only</option>
                  </select>
                ) : (
                  <input
                    className="bndz-native-input h-8 w-48 text-xs"
                    placeholder={`Value for ${rule.matchType}`}
                    value={rule.matchValue}
                    onChange={e => updateRule(rule.id, { matchValue: e.target.value })}
                  />
                )}

                <input
                  className="bndz-native-input h-8 flex-1 min-w-[140px] text-xs"
                  placeholder="Folder scope (e.g. C:\\Windows)"
                  value={rule.targetScope || ''}
                  onChange={e => updateRule(rule.id, { targetScope: e.target.value })}
                />

                <button
                  type="button"
                  className="bndz-hub-btn-ghost p-2 text-rose-400 hover:text-rose-300"
                  onClick={() => removeRule(rule.id)}
                  title="Remove rule"
                >
                  <Icons8Icon id="trash_ui" size={14} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 items-center pl-5 text-xs">
                <span className="text-gray-500 w-14 shrink-0">Styles</span>
                <input
                  className="bndz-native-input h-7 w-32 text-xs"
                  placeholder="Text color"
                  value={rule.textColor || rule.hexColor || ''}
                  onChange={e => updateRule(rule.id, { textColor: e.target.value, hexColor: e.target.value })}
                />
                <input
                  className="bndz-native-input h-7 w-36 text-xs"
                  placeholder="Row tint (#rrggbbaa)"
                  value={rule.rowTint || ''}
                  onChange={e => updateRule(rule.id, { rowTint: e.target.value })}
                />
                <input
                  className="bndz-native-input h-7 w-32 text-xs"
                  placeholder="Badge color"
                  value={rule.badgeColor || ''}
                  onChange={e => updateRule(rule.id, { badgeColor: e.target.value })}
                />
                {(rule.textColor || rule.hexColor || rule.rowTint || rule.badgeColor) && (
                  <span
                    className="h-7 px-3 rounded-md text-[11px] font-medium flex items-center border border-white/[0.08]"
                    style={{
                      color: rule.textColor || rule.hexColor || undefined,
                      background: rule.rowTint || 'transparent',
                    }}
                  >
                    Preview
                    {rule.badgeColor && (
                      <span
                        className="ml-2 w-2 h-2 rounded-full"
                        style={{ backgroundColor: rule.badgeColor }}
                      />
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addRule}
            className="w-full bndz-hub-btn-ghost border border-dashed border-white/[0.12] py-2.5 text-xs font-medium flex items-center justify-center gap-2"
          >
            <Icons8Icon id="plus_ui" size={14} /> Add Rule
          </button>
        </div>

        <div className="shrink-0 flex justify-end gap-2 px-4 py-3 border-t border-white/[0.06]">
          <button type="button" className="bndz-hub-btn-ghost px-4 py-2 text-xs font-semibold" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="bndz-hub-btn-primary px-4 py-2 text-xs font-semibold" onClick={handleSave}>
            Save Ruleset
          </button>
        </div>
      </div>
    </BndzWindowFrame>
  );
}
