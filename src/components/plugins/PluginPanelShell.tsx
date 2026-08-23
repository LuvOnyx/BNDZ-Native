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
  footer?: ReactNode;
  /** When embedded in bottom tab strip, skip duplicate title chrome */
  variant?: 'default' | 'embedded';
  /** When false, body uses overflow-hidden flex fill (canvas plugins). */
  scrollable?: boolean;
}

/** Shared chrome for bottom panel plugins */
export default function PluginPanelShell({
  title,
  icon,
  iconColor = '#0078d4',
  subtitle,
  toolbar,
  children,
  status,
  footer,
  variant = 'default',
  scrollable = true,
}: PluginPanelShellProps) {
  const iconId = typeof icon === 'string' ? icon : 'extension_hub';
  const bodyClass = scrollable
    ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden bndz-scrollbar overscroll-contain'
    : 'flex-1 min-h-0 overflow-hidden flex flex-col';
  if (variant === 'embedded') {
    return (
      <div className="bndz-plugin-tier flex flex-col w-full h-full min-h-0 bg-[var(--panel-bottom-bg,var(--bndz-surface-panel,#0c0e14))] text-[var(--panel-bottom-text,var(--text-main,#e2e8f0))]">
        {toolbar && (
          <div className="bndz-plugin-toolbar shrink-0 px-3 py-2 flex items-center justify-end gap-2">
            {toolbar}
          </div>
        )}
        {status && (
          <div className="shrink-0 px-4 py-2 border-b border-[var(--border-subtle,rgba(255,255,255,0.06))] bndz-panel-muted">{status}</div>
        )}
        <div className={bodyClass}>{children}</div>
        {footer && (
          <div className="bndz-plugin-footer shrink-0 px-3 py-2 border-t border-[var(--border-subtle,rgba(255,255,255,0.06))] flex items-center gap-2 bg-[color-mix(in_srgb,var(--panel-bottom-bg,#0c0e14)_92%,#000_8%)]">
            {footer}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bndz-plugin-tier flex flex-col w-full h-full min-h-0 bg-[var(--panel-bottom-bg,var(--bndz-surface-panel,#0c0e14))] text-[var(--panel-bottom-text,var(--text-main,#e2e8f0))]">
      <div className="bndz-plugin-toolbar shrink-0 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icons8Icon id={iconId} size={16} className="shrink-0" style={{ color: iconColor } as React.CSSProperties} />
            <span className="font-semibold text-sm tracking-tight">{title}</span>
          </div>
          {subtitle && <p className="bndz-panel-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex items-center gap-2 shrink-0">{toolbar}</div>}
      </div>
      {status && (
        <div className="shrink-0 px-4 py-2 border-b border-[var(--border-subtle,rgba(255,255,255,0.06))] bndz-panel-muted">{status}</div>
      )}
      <div className={bodyClass}>{children}</div>
      {footer && (
        <div className="bndz-plugin-footer shrink-0 px-4 py-2 border-t border-[var(--border-subtle,rgba(255,255,255,0.06))] flex items-center gap-2 bg-[color-mix(in_srgb,var(--panel-bottom-bg,#0c0e14)_92%,#000_8%)]">
          {footer}
        </div>
      )}
    </div>
  );
}
