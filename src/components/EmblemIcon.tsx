import React from 'react';

/**
 * SVG emblems from public/EMBLEMS — sized via CSS box, not the SVG's native viewport.
 * Use for status badges, list emblems, and plugin chrome where SVG sharpness matters.
 */
export type EmblemId =
  | 'emblem-mounted'
  | 'emblem-unmounted'
  | 'emblem-symbolic-link'
  | 'emblem-synchronizing'
  | 'emblem-lock'
  | 'emblem-unlocked'
  | 'emblem-favorite'
  | 'emblem-important'
  | 'emblem-warning'
  | 'emblem-check'
  | 'emblem-add'
  | 'emblem-remove'
  | 'emblem-close'
  | 'emblem-downloads'
  | 'emblem-documents'
  | 'emblem-system'
  | 'emblem-update'
  | 'emblem-pause'
  | 'emblem-information'
  | 'emblem-question'
  | 'emblem-unavailable'
  | 'emblem-locally-modified'
  | 'emblem-notification-dot'
  | 'emblem-noread'
  | 'state-ok'
  | 'state-error'
  | 'state-warning'
  | 'state-sync'
  | 'state-download'
  | 'state-pause'
  | 'state-offline'
  | 'state-information'
  | 'share-check'
  | 'share-error'
  | 'share-warn'
  | 'cloud-sync'
  | 'Nextcloud_sync_shared'
  | 'tag'
  | 'starred'
  | 'semi-starred'
  | 'home'
  | 'drive-removable-media'
  | 'computer'
  | 'computer-laptop'
  | 'network-server'
  | 'notification-device-eject'
  | 'round-big-add'
  | 'round-big-check'
  | 'round-big-refresh'
  | 'round-big-warning'
  | 'round-big-X'
  | 'round-big-back'
  | 'data-success'
  | 'data-warning'
  | 'data-information'
  | 'user-trash'
  | 'user-trash-full'
  | 'view-filter'
  | 'view-history'
  | 'media-playback-playing'
  | 'media-playback-paused'
  | 'media-playback-stop'
  | 'media-record';

const EMBLEM_BASE = '/EMBLEMS';

export function emblemUrl(id: EmblemId | string): string {
  const clean = id.replace(/\.svg$/i, '');
  return `${EMBLEM_BASE}/${clean}.svg`;
}

type Props = {
  id: EmblemId | string;
  /** Rendered box size in CSS pixels (SVG scales to fit). */
  size?: number;
  className?: string;
  title?: string;
  /** Optional CSS filter / opacity via className; this dims for disabled chrome. */
  disabled?: boolean;
};

export function EmblemIcon({ id, size = 16, className = '', title, disabled }: Props) {
  return (
    <img
      src={emblemUrl(id)}
      alt=""
      title={title}
      draggable={false}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain select-none ${disabled ? 'opacity-40' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Map common FM verbs / plugin roles onto the new emblem set. */
export function emblemForRole(role:
  | 'ram-mounted'
  | 'ram-dirty'
  | 'ghost-link'
  | 'mesh-drop'
  | 'sync'
  | 'ok'
  | 'warn'
  | 'error'
  | 'eject'
  | 'favorite'
  | 'lock'
): EmblemId {
  switch (role) {
    case 'ram-mounted': return 'emblem-mounted';
    case 'ram-dirty': return 'emblem-locally-modified';
    case 'ghost-link': return 'emblem-symbolic-link';
    case 'mesh-drop': return 'share-check';
    case 'sync': return 'emblem-synchronizing';
    case 'ok': return 'state-ok';
    case 'warn': return 'state-warning';
    case 'error': return 'state-error';
    case 'eject': return 'notification-device-eject';
    case 'favorite': return 'emblem-favorite';
    case 'lock': return 'emblem-lock';
  }
}
