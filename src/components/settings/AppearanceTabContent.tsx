import React from 'react';
import { SettingsTabHeader, SettingsSection } from './SettingsPrimitives';
import {
  SELECTION_STYLE_OPTIONS,
  SURFACE_STYLE_OPTIONS,
  CORNER_RADIUS_OPTIONS,
  DENSITY_OPTIONS,
  TAB_STYLE_OPTIONS,
  CHROME_PALETTE_OPTIONS,
  GRID_SELECTION_OPTIONS,
  NAV_TREE_COLOR_OPTIONS,
  type SelectionStyle,
  type SurfaceStyle,
  type CornerRadius,
  type DensityStyle,
  type TabStyle,
  type ChromePalette,
  type GridSelectionStyle,
  type NavTreeColorMode,
} from '../../lib/appearanceVariants';
import { SIZE_BAR_STYLE_OPTIONS, type SizeBarStyle, SizeBar } from '../SizeBar';
import { applySettingsRuntime } from '../../lib/settingsRuntime';
import type { AppConfig } from '../../data/configContext';

type Props = {
  localConfig: AppConfig;
  updateLocalConfig: (patch: Partial<AppConfig>) => void;
};

function VariantSelect<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: { id: T; label: string; hint: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-2 border-b border-white/[0.06] last:border-0">
      <div className="sm:w-[160px] shrink-0">
        <div className="text-[12px] font-medium text-white/90">{label}</div>
        {description && <div className="text-[10px] text-white/40 mt-0.5 leading-snug">{description}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <select
          className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
          value={value}
          onChange={e => onChange(e.target.value as T)}
        >
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label} — {o.hint}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function AppearanceTabContent({ localConfig, updateLocalConfig }: Props) {
  const patch = (updates: Partial<AppConfig>) => {
    updateLocalConfig(updates);
    applySettingsRuntime({ ...localConfig, ...updates });
  };

  return (
    <div className="p-1">
      <SettingsTabHeader
        title="Appearance"
        description="Global UI variants — selection chrome, surfaces, density. Inspired by XYplorer / FilePilot (file manager) and Raycast (launcher)."
      />

      <SettingsSection title="Selection & focus">
        <label className="flex items-center gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4]"
            checked={localConfig.listShowSelectionHighlight !== false}
            onChange={e => patch({ listShowSelectionHighlight: e.target.checked })}
          />
          <span className="text-[12px] text-white/90">Show list selection highlight</span>
        </label>
        <label className="flex items-center gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4]"
            checked={!!localConfig.listShowSelectionCheckboxes}
            onChange={e => patch({ listShowSelectionCheckboxes: e.target.checked })}
          />
          <span className="text-[12px] text-white/90">Show item checkboxes in details view</span>
        </label>
        <label className="flex items-center gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4]"
            checked={localConfig.stickyGroupHeaders !== false}
            onChange={e => patch({ stickyGroupHeaders: e.target.checked })}
          />
          <span className="text-[12px] text-white/90">Sticky type group headers while scrolling</span>
        </label>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">Highlight color</div>
            <div className="text-[10px] text-white/40 mt-0.5">Overrides theme when set</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={localConfig.listSelectionHighlightColor || '#264f78'}
              onChange={e => patch({ listSelectionHighlightColor: e.target.value })}
              className="w-9 h-8 rounded border border-white/10 bg-transparent cursor-pointer"
            />
            <button
              type="button"
              className="text-[11px] text-white/50 hover:text-white/80 px-2 py-1 rounded border border-white/10"
              onClick={() => patch({ listSelectionHighlightColor: undefined })}
            >
              Use theme default
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4]"
            checked={localConfig.showQuickActionsBar === true}
            onChange={e => patch({ showQuickActionsBar: e.target.checked })}
          />
          <span className="text-[12px] text-white/90">Show selection quick actions bar</span>
        </label>
        <VariantSelect<SelectionStyle>
          label="List selection"
          description="How selected rows look in details/list views"
          value={localConfig.appearanceSelectionStyle || 'inset'}
          options={SELECTION_STYLE_OPTIONS}
          onChange={v => patch({ appearanceSelectionStyle: v })}
        />
        <VariantSelect<GridSelectionStyle>
          label="Grid selection"
          description="How selected tiles look in grid / icon views"
          value={localConfig.appearanceGridSelection || 'subtle'}
          options={GRID_SELECTION_OPTIONS}
          onChange={v => patch({ appearanceGridSelection: v })}
        />
      </SettingsSection>

      <SettingsSection title="Surfaces & chrome">
        <VariantSelect<ChromePalette>
          label="Workspace palette"
          description="Base background family (escapes brown/black slop)"
          value={localConfig.appearanceChromePalette || 'cool'}
          options={CHROME_PALETTE_OPTIONS}
          onChange={v => patch({ appearanceChromePalette: v })}
        />
        <VariantSelect<SurfaceStyle>
          label="Panel surfaces"
          description="Sidebar, menus, preview docks"
          value={localConfig.appearanceSurfaceStyle || 'flat'}
          options={SURFACE_STYLE_OPTIONS}
          onChange={v => patch({ appearanceSurfaceStyle: v })}
        />
        <VariantSelect<CornerRadius>
          label="Corner radius"
          description="Rectangle-rounded — not pills"
          value={localConfig.appearanceCornerRadius || 'rounded'}
          options={CORNER_RADIUS_OPTIONS}
          onChange={v => patch({ appearanceCornerRadius: v })}
        />
      </SettingsSection>

      <SettingsSection title="Layout density">
        <VariantSelect<DensityStyle>
          label="Density"
          description="Row height in lists and navigation tree"
          value={localConfig.appearanceDensity || 'comfortable'}
          options={DENSITY_OPTIONS}
          onChange={v => patch({ appearanceDensity: v, rowHeight: undefined })}
        />
        <VariantSelect<TabStyle>
          label="Tab strip"
          description="Tab bar visual style"
          value={localConfig.appearanceTabStyle || 'underline'}
          options={TAB_STYLE_OPTIONS}
          onChange={v => patch({ appearanceTabStyle: v })}
        />
      </SettingsSection>

      <SettingsSection title="Navigation & size bars">
        <VariantSelect<NavTreeColorMode>
          label="Sidebar section colors"
          description="Gradient accents on Drives, Rapid access, Tree headers"
          value={localConfig.appearanceNavTreeColors || 'subtle'}
          options={NAV_TREE_COLOR_OPTIONS}
          onChange={v => patch({ appearanceNavTreeColors: v })}
        />
        <VariantSelect<SizeBarStyle>
          label="Folder size bars"
          description="Size column & folder-size view indicators"
          value={localConfig.folderSizeBarStyle || 'bar'}
          options={SIZE_BAR_STYLE_OPTIONS}
          onChange={v => patch({ folderSizeBarStyle: v })}
        />
        <div className="py-3 flex items-center gap-4">
          <span className="text-[11px] text-white/50 w-[100px] shrink-0">Preview</span>
          <div className="flex flex-col gap-2">
            <SizeBar percent={72} style={(localConfig.folderSizeBarStyle || 'bar') as SizeBarStyle} widthClass="w-24" />
            <SizeBar percent={45} isDir={false} style={(localConfig.folderSizeBarStyle || 'bar') as SizeBarStyle} widthClass="w-24" />
          </div>
        </div>
      </SettingsSection>

      <p className="text-[10px] text-white/35 mt-4 leading-relaxed max-w-xl">
        Changes preview live when you adjust dropdowns. Click OK or Apply to persist.
        Custom colors from the Colors tab still override list selection fill when &quot;Apply colors&quot; is enabled.
      </p>
    </div>
  );
}
