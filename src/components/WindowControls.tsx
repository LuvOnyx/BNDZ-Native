import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { IPC } from '../lib/ipcBridge';

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

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

  if (!IPC.isNative) return null;

  return (
    <div className="flex h-full shrink-0 ml-auto">
      <button
        type="button"
        data-window-btn
        title="Minimize"
        onClick={() => IPC.windowChrome('minimize')}
        className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        data-window-btn
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => IPC.windowChrome('maximize')}
        className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
      >
        {maximized ? <Copy size={12} className="rotate-180" /> : <Square size={12} />}
      </button>
      <button
        type="button"
        data-window-btn
        title="Close"
        onClick={() => IPC.windowChrome('close')}
        className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#e81123] hover:text-white transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
