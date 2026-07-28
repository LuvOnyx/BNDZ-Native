import React from 'react';
import { Icons8Icon } from '../Icons8Icon';

export type WorkspaceLaunchCardProps = {
  title: string;
  desc: string;
  icon: string;
  accent: string;
  badge?: string;
  badgeVariant?: 'gold' | 'new' | 'default';
  features?: string[];
  onClick: () => void;
  className?: string;
};

export default function WorkspaceLaunchCard({
  title,
  desc,
  icon,
  accent,
  badge,
  badgeVariant = 'default',
  features,
  onClick,
  className = '',
}: WorkspaceLaunchCardProps) {
  return (
    <button
      type="button"
      className={`bndz-ws-launch-card ${className}`.trim()}
      style={{ ['--ws-accent' as string]: accent }}
      onClick={onClick}
    >
      <span className="bndz-ws-launch-card-glow" aria-hidden />
      <span className="bndz-ws-launch-card-icon" aria-hidden>
        <Icons8Icon id={icon} size={24} />
      </span>
      <span className="bndz-ws-launch-card-body">
        <span className="bndz-ws-launch-card-title-row">
          <span className="bndz-ws-launch-card-title">{title}</span>
          {badge && (
            <span className={`bndz-ws-launch-badge is-${badgeVariant}`}>{badge}</span>
          )}
        </span>
        <span className="bndz-ws-launch-card-desc">{desc}</span>
        {features && features.length > 0 && (
          <span className="bndz-ws-launch-card-features">
            {features.map(f => (
              <span key={f} className="bndz-ws-launch-feature-chip">{f}</span>
            ))}
          </span>
        )}
      </span>
      <Icons8Icon id="chevron_right" size={14} className="bndz-ws-launch-card-chevron" />
    </button>
  );
}
