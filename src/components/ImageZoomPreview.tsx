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
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imgSrc, setImgSrc] = useState(src);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setImgSrc(src); }, [src]);

  const zoomIn = () => setScale(s => Math.min(s + 0.25, 5));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.25));
  const reset = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const fit = () => setScale(1);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [scale]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  }, []);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  // React registers wheel as passive — use native listener so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(s => Math.min(5, Math.max(0.25, s + (e.deltaY < 0 ? 0.15 : -0.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col bg-[#080808] pattern-checkerboard relative overflow-hidden"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className="absolute top-2 right-2 z-20 flex gap-1 bg-black/70 rounded-md p-1 border border-white/10">
        <button type="button" onClick={zoomOut} className="p-1 hover:bg-white/10 rounded" title="Zoom out"><Icons8Icon id="zoom_out_ui" size={14} /></button>
        <span className="text-[10px] font-mono text-gray-300 px-1 self-center min-w-[36px] text-center">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={zoomIn} className="p-1 hover:bg-white/10 rounded" title="Zoom in"><Icons8Icon id="zoom_in_ui" size={14} /></button>
        <button type="button" onClick={fit} className="p-1 hover:bg-white/10 rounded" title="Fit"><Icons8Icon id="maximize_ui" size={14} /></button>
        <button type="button" onClick={reset} className="p-1 hover:bg-white/10 rounded" title="Reset"><Icons8Icon id="reset_ui" size={14} /></button>
      </div>
      <div className="flex-1 flex items-center justify-center cursor-grab active:cursor-grabbing">
        <img
          src={imgSrc}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-full object-contain drop-shadow-2xl select-none transition-transform duration-75"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
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
  );
}
