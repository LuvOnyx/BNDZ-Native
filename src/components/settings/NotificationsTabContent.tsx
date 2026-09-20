import React from 'react';
import { SettingsTabHeader, SettingsSection } from './SettingsPrimitives';
import { Checkbox } from '../ui/checkbox';
import type { AppConfig } from '../../data/configContext';

export type WindowsNotifyCategory =
  | 'transfers'
  | 'errors'
  | 'filesystem'
  | 'plugins'
  | 'mesh'
  | 'system'
  | 'progress';

export const DEFAULT_WINDOWS_NOTIFY_CATEGORIES: Record<WindowsNotifyCategory, boolean> = {
  transfers: true,
  errors: true,
  filesystem: true,
  plugins: false,
  mesh: true,
  system: true,
  progress: false,
};

const CATEGORY_ROWS: Array<{ id: WindowsNotifyCategory; label: string; hint: string }> = [
  { id: 'transfers', label: 'Transfers', hint: 'Copy / move / delete completion' },
  { id: 'errors', label: 'Errors', hint: 'Failures and warnings that need attention' },
  { id: 'filesystem', label: 'Filesystem', hint: 'New folder / file and list refresh notices' },
  { id: 'plugins', label: 'Plugins', hint: 'Bottom-plugin and Extension Hub chatter' },
  { id: 'mesh', label: 'Remote', hint: 'SSH, Mesh Drop, and Shell Here status' },
  { id: 'system', label: 'System', hint: 'Startup, tray, and host status' },
  { id: 'progress', label: 'Progress', hint: 'Noisy in-progress ticks (usually leave off)' },
];

type Props = {
  localConfig: AppConfig;
  updateLocalConfig: (patch: Partial<AppConfig>) => void;
};

function catsOf(cfg: AppConfig): Record<WindowsNotifyCategory, boolean> {
  const raw = (cfg.windowsNotificationCategories || {}) as Partial<Record<WindowsNotifyCategory, boolean>>;
  return { ...DEFAULT_WINDOWS_NOTIFY_CATEGORIES, ...raw };
}

export default function NotificationsTabContent({ localConfig, updateLocalConfig }: Props) {
  const delivery = (localConfig.toastDelivery as 'inApp' | 'windows' | 'both')
    || (localConfig.useNativeWindowsNotifications === false ? 'inApp' : 'both');
  const cats = catsOf(localConfig);
  const windowsOn = delivery !== 'inApp' && localConfig.nativeActionCenterToasts !== false;

  return (
    <div className="space-y-5">
      <SettingsTabHeader
        title="Notifications"
        description="In-app physics toasts and Windows Action Center -- independently gated by category."
      />

      <SettingsSection title="Delivery">
        <div className="ml-[10px] space-y-[8px] mb-3">
          {([
            { id: 'inApp' as const, label: 'In-app only', hint: 'Physics toast stack inside BNDZ' },
            { id: 'windows' as const, label: 'Windows only', hint: 'Action Center / Notification Center' },
            { id: 'both' as const, label: 'Both', hint: 'In-app + Action Center' },
          ]).map(opt => (
            <label key={opt.id} className="flex items-start gap-[10px] cursor-pointer py-[2px]">
              <input
                type="radio"
                name="bndzToastDelivery"
                className="mt-[3px] accent-[#0078d4]"
                checked={delivery === opt.id}
                onChange={() => updateLocalConfig({
                  toastDelivery: opt.id,
                  useNativeWindowsNotifications: opt.id !== 'inApp',
                  nativeActionCenterToasts: opt.id !== 'inApp',
                })}
              />
              <span className="text-[12.5px] text-[#d1d5db] leading-snug">
                {opt.label}
                <span className="block text-[11px] text-[#a0a0a0] font-normal mt-[1px]">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="ml-[10px] flex flex-wrap gap-x-5 gap-y-2 pt-2 border-t border-[#333]">
          {([
            { id: 'top-right' as const, label: 'Top right' },
            { id: 'top-left' as const, label: 'Top left' },
            { id: 'bottom-right' as const, label: 'Bottom right' },
            { id: 'bottom-left' as const, label: 'Bottom left' },
          ]).map(opt => (
            <label key={opt.id} className="flex items-center gap-[8px] text-[12.5px] text-[#d1d5db] cursor-pointer">
              <input
                type="radio"
                name="bndzToastPosition"
                className="accent-[#0078d4]"
                checked={(localConfig.toastPosition || 'top-right') === opt.id}
                onChange={() => updateLocalConfig({ toastPosition: opt.id })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Windows Action Center categories">
        <p className="text-[11px] text-[#a0a0a0] ml-[10px] mb-2">
          {windowsOn
            ? 'Only enabled categories mirror to Windows. In-app toasts still respect delivery above.'
            : 'Turn on Windows or Both delivery to mirror these categories to Action Center.'}
        </p>
        <div className={`ml-[10px] space-y-[2px] ${windowsOn ? '' : 'opacity-50 pointer-events-none'}`}>
          {CATEGORY_ROWS.map(row => (
            <Checkbox
              key={row.id}
              disabled={!windowsOn}
              checked={cats[row.id] !== false}
              onChange={e => updateLocalConfig({
                windowsNotificationCategories: {
                  ...cats,
                  [row.id]: e.target.checked,
                },
              })}
              label={(
                <span>
                  {row.label}
                  <span className="block text-[11px] text-[#a0a0a0] font-normal">{row.hint}</span>
                </span>
              )}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Folder size toasts">
        <div className="flex items-center gap-2 py-1 ml-[10px]">
          <span className="text-[12px] text-[#d1d5db] w-[160px]">Cooldown cooldown</span>
          <input
            type="number"
            min={0}
            max={600}
            value={localConfig.folderSizeToastCooldownSeconds ?? 90}
            onChange={e => updateLocalConfig({
              folderSizeToastCooldownSeconds: Math.max(0, parseInt(e.target.value, 10) || 0),
            })}
            className="w-[72px] h-7 bg-[#1e1e1e] border border-[#555] rounded-sm px-2 text-[12px] text-white outline-none"
          />
          <span className="text-[11px] text-[#a0a0a0]">seconds (auto-scan only)</span>
        </div>
        <div className="ml-[10px] mt-1">
          <Checkbox
            checked={localConfig.folderSizeToastOnlyWhenFetched !== false}
            onChange={e => updateLocalConfig({ folderSizeToastOnlyWhenFetched: e.target.checked })}
            label="Only notify when sizes are freshly calculated (not from cache)"
          />
        </div>
      </SettingsSection>
    </div>
  );
}
