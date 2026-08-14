import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { toWindowsPath } from '../lib/pathUtils';
import { useAppConfig } from '../data/configContext';
import { getBlowUpBehavior, getBlowUpMouseBehavior } from '../lib/settingsBehavior';
import { applyWebPathMap } from '../lib/listReportExport';
import { buildSettingsRuntime } from '../lib/settingsRuntime';

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
  return Math.min(sx, sy);
}

function measureCoverScale(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  padding = 0,
): number {
  if (!imgW || !imgH || !boxW || !boxH) return 1;
  const sx = (boxW - padding) / imgW;
  const sy = (boxH - padding) / imgH;
  return Math.min(Math.max(sx, sy), 24);
}

export default function ImageZoomPreview({
  src, alt, fallbackSrc, filePath, onError, onOpenFloating,
}: ImageZoomPreviewProps) {
  const { config } = useAppConfig();
  const blowUp = getBlowUpMouseBehavior(config);
  const blowVisual = getBlowUpBehavior(config);
  const previewRt = buildSettingsRuntime(config).preview;
  const mappedSrc = config.enableServerMappings === false
    ? src
    : applyWebPathMap(config, src);
  const [displayScale, setDisplayScale] = useState(1);
  const [imgSrc, setImgSrc] = useState(mappedSrc);
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
    setImgSrc(applyWebPathMap(config, src));
    offsetRef.current = { x: 0, y: 0 };
    baseFitScaleRef.current = 1;
    // Always start from identity; fit runs on load so large PNGs are not stuck at 100% native.
    scaleRef.current = 1;
    setDisplayScale(1);
  }, [src, filePath, config]);

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
    const s = scaleRef.current;
    el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${s})`;
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
    const boxW = stage.clientWidth;
    const boxH = stage.clientHeight;
    if (boxW < 8 || boxH < 8) return 1;
    const measure = blowVisual.zoomToFill ? measureCoverScale : measureContainScale;
    let fit = measure(img.naturalWidth, img.naturalHeight, boxW, boxH);
    // Fit-to-screen: never enlarge past 100% for photos (avoids "already zoomed in" on small PNGs).
    // Cover mode may still fill; contain caps at 1 unless the user zooms manually.
    if (!blowVisual.zoomToFill) {
      fit = Math.min(fit, 1);
    }
    // Settings → Limit original preview size (px) caps the fitted native scale.
    if (config.limitOriginalPreviewSize) {
      const maxPx = Math.max(64, Number(config.limitOriginalPreviewSizeValue) || 1600);
      const maxScale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      fit = Math.min(fit, maxScale);
    }
    return Math.max(0.05, fit);
  }, [blowVisual.zoomToFill, config.limitOriginalPreviewSize, config.limitOriginalPreviewSizeValue]);

  const fitToContainer = useCallback((preserveZoom = false) => {
    const stage = stageRef.current;
    if (!stage?.clientWidth || !stage?.clientHeight) return false;
    const fit = measureFitScale();
    if (!fit || !Number.isFinite(fit)) return false;
    baseFitScaleRef.current = fit;
    if (!preserveZoom) {
      offsetRef.current = { x: 0, y: 0 };
      setScaleImmediate(fit);
    }
    return true;
  }, [measureFitScale, setScaleImmediate]);

  const scheduleFit = useCallback(() => {
    // Stage often has 0×0 on first onLoad — retry until layout settles.
    const tryFit = (attempt: number) => {
      if (fitToContainer(false)) return;
      if (attempt >= 12) return;
      window.requestAnimationFrame(() => tryFit(attempt + 1));
    };
    tryFit(0);
  }, [fitToContainer]);

  const zoomIn = () => setScaleImmediate(scaleRef.current + 0.25);
  const zoomOut = () => setScaleImmediate(scaleRef.current - 0.25);
  const reset = () => {
    offsetRef.current = { x: 0, y: 0 };
    setScaleImmediate(1);
  };
  const fit = () => { scheduleFit(); };

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
      if (!stage.clientWidth || !stage.clientHeight) return;
      // Keep fitted while the user has not manually zoomed away from fit.
      const nearFit = Math.abs(scaleRef.current - baseFitScaleRef.current) < 0.08;
      if (nearFit || baseFitScaleRef.current <= 1.01) fitToContainer(false);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fitToContainer, imgSrc]);

  const checker = previewRt.transparencyBg !== false
    && config.transparencyBackground !== false
    && String(config.transparencyBackground || 'Grid').toLowerCase() !== 'none';
  const imageRendering = 'auto' as const;
  const thumbPad = Math.max(0, parseInt(String(config.thumbnailPadding ?? 4), 10) || 4);
  const thumbStyle = String(config.thumbnailStyle || 'Shadow');

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 && (blowUp.onMiddleMouseDown || !!config.onMiddleMouseDown)) {
      scheduleFit();
      e.preventDefault();
      return;
    }
    // Always allow drag-pan in the preview panel (WebView2-safe pointer path).
    if (e.button === 2 && !blowUp.onRightMouseDown) return;
    if (e.button !== 0 && e.button !== 2) return;
    draggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  }, [blowUp.onMiddleMouseDown, blowUp.onRightMouseDown, config.onMiddleMouseDown, scheduleFit]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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

  const endPointerDrag = useCallback((e?: React.PointerEvent) => {
    if (blowUp.stayUp && blowUp.onRightMouseDown) return;
    draggingRef.current = false;
    setIsDragging(false);
    if (e) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
  }, [blowUp.stayUp, blowUp.onRightMouseDown]);

  return (
    <div
      ref={containerRef}
      className={`bndz-image-preview ${checker ? 'bndz-image-preview--checker' : ''} bndz-thumb-style-${thumbStyle.replace(/\s+/g, '-').toLowerCase()}`}
      style={{ ['--bndz-thumb-pad' as string]: `${thumbPad}px` }}
    >
      <div
        ref={stageRef}
        className={`bndz-image-preview-stage ${isDragging ? 'is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onContextMenu={(e) => {
          if (blowUp.onRightMouseDown) e.preventDefault();
        }}
      >
        <div
          ref={transformRef}
          className="bndz-image-preview-transform"
          style={{ transform: 'translate(-50%, -50%) scale(1)' }}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt={alt}
            draggable={false}
            decoding="async"
            className={`bndz-image-preview-img${config.autoRotatePreview ? ' bndz-auto-rotate-preview' : ''}`}
            style={{ imageRendering }}
            onLoad={() => {
              // Always fit PNGs/images to the preview panel on open (not stuck at 100% native).
              scheduleFit();
            }}
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
