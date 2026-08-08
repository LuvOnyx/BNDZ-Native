import React, { useEffect, useId, useRef, useState } from 'react';

export type BndzDensitySliderProps = {
  value: number;
  min: number;
  max: number;
  /** Committed value (pointer up / blur / keyboard commit). */
  onChange: (value: number) => void;
  /** Optional live scrub updates (rAF-coalesced). Prefer this for expensive layouts. */
  onLiveChange?: (value: number) => void;
  title?: string;
  className?: string;
  /** Optional width class; default suits the views-bar chrome. */
  widthClassName?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * FM views-bar density control — recessed glass rail, accent fill, soft squircle thumb
 * (Uiverse craft translated into BNDZ tokens / squircles — not a raw dump).
 *
 * Scrubbing stays butter-smooth by painting a local/live value and coalescing
 * expensive parent updates to at most one rAF tick; config commits on release.
 */
export function BndzDensitySlider({
  value,
  min,
  max,
  onChange,
  onLiveChange,
  title = 'Icon size',
  className = '',
  widthClassName = 'w-[148px]',
}: BndzDensitySliderProps) {
  const id = useId();
  const span = Math.max(1, max - min);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState(value);
  const liveRef = useRef(value);
  const rafRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!dragging) {
      liveRef.current = value;
      setLive(value);
    }
  }, [value, dragging]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const flushLive = (next: number) => {
    const v = clamp(Math.round(next), min, max);
    liveRef.current = v;
    setLive(v);
    if (onLiveChange) {
      pendingRef.current = v;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const p = pendingRef.current;
          pendingRef.current = null;
          if (p != null) onLiveChange(p);
        });
      }
    } else {
      pendingRef.current = v;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const p = pendingRef.current;
          pendingRef.current = null;
          if (p != null) onChange(p);
        });
      }
    }
  };

  const commit = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const v = liveRef.current;
    pendingRef.current = null;
    if (onLiveChange) onLiveChange(v);
    onChange(v);
    setDragging(false);
  };

  const pct = Math.min(100, Math.max(0, ((live - min) / span) * 100));

  return (
    <label
      className={`bndz-density-slider group relative flex items-center shrink-0 ${dragging ? 'bndz-density-slider--dragging' : ''} ${widthClassName} ${className}`}
      title={title}
      htmlFor={id}
      style={{ ['--bndz-ds-pct' as string]: String(pct) }}
      data-dragging={dragging ? '1' : undefined}
    >
      <span className="bndz-density-slider-glyph bndz-density-slider-glyph--lo" aria-hidden>
        <i /><i /><i />
      </span>

      <span className="bndz-density-slider-track">
        <span className="bndz-density-slider-rail" aria-hidden>
          <span className="bndz-density-slider-ticks" />
          <span className="bndz-density-slider-fill" />
          <span className="bndz-density-slider-gloss" />
        </span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={live}
          aria-label={title}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={live}
          onPointerDown={() => setDragging(true)}
          onPointerUp={commit}
          onPointerCancel={commit}
          onBlur={() => {
            if (dragging) commit();
          }}
          onKeyUp={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
              commit();
            }
          }}
          onChange={e => flushLive(Number(e.target.value))}
          className="bndz-density-slider-input"
        />
        <span className="bndz-density-slider-thumb" aria-hidden>
          <span className="bndz-density-slider-thumb-core" />
        </span>
      </span>

      <span className="bndz-density-slider-glyph bndz-density-slider-glyph--hi" aria-hidden>
        <i /><i /><i />
      </span>
    </label>
  );
}

export default BndzDensitySlider;
