import React, { useMemo } from 'react';
import { Palette, RotateCcw, Sparkles } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { ColorSettingRow } from './ColorSettingRow';
import { COLOR_CONFIG_SECTIONS, COLOR_CONFIG_FIELDS, getColorConfigDefaults } from '../../data/colorConfigSchema';
import { applySettingsRuntime } from '../../lib/settingsRuntime';

interface ColorsTabContentProps {
  localConfig: Record<string, any>;
  updateLocalConfig: (updates: Record<string, any>) => void;
}

function MiniPreview({ localConfig }: { localConfig: Record<string, any> }) {
  const treeBg = localConfig.colorConfig2 || '#111111';
  const treeText = localConfig.colorConfig1 || '#d4d4d4';
  const listBg = localConfig.colorConfig11 || '#1c1c1c';
  const listText = localConfig.colorConfig10 || '#e0e0e0';
  const selBg = localConfig.colorConfig14 || '#264f78';
  const tabActive = localConfig.colorConfig7 || '#2d2d30';
  const accent = localConfig.colorConfig20 || '#007acc';

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden shadow-2xl shadow-black/40">
      <div className="flex h-[140px] text-[10px]">
        <div className="w-[28%] border-r border-black/30 p-2 space-y-1" style={{ background: treeBg, color: treeText }}>
          <div className="font-semibold opacity-90">Navigation</div>
          <div className="opacity-70">Home</div>
          <div className="opacity-70">This PC</div>
          <div className="rounded px-1" style={{ background: accent, color: '#fff' }}>Documents</div>
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-6 flex items-center px-2 border-b border-black/30 font-semibold" style={{ background: tabActive, color: '#fff' }}>
            Documents
          </div>
          <div className="flex-1 p-2 space-y-0.5" style={{ background: listBg, color: listText }}>
            <div className="opacity-60">report.pdf</div>
            <div className="rounded px-1" style={{ background: selBg, color: '#fff' }}>project-notes.md</div>
            <div className="opacity-60">photos/</div>
          </div>
        </div>
      </div>
      <div className="px-3 py-1.5 text-[9px] text-gray-500 bg-[#0d0d10] border-t border-white/5 flex items-center gap-1.5">
        <Sparkles size={10} className="text-violet-400" />
        Live workspace preview
      </div>
    </div>
  );
}

export default function ColorsTabContent({ localConfig, updateLocalConfig }: ColorsTabContentProps) {
  const defaults = getColorConfigDefaults();

  const setColor = (key: string, val: string) => {
    const next = { ...localConfig, [key]: val, applyColors: true };
    updateLocalConfig({ [key]: val, applyColors: true });
    applySettingsRuntime(next as any);
  };

  const resetDefaults = () => {
    updateLocalConfig({ ...defaults, applyColors: true });
    applySettingsRuntime({ ...localConfig, ...defaults, applyColors: true } as any);
  };

  const sectionColors = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of COLOR_CONFIG_FIELDS) {
      if (!map[field.section]) map[field.section] = [];
      map[field.section].push(localConfig[field.key] || field.default);
    }
    return map;
  }, [localConfig]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-white mb-1 leading-tight flex items-center gap-2">
            <Palette size={20} className="text-violet-400" />
            Colors
          </h1>
          <p className="text-[12px] text-[#a0a0a0] max-w-[480px]">
            Customize every workspace surface. Changes apply instantly when custom colors are enabled — even with an active theme.
          </p>
        </div>
        <MiniPreview localConfig={localConfig} />
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
          <RotateCcw size={12} />
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
              <div className="p-3 space-y-1">
                {fields.map(field => (
                  <ColorSettingRow
                    key={field.key}
                    label={field.label}
                    value={localConfig[field.key] || field.default}
                    defaultValue={field.default}
                    previewTextColor={field.previewText}
                    onChange={val => setColor(field.key, val)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
