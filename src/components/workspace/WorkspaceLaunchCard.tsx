import React, { useRef } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { EmblemIcon } from '../EmblemIcon';

export type WorkspaceLaunchCardProps = {
  title: string;
  desc: string;
  icon: string;
  emblemId?: string;
  accent: string;
  badge?: string;
  badgeVariant?: 'gold' | 'green' | 'new' | 'default';
  features?: string[];
  onClick: () => void;
  className?: string;
};

/**
 * Workspace launch tiles — Aceternity/Magic-UI inspired bloom + spotlight,
 * adapted into BNDZ glass tokens (no third-party dump).
 */
export default function WorkspaceLaunchCard({
  title,
  desc,
  icon,
  emblemId,
  accent,
  badge,
  badgeVariant = 'default',
  features,
  onClick,
  className = '',
}: WorkspaceLaunchCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    card.style.setProperty('--mouse-x', `${x}%`);
    card.style.setProperty('--mouse-y', `${y}%`);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      className={`bndz-ws-launch-card ${className}`.trim()}
      style={{ ['--ws-accent' as string]: accent }}
      onClick={onClick}
      onMouseMove={handleMouseMove}
    >
      <span className="bndz-ws-launch-card-bloom" aria-hidden />
      <span className="bndz-ws-launch-card-mesh" aria-hidden />
      <span className="bndz-ws-launch-card-spotlight" aria-hidden />
      <span className="bndz-ws-launch-card-topline" aria-hidden />
      <span className="bndz-ws-launch-card-shimmer" aria-hidden />
      <span className="bndz-ws-launch-card-edge" aria-hidden />

      <span className="bndz-ws-launch-card-medallion" aria-hidden>
        <span className="bndz-ws-launch-card-medallion-ring" />
        <span className="bndz-ws-launch-card-medallion-glow" />
        <span className="bndz-ws-launch-card-icon">
          {emblemId
            ? <EmblemIcon id={emblemId} size={28} />
            : <Icons8Icon id={icon} size={28} />}
        </span>
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
