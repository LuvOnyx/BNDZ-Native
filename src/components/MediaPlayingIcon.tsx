import React, { useEffect, useState } from 'react';
import { audioPlaybackSession } from '../lib/audioPlaybackSession';

type Props = {
  size?: number;
  className?: string;
  /** 0-1 progress; when omitted, follows the shared audio session. */
  progress?: number;
  /** When true, center shows pause bars; ring still tracks seek position. */
  paused?: boolean;
};

/**
 * Round play control with live seek ring -- cyan arc grows with currentTime/duration.
 */
export default function MediaPlayingIcon({ size = 16, className = '', progress, paused = false }: Props) {
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
  const gGlyph = `bndzPlayGlyph-${uid}`;

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
          <linearGradient id={gGlyph} x1="69" y1="45" x2="69" y2="83" gradientUnits="userSpaceOnUse">
            <stop stopColor="#161616" />
            <stop offset="1" stopColor="#707070" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r="48" fill={`url(#${gBg})`} />
        <circle cx="64" cy="64" r="40" fill={`url(#${gMid})`} />
        {/* Track ring (dim) + progress arc that lengthens with playback */}
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="rgba(15, 23, 42, 0.12)"
          strokeWidth="12"
        />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={`url(#${gProg})`}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 64 64)"
          opacity={pct > 0.005 ? 1 : 0.35}
        />
        <circle cx="64" cy="64" r="37.333" fill={`url(#${gCore})`} />
        {paused ? (
          <>
            <path
              d="M48 50.6667C48 49.1939 49.1939 48 50.6667 48H56C57.4728 48 58.6667 49.1939 58.6667 50.6667V77.3333C58.6667 78.8061 57.4728 80 56 80H50.6667C49.1939 80 48 78.8061 48 77.3333V50.6667Z"
              fill={`url(#${gGlyph})`}
            />
            <path
              d="M69.3333 50.6667C69.3333 49.1939 70.5272 48 72 48H77.3333C78.8061 48 80 49.1939 80 50.6667V77.3333C80 78.8061 78.8061 80 77.3333 80H72C70.5272 80 69.3333 78.8061 69.3333 77.3333V50.6667Z"
              fill={`url(#${gGlyph})`}
            />
          </>
        ) : (
          <path
            d="M57.3436 47.6726L81.3846 61.6965C83.1486 62.7256 83.1486 65.2744 81.3846 66.3034L57.3437 80.3273C55.5659 81.3643 53.3333 80.082 53.3333 78.0239V49.9761C53.3333 47.9179 55.5659 46.6356 57.3436 47.6726Z"
            fill={`url(#${gGlyph})`}
          />
        )}
      </svg>
    </span>
  );
}
