import React, { useEffect, useState } from 'react';
import { Rocket, Palette, Keyboard, RefreshCw, ExternalLink } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import { SettingsTabHeader, SettingsSection, SettingsHint } from './SettingsPrimitives';

const HOTKEY_PRESETS = [
  'Alt + Space',
  'Ctrl + Alt + Space',
  'Win + Space',
  'Ctrl + Shift + Space',
  'Alt + Z',
];

interface LauncherTabContentProps {
  localConfig: Record<string, any>;
  updateLocalConfig: (updates: Record<string, any>) => void;
}

export default function LauncherTabContent({ localConfig, updateLocalConfig }: LauncherTabContentProps) {
  const [launcherState, setLauncherState] = useState<{ installed?: boolean; running?: boolean } | null>(null);

  useEffect(() => {
    import('../../lib/ipcBridge').then(({ IPC }) => {
      if (!IPC.isNative) return;
      IPC.getLauncherState().then(setLauncherState).catch(() => {});
    });
  }, []);

  const openLauncher = () => {
    import('../../lib/ipcBridge').then(({ IPC }) => IPC.showLauncher());
  };

  const restartLauncher = () => {
    import('../../lib/ipcBridge').then(({ IPC }) => {
      IPC.syncLauncherSettings(localConfig).then(() => {
        IPC.getLauncherState().then(setLauncherState).catch(() => {});
      });
    });
  };

  const hotkey = localConfig.launcherHotkey || 'Alt + Space';

  return (
    <div>
      <SettingsTabHeader
        title="BNDZ Launcher"
        description="Your quick-launch command palette — plugins, search, and instant file-manager access. Configured here as part of BNDZ, not a separate app."
        icon={Rocket}
      >
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border ${
              launcherState?.running
                ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                : launcherState?.installed === false
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : 'text-[#888] border-[#444] bg-[#1a1a1a]'
            }`}
          >
            {launcherState?.running ? 'Running' : launcherState?.installed === false ? 'Not installed' : 'Stopped'}
          </span>
        </div>
      </SettingsTabHeader>

      <SettingsSection title="Integration" description="How the launcher works with BNDZ">
        <Checkbox
          label={<span>Start BNDZ Launcher with file manager</span>}
          checked={localConfig.launcherEnabled !== false}
          onChange={e => updateLocalConfig({ launcherEnabled: e.target.checked })}
        />
        <Checkbox
          label={<span>Exit launcher when exiting BNDZ</span>}
          checked={localConfig.launcherExitWithBndz !== false}
          onChange={e => updateLocalConfig({ launcherExitWithBndz: e.target.checked })}
        />
        <Checkbox
          label={<span>Hide launcher tray icon — use BNDZ tray only</span>}
          checked={localConfig.launcherHideTrayIcon !== false}
          onChange={e => updateLocalConfig({ launcherHideTrayIcon: e.target.checked })}
        />
        <SettingsHint>
          When bundled with BNDZ, launcher settings are stored in <code className="text-violet-300">BNDZLauncher/UserData</code> beside the install — not in a separate Flow Launcher profile.
        </SettingsHint>
      </SettingsSection>

      <SettingsSection title="Activation hotkey" description="Global shortcut to open the launcher from anywhere">
        <div className="flex flex-wrap gap-2 mb-3">
          {HOTKEY_PRESETS.map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => updateLocalConfig({ launcherHotkey: preset })}
              className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${
                hotkey === preset
                  ? 'border-violet-400/60 bg-violet-500/15 text-violet-200'
                  : 'border-[#444] bg-[#1a1a1a] text-[#ccc] hover:border-[#666]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Keyboard size={14} className="text-violet-400 shrink-0" />
          <input
            type="text"
            value={hotkey}
            onChange={e => updateLocalConfig({ launcherHotkey: e.target.value })}
            className="flex-1 h-8 bg-[#111] border border-[#555] text-white text-[12px] px-2 rounded outline-none focus:border-violet-500/60"
            placeholder="Alt + Space"
          />
        </div>
        <p className="text-[10px] text-[#777] mt-2">
          Changes apply after saving settings. The launcher restarts automatically to register the new hotkey.
        </p>
      </SettingsSection>

      <SettingsSection title="Appearance" description="Keep the launcher visually in sync with BNDZ">
        <Checkbox
          label={<span>Match file manager theme in launcher</span>}
          checked={localConfig.launcherSyncTheme !== false}
          onChange={e => updateLocalConfig({ launcherSyncTheme: e.target.checked })}
        />
        <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-[#151518] border border-[#333]">
          <Palette size={14} className="text-sky-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-[#999] leading-relaxed">
            When <strong className="text-[#ccc]">Apply custom colors</strong> is on (Colors tab), BNDZ generates a synced launcher theme from your palette.
            Otherwise, workspace theme names are mapped to matching Flow themes (e.g. Nord → Nord Darker, Dark → Darker).
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Actions">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openLauncher}
            className="flex items-center gap-2 text-[12px] px-4 py-2 rounded-lg border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 transition-colors"
          >
            <ExternalLink size={14} />
            Open launcher now
          </button>
          <button
            type="button"
            onClick={restartLauncher}
            className="flex items-center gap-2 text-[12px] px-4 py-2 rounded-lg border border-[#555] bg-[#1a1a1a] text-[#ddd] hover:bg-[#2a2a2a] transition-colors"
          >
            <RefreshCw size={14} />
            Apply &amp; restart launcher
          </button>
        </div>
        <p className="text-[10px] text-[#666] mt-3">
          Type <strong className="text-[#999]">bndz</strong> in the launcher to focus the file manager, or <strong className="text-[#999]">bndz C:\path</strong> to open a folder.
          Advanced plugin and search settings: open launcher → type <strong className="text-[#999]">settings</strong>.
        </p>
      </SettingsSection>
    </div>
  );
}
