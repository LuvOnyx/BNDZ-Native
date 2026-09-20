import React, { useMemo } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { Checkbox } from '../ui/checkbox';
import { ColorSettingRow } from './ColorSettingRow';
import { COLOR_CONFIG_SECTIONS, COLOR_CONFIG_FIELDS, getColorConfigDefaults } from '../../data/colorConfigSchema';
import { applySettingsRuntime } from '../../lib/settingsRuntime';
import { fillToBackground, migratePluginHeroFill } from '../../lib/colorFill';

interface ColorsTabContentProps {
  localConfig: Record<string, any>;
  updateLocalConfig: (updates: Record<string, any>) => void;
}

export default function ColorsTabContent({ localConfig, updateLocalConfig }: ColorsTabContentProps) {
  const defaults = getColorConfigDefaults();
  const applyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const setColor = (key: string, val: string) => {
    const updates: Record<string, any> = { [key]: val, applyColors: true };
    // Collapse legacy mid/edge when editing the unified hero gradient
    if (key === 'colorConfig47') {
      updates.colorConfig48 = false;
      updates.colorConfig49 = false;
    }
    const next = { ...localConfig, ...updates };
    updateLocalConfig(updates);
    // Live-paint documentElement immediately so workspace tracks the picker.
    // Tiny rAF coalesce keeps opacity drags smooth without feeling laggy.
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(() => {
      applySettingsRuntime(next as any);
      applyTimerRef.current = null;
    }, 16);
  };

  const resetDefaults = () => {
    updateLocalConfig({ ...defaults, colorConfig48: false, colorConfig49: false, applyColors: true });
    applySettingsRuntime({ ...localConfig, ...defaults, colorConfig48: false, colorConfig49: false, applyColors: true } as any);
  };

  const sectionColors = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of COLOR_CONFIG_FIELDS) {
      if (!map[field.section]) map[field.section] = [];
      const raw =
        field.key === 'colorConfig47'
          ? migratePluginHeroFill(localConfig.colorConfig47, localConfig.colorConfig48, localConfig.colorConfig49)
          : localConfig[field.key] || field.default;
      map[field.section].push(fillToBackground(raw));
    }
    return map;
  }, [localConfig]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-white mb-1 leading-tight flex items-center gap-2">
          <Icons8Icon id="palette_ui" size={20} />
          Colors
        </h1>
        <p className="text-[12px] text-[#a0a0a0] max-w-[560px]">
          Every color uses one picker -- Solid or Gradient. Gradients edit as steps inside the picker. Plugin heroes are gradient-only. Changes paint the live workspace immediately when Apply colors is on.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-8 pb-5 border-b border-[#333] rounded-lg bg-gradient-to-r from-[#1a1a22] to-[#141418] px-4 py-3">
        <Checkbox
          label={<span>Apply custom <span className="underline decoration-1 underline-offset-[3px]">c</span>olors to workspace</span>}
          checked={localConfig.applyColors ?? false}
          onChange={e => {
            updateLocalConfig({ applyColors: e.target.checked });
            applySettingsRuntime({ ...localConfig, applyColors: e.target.checked } as any);
          }}
        />
        <button
          type="button"
          onClick={resetDefaults}
          className="text-[11px] px-3 py-1.5 rounded-md border border-[#555] bg-[#2a2a2a] text-[#ddd] hover:bg-[#444] hover:text-white transition-colors flex items-center gap-1.5"
        >
          <Icons8Icon id="reset_ui" size={12} />
          Reset to Defaults
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {COLOR_CONFIG_SECTIONS.map(section => {
          const fields = COLOR_CONFIG_FIELDS.filter(f => f.section === section.id);
          if (!fields.length) return null;
          const swatches = sectionColors[section.id] || [];

          return (
            <div
              key={section.id}
              className="rounded-xl border border-[#333] bg-gradient-to-br from-[#1c1c22] to-[#141418] overflow-hidden shadow-lg"
            >
              <div className="px-4 py-3 border-b border-[#333] flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-bold text-white">{section.title}</h2>
                  {section.description && (
                    <p className="text-[10px] text-[#777] mt-0.5">{section.description}</p>
                  )}
                </div>
                <div className="flex -space-x-1 shrink-0">
                  {swatches.slice(0, 5).map((c, i) => (
                    <div
                      key={i}
                      className="w-5 h-5 rounded-full border-2 border-[#1c1c22] ring-1 ring-white/10"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
              <div className="p-3 space-y-2">
                {fields.map(field => {
                  const value =
                    field.key === 'colorConfig47'
                      ? migratePluginHeroFill(
                          localConfig.colorConfig47 || field.default,
                          localConfig.colorConfig48,
                          localConfig.colorConfig49,
                        )
                      : localConfig[field.key] || field.default;
                  return (
                    <ColorSettingRow
                      key={field.key}
                      label={field.label}
                      value={value}
                      defaultValue={field.default}
                      previewTextColor={field.previewText}
                      fillMode={field.fillMode || 'any'}
                      minStops={field.minStops || 2}
                      onChange={val => setColor(field.key, val)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
