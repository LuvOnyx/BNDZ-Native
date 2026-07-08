import React, { ReactNode } from 'react';
import { Icons8Icon } from '../Icons8Icon';

/** Compact toolbar control for bottom plugin panels */
export function PluginToolbarButton({
  children,
  onClick,
  disabled,
  active,
  title,
  icon,
}: {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
  icon?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`bndz-plugin-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        active
          ? 'bg-sky-600/20 border-sky-500/35 text-sky-300'
          : 'bg-white/[0.03] border-white/10 text-gray-300 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {icon && <Icons8Icon id={icon} size={12} />}
      {children}
    </button>
  );
}

export function PluginTabStrip({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bndz-plugin-tabstrip shrink-0 flex border-b border-white/[0.06] ${className}`}>
      {children}
    </div>
  );
}

export function PluginTab({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bndz-plugin-tab ${active ? 'bndz-plugin-tab-active' : ''}`}
    >
      {children}
    </button>
  );
}

export function PluginSectionTitle({
  children,
  icon,
  action,
}: {
  children: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="bndz-plugin-section-title flex items-center gap-1.5 min-w-0">
        {icon && <Icons8Icon id={icon} size={13} className="shrink-0 opacity-80" />}
        <span className="truncate">{children}</span>
      </div>
      {action}
    </div>
  );
}

export function PluginCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bndz-plugin-card ${className}`}>
      {children}
    </div>
  );
}

export function PluginFieldGrid({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bndz-plugin-field-grid ${className}`}>
      {children}
    </div>
  );
}

export function PluginFieldRow({
  label,
  children,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <div className="bndz-plugin-field-label">{label}</div>
      <div className={mono ? 'bndz-plugin-field-value bndz-mono' : 'bndz-plugin-field-value'}>{children}</div>
    </>
  );
}

export function PluginEmptyState({
  icon = 'layers_ui',
  title,
  description,
}: {
  icon?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div className="bndz-plugin-empty flex flex-col items-center justify-center h-full min-h-[120px] gap-3 p-6 select-none text-center">
      <Icons8Icon id={icon} size={36} className="opacity-25" />
      {title && <p className="text-sm font-medium text-gray-400">{title}</p>}
      {description && <p className="text-xs bndz-panel-muted max-w-[280px] leading-relaxed">{description}</p>}
    </div>
  );
}

export function PluginIdentityHeader({
  icon,
  name,
  typeLabel,
  path,
  meta,
}: {
  icon: ReactNode;
  name: string;
  typeLabel?: string;
  path?: string | null;
  meta?: ReactNode;
}) {
  return (
    <div className="bndz-plugin-identity shrink-0 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3 min-w-0">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-white truncate leading-tight">{name}</h2>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {typeLabel && <span className="bndz-plugin-kind-pill">{typeLabel}</span>}
          {meta}
        </div>
        {path && (
          <p className="bndz-mono bndz-panel-muted mt-1 truncate text-xs" title={path}>{path}</p>
        )}
      </div>
    </div>
  );
}
