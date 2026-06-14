import React, { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface PluginPanelShellProps {
  title: string;
  icon: LucideIcon;
  iconColor?: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
}

/** Shared chrome for bottom panel plugins */
export default function PluginPanelShell({
  title,
  icon: Icon,
  iconColor = '#38bdf8',
  subtitle,
  toolbar,
  children,
  status,
}: PluginPanelShellProps) {
  return (
    <div className="flex flex-col w-full h-full min-h-0 bg-[#0a0a0a] text-gray-300">
      <div className="shrink-0 px-4 py-2.5 border-b border-[#222] bg-gradient-to-r from-[#141414] to-[#0f0f0f] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={15} style={{ color: iconColor }} />
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
