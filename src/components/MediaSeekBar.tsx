import React, { useCallback, useRef } from 'react';

type Props = {
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
};

/** Native-feel seek bar with pointer drag and keyboard focus support. */
export default function MediaSeekBar({ value, max, disabled, onChange, className = '' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  const seekFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || disabled || max <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(ratio * max);
  }, [disabled, max, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    seekFromClientX(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClientX(e.clientX);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      className={`bndz-media-seek flex-1 min-w-0 ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(0, value - 5)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(max, value + 5)); }
      }}
    >
      <div className="bndz-media-seek-fill" style={{ width: `${pct}%` }} />
      <div className="bndz-media-seek-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}
