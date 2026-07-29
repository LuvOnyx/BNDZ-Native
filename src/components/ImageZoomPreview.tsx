import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { toWindowsPath } from '../lib/pathUtils';

interface ImageZoomPreviewProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
  filePath?: string | null;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  /** Opens BNDZ floating Quick Look overlay for the current file. */
  onOpenFloating?: () => void;
}

function measureContainScale(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  padding = 20,
): number {
  if (!imgW || !imgH || !boxW || !boxH) return 1;
  const sx = (boxW - padding) / imgW;
  const sy = (boxH - padding) / imgH;
  return Math.min(sx, sy, 24);
}

export default function ImageZoomPreview({
  src, alt, fallbackSrc, filePath, onError, onOpenFloating,
}: ImageZoomPreviewProps) {
  const [displayScale, setDisplayScale] = useState(1);
  const [imgSrc, setImgSrc] = useState(src);
  const [isDragging, setIsDragging] = useState(false);
  const blobTriedRef = useRef(false);
  const blobUrlRef = useRef<string | null>(null);
  const baseFitScaleRef = useRef(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    blobTriedRef.current = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setImgSrc(src);
    offsetRef.current = { x: 0, y: 0 };
    baseFitScaleRef.current = 1;
    scaleRef.current = 1;
    setDisplayScale(1);
  }, [src, filePath]);

  useEffect(() => () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const tryBlobFallback = useCallback(async () => {
    if (blobTriedRef.current || !filePath) return false;
    blobTriedRef.current = true;
    try {
      const { IPC } = await import('../lib/ipcBridge');
      if (!IPC.isNative) return false;
      const result = await IPC.getMediaBlob(toWindowsPath(filePath));
      if (!result.base64 || !result.mime) return false;
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: result.mime });
      const url = URL.createObjectURL(blob);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setImgSrc(url);
      return true;
    } catch {
      return false;
    }
  }, [filePath]);

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
    const clamped = Math.min(24, Math.max(0.1, next));
    scaleRef.current = clamped;
    setDisplayScale(clamped);
    scheduleTransform();
  }, [scheduleTransform]);

  const measureFitScale = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img?.naturalWidth || !stage) return 1;
    return measureContainScale(
      img.naturalWidth,
      img.naturalHeight,
      stage.clientWidth,
      stage.clientHeight,
    );
  }, []);

  const fitToContainer = useCallback((preserveZoom = false) => {
    const fit = measureFitScale();
    baseFitScaleRef.current = fit;
    if (!preserveZoom) {
      offsetRef.current = { x: 0, y: 0 };
      setScaleImmediate(fit);
    }
  }, [measureFitScale, setScaleImmediate]);

  const zoomIn = () => setScaleImmediate(scaleRef.current + 0.25);
  const zoomOut = () => setScaleImmediate(scaleRef.current - 0.25);
  const reset = () => {
    offsetRef.current = { x: 0, y: 0 };
    setScaleImmediate(1);
  };
  const fit = () => fitToContainer(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
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
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      const nearFit = Math.abs(scaleRef.current - baseFitScaleRef.current) < 0.08;
      if (nearFit) fitToContainer(false);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fitToContainer, imgSrc]);

  return (
    <div
      ref={containerRef}
      className="bndz-image-preview"
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <div
        ref={stageRef}
        className={`bndz-image-preview-stage ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={onMouseDown}
      >
        <div
          ref={transformRef}
          className="bndz-image-preview-transform"
          style={{ transform: 'translate3d(0px, 0px, 0) scale(1)' }}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt={alt}
            draggable={false}
            className="bndz-image-preview-img"
            onLoad={() => fitToContainer(false)}
            onError={(e) => {
              void tryBlobFallback().then((ok) => {
                if (ok) return;
                if (fallbackSrc && imgSrc !== fallbackSrc) {
                  setImgSrc(fallbackSrc);
                  return;
                }
                onError?.(e);
              });
            }}
          />
        </div>
      </div>

      <div className="bndz-image-preview-chrome">
        <span className="bndz-image-preview-hint">Scroll to zoom · Drag to pan</span>
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
