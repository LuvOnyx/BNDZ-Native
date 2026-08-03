import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { toVirtualStreamUrl, toWindowsPath } from '../../lib/pathUtils';

type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

const DEFAULT_ADJ: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  rotation: 0,
  flipX: false,
  flipY: false,
};

type Props = {
  path: string;
  title?: string;
  onSaved?: (destPath: string) => void;
};

function editedPathFor(sourcePath: string): string {
  const win = toWindowsPath(sourcePath);
  const dot = win.lastIndexOf('.');
  if (dot <= 0) return `${win}_edited`;
  return `${win.slice(0, dot)}_edited${win.slice(dot)}`;
}

function RotateCCWGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8A4.5 4.5 0 0 1 8 3.5V2L5.5 4 8 6V4.5A3.5 3.5 0 1 0 11.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function RotateCWGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M12.5 8A4.5 4.5 0 0 0 8 3.5V2L10.5 4 8 6V4.5A3.5 3.5 0 1 1 4.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function FlipHGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="4" width="5.5" height="8" rx="1" stroke="currentColor" strokeWidth="1.25" opacity="0.55"/>
      <rect x="9" y="4" width="5.5" height="8" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.5 1.5" strokeLinecap="round"/>
    </svg>
  );
}

function FlipVGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4" y="1.5" width="8" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25" opacity="0.55"/>
      <rect x="4" y="9" width="8" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.25"/>
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.5 1.5" strokeLinecap="round"/>
    </svg>
  );
}

