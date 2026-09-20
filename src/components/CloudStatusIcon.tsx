import React from 'react';
import type { CloudStatusKind } from '../lib/cloudStatus';

type Props = {
  kind: CloudStatusKind | string;
  size?: number;
  title?: string;
  className?: string;
};

/** Inline SVG cloud sync stages -- never depends on /EMBLEMS/*.svg loading in WebView. */
export function CloudStatusIcon({ kind, size = 16, title, className = '' }: Props) {
  const k = String(kind || '').toLowerCase();
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className: `inline-block shrink-0 ${className}`,
    style: { width: size, height: size } as React.CSSProperties,
    'aria-hidden': true as const,
  };

  // Cloud outline shared
  const cloud = (
    <path
      d="M7.5 18h9.2a4.3 4.3 0 0 0 .5-8.55A6 6 0 0 0 6.1 11.4 3.6 3.6 0 0 0 7.5 18z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      opacity="0.9"
    />
  );

  let body: React.ReactNode;
  if (k === 'online-only' || k === 'offline') {
    // download arrow
    body = (
      <>
        {cloud}
        <path d="M12 10.5v6.2M12 16.7l-2.2-2.2M12 16.7l2.2-2.2" stroke="#fbbf24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  } else if (k === 'pinned') {
    body = (
      <>
        {cloud}
        <path d="M9.2 13.2l2 2 4-4" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  } else if (k === 'error' || k === 'missing') {
    body = (
      <>
        {cloud}
        <path d="M12 11v3.2M12 16.6h.01" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" />
      </>
    );
  } else if (k === 'syncing') {
    body = (
      <>
        {cloud}
        <path d="M9.2 13.6a3 3 0 0 1 5.1-1.6M14.8 12.4a3 3 0 0 1-5.1 1.6" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M14.3 10.2l.7 1.8 1.8-.7M9.7 15.8l-.7-1.8-1.8.7" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  } else {
    // available / default
    body = (
      <>
        {cloud}
        <circle cx="12" cy="13.5" r="1.6" fill="#38bdf8" />
      </>
    );
  }

  return (
    <span className="inline-flex items-center justify-center text-gray-200" title={title} style={{ width: size, height: size }}>
      <svg {...common}>{body}</svg>
    </span>
  );
}
