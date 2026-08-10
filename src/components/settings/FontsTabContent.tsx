import React from 'react';
import { SettingsTabHeader, SettingsSection } from './SettingsPrimitives';
import { Checkbox } from '../ui/checkbox';
import { applySettingsRuntime } from '../../lib/settingsRuntime';
import {
  PANEL_FONT_ZONE_META,
  UI_FONT_PRESET_OPTIONS,
  MONO_FONT_PRESET_OPTIONS,
  type PanelFontZone,
} from '../../lib/panelTypography';
import type { AppConfig } from '../../data/configContext';

type Props = {
  localConfig: AppConfig;
  updateLocalConfig: (patch: Partial<AppConfig>) => void;
};

const FONT_SIZE_OPTIONS = [0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22];
const WEIGHT_OPTIONS = [
  { value: 400, label: 'Regular (400)' },
  { value: 450, label: 'Book (450)' },
  { value: 500, label: 'Medium (500)' },
  { value: 550, label: 'Semibold (550)' },
  { value: 600, label: 'Semibold (600)' },
];

function zoneFamilyKey(zone: PanelFontZone): keyof AppConfig {
  return `${zone}FontFamily` as keyof AppConfig;
}

function zoneSizeKey(zone: PanelFontZone): keyof AppConfig {
  return `${zone}FontSize` as keyof AppConfig;
}

const selectClass =
  'bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] rounded-sm outline-none focus:border-[#0078d4]/45';

