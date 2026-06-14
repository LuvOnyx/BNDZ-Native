import React from 'react';
import { Check, Sparkles, Palette } from 'lucide-react';
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
      className={`bndz-theme-card group relative text-left rounded-2xl overflow-hidden border transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#0ea5e9)]/60 ${
        active
          ? 'bndz-theme-card-active border-[var(--accent,#38bdf8)] shadow-[0_0_32px_color-mix(in_srgb,var(--accent,#38bdf8)_28%,transparent)] scale-[1.02]'
          : 'border-white/10 hover:border-white/25 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-0.5'
      }`}
    >
      <div className="h-[108px] relative overflow-hidden" style={{ background: preset.bg }}>
        <div
          className="absolute inset-0 opacity-50"
          style={{ background: `radial-gradient(ellipse at 85% 15%, ${preset.accent}66 0%, transparent 58%)` }}
        />
        <div
          className="absolute inset-0 opacity-25"
          style={{ background: `linear-gradient(135deg, transparent 40%, ${preset.accent}33 100%)` }}
        />
        <div className="absolute top-2.5 left-2.5 right-2.5 flex gap-2">
          <div
            className="h-5 flex-1 rounded-lg opacity-95 shadow-sm"
            style={{ background: surface, border: `1px solid ${preset.accent}22` }}
          />
          <div className="w-9 h-5 rounded-lg shadow-sm" style={{ background: preset.accent }} />
        </div>
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex gap-2">
          <div
            className="w-[36%] h-[52px] rounded-xl shadow-inner"
            style={{ background: surface, border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}` }}
          />
          <div
            className="flex-1 h-[52px] rounded-xl p-2 flex flex-col gap-1.5 shadow-inner"
            style={{ background: surface, border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}` }}
          >
            <div className="h-1.5 rounded-full w-full" style={{ background: preset.accent }} />
            <div className="h-1.5 rounded-full w-4/5 opacity-45" style={{ background: preset.text }} />
            <div className="h-1.5 rounded-full w-3/5 opacity-30" style={{ background: preset.text }} />
          </div>
        </div>
        {active && (
          <div
            className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
            style={{ background: preset.accent }}
          >
            <Check size={15} className="text-white" strokeWidth={3} />
          </div>
        )}
      </div>
      <div
        className={`px-3.5 py-3 flex items-center justify-between gap-2 backdrop-blur-sm ${
          isLight ? 'bg-white/96' : 'bg-[#121218]/96'
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
        <div className="hidden lg:flex items-center gap-2 text-[11px] text-sky-300/90 bg-sky-500/10 border border-sky-500/25 rounded-xl px-3.5 py-2.5 shadow-sm">
          <Sparkles size={14} />
          <span>Live preview on click</span>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="bndz-themes-section-title mb-4">
          <Palette size={14} className="text-sky-400" />
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
          <Sparkles size={14} className="text-fuchsia-400" />
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
