import React, { useEffect, useMemo, useState } from 'react';
import WindowTitleBar from './WindowTitleBar';
import StickyWidgetEditor from './StickyWidgetEditor';
import BndzErrorBoundary from './BndzErrorBoundary';
import MeshDropDialog from './meshdrop/MeshDropDialog';
import TransferActivityToast from './TransferActivityToast';
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

function navigateMainList(path: string) {
  const p = (path || '').trim();
  if (!p) return;
  // Pop-out has no BNDZUI list — ask the host to open in the main FM window.
  void IPC.hostNavigate(p);
}

/** Slim second-process chrome — one plugin (or sticky widget) fills the viewport. */
export default function PluginPopoutShell({ initial }: Props) {
  const { pluginRegistry } = usePluginRegistry();
  const { config } = useAppConfig();
  const [boot, setBoot] = useState<PluginWindowBoot>(initial);
  const [meshDropOpen, setMeshDropOpen] = useState(false);
  const [meshDropPaths, setMeshDropPaths] = useState<string[]>([]);
  const [meshDropMode, setMeshDropMode] = useState<'host' | 'receive'>('host');

  useEffect(() => {
    const onMeshDropSend = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const raw = detail.paths as string[] | undefined;
      const paths = Array.isArray(raw) ? raw.filter(Boolean) : [];
      setMeshDropPaths(paths);
      setMeshDropMode(detail.receive ? 'receive' : 'host');
      setMeshDropOpen(true);
    };
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (typeof path === 'string' && path.trim()) navigateMainList(path);
    };
    window.addEventListener('bndz-mesh-drop-send', onMeshDropSend);
    window.addEventListener('bndz-navigate', onNavigate);
    return () => {
      window.removeEventListener('bndz-mesh-drop-send', onMeshDropSend);
      window.removeEventListener('bndz-navigate', onNavigate);
    };
  }, []);

  useEffect(() => {
    IPC.init();
    IPC.notifyUiReady();
    document.documentElement.dataset.bndzPluginPopout = '1';

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
      delete document.documentElement.dataset.bndzPluginPopout;
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
              onNavigate={navigateMainList}
            />
          </BndzErrorBoundary>
        </div>
      );
    })()
  ) : (
    <div className="bndz-plugin-popout-missing flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 px-6 text-center">
      <div className="bndz-plugin-popout-missing-orb" aria-hidden />
      <p className="text-sm font-semibold text-gray-200">Loading plugin…</p>
      <p className="text-[12px] max-w-sm leading-relaxed">
        {installedIds.includes(boot.pluginId)
          ? `Warming “${boot.pluginId}”…`
          : `“${boot.pluginId}” is not installed — open Extension Hub in the main window, install it, then pop out again.`}
      </p>
    </div>
  );

  return (
    <div className={`bndz-plugin-popout-shell h-screen w-screen flex flex-col overflow-hidden ${stickyMode ? 'bndz-plugin-popout-shell--sticky' : ''}`}>
      {!stickyMode && (
        <div className="bndz-plugin-popout-chrome shrink-0" data-bndz-drag-region="1">
          <div className="bndz-plugin-popout-chrome-brand" aria-hidden>
            <span className="bndz-plugin-popout-chrome-sigil">
              <img src="/Bndz-main.png" alt="" width={14} height={14} className="object-contain" draggable={false} />
            </span>
            <span className="bndz-plugin-popout-chrome-word">BNDZ</span>
          </div>
          <div className="bndz-plugin-popout-chrome-title min-w-0 flex-1">
            <WindowTitleBar title={title} />
          </div>
        </div>
      )}
      <div className="bndz-plugin-popout-body flex-1 min-h-0 flex flex-col overflow-hidden">
        {body}
      </div>
      <TransferActivityToast />
      {meshDropOpen && (
        <MeshDropDialog
          paths={meshDropPaths}
          initialMode={meshDropMode}
          onClose={() => { setMeshDropOpen(false); setMeshDropPaths([]); setMeshDropMode('host'); }}
        />
      )}
    </div>
  );
}
