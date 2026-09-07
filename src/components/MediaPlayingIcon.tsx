import React, { useEffect, useState } from 'react';
import { audioPlaybackSession } from '../lib/audioPlaybackSession';

type Props = {
  size?: number;
  className?: string;
  /** 0–1 progress; when omitted, follows the shared audio session. */
  progress?: number;
};

/**
 * Live seek ring for Media/playing — cyan arc tracks currentTime/duration.
 */
export default function MediaPlayingIcon({ size = 16, className = '', progress }: Props) {
  const [live, setLive] = useState(0);
  const uid = React.useId().replace(/:/g, '');

  useEffect(() => {
    if (typeof progress === 'number') return;
    const tick = () => {
      const snap = audioPlaybackSession.getSnapshot();
      const dur = snap.duration || 0;
      const t = snap.currentTime || 0;
      setLive(dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0);
    };
    tick();
    return audioPlaybackSession.subscribe(tick);
  }, [progress]);

  const pct = typeof progress === 'number'
    ? Math.min(1, Math.max(0, progress))
    : live;
  const r = 44;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0.01, c * pct);
  const gBg = `bndzPlayRingBg-${uid}`;
  const gMid = `bndzPlayRingMid-${uid}`;
  const gProg = `bndzPlayRingProg-${uid}`;
  const gCore = `bndzPlayRingCore-${uid}`;
  const gTri = `bndzPlayTri-${uid}`;

  return (
    <span
      className={`bndz-media-playing-icon inline-flex relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 128 128" width={size} height={size} className="block">
        <defs>
          <linearGradient id={gBg} x1="64" y1="54" x2="64" y2="112" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff" />
            <stop offset="1" stopColor="#E8E8E8" />
          </linearGradient>
          <linearGradient id={gMid} x1="64" y1="24" x2="64" y2="104" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ECECEC" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <linearGradient id={gProg} x1="64" y1="24" x2="64" y2="104" gradientUnits="userSpaceOnUse">
            <stop stopColor="#42D9FB" />
            <stop offset="1" stopColor="#1FB6D8" />
          </linearGradient>
          <linearGradient id={gCore} x1="64" y1="26" x2="64" y2="101" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fff" />
            <stop offset="1" stopColor="#E4E4E4" />
          </linearGradient>
          <linearGradient id={gTri} x1="69" y1="45" x2="69" y2="83" gradientUnits="userSpaceOnUse">
            <stop stopColor="#161616" />
            <stop offset="1" stopColor="#707070" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r="48" fill={`url(#${gBg})`} />
        <circle cx="64" cy="64" r="40" fill={`url(#${gMid})`} />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={`url(#${gProg})`}
          strokeWidth="12"
          strokeLinecap="butt"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 64 64)"
          opacity={pct > 0.01 ? 1 : 0.25}
        />
        <circle cx="64" cy="64" r="37.333" fill={`url(#${gCore})`} />
        <path
          d="M57.3436 47.6726L81.3846 61.6965C83.1486 62.7256 83.1486 65.2744 81.3846 66.3034L57.3437 80.3273C55.5659 81.3643 53.3333 80.082 53.3333 78.0239V49.9761C53.3333 47.9179 55.5659 46.6356 57.3436 47.6726Z"
          fill={`url(#${gTri})`}
        />
      </svg>
    </span>
  );
}