export default function FontsTabContent({ localConfig, updateLocalConfig }: Props) {
  const patch = (updates: Partial<AppConfig>) => {
    updateLocalConfig(updates);
    applySettingsRuntime({ ...localConfig, ...updates });
  };

  const baseFamily = localConfig.uiFontFamily || UI_FONT_PRESET_OPTIONS[0]?.value || '';
  const baseSize = localConfig.fontSize ?? 12;
  const baseWeight = localConfig.uiFontWeight ?? 500;
  const monoFamily = localConfig.uiFontFamilyMono || MONO_FONT_PRESET_OPTIONS[0]?.value || '';

  return (
    <div className="p-1">
      <SettingsTabHeader
        title="Fonts"
        description="BNDZ font pack for List, Tree, Tabs, and the top menu bar — plus preview, plugins, and status. Pick a face per region or inherit the global UI font."
      />

      <SettingsSection title="Global UI">
        <div className="space-y-3 max-w-[640px]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">UI font family</span>
            <select
              className={`${selectClass} flex-1 min-w-[200px]`}
              value={baseFamily}
              onChange={e => patch({ uiFontFamily: e.target.value })}
            >
              {UI_FONT_PRESET_OPTIONS.map(o => (
                <option key={o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">UI font weight</span>
            <select
              className={`${selectClass} w-[160px]`}
              value={baseWeight}
              onChange={e => patch({ uiFontWeight: parseInt(e.target.value, 10) })}
            >
              {WEIGHT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">UI font size</span>
            <select
              className={`${selectClass} w-[120px]`}
              value={baseSize}
              onChange={e => patch({ fontSize: parseInt(e.target.value, 10) })}
            >
              {[9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22].map(n => (
                <option key={n} value={n}>{n}px</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">List text AA</span>
            <select
              className={`${selectClass} w-[160px]`}
              value={localConfig.listFontLcdAa === false ? 'greyscale' : 'lcd'}
              onChange={e => patch({ listFontLcdAa: e.target.value !== 'greyscale' })}
            >
              <option value="lcd">LCD (ClearType-like)</option>
              <option value="greyscale">Greyscale</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">Monospace font</span>
            <select
              className={`${selectClass} flex-1 min-w-[200px]`}
              value={monoFamily}
              onChange={e => patch({ uiFontFamilyMono: e.target.value })}
            >
              {MONO_FONT_PRESET_OPTIONS.map(o => (
                <option key={o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Per-panel overrides">
        <p className="text-[11px] text-gray-500 mb-3 max-w-[560px] leading-relaxed">
          Set a custom family or size for each workspace region. Leave family as &ldquo;Inherit&rdquo; or size at &ldquo;Default&rdquo; to use the global UI font.
        </p>
        <div className="space-y-2 max-w-[720px]">
          {PANEL_FONT_ZONE_META.map(zone => {
            const familyKey = zoneFamilyKey(zone.id);
            const sizeKey = zoneSizeKey(zone.id);
            const familyVal = (localConfig[familyKey] as string) || '';
            const sizeVal = (localConfig[sizeKey] as number) || 0;
            return (
              <div
                key={zone.id}
                className="grid grid-cols-1 sm:grid-cols-[minmax(140px,180px)_1fr_100px] gap-2 sm:gap-3 items-center py-2 border-b border-white/[0.05] last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-white/90">{zone.label}</div>
                  <div className="text-[10px] text-white/40 mt-0.5">{zone.description}</div>
                </div>
                <select
                  className={selectClass}
                  value={familyVal}
                  onChange={e => patch({ [familyKey]: e.target.value } as Partial<AppConfig>)}
                >
                  <option value="">Inherit global UI font</option>
                  {UI_FONT_PRESET_OPTIONS.map(o => (
                    <option key={`${zone.id}-${o.label}`} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={sizeVal}
                  onChange={e => patch({ [sizeKey]: parseInt(e.target.value, 10) } as Partial<AppConfig>)}
                >
                  {FONT_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n === 0 ? 'Default' : `${n}px`}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Layout density">
        <div className="space-y-3 max-w-[560px]">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">List row height</span>
            <select
              className={`${selectClass} w-[120px]`}
              value={localConfig.rowHeight ?? 26}
              onChange={e => patch({ rowHeight: parseInt(e.target.value, 10) })}
            >
              {[18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 44].map(n => (
                <option key={n} value={n}>{n}px</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">Corner radius</span>
            <select
              className={`${selectClass} w-[120px]`}
              value={localConfig.uiCornerRadius || 'soft'}
              onChange={e => patch({ uiCornerRadius: e.target.value })}
            >
              <option value="sharp">Sharp</option>
              <option value="soft">Soft</option>
              <option value="round">Round</option>
            </select>
          </div>
          <div className="space-y-2 pt-2 border-t border-[#333]">
            <Checkbox label="Compact toolbar (smaller buttons)" checked={!!localConfig.compactToolbar} onChange={e => patch({ compactToolbar: e.target.checked })} />
            <Checkbox label="Dense menubar" checked={!!localConfig.denseMenubar} onChange={e => patch({ denseMenubar: e.target.checked })} />
            <Checkbox label="Accent borders on panels" checked={!!localConfig.showPanelAccentBorders} onChange={e => patch({ showPanelAccentBorders: e.target.checked })} />
            <Checkbox label="Animate panel transitions" checked={localConfig.animatePanelTransitions !== false} onChange={e => patch({ animatePanelTransitions: e.target.checked })} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Live preview">
        <div
          className="rounded-lg border border-[#333] bg-[#141418] p-4 space-y-3 max-w-[560px]"
          style={{ fontFamily: baseFamily, fontSize: baseSize, fontWeight: baseWeight }}
        >
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Navigation tree</div>
            <div style={{ fontFamily: (localConfig.treeFontFamily as string) || baseFamily, fontSize: (localConfig.treeFontSize as number) || 12 }}>
              Documents · Downloads · Desktop
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">File list</div>
            <div style={{ fontFamily: (localConfig.listFontFamily as string) || baseFamily, fontSize: (localConfig.listFontSize as number) || 12 }}>
              report-2026.pdf · vacation-photos · project-notes.md
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">List tabs</div>
            <div style={{ fontFamily: (localConfig.tabsFontFamily as string) || baseFamily, fontSize: (localConfig.tabsFontSize as number) || (localConfig.tabFontSize as number) || 11 }}>
              Desktop · Downloads · Pictures
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Top menu bar</div>
            <div style={{ fontFamily: (localConfig.chromeFontFamily as string) || baseFamily, fontSize: (localConfig.chromeFontSize as number) || baseSize }}>
              File · Edit · View · Go · Tools
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Preview panel</div>
            <div style={{ fontFamily: (localConfig.previewFontFamily as string) || baseFamily, fontSize: (localConfig.previewFontSize as number) || 12 }}>
              Modified · 2.4 MB · Read-only
            </div>
          </div>
          <div className="bndz-mono text-gray-400" style={{ fontFamily: monoFamily, fontSize: 11 }}>
            C:\Users\preview\Documents\sample.txt
          </div>
        </div>
      </SettingsSection>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-[11px] text-gray-400 block mb-1">
            Interface scale ({localConfig.interfaceScale ?? 100}%)
          </label>
          <input
            type="range"
            min={80}
            max={150}
            step={5}
            className="w-full max-w-md"
            value={localConfig.interfaceScale ?? 100}
            onChange={e => patch({ interfaceScale: parseInt(e.target.value, 10) || 100 })}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            All UI scaling lives here — Ctrl+wheel zoom is disabled in the file manager.
          </p>
        </div>
        <Checkbox
          label="Lock browser zoom (recommended)"
          checked={localConfig.lockBrowserZoom !== false}
          onChange={e => patch({ lockBrowserZoom: e.target.checked })}
        />
      </div>
    </div>
  );
}
