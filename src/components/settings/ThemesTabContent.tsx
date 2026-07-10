import React from 'react';
import { Icons8Icon } from '../Icons8Icon';
import {
  IMPORTED_THEMES,
  AESTHETIC_THEMES,
  ThemePreset,
  applyThemeCssVars,
  themeSurfaceColor,
  themeToColorConfig,
} from '../../data/themePresets';

interface ThemesTabContentProps {
  activeTheme?: string;
  onSelectTheme: (updates: Record<string, any>) => void;
}

function ThemeCard({ preset, active, onClick }: { preset: ThemePreset; active: boolean; onClick: () => void }) {
  const surface = themeSurfaceColor(preset.surface);
  const isLight = preset.text === '#000000' || preset.text === '#1d1d1f' || preset.name.toLowerCase().includes('light');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`bndz-theme-card group relative text-left overflow-hidden border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#0078d4)]/60 ${
        active
          ? 'bndz-theme-card-active border-[var(--accent,#0078d4)]'
          : 'border-[#454545] hover:border-[#666] hover:bg-[#2a2a2a]'
      }`}
    >
      <div className="h-[108px] relative overflow-hidden" style={{ background: preset.bg }}>
        <div className="absolute top-2.5 left-2.5 right-2.5 flex gap-2">
          <div
            className="h-5 flex-1 opacity-95"
            style={{ background: surface, border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : '#454545'}` }}
          />
          <div className="w-9 h-5" style={{ background: preset.accent }} />
        </div>
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex gap-2">
          <div
            className="w-[36%] h-[52px]"
            style={{ background: surface, border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : '#454545'}` }}
          />
          <div
            className="flex-1 h-[52px] p-2 flex flex-col gap-1.5"
            style={{ background: surface, border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : '#454545'}` }}
          >
            <div className="h-1.5 w-full" style={{ background: preset.accent }} />
            <div className="h-1.5 w-4/5 opacity-45" style={{ background: preset.text }} />
            <div className="h-1.5 w-3/5 opacity-30" style={{ background: preset.text }} />
          </div>
        </div>
        {active && (
          <div
            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center border border-[#454545]"
            style={{ background: preset.accent }}
          >
            <Icons8Icon id="check" size={13} />
          </div>
        )}
      </div>
      <div
        className={`px-3.5 py-3 flex items-center justify-between gap-2 ${
          isLight ? 'bg-white/96' : 'bg-[#2b2b2b]'
        }`}
      >
        <div className="min-w-0">
          <div className="text-[13px] font-bold truncate" style={{ color: preset.text }}>{preset.name}</div>
          <div className="text-[10px] opacity-55 mt-0.5 truncate" style={{ color: preset.text }}>
            {preset.category === 'aesthetic' ? 'Curated palette' : 'Classic workspace'}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {[preset.bg, surface, preset.accent, preset.text].map((c, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full ring-1 ring-white/15 shadow-sm"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>
    </button>
  );
}

export default function ThemesTabContent({ activeTheme, onSelectTheme }: ThemesTabContentProps) {
  const select = (preset: ThemePreset) => {
    applyThemeCssVars(preset);
    onSelectTheme(themeToColorConfig(preset));
  };

  return (
    <div className="bndz-themes-tab">
      <div className="flex items-start justify-between gap-4 mb-7">
        <div>
          <h1 className="text-[22px] font-bold text-white mb-1.5 leading-tight tracking-tight">Themes</h1>
          <p className="text-[12px] text-[#a8a8b0] max-w-[540px] leading-relaxed">
            Pick a complete workspace look — sidebar, toolbar, panels, and context menus update together.
            Fine-tune any color afterward in the <strong className="text-violet-300/90 font-semibold">Colors</strong> tab.
          </p>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-[11px] text-[#99c9f0] bg-[#094771]/25 border border-[#0078d4]/30 px-3.5 py-2.5">
          <Icons8Icon id="sparkles_ui" size={14} />
          <span>Live preview on click</span>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="bndz-themes-section-title mb-4">
          <Icons8Icon id="palette_ui" size={14} />
          Imported Themes
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {IMPORTED_THEMES.map(preset => (
            <ThemeCard
              key={preset.name}
              preset={preset}
              active={activeTheme === preset.name}
              onClick={() => select(preset)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="bndz-themes-section-title mb-4">
          <Icons8Icon id="sparkles_ui" size={14} />
          Aesthetic Presets
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {AESTHETIC_THEMES.map(preset => (
            <ThemeCard
              key={preset.name}
              preset={preset}
              active={activeTheme === preset.name}
              onClick={() => select(preset)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
