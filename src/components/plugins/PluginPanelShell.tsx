import React, { ReactNode } from 'react';
import { Icons8Icon } from '../Icons8Icon';

interface PluginPanelShellProps {
  title: string;
  /** Icons8 asset id from toolbarLauncherIcons.ts. */
  icon: string;
  iconColor?: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  /** When embedded in bottom tab strip, skip duplicate title chrome */
  variant?: 'default' | 'embedded';
}

/** Shared chrome for bottom panel plugins */
export default function PluginPanelShell({
  title,
  icon,
  iconColor = '#38bdf8',
  subtitle,
  toolbar,
  children,
  status,
  variant = 'default',
}: PluginPanelShellProps) {
  if (variant === 'embedded') {
    return (
      <div className="bndz-plugin-tier flex flex-col w-full h-full min-h-0 bg-[var(--bndz-surface-panel,#0a0a0a)] text-gray-300">
        {toolbar && (
          <div className="shrink-0 px-3 py-1.5 border-b border-white/[0.06] flex items-center justify-end gap-2 bg-[#0d0d10]/90">
            {toolbar}
          </div>
        )}
        {status && <div className="shrink-0 px-4 py-1.5 border-b border-[#1a1a1a] text-xs">{status}</div>}
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="bndz-plugin-tier flex flex-col w-full h-full min-h-0 bg-[#0a0a0a] text-gray-300">
      <div className="shrink-0 px-4 py-2.5 border-b border-[#222] bg-gradient-to-r from-[#141414] to-[#0f0f0f] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icons8Icon id={icon} size={15} />
            <span className="font-bold text-sm text-white tracking-tight">{title}</span>
          </div>
          {subtitle && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex items-center gap-2 shrink-0">{toolbar}</div>}
      </div>
      {status && <div className="shrink-0 px-4 py-1.5 border-b border-[#1a1a1a] text-xs">{status}</div>}
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
