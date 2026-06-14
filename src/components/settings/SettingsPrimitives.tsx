import React from 'react';
import type { LucideIcon } from 'lucide-react';

export function SettingsTabHeader({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 pb-5 border-b border-[#333]">
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold text-white mb-1 leading-tight flex items-center gap-2">
          {Icon && <Icon size={20} className="text-sky-400 shrink-0" />}
          {title}
        </h1>
        {description && (
          <p className="text-[12px] text-[#a0a0a0] max-w-[520px] leading-relaxed">{description}</p>
        )}
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
    <section className={`rounded-xl border border-[#333] bg-gradient-to-br from-[#1c1c22] to-[#141418] overflow-hidden shadow-lg mb-5 ${className}`}>
      <div className="px-4 py-3 border-b border-[#333] bg-[#1a1a20]/50">
        <h3 className="text-[13px] font-bold text-white">{title}</h3>
        {description && <p className="text-[10px] text-[#777] mt-0.5">{description}</p>}
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
        className={`bg-[#141418] border border-[#444] text-[#e0e0e0] text-[12px] px-2.5 py-1.5 rounded-lg outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/20 ${className}`}
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
