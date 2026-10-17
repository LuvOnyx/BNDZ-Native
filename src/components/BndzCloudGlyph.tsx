import React, { useId } from 'react';

type Props = {
  size?: number;
  className?: string;
  title?: string;
};

/**
 * The BNDZ Cloud brand glyph (custom-drawn, not an Icons8 asset): a single
 * cloud in the BNDZ purple gradient — pale light on top melting into violet
 * with a pink base — with a soft sheen on its top-left hump. Used wherever
 * BNDZ Cloud appears as itself -- the nav tree node, the sidebar row, menus,
 * and the plugin header -- via Icons8Icon id "bndz_cloud" or directly.
 */
export function BndzCloudGlyph({ size = 16, className = '', title }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bodyId = `bndz-cloud-body-${uid}`;
  const sheenId = `bndz-cloud-sheen-${uid}`;
  const clipId = `bndz-cloud-clip-${uid}`;
  const blurId = `bndz-cloud-blur-${uid}`;
  const cloudPath =
    'M22 46h34.5a10.3 10.3 0 0 0 2.07-20.42A16.2 16.2 0 0 0 27.9 15.7a13.2 13.2 0 0 0-12.5 8.88A8.85 8.85 0 0 0 22 46Z';
  return (
    <svg
      width={size}
      height={size}
      viewBox="8 0 60 48"
      className={`inline-block shrink-0 select-none ${className}`}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8b4fe" />
          <stop offset="0.35" stopColor="#a855f7" />
          <stop offset="0.75" stopColor="#7e22ce" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={blurId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id={clipId}>
          <path d={cloudPath} />
        </clipPath>
      </defs>
      <path d={cloudPath} fill={`url(#${bodyId})`} />
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx="38" cy="14" rx="17" ry="10" fill={`url(#${sheenId})`} filter={`url(#${blurId})`} opacity="0.8" />
        <ellipse cx="24" cy="23" rx="8" ry="5.5" fill="#ffffff" filter={`url(#${blurId})`} opacity="0.35" />
        <rect x="10" y="41" width="62" height="7" fill="#4a044e" filter={`url(#${blurId})`} opacity="0.3" />
      </g>
    </svg>
  );
}
