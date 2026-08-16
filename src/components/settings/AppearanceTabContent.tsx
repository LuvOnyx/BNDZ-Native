import React from 'react';
import { SettingsTabHeader, SettingsSection } from './SettingsPrimitives';
import {
  migrateLayoutV39,
  migrateLayoutV40,
  migrateLayoutV43,
} from '../../lib/workspaceLayout';
import {
  SELECTION_STYLE_OPTIONS,
  SURFACE_STYLE_OPTIONS,
  CORNER_RADIUS_OPTIONS,
  DENSITY_OPTIONS,
  TAB_STYLE_OPTIONS,
  CHROME_PALETTE_OPTIONS,
  GRID_SELECTION_OPTIONS,
  NAV_TREE_COLOR_OPTIONS,
  visualLabelFromTabStyle,
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

const FONT_SIZE_OPTIONS = [0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22];
const ROW_HEIGHT_OPTIONS = [0, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 44, 48];
const ICON_SIZE_OPTIONS = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];
const GRID_ICON_SIZE_OPTIONS = [24, 32, 40, 48, 64, 80, 96, 120, 144, 160, 192, 224, 256];

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
              value={localConfig.listSelectionHighlightColor || '#a855f7'}
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">Selection highlight</div>
            <div className="text-[10px] text-white/40 mt-0.5">How far the selection fill paints</div>
          </div>
          <select
            className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] rounded-sm outline-none min-w-[220px]"
            value={localConfig.listSelectionChrome || 'fullRow'}
            onChange={e => patch({ listSelectionChrome: e.target.value as 'fullRow' | 'nameOnly' | 'throughSecondColumn' })}
          >
            <option value="fullRow">Full row</option>
            <option value="nameOnly">Name only</option>
            <option value="throughSecondColumn">Through second column</option>
          </select>
        </div>
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
        <label className="flex items-start gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4] mt-0.5"
            checked={localConfig.micaBackdrop !== false}
            onChange={e => patch({ micaBackdrop: e.target.checked })}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Mica / Fluent backdrop
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              On (default): Windows Mica material behind the shell chrome. Off: solid native fill.
            </span>
          </span>
        </label>
        <VariantSelect<'mica' | 'micaAlt' | 'acrylic'>
          label="Backdrop material"
          description="Fluent system backdrop when Mica is enabled"
          value={(localConfig.systemBackdropKind as 'mica' | 'micaAlt' | 'acrylic') || 'mica'}
          options={[
            { id: 'mica', label: 'Mica', hint: 'Standard Windows 11 material' },
            { id: 'micaAlt', label: 'Mica Alt', hint: 'BaseAlt — stronger tint' },
            { id: 'acrylic', label: 'Acrylic', hint: 'Desktop Acrylic / Fluent blur' },
          ]}
          onChange={v => patch({ systemBackdropKind: v, micaBackdrop: true })}
        />
        <label className="flex items-start gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4] mt-0.5"
            checked={localConfig.nativeActionCenterToasts !== false}
            onChange={e => patch({ nativeActionCenterToasts: e.target.checked })}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Windows Notification Center toasts
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              Mirror important alerts into Action Center via AppNotificationBuilder (in-app toasts stay).
            </span>
          </span>
        </label>
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

      <SettingsSection title="Workspace layout">
        <label className="flex items-start gap-2 py-2 border-b border-white/[0.06] cursor-pointer">
          <input
            type="checkbox"
            className="accent-[#0078d4] mt-0.5"
            checked={localConfig.previewDockedInWorkspace === true}
            onChange={e => {
              const docked = e.target.checked;
              const migrated = docked
                ? migrateLayoutV39(
                  localConfig.workspaceLayoutOuter as Record<string, number>,
                  localConfig.workspaceLayoutMainRow as Record<string, number>,
                )
                : migrateLayoutV43(
                  localConfig.workspaceLayoutOuter as Record<string, number>,
                  localConfig.workspaceLayoutMainRow as Record<string, number>,
                  false,
                );
              patch({
                previewDockedInWorkspace: docked,
                workspaceLayoutOuter: migrated.outer,
                workspaceLayoutMainRow: migrated.mainRow,
              });
            }}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Dock preview above bottom plugin panel
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              Off (default): classic layout — preview is full-height on the right; bottom plugins span only under the file list.
              On: preview shares the list row and sits above the plugin dock.
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection title="List & Grid cards">
        <label className="flex items-start gap-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 accent-[#0078d4]"
            checked={localConfig.showListGridCards === true}
            onChange={e => patch({ showListGridCards: e.target.checked })}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Show cards on List &amp; Grid
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              Off (default): icons and names only — like File Explorer. On: mica/glass tiles; Grid auto-sizes so captions fit.
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsSection title="Typography (list & tree)">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">List font size</div>
            <div className="text-[10px] text-white/40 mt-0.5">Details / list view text</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.listFontSize ?? 0}
            onChange={e => patch({ listFontSize: parseInt(e.target.value, 10) })}
          >
            {FONT_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n === 0 ? 'Default (zone preset)' : `${n}px`}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">Tree font size</div>
            <div className="text-[10px] text-white/40 mt-0.5">Sidebar tree, Rapid access, Cloud</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.treeFontSize ?? 0}
            onChange={e => patch({ treeFontSize: parseInt(e.target.value, 10) })}
          >
            {FONT_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n === 0 ? 'Default (zone preset)' : `${n}px`}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">List row height</div>
            <div className="text-[10px] text-white/40 mt-0.5">Overrides density when set</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.rowHeight ?? 0}
            onChange={e => patch({ rowHeight: parseInt(e.target.value, 10) })}
          >
            {ROW_HEIGHT_OPTIONS.map(n => (
              <option key={n} value={n}>{n === 0 ? 'From density preset' : `${n}px`}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">Details icon size</div>
            <div className="text-[10px] text-white/40 mt-0.5">Icon column in details view</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.detailsIconSize ?? 16}
            onChange={e => patch({ detailsIconSize: parseInt(e.target.value, 10) })}
          >
            {ICON_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}px</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">List icon size</div>
            <div className="text-[10px] text-white/40 mt-0.5">Multi-column list view</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.listIconSize ?? 14}
            onChange={e => patch({ listIconSize: parseInt(e.target.value, 10) })}
          >
            {ICON_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}px</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 py-2 border-b border-white/[0.06]">
          <div className="sm:w-[160px] shrink-0">
            <div className="text-[12px] font-medium text-white/90">Grid icon size</div>
            <div className="text-[10px] text-white/40 mt-0.5">Tiles; large values fetch jumbo shell icons</div>
          </div>
          <select
            className="w-full max-w-md bg-[#1a1d26] border border-white/10 text-[12px] text-white/90 px-2.5 py-1.5 rounded-md outline-none focus:border-[#0078d4]/45"
            value={localConfig.gridIconSize ?? 48}
            onChange={e => patch({ gridIconSize: parseInt(e.target.value, 10) })}
          >
            {GRID_ICON_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>{n}px</option>
            ))}
          </select>
        </div>
      </SettingsSection>

      <SettingsSection title="Layout density">
        <VariantSelect<DensityStyle>
          label="Density"
          description="Row height in lists and navigation tree"
          value={localConfig.appearanceDensity || 'comfortable'}
          options={DENSITY_OPTIONS}
          onChange={v => patch({ appearanceDensity: v, rowHeight: undefined })}
        />
        <label className="flex items-start gap-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={localConfig.adaptiveListDensity !== false}
            onChange={e => patch({ adaptiveListDensity: e.target.checked })}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Adaptive list density
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              Slightly expands row spacing when items are focused. Row size no longer changes mid-scroll (that caused flash).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!localConfig.liveShareCursorEnabled}
            onChange={e => patch({ liveShareCursorEnabled: e.target.checked })}
          />
          <span className="text-[12px] text-white/90 leading-snug">
            Live Share cursor
            <span className="block text-[10px] text-white/40 mt-0.5 font-normal">
              Broadcast selection and cursor in shared folders so mesh peers see your focus (Remote Mesh plugin).
            </span>
          </span>
        </label>
        <VariantSelect<TabStyle>
          label="Tab strip"
          description="Classic Explorer vs Soft Modern, plus accent variants"
          value={(localConfig.appearanceTabStyle as TabStyle) || 'explorer'}
          options={TAB_STYLE_OPTIONS}
          onChange={v => patch({ appearanceTabStyle: v, visualStyleTabs: visualLabelFromTabStyle(v) })}
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
