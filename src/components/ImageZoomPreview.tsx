import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { toWindowsPath } from '../lib/pathUtils';
import { useAppConfig } from '../data/configContext';
import { getBlowUpBehavior, getBlowUpMouseBehavior } from '../lib/settingsBehavior';
import { applyWebPathMap } from '../lib/listReportExport';
import { buildSettingsRuntime } from '../lib/settingsRuntime';
import InspectionLens2D from '../workstation/inspection/InspectionLens2D';
import type { InspectionShaderMode } from '../workstation/inspection/InspectionViewportRouter';

interface ImageZoomPreviewProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
  filePath?: string | null;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onOpenFloating?: () => void;
  inspectionMode?: InspectionShaderMode;
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
  src, alt, fallbackSrc, filePath, onError, onOpenFloating, inspectionMode = 'passthrough',
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
  const userAdjustedRef = useRef(false);
  const lastDisplayRef = useRef(1);
  const lastRoSizeRef = useRef({ w: 0, h: 0 });
  const fittingRef = useRef(false);
  const inspectionModeRef = useRef(inspectionMode);
  inspectionModeRef.current = inspectionMode;
  const displayScaleRef = useRef(displayScale);
  displayScaleRef.current = displayScale;

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);

  const pathMapEnabled = config.enableServerMappings !== false;
  const limitOrig = !!config.limitOriginalPreviewSize;
  const limitOrigPx = Number(config.limitOriginalPreviewSizeValue) || 1600;
  const zoomToFill = !!blowVisual.zoomToFill;

  useEffect(() => {
    blobTriedRef.current = false;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setImgSrc(pathMapEnabled ? applyWebPathMap(config, src) : src);
    offsetRef.current = { x: 0, y: 0 };
    baseFitScaleRef.current = 1;
    userAdjustedRef.current = false;
    scaleRef.current = 1;
    lastDisplayRef.current = 1;
    lastRoSizeRef.current = { w: 0, h: 0 };
    setDisplayScale(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional narrow deps
  }, [src, filePath, pathMapEnabled]);

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
      // Hard cap — decoding multi‑MB base64 on the UI thread freezes WebView2.
      const result = await IPC.getMediaBlob(toWindowsPath(filePath), 2 * 1024 * 1024);
      if (!result.base64 || !result.mime || result.error) return false;
      if (result.base64.length > 2.8e6) return false; // ~2MB binary ≈ 2.7M b64 chars
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      const chunk = 0x8000;
      for (let i = 0; i < binary.length; i += chunk) {
        const end = Math.min(i + chunk, binary.length);
        for (let j = i; j < end; j++) bytes[j] = binary.charCodeAt(j);
        if (end < binary.length) {
          // Yield so selection / scroll / inspection clicks stay responsive.
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
      }
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
    // Luma filter comes from CSS classes (.is-luma / --luma) — never inline blowout.
    el.style.filter = '';
    rafRef.current = null;
  }, []);

  const scheduleTransform = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(applyTransform);
  }, [applyTransform]);

  const setScaleImmediate = useCallback((next: number, fromUser = true) => {
    if (fromUser) userAdjustedRef.current = true;
    const fit = baseFitScaleRef.current > 0 ? baseFitScaleRef.current : 1;
    const minScale = Math.max(0.05, fit * 0.2);
    const clamped = Math.min(24, Math.max(minScale, next));
    scaleRef.current = clamped;
    // Avoid setState churn — ResizeObserver + fit feedback loops froze the WebView.
    if (Math.abs(lastDisplayRef.current - clamped) > 0.002) {
      lastDisplayRef.current = clamped;
      setDisplayScale(clamped);
    }
    const stage = stageRef.current;
    const img = imgRef.current;
    if (stage && img?.naturalWidth) {
      const s = clamped;
      const maxX = Math.max(48, Math.abs(img.naturalWidth * s - stage.clientWidth) / 2);
      const maxY = Math.max(48, Math.abs(img.naturalHeight * s - stage.clientHeight) / 2);
      offsetRef.current = {
        x: Math.max(-maxX, Math.min(maxX, offsetRef.current.x)),
        y: Math.max(-maxY, Math.min(maxY, offsetRef.current.y)),
      };
    }
    scheduleTransform();
  }, [scheduleTransform]);

  const measureFitScale = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img?.naturalWidth || !stage) return 1;
    const boxW = stage.clientWidth;
    const boxH = stage.clientHeight;
    if (boxW < 8 || boxH < 8) return 1;
    const measure = zoomToFill ? measureCoverScale : measureContainScale;
    let fit = measure(img.naturalWidth, img.naturalHeight, boxW, boxH);
    if (!zoomToFill) {
      fit = Math.min(fit, 1);
    }
    if (limitOrig) {
      const maxPx = Math.max(64, limitOrigPx);
      const maxScale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      fit = Math.min(fit, maxScale);
    }
    return Math.max(0.05, fit);
  }, [zoomToFill, limitOrig, limitOrigPx]);

  const fitToContainer = useCallback((preserveZoom = false) => {
    const stage = stageRef.current;
    if (!stage?.clientWidth || !stage?.clientHeight) return false;
    const fit = measureFitScale();
    if (!fit || !Number.isFinite(fit)) return false;
    baseFitScaleRef.current = fit;
    if (!preserveZoom) {
      offsetRef.current = { x: 0, y: 0 };
      userAdjustedRef.current = false;
      setScaleImmediate(fit, false);
    }
    return true;
  }, [measureFitScale, setScaleImmediate]);

  const scheduleFit = useCallback(() => {
    const tryFit = (attempt: number) => {
      if (fitToContainer(false)) return;
      if (attempt >= 12) return;
      window.requestAnimationFrame(() => tryFit(attempt + 1));
    };
    tryFit(0);
  }, [fitToContainer]);

  const zoomIn = () => setScaleImmediate(scaleRef.current + 0.25, true);
  const zoomOut = () => setScaleImmediate(scaleRef.current - 0.25, true);
  const reset = () => {
    offsetRef.current = { x: 0, y: 0 };
    setScaleImmediate(1, true);
  };
  const fit = () => { scheduleFit(); };

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setScaleImmediate(scaleRef.current + (e.deltaY < 0 ? 0.15 : -0.15), true);
    };
    const targets = [containerRef.current, stageRef.current].filter(Boolean) as HTMLElement[];
    targets.forEach((el) => el.addEventListener('wheel', onWheel, { passive: false }));
    return () => targets.forEach((el) => el.removeEventListener('wheel', onWheel));
  }, [setScaleImmediate, imgSrc, isDragging]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (fittingRef.current) return;
      cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (w < 8 || h < 8) return;
        const prev = lastRoSizeRef.current;
        // Ignore sub-pixel / flex thrash that used to spin fit forever and freeze UI.
        if (Math.abs(prev.w - w) < 3 && Math.abs(prev.h - h) < 3) return;
        lastRoSizeRef.current = { w, h };

        if (userAdjustedRef.current) {
          const nextFit = measureFitScale();
          if (nextFit && Number.isFinite(nextFit)) baseFitScaleRef.current = nextFit;
          return;
        }

        fittingRef.current = true;
        try {
          fitToContainer(false);
        } finally {
          window.requestAnimationFrame(() => { fittingRef.current = false; });
        }
      });
    });
    ro.observe(stage);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fitToContainer, measureFitScale, imgSrc]);

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
    userAdjustedRef.current = true;
    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    const stage = stageRef.current;
    const img = imgRef.current;
    let nx = offsetRef.current.x + dx;
    let ny = offsetRef.current.y + dy;
    if (stage && img?.naturalWidth) {
      const s = scaleRef.current;
      const maxX = Math.max(48, Math.abs(img.naturalWidth * s - stage.clientWidth) / 2);
      const maxY = Math.max(48, Math.abs(img.naturalHeight * s - stage.clientHeight) / 2);
      nx = Math.max(-maxX, Math.min(maxX, nx));
      ny = Math.max(-maxY, Math.min(maxY, ny));
    }
    offsetRef.current = { x: nx, y: ny };
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

  useEffect(() => {
    const needsBlob =
      (inspectionMode === 'histogram' || inspectionMode === 'loupe')
      && filePath
      && (imgSrc.startsWith('bndz-stream:') || imgSrc.includes('/local-stream/'));
    if (!needsBlob) return;
    void tryBlobFallback();
  }, [inspectionMode, filePath, imgSrc, tryBlobFallback]);

  const isLuma = inspectionMode === 'histogram';
  const isLoupe = inspectionMode === 'loupe';

  useEffect(() => {
    scheduleTransform();
  }, [inspectionMode, scheduleTransform]);

  useLayoutEffect(() => {
    applyTransform();
  }, [applyTransform, inspectionMode]);

  return (
    <div
      ref={containerRef}
      data-bndz-workspace-surface="preview"
      data-inspect={inspectionMode}
      className={`bndz-image-preview ${checker ? 'bndz-image-preview--checker' : ''} bndz-thumb-style-${thumbStyle.replace(/\s+/g, '-').toLowerCase()}${isLuma ? ' is-luma' : ''}${isLoupe ? ' is-loupe' : ''}`}
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
          className={`bndz-image-preview-transform${isLuma ? ' bndz-image-preview-transform--luma' : ''}`}
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
              scheduleFit();
            }}
            onError={(e) => {
              // Prefer the already-warm CAS/shell thumb — never jump straight into a
              // multi‑MB GET_MEDIA_BLOB + atob that freezes the host on PNG/ICO open.
              if (fallbackSrc && imgSrc !== fallbackSrc) {
                setImgSrc(fallbackSrc);
                return;
              }
              void tryBlobFallback().then((ok) => {
                if (!ok) onError?.(e);
              });
            }}
          />
        </div>
        {isLoupe && (
          <InspectionLens2D
            mode="loupe"
            stageRef={stageRef}
            imgRef={imgRef}
            displayScale={displayScale}
          />
        )}
      </div>

      <div className="bndz-image-preview-chrome">
        <span className="bndz-image-preview-hint">
          {isLoupe ? 'Scroll zoom · Drag pan · Move cursor for loupe' : isLuma ? 'Luma · Scroll zoom · Drag pan' : 'Scroll to zoom · Drag to pan'}
        </span>
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
              <button type="button" onClick={onOpenFloating} className="bndz-media-transport-btn" title="Quick Look">
                <Icons8Icon id="preview" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
