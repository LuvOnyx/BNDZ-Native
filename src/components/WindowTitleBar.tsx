import React, { useEffect, useRef, useState } from 'react';
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph } from './ChromeGlyphs';
import { IPC } from '../lib/ipcBridge';

const BNDZ_APP_ICON = '/Bndz-main.png';
const DRAG_THRESHOLD_PX = 5;

interface WindowTitleBarProps {
  title?: string;
  /** When true (plugin pop-out), prefer native Caption -- avoid IPC drag on every mousedown. */
  nativeCaptionDrag?: boolean;
}

export default function WindowTitleBar({ title = 'BNDZ', nativeCaptionDrag = false }: WindowTitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const dragArmedRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!IPC.isNative) return;
    IPC.getWindowState().then(s => setMaximized(!!s?.maximized)).catch(() => {});
    const onMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.type === 'WINDOW_STATE_CHANGED') {
          setMaximized(!!data.payload?.maximized);
        }
      } catch { /* ignore */ }
    };
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
    return () => (window as any).chrome?.webview?.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (nativeCaptionDrag) return;
    const onMove = (e: PointerEvent) => {
      const armed = dragArmedRef.current;
      if (!armed || e.pointerId !== armed.pointerId) return;
      const dx = Math.abs(e.clientX - armed.x);
      const dy = Math.abs(e.clientY - armed.y);
      if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
      dragArmedRef.current = null;
      IPC.windowChrome('drag');
    };
    const clear = () => { dragArmedRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, [nativeCaptionDrag]);

  if (!IPC.isNative) return null;

  return (
    <div
      className="h-8 flex items-center shrink-0 bg-[#1a1a1a] border-b border-[#333] select-none z-[200]"
      style={nativeCaptionDrag ? { appRegion: 'drag', WebkitAppRegion: 'drag' } as React.CSSProperties : undefined}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('[data-window-btn]')) return;
        if (e.button !== 0) return;
        // Plugin windows use native Caption regions -- bare click must not arm IPC drag.
        if (nativeCaptionDrag) return;
        e.preventDefault();
        dragArmedRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      }}
      onDoubleClick={() => IPC.windowChrome('maximize')}
    >
      <div className="flex items-center gap-2 pl-3 pr-2 min-w-0 flex-1">
        <img src={BNDZ_APP_ICON} alt="" className="w-6 h-6 rounded-[5px] object-cover object-center shrink-0 scale-[0.98]" draggable={false} />
        <span className="text-[11px] font-semibold text-gray-300 tracking-wide truncate">{title}</span>
      </div>
      <div
        className="flex h-full shrink-0"
        style={nativeCaptionDrag ? { appRegion: 'no-drag', WebkitAppRegion: 'no-drag' } as React.CSSProperties : undefined}
      >
        <button
          type="button"
          data-window-btn
          title="Minimize"
          onClick={() => IPC.windowChrome('minimize')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
        >
          <MinimizeGlyph size={14} />
        </button>
        <button
          type="button"
          data-window-btn
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => IPC.windowChrome('maximize')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
        >
          <MaximizeGlyph restored={maximized} bg="#1a1a1a" />
        </button>
        <button
          type="button"
          data-window-btn
          title="Close"
          onClick={() => IPC.windowChrome('close')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#e81123] hover:text-white transition-colors"
        >
          <CloseGlyph size={14} />
        </button>
      </div>
    </div>
  );
}
