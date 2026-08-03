import React, { useEffect, useMemo, useState } from 'react';
import WindowTitleBar from './WindowTitleBar';
import StickyWidgetEditor from './StickyWidgetEditor';
import { usePluginRegistry } from '../data/PluginRegistryContext';
import { IPC } from '../lib/ipcBridge';
import {
  isStickyPluginMode,
  type PluginWindowBoot,
} from '../lib/pluginWindowBoot';

type Props = {
  initial: PluginWindowBoot;
};

/** Slim second-process chrome — one plugin (or sticky widget) fills the viewport. */
export default function PluginPopoutShell({ initial }: Props) {
  const { pluginRegistry } = usePluginRegistry();
  const [boot, setBoot] = useState<PluginWindowBoot>(initial);

  useEffect(() => {
    IPC.init();
    IPC.notifyUiReady();

    const onMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.type !== 'BNDZ_PLUGIN_WINDOW') return;
        const payload = data.payload || {};
        if (!payload.pluginId) return;
        setBoot({
          pluginId: String(payload.pluginId),
          stickyId: payload.stickyId ? String(payload.stickyId) : undefined,
          title: payload.title ? String(payload.title) : undefined,
        });
      } catch { /* ignore */ }
    };
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
    return () => (window as any).chrome?.webview?.removeEventListener('message', onMsg);
  }, []);

  const stickyMode = isStickyPluginMode(boot);
  const plugin = useMemo(
    () => pluginRegistry.find((p: { id: string }) => p.id === boot.pluginId),
    [pluginRegistry, boot.pluginId],
  );

  const title = boot.title
    || (stickyMode ? (plugin?.name || 'Sticky') : (plugin?.name || boot.pluginId));

  useEffect(() => {
    document.title = `BNDZ · ${title}`;
  }, [title]);

  const body = stickyMode ? (
    <StickyWidgetEditor stickyId={boot.stickyId} />
  ) : plugin?.component ? (
    (() => {
      const Active = plugin.component;
      return (
        <div className="bndz-plugin-popout-surface flex-1 min-h-0 flex flex-col overflow-hidden">
          <Active
            isPluginTabActive
            immersive
            popout
            selectedItems={[]}
            selectedPaths={[]}
            currentPath=""
          />
        </div>
      );
    })()
  ) : (
    <div className="bndz-plugin-popout-missing flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 px-6 text-center">
      <p className="text-sm font-semibold text-gray-200">Plugin unavailable</p>
      <p className="text-[12px] max-w-sm">
        “{boot.pluginId}” is not installed in this session. Install it from Extension Hub in the main window, then pop out again.
      </p>
    </div>
  );

  return (
    <div className="bndz-plugin-popout-shell h-screen w-screen flex flex-col overflow-hidden bg-[#0c0c10]">
      <WindowTitleBar title={`BNDZ · ${title}`} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {body}
      </div>
    </div>
  );
}