export default function ImageMicroEditor({ path, title, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJ);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadImage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAdjust(DEFAULT_ADJ);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
      let src = toVirtualStreamUrl(path);
      if (IPC.isNative) {
        const result = await IPC.getMediaBlob(toWindowsPath(path));
        if (result.base64 && result.mime) {
          const binary = atob(result.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: result.mime });
          src = URL.createObjectURL(blob);
        }
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = src;
      });
      imgRef.current = img;
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to load image');
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void loadImage();
  }, [loadImage]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const rot = ((adjust.rotation % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const w = swap ? img.naturalHeight : img.naturalWidth;
    const h = swap ? img.naturalWidth : img.naturalHeight;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%)`;
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(adjust.flipX ? -1 : 1, adjust.flipY ? -1 : 1);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }, [adjust]);

  useEffect(() => {
    if (!loading && !error) paint();
  }, [loading, error, paint]);

  const reset = () => {
    setAdjust(DEFAULT_ADJ);
    setStatus(null);
  };

  const saveCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setStatus(null);
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
      if (!blob) throw new Error('Export failed');
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const dest = editedPathFor(path);
      const { IPC } = await import('../../lib/ipcBridge');
      const ok = await IPC.writeBinaryFile(dest, base64);
      if (!ok) throw new Error('Could not write file');
      setStatus(`Saved ${dest.split(/[/\\]/).pop()}`);
      onSaved?.(dest);
    } catch (err: any) {
      setStatus(err?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bndz-image-editor flex items-center justify-center h-full gap-2 text-gray-500">
        <Icons8Icon id="loading" size={20} spin />
        <span className="text-xs">Loading image…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bndz-image-editor flex flex-col items-center justify-center h-full gap-2 text-gray-500 p-6 text-center">
        <Icons8Icon id="warning" size={28} className="opacity-70" />
        <p className="text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="bndz-image-editor flex flex-col h-full min-h-0">
      <div className="bndz-image-editor-stage flex-1 min-h-0 flex items-center justify-center p-3 pattern-checkerboard">
        <canvas ref={canvasRef} className="bndz-image-editor-canvas max-w-full max-h-full object-contain" />
      </div>

      <div className="bndz-image-editor-strip shrink-0">
        {/* Title row */}
        <div className="bndz-image-editor-strip-title">
          <img src="/Ui/edit-image.svg" alt="" className="w-3.5 h-3.5 opacity-60" />
          <span className="truncate">{title || 'Image editor'}</span>
        </div>

        {/* Instrument row */}
        <div className="bndz-image-editor-instrument-row">

          {/* Transform rack — rotate & flip wells */}
          <div className="bndz-image-editor-rack" role="group" aria-label="Transform">
            <span className="bndz-image-editor-rack-label">Transform</span>
            <div className="bndz-image-editor-rack-wells">
              <button
                type="button"
                className="bndz-image-editor-well"
                title="Rotate left 90°"
                onClick={() => setAdjust(p => ({ ...p, rotation: p.rotation - 90 }))}
              >
                <RotateCCWGlyph />
              </button>
              <button
                type="button"
                className="bndz-image-editor-well"
                title="Rotate right 90°"
                onClick={() => setAdjust(p => ({ ...p, rotation: p.rotation + 90 }))}
              >
                <RotateCWGlyph />
              </button>
              <button
                type="button"
                className={`bndz-image-editor-well${adjust.flipX ? ' is-active' : ''}`}
                title="Flip horizontal"
                onClick={() => setAdjust(p => ({ ...p, flipX: !p.flipX }))}
              >
                <FlipHGlyph />
              </button>
              <button
                type="button"
                className={`bndz-image-editor-well${adjust.flipY ? ' is-active' : ''}`}
                title="Flip vertical"
                onClick={() => setAdjust(p => ({ ...p, flipY: !p.flipY }))}
              >
                <FlipVGlyph />
              </button>
            </div>
          </div>

          <div className="bndz-image-editor-strip-sep" aria-hidden />

          {/* Adjustments rack */}
          <div className="bndz-image-editor-rack bndz-image-editor-rack--adj" role="group" aria-label="Adjustments">
            <span className="bndz-image-editor-rack-label">Adjustments</span>
            <div className="bndz-image-editor-adj-sliders">
              {(
                [
                  { key: 'brightness', label: 'Brt', min: 40, max: 180, def: 100 },
                  { key: 'contrast',   label: 'Cnt', min: 40, max: 180, def: 100 },
                  { key: 'saturation', label: 'Sat', min: 0,  max: 200, def: 100 },
                ] as const
              ).map(({ key, label, min, max, def }) => (
                <label key={key} className="bndz-image-editor-adj-row">
                  <span className="bndz-image-editor-adj-label">{label}</span>
                  <input
                    type="range"
                    className="bndz-image-editor-slider-input"
                    min={min}
                    max={max}
                    value={adjust[key as keyof typeof adjust] as number}
                    onChange={e => setAdjust(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                  />
                  <span
                    className={`bndz-image-editor-adj-val${(adjust[key as keyof typeof adjust] as number) !== def ? ' is-modified' : ''}`}
                  >
                    {adjust[key as keyof typeof adjust]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="bndz-image-editor-strip-sep" aria-hidden />

          {/* Actions */}
          <div className="bndz-image-editor-rack bndz-image-editor-rack--actions" role="group" aria-label="Actions">
            <span className="bndz-image-editor-rack-label">Output</span>
            <div className="bndz-image-editor-rack-wells bndz-image-editor-rack-wells--col">
              <button
                type="button"
                className="bndz-image-editor-action-btn"
                title="Reset all adjustments"
                onClick={reset}
              >
                <Icons8Icon id="reset_ui" size={13} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                className="bndz-image-editor-action-btn bndz-image-editor-action-btn--primary"
                title="Save as _edited copy"
                onClick={() => void saveCopy()}
                disabled={busy}
              >
                <Icons8Icon id="emblem_checked" size={13} />
                <span>{busy ? 'Saving…' : 'Save copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Status line */}
        {status && (
          <div className="bndz-image-editor-status">
            <span className={status.toLowerCase().includes('fail') || status.toLowerCase().includes('error') ? 'is-error' : ''}>
              {status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
