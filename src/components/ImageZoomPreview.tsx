import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';

interface ImageZoomPreviewProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export default function ImageZoomPreview({ src, alt, fallbackSrc, onError }: ImageZoomPreviewProps) {
  const [scale, setScale] = useState(1);
  const [displayScale, setDisplayScale] = useState(1);
  const [imgSrc, setImgSrc] = useState(src);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => { setImgSrc(src); }, [src]);

  const applyTransform = useCallback(() => {
    const el = transformRef.current;
    if (!el) return;
    const { x, y } = offsetRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scaleRef.current})`;
    rafRef.current = null;
  }, []);

  const scheduleTransform = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(applyTransform);
  }, [applyTransform]);

  const setScaleImmediate = useCallback((next: number) => {
    const clamped = Math.min(5, Math.max(0.25, next));
    scaleRef.current = clamped;
    setScale(clamped);
    setDisplayScale(clamped);
    scheduleTransform();
  }, [scheduleTransform]);

  const zoomIn = () => setScaleImmediate(scaleRef.current + 0.25);
  const zoomOut = () => setScaleImmediate(scaleRef.current - 0.25);
  const reset = () => {
    offsetRef.current = { x: 0, y: 0 };
    setScaleImmediate(1);
  };
  const fit = () => setScaleImmediate(1);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (scaleRef.current <= 1) return;
    draggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    offsetRef.current = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    };
    scheduleTransform();
  }, [scheduleTransform]);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScaleImmediate(scaleRef.current + (e.deltaY < 0 ? 0.15 : -0.15));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setScaleImmediate]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
    scheduleTransform();
  }, [scale, scheduleTransform]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col bg-[#080808] pattern-checkerboard relative overflow-hidden"
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div className="absolute top-2 right-2 z-20 flex gap-1 bg-black/70 rounded-md p-1 border border-white/10">
        <button type="button" onClick={zoomOut} className="p-1 hover:bg-white/10 rounded" title="Zoom out"><Icons8Icon id="zoom_out_ui" size={14} /></button>
        <span className="text-[10px] font-mono text-gray-300 px-1 self-center min-w-[36px] text-center">{Math.round(displayScale * 100)}%</span>
        <button type="button" onClick={zoomIn} className="p-1 hover:bg-white/10 rounded" title="Zoom in"><Icons8Icon id="zoom_in_ui" size={14} /></button>
        <button type="button" onClick={fit} className="p-1 hover:bg-white/10 rounded" title="Fit"><Icons8Icon id="maximize_ui" size={14} /></button>
        <button type="button" onClick={reset} className="p-1 hover:bg-white/10 rounded" title="Reset"><Icons8Icon id="reset_ui" size={14} /></button>
      </div>
      <div className={`flex-1 flex items-center justify-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
        <div
          ref={transformRef}
          className="inline-flex items-center justify-center will-change-transform"
          style={{ transform: 'translate3d(0px, 0px, 0) scale(1)' }}
        >
          <img
            src={imgSrc}
            alt={alt}
            draggable={false}
            className="max-w-full max-h-full object-contain drop-shadow-2xl select-none"
            onMouseDown={onMouseDown}
            onError={(e) => {
              if (fallbackSrc && imgSrc !== fallbackSrc) {
                setImgSrc(fallbackSrc);
              }
              onError?.(e);
            }}
          />
        </div>
      </div>
    </div>
  );
}
