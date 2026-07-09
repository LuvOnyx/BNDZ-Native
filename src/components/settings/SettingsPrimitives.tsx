import React from 'react';
import { Icons8Icon } from '../Icons8Icon';

export function SettingsTabHeader({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  /** Icons8 asset id (see toolbarLauncherIcons.ts). */
  icon?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bndz-settings-page-header flex items-start justify-between gap-4 mb-5 pb-4 border-b border-[#333]">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <div className="bndz-settings-page-icon shrink-0 mt-0.5">
            <Icons8Icon id={icon} size={16} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold text-white tracking-tight leading-tight">{title}</h1>
          {description && (
            <p className="text-[12px] text-[#9ca3af] mt-1 max-w-[520px] leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bndz-settings-section ${className}`}>
      <div className="bndz-settings-section-header">
        <h3 className="text-[13px] font-semibold text-white tracking-tight">{title}</h3>
        {description && <p className="bndz-panel-muted mt-0.5 text-[11px]">{description}</p>}
      </div>
      <div className="p-4 space-y-[6px]">{children}</div>
    </section>
  );
}

export function SettingsHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-[#888] mb-5 p-3 border border-[#333] rounded-lg bg-[#151518] leading-relaxed">
      {children}
    </p>
  );
}

export function SettingsSelectRow({
  label,
  value,
  onChange,
  options,
  className = 'w-[360px]',
}: {
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className="flex items-center gap-4 py-1">
      <span className="text-[12px] text-[#e0e0e0] w-[140px] shrink-0">{label}</span>
      <select
        className={`bndz-native-input text-[12px] px-2.5 py-1.5 ${className}`}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
