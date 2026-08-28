import React, { useEffect, useMemo, useState } from 'react';
import WindowTitleBar from './WindowTitleBar';
import StickyWidgetEditor from './StickyWidgetEditor';
import BndzErrorBoundary from './BndzErrorBoundary';
import { usePluginRegistry } from '../data/PluginRegistryContext';
import { useAppConfig } from '../data/configContext';
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
  const { config } = useAppConfig();
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
    return () => {
      (window as any).chrome?.webview?.removeEventListener('message', onMsg);
    };
  }, []);

  const stickyMode = isStickyPluginMode(boot);
  const installedIds = (config.installedPlugins as string[] | undefined) || [];
  const plugin = useMemo(
    () => pluginRegistry.find((p: { id: string }) => p.id === boot.pluginId),
    [pluginRegistry, boot.pluginId],
  );
  const pluginReady = stickyMode || (plugin?.component && installedIds.includes(boot.pluginId));

  const title = boot.title
    || (stickyMode ? (plugin?.name || 'Sticky') : (plugin?.name || boot.pluginId));

  useEffect(() => {
    document.title = stickyMode ? (title || 'Sticky') : `BNDZ · ${title}`;
  }, [title, stickyMode]);

  const body = stickyMode ? (
    <StickyWidgetEditor stickyId={boot.stickyId} />
  ) : plugin?.component && pluginReady ? (
    (() => {
      const Active = plugin.component;
      return (
        <div className="bndz-plugin-popout-surface flex-1 min-h-0 flex flex-col overflow-hidden">
          <BndzErrorBoundary isolate label={`PluginPopout:${boot.pluginId}`} resetKey={boot.pluginId}>
            <Active
              isPluginTabActive
              immersive
              popout
              selectedItems={[]}
              selectedPaths={[]}
              currentPath=""
            />
          </BndzErrorBoundary>
        </div>
      );
    })()
  ) : (
    <div className="bndz-plugin-popout-missing flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 px-6 text-center">
      <p className="text-sm font-semibold text-gray-200">Loading plugin…</p>
      <p className="text-[12px] max-w-sm">
        {installedIds.includes(boot.pluginId)
          ? `Loading “${boot.pluginId}”…`
          : `“${boot.pluginId}” is not installed — open Extension Hub in the main window, install it, then pop out again.`}
      </p>
    </div>
  );

  return (
    <div className={`bndz-plugin-popout-shell h-screen w-screen flex flex-col overflow-hidden ${stickyMode ? 'bndz-plugin-popout-shell--sticky' : 'bg-[#0c0c10]'}`}>
      {!stickyMode && <WindowTitleBar title={`BNDZ · ${title}`} />}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {body}
      </div>
    </div>
  );
}
