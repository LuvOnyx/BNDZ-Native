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

  const slider = (label: string, key: keyof Pick<Adjustments, 'brightness' | 'contrast' | 'saturation'>, min: number, max: number) => (
    <label className="bndz-image-editor-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={adjust[key]}
        onChange={e => setAdjust(prev => ({ ...prev, [key]: Number(e.target.value) }))}
      />
      <span className="bndz-mono">{adjust[key]}</span>
    </label>
  );

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
      <div className="bndz-image-editor-toolbar shrink-0 border-t border-white/10 bg-black/25 p-3 flex flex-col gap-2">
        <div className="text-[11px] text-gray-400 truncate" title={title}>{title || 'Image editor'}</div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="bndz-image-editor-btn" onClick={() => setAdjust(p => ({ ...p, rotation: p.rotation - 90 }))} title="Rotate left">
            Rotate L
          </button>
          <button type="button" className="bndz-image-editor-btn" onClick={() => setAdjust(p => ({ ...p, rotation: p.rotation + 90 }))} title="Rotate right">
            Rotate R
          </button>
          <button type="button" className="bndz-image-editor-btn" onClick={() => setAdjust(p => ({ ...p, flipX: !p.flipX }))} title="Flip horizontal">
            Flip H
          </button>
          <button type="button" className="bndz-image-editor-btn" onClick={() => setAdjust(p => ({ ...p, flipY: !p.flipY }))} title="Flip vertical">
            Flip V
          </button>
          <button type="button" className="bndz-image-editor-btn" onClick={reset}>Reset</button>
          <button type="button" className="bndz-image-editor-btn bndz-image-editor-btn--primary" onClick={() => void saveCopy()} disabled={busy}>
            {busy ? 'Saving…' : 'Save copy'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {slider('Brightness', 'brightness', 40, 180)}
          {slider('Contrast', 'contrast', 40, 180)}
          {slider('Saturation', 'saturation', 0, 200)}
        </div>
        {status && <div className="text-[10px] text-emerald-400/90">{status}</div>}
      </div>
    </div>
  );
}
