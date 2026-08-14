import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';

type Props = {
  src: string;
  alt: string;
  filePath?: string | null;
  onOpenFloating?: () => void;
};

/**
 * Vector-faithful SVG preview — size via layout (width/height), never CSS
 * transform scale (that rasterizes and looks blurry on reselect / zoom).
 * Wheel zoom + drag-pan match raster ImageZoomPreview interaction.
 */
export default function SvgVectorPreview({ src, alt, onOpenFloating }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [imgSrc, setImgSrc] = useState(src);
  const [dragging, setDragging] = useState(false);
  const baseFitRef = useRef(1);
  const userScaleRef = useRef(1);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    // Force a fresh decode so returning to a cached blob: URL stays crisp.
    const bust = src.includes('#') ? `${src}&bndz=${Date.now()}` : `${src}#bndz=${Date.now()}`;
    setImgSrc(bust);
    userScaleRef.current = 1;
    setDisplayScale(1);
    setNatural({ w: 0, h: 0 });
    dragRef.current = null;
    setDragging(false);
  }, [src]);

  const applyFit = useCallback((nw: number, nh: number, userMul = 1) => {
    const stage = stageRef.current;
    if (!stage || !nw || !nh) return;
    const pad = 20;
    const fit = Math.min((stage.clientWidth - pad) / nw, (stage.clientHeight - pad) / nh, 24);
    baseFitRef.current = fit > 0 && Number.isFinite(fit) ? fit : 1;
    const next = Math.min(24, Math.max(0.05, baseFitRef.current * userMul));
    userScaleRef.current = userMul;
    setDisplayScale(next);
  }, []);

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth || 256;
    const nh = img.naturalHeight || 256;
    setNatural({ w: nw, h: nh });
    applyFit(nw, nh, 1);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !natural.w) return;
    const ro = new ResizeObserver(() => applyFit(natural.w, natural.h, userScaleRef.current));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [natural.w, natural.h, applyFit]);

  // Wheel zoom (Ctrl or plain — match raster preview; prevent stage scroll hijack).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!natural.w) return;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyFit(natural.w, natural.h, userScaleRef.current * factor);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [natural.w, natural.h, applyFit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    stage.scrollLeft = drag.left - (e.clientX - drag.x);
    stage.scrollTop = drag.top - (e.clientY - drag.y);
  };

  const endDrag = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (stage?.hasPointerCapture?.(e.pointerId)) {
      try { stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    dragRef.current = null;
    setDragging(false);
  };

  const zoomIn = () => applyFit(natural.w, natural.h, userScaleRef.current * 1.25);
  const zoomOut = () => applyFit(natural.w, natural.h, userScaleRef.current / 1.25);
  const fit = () => applyFit(natural.w, natural.h, 1);
  const reset = () => {
    userScaleRef.current = 1 / Math.max(baseFitRef.current, 0.001);
    setDisplayScale(1);
  };

  const w = natural.w ? Math.max(1, Math.round(natural.w * displayScale)) : undefined;
  const h = natural.h ? Math.max(1, Math.round(natural.h * displayScale)) : undefined;

  return (
    <div className="bndz-image-preview bndz-svg-vector-preview">
      <div
        ref={stageRef}
        className={`bndz-image-preview-stage bndz-svg-vector-stage${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          key={imgSrc}
          src={imgSrc}
          alt={alt}
          draggable={false}
          className="bndz-svg-vector-img"
          style={{ width: w, height: h }}
          onLoad={onLoad}
        />
      </div>
      <div className="bndz-image-preview-chrome">
        <span className="bndz-image-preview-hint">Vector SVG · Wheel zoom · Drag to pan</span>
        <div className="bndz-image-preview-tools">
          <button type="button" onClick={zoomOut} className="bndz-media-transport-btn" title="Zoom out">
            <Icons8Icon id="zoom_out_ui" size={14} />
          </button>
          <span className="bndz-image-preview-scale bndz-mono">{Math.round(displayScale * 100)}%</span>
          <button type="button" onClick={zoomIn} className="bndz-media-transport-btn" title="Zoom in">
            <Icons8Icon id="zoom_in_ui" size={14} />
          </button>
          <button type="button" onClick={fit} className="bndz-media-transport-btn" title="Fit to panel">
            <Icons8Icon id="maximize_ui" size={14} />
          </button>
          <button type="button" onClick={reset} className="bndz-media-transport-btn" title="Actual size (100%)">
            <Icons8Icon id="reset_ui" size={14} />
          </button>
          {onOpenFloating && (
            <>
              <span className="bndz-image-preview-sep" aria-hidden />
              <button
                type="button"
                onClick={onOpenFloating}
                className="bndz-media-transport-btn bndz-media-transport-btn--accent"
                title="Open floating preview (Space)"
              >
                <Icons8Icon id="eye_ui" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
