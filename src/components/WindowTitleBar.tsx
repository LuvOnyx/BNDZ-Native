import React, { useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { IPC } from '../lib/ipcBridge';

const BNDZ_APP_ICON = '/bndz-light.png';

interface WindowTitleBarProps {
  title?: string;
}

export default function WindowTitleBar({ title = 'BNDZ' }: WindowTitleBarProps) {
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

  const onDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
  };

  return (
    <div
      className="h-8 flex items-center shrink-0 bg-[#1a1a1a] border-b border-[#333] select-none z-[200]"
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-window-btn]')) return;
        if (e.button === 0) IPC.windowChrome('drag');
      }}
      onDoubleClick={() => IPC.windowChrome('maximize')}
    >
      <div className="flex items-center gap-2 pl-3 pr-2 min-w-0 flex-1" onMouseDown={onDrag}>
        <img src={BNDZ_APP_ICON} alt="" className="w-5 h-5 object-contain" draggable={false} />
        <span className="text-[11px] font-semibold text-gray-300 tracking-wide truncate">{title}</span>
      </div>
      <div className="flex h-full shrink-0">
        <button
          type="button"
          data-window-btn
          title="Minimize"
          onClick={() => IPC.windowChrome('minimize')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
        >
          <Icons8Icon id="minus_ui" size={14} />
        </button>
        <button
          type="button"
          data-window-btn
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => IPC.windowChrome('maximize')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#333] hover:text-white transition-colors"
        >
          {maximized ? (
            <span className="relative inline-block w-[11px] h-[11px]">
              <span className="absolute right-0 top-0 w-[8px] h-[8px] border border-current" />
              <span className="absolute left-0 bottom-0 w-[8px] h-[8px] border border-current bg-[#1a1a1a]" />
            </span>
          ) : (
            <span className="inline-block w-[11px] h-[11px] border border-current" />
          )}
        </button>
        <button
          type="button"
          data-window-btn
          title="Close"
          onClick={() => IPC.windowChrome('close')}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:bg-[#e81123] hover:text-white transition-colors"
        >
          <Icons8Icon id="close" size={14} />
        </button>
      </div>
    </div>
  );
}
