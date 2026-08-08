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
  return Math.min(sx, sy, 24);
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
    if (previewRt.zoomToFit || blowVisual.shrinkToFit || blowVisual.zoomToFill) {
      scaleRef.current = 1;
      setDisplayScale(1);
      // fitToContainer runs on image load
    } else {
      const zoomPct = blowUp.applyZoom ? Math.max(10, blowUp.applyZoomBlowUpValue || 100) / 100 : 1;
      scaleRef.current = zoomPct;
      setDisplayScale(zoomPct);
    }
  }, [src, filePath, config, blowUp.applyZoom, blowUp.applyZoomBlowUpValue, previewRt.zoomToFit, blowVisual.shrinkToFit, blowVisual.zoomToFill]);

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
    const measure = blowVisual.zoomToFill ? measureCoverScale : measureContainScale;
    let fit = measure(
      img.naturalWidth,
      img.naturalHeight,
      stage.clientWidth,
      stage.clientHeight,
    );
    // Settings → Limit original preview size (px) caps the fitted native scale.
    if (config.limitOriginalPreviewSize) {
      const maxPx = Math.max(64, Number(config.limitOriginalPreviewSizeValue) || 1600);
      const maxScale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      fit = Math.min(fit, maxScale);
    }
    return fit;
  }, [blowVisual.zoomToFill, config.limitOriginalPreviewSize, config.limitOriginalPreviewSizeValue]);

  const fitToContainer = useCallback((preserveZoom = false) => {
    const stage = stageRef.current;
    if (!stage?.clientWidth || !stage?.clientHeight) return;
    const fit = measureFitScale();
    if (!fit || !Number.isFinite(fit)) return;
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
    const leftOk = e.button === 0 && (blowUp.onLeftMouseDown || blowUp.allowPanning);
    const rightOk = e.button === 2 && blowUp.onRightMouseDown;
    const middleOk = e.button === 1 && (blowUp.onMiddleMouseDown || !!config.onMiddleMouseDown);
    if (!leftOk && !rightOk && !middleOk) return;
    if (!blowUp.allowPanning && e.button === 0 && !blowUp.movementBlowUp) return;
    if (middleOk && e.button === 1) {
      // Middle-down: quick recenter / fit when enabled.
      fitToContainer(false);
      e.preventDefault();
      return;
    }
    draggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, [blowUp.allowPanning, blowUp.movementBlowUp, blowUp.onLeftMouseDown, blowUp.onRightMouseDown, blowUp.onMiddleMouseDown, config.onMiddleMouseDown, fitToContainer]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    if (!blowUp.allowPanning && !blowUp.movementBlowUp) return;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    offsetRef.current = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    };
    scheduleTransform();
  }, [blowUp.allowPanning, blowUp.movementBlowUp, scheduleTransform]);

  const endDrag = useCallback(() => {
    if (blowUp.stayUp && blowUp.onRightMouseDown) return;
    draggingRef.current = false;
    setIsDragging(false);
  }, [blowUp.stayUp, blowUp.onRightMouseDown]);

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
      if (!(previewRt.zoomToFit || blowVisual.shrinkToFit || blowVisual.zoomToFill)) return;
      const nearFit = Math.abs(scaleRef.current - baseFitScaleRef.current) < 0.08;
      if (nearFit || baseFitScaleRef.current <= 1.01) fitToContainer(false);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fitToContainer, imgSrc, previewRt.zoomToFit, blowVisual.shrinkToFit, blowVisual.zoomToFill]);

  const checker = previewRt.transparencyBg !== false
    && config.transparencyBackground !== false
    && String(config.transparencyBackground || 'Grid').toLowerCase() !== 'none';
  const imageRendering = (previewRt.highQuality || !!config.highQualityImageResampling
    || String(config.thumbnailQuality || '') === 'High Quality')
    ? 'auto'
    : 'pixelated';
  const thumbPad = Math.max(0, parseInt(String(config.thumbnailPadding ?? 4), 10) || 4);
  const thumbStyle = String(config.thumbnailStyle || 'Shadow');

  return (
    <div
      ref={containerRef}
      className={`bndz-image-preview ${checker ? 'bndz-image-preview--checker' : ''} bndz-thumb-style-${thumbStyle.replace(/\s+/g, '-').toLowerCase()}`}
      style={{ ['--bndz-thumb-pad' as string]: `${thumbPad}px` }}
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
          style={{ transform: 'translate(-50%, -50%) scale(1)' }}
        >
          <img
            ref={imgRef}
            src={imgSrc}
            alt={alt}
            draggable={false}
            className={`bndz-image-preview-img${config.autoRotatePreview ? ' bndz-auto-rotate-preview' : ''}`}
            style={{ imageRendering }}
            onLoad={() => {
              if (previewRt.zoomToFit || blowVisual.shrinkToFit || blowVisual.zoomToFill) fitToContainer(false);
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
