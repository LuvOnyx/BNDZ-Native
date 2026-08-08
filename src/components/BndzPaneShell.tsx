import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IPC } from '../lib/ipcBridge';
import {
  applyPaneDocumentMark,
  paneTitle,
  type BndzPaneBoot,
  type BndzPaneKind,
} from '../lib/paneBoot';
import { routeCommandDeckTool } from '../lib/paneCommandDeck';
import { usePluginRegistry } from '../data/PluginRegistryContext';
import { useAppConfig } from '../data/configContext';
import BottomPluginPanel from './BottomPluginPanel';
import BndzAutomationView from './views/BndzAutomationView';
import BndzSpatialCanvasView from './views/BndzSpatialCanvasView';
import RightPreviewPanel from './RightPreviewPanel';
import CommandDeckShell from '../workstation/command-deck/CommandDeckShell';
import { deriveSelectionSignature } from '../workstation/selectionSignature';
import type { ContextToolId } from '../workstation/command-deck/contextToolRegistry';
import { Icons8Icon } from './Icons8Icon';
import type { FSEntity } from '../types';
import SmartToolsDialog from './SmartToolsDialog';
import { PluginStoreDialog } from './PluginStoreDialog';
import ConfigurationDialog from './ConfigurationDialog';

type Props = {
  initial: BndzPaneBoot;
};

type PaneContextMsg = {
  path?: string;
  selectedPaths?: string[];
  selectedNames?: string[];
  selectedTypes?: string[];
  selectedSizes?: number[];
  selectedModified?: string[];
};

function postToHost(type: string, payload: Record<string, unknown>) {
  try {
    (window as any).chrome?.webview?.postMessage({ type, payload });
  } catch {
    /* ignore */
  }
}

/**
 * FilesMerge-hosted pane shell.
 * Hybrid: Files owns shell geometry; React owns real BNDZ surfaces
 * (plugins dock, preview, Automation, Spatial, Hub, Config).
 */
export default function BndzPaneShell({ initial }: Props) {
  const [boot, setBoot] = useState(initial);
  const [ctx, setCtx] = useState<PaneContextMsg>({ path: initial.path });
  const [pathContentsCache, setPathContentsCache] = useState<Record<string, any[]>>({});
  const [toast, setToast] = useState<{ msg: string; tone?: 'info' | 'warning' } | null>(null);
  const [immersive, setImmersive] = useState(false);
  const { pluginRegistry } = usePluginRegistry();
  const { config, updateConfig } = useAppConfig();

  useEffect(() => {
    applyPaneDocumentMark(boot);
    document.title = `BNDZ · ${paneTitle(boot)}`;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('pane', boot.pane);
      if (boot.plugin) url.searchParams.set('plugin', boot.plugin);
      else url.searchParams.delete('plugin');
      window.history.replaceState({}, '', url.toString());
    } catch {
      /* ignore */
    }
  }, [boot]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    IPC.init();
    IPC.notifyUiReady();

    const onMsg = (e: MessageEvent) => {
      try {
        const raw = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const data = raw?.type ? raw : raw?.data?.type ? raw.data : raw;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'BNDZ_PANE_SWITCH' && data.payload?.pane) {
          setBoot((prev) => ({
            ...prev,
            pane: data.payload.pane as BndzPaneKind,
            plugin: data.payload.plugin || prev.plugin,
            path: data.payload.path || prev.path,
          }));
          return;
        }
        if (data.type === 'BNDZ_PANE_CONTEXT') {
          const payload = data.payload || {};
          setCtx({
            path: payload.path ? String(payload.path) : undefined,
            selectedPaths: Array.isArray(payload.selectedPaths)
              ? payload.selectedPaths.map(String)
              : undefined,
            selectedNames: Array.isArray(payload.selectedNames)
              ? payload.selectedNames.map(String)
              : undefined,
            selectedTypes: Array.isArray(payload.selectedTypes)
              ? payload.selectedTypes.map(String)
              : undefined,
            selectedSizes: Array.isArray(payload.selectedSizes)
              ? payload.selectedSizes.map((n: unknown) => Number(n) || 0)
              : undefined,
            selectedModified: Array.isArray(payload.selectedModified)
              ? payload.selectedModified.map(String)
              : undefined,
          });
        }
      } catch {
        /* ignore */
      }
    };
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
    return () => (window as any).chrome?.webview?.removeEventListener('message', onMsg);
  }, []);

  // Folder listing for plugins / preview filmstrip — classic pathContentsCache parity.
  useEffect(() => {
    const folder = ctx.path;
    if (!folder || !IPC.isNative) return;
    let cancelled = false;
    void IPC.getDirContents(folder)
      .then((items) => {
        if (cancelled || !Array.isArray(items)) return;
        setPathContentsCache((prev) => ({ ...prev, [folder]: items }));
      })
      .catch(() => {
        /* offline / missing — plugins fall back to selection-only */
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.path]);

  const installedPluginIds = useMemo(() => {
    const saved = (config as { installedPlugins?: string[] }).installedPlugins;
    if (Array.isArray(saved)) return saved.filter(Boolean);
    return pluginRegistry
      .filter((p: { isInstalled?: boolean }) => p.isInstalled === true)
      .map((p: { id: string }) => p.id);
  }, [config, pluginRegistry]);

  const selectedPaths = useMemo(
    () => ctx.selectedPaths || (ctx.path ? [ctx.path] : []),
    [ctx.path, ctx.selectedPaths],
  );

  const signature = useMemo(
    () => deriveSelectionSignature(selectedPaths, ctx.selectedTypes || []),
    [selectedPaths, ctx.selectedTypes],
  );

  const deckSignature = useMemo(() => {
    if (signature.kind !== 'empty') return signature;
    const folderPath = ctx.path || '';
    if (!folderPath) return signature;
    return deriveSelectionSignature([folderPath], ['directory']);
  }, [signature, ctx.path]);

  const openPluginTab = useCallback((pluginId: string) => {
    setBoot((prev) => ({ ...prev, pane: 'plugins', plugin: pluginId }));
    postToHost('BNDZ_PANE_SWITCH', { pane: 'plugins', plugin: pluginId });
  }, []);

  const onCommandDeckTool = useCallback((id: ContextToolId) => {
    const route = routeCommandDeckTool(id);
    postToHost('BNDZ_PANE_TOOL', {
      tool: id,
      path: ctx.path,
      selectedPaths,
      route,
    });

    switch (route.kind) {
      case 'plugin':
        openPluginTab(route.pluginId);
        break;
      case 'preview':
        if (route.inspection) {
          updateConfig({ inspectionShaderMode: route.inspection });
        }
        if (route.tab) {
          window.dispatchEvent(new CustomEvent('bndz-preview-tab', { detail: { tab: route.tab } }));
        }
        postToHost('BNDZ_PANE_SWITCH', { pane: 'preview' });
        break;
      case 'pane':
        postToHost('BNDZ_PANE_SWITCH', { pane: route.pane });
        break;
      case 'host':
        if (route.tool === 'index-folder') {
          const folderPath = selectedPaths[0] || ctx.path;
          if (folderPath) void IPC.indexBndzLocation(folderPath);
        }
        break;
      default: {
        const _exhaustive: never = route;
        return _exhaustive;
      }
    }
  }, [ctx.path, selectedPaths, openPluginTab, updateConfig]);

  const onNavigate = useCallback((path: string) => {
    setCtx((prev) => ({ ...prev, path }));
    postToHost('BNDZ_PANE_NAVIGATE', { path });
  }, []);

  const onSelectPath = useCallback((path: string) => {
    postToHost('BNDZ_PANE_NAVIGATE', { path });
  }, []);

  const onToast = useCallback((msg: string, tone?: 'info' | 'warning') => {
    setToast({ msg, tone });
  }, []);

  const onOpenPluginStore = useCallback(() => {
    postToHost('BNDZ_PANE_SWITCH', { pane: 'marketplace' });
  }, []);

  const previewEntity: FSEntity | null = useMemo(() => {
    if (!selectedPaths[0]) return null;
    const name = ctx.selectedNames?.[0] || selectedPaths[0].split(/[/\\]/).pop() || selectedPaths[0];
    const isDir = (ctx.selectedTypes?.[0] || '').toLowerCase() === 'directory';
    const size = ctx.selectedSizes?.[0] ?? 0;
    const modified = ctx.selectedModified?.[0] || '';
    return {
      id: selectedPaths[0],
      name,
      path: selectedPaths[0],
      type: isDir ? 'directory' : 'file',
      size,
      modified,
      created: '',
      extension: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '',
    } as FSEntity;
  }, [selectedPaths, ctx.selectedNames, ctx.selectedTypes, ctx.selectedSizes, ctx.selectedModified]);

  const selectedItems = selectedPaths.map((p, i) => ({
    id: p,
    name: ctx.selectedNames?.[i] || p.split(/[/\\]/).pop() || p,
    path: p,
    isDirectory: (ctx.selectedTypes?.[i] || '').toLowerCase() === 'directory',
    size: ctx.selectedSizes?.[i] ?? 0,
  }));

  const isPluginsDock = boot.pane === 'plugins';
  const isPreviewPane = boot.pane === 'preview';
  const isWorkspaceTool = boot.pane === 'automation' || boot.pane === 'canvas';
  const isWorkspaceDialog =
    boot.pane === 'smart-tools' || boot.pane === 'marketplace' || boot.pane === 'settings';
  const isWorkspaceContent = isWorkspaceTool || isWorkspaceDialog;
  // Preview: no BNDZ-NATIVE chrome — Workspace/Details sit at the top edge; flush to host.
  const isFlushHost = isPluginsDock || isWorkspaceContent || isPreviewPane;

  let body: React.ReactNode;
  switch (boot.pane) {
    case 'automation':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--workspace bndz-native-pane-surface--content-flush">
          <BndzAutomationView />
        </div>
      );
      break;
    case 'canvas':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--workspace bndz-native-pane-surface--content-flush">
          <BndzSpatialCanvasView onNavigate={onNavigate} onOpenPath={onNavigate} />
        </div>
      );
      break;
    case 'plugins':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--plugins bndz-native-pane-surface--plugins-dock">
          {config.commandDeck === true && (
            <div className="bndz-native-pane-deck-rail" aria-label="Command Deck">
              <CommandDeckShell
                signature={deckSignature}
                onTool={onCommandDeckTool}
                installedPluginIds={installedPluginIds}
                currentPath={ctx.path || ''}
              />
            </div>
          )}
          <div className="bndz-native-pane-plugins-body">
            <BottomPluginPanel
              entity={previewEntity}
              config={config}
              focusedPath={ctx.path || ''}
              primarySelectedPath={selectedPaths[0] || null}
              requestedTab={boot.plugin || null}
              selectedItems={selectedItems}
              selectedTargetTypes={ctx.selectedTypes || []}
              selectedPaths={selectedPaths}
              currentPath={ctx.path || ''}
              pathContentsCache={pathContentsCache}
              folderSizeMap={{}}
              onNavigate={onNavigate}
              immersive={immersive}
              onExitImmersive={() => setImmersive(false)}
              onEnterImmersive={() => setImmersive(true)}
              onCommandDeckTool={onCommandDeckTool}
              onOpenPluginStore={onOpenPluginStore}
            />
          </div>
        </div>
      );
      break;
    case 'preview':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--preview bndz-native-pane-surface--content-flush bndz-native-pane-surface--preview-flush">
          {previewEntity ? (
            <RightPreviewPanel
              key={`preview-${previewEntity.path}`}
              entity={previewEntity}
              path={previewEntity.path}
              pathContentsCache={pathContentsCache}
              selectionPaths={selectedPaths}
              onNavigate={onNavigate}
              onSelectPath={onSelectPath}
              onToast={onToast}
              onOpenFloatingPreview={() => {
                onToast('Floating preview stays in classic — use Preview column here.', 'info');
              }}
            />
          ) : (
            <div className="bndz-native-pane-empty bndz-native-pane-empty--flush">
              <div className="bndz-native-pane-empty-card">
                <Icons8Icon id="loupe" size={28} />
                <h2>Preview</h2>
                <p>Select a file in the list to preview here.</p>
              </div>
            </div>
          )}
        </div>
      );
      break;
    case 'smart-tools':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--dialog bndz-native-pane-surface--content-flush">
          <SmartToolsDialog
            embedded
            selectedItems={selectedPaths}
            currentPath={ctx.path || ''}
            onNavigate={onNavigate}
          />
        </div>
      );
      break;
    case 'marketplace':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--dialog bndz-native-pane-surface--content-flush">
          <PluginStoreDialog embedded />
        </div>
      );
      break;
    case 'settings':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--dialog bndz-native-pane-surface--content-flush">
          <ConfigurationDialog embedded />
        </div>
      );
      break;
    default: {
      const _exhaustive: never = boot.pane;
      body = _exhaustive;
      break;
    }
  }

  return (
    <div
      className="bndz-native-pane-root"
      data-pane={boot.pane}
      data-dock={isPluginsDock ? 'files' : undefined}
      data-preview={isPreviewPane ? 'files' : undefined}
      data-content={isWorkspaceContent ? 'files' : undefined}
    >
      {!isFlushHost && (
        <header className="bndz-native-pane-chrome" data-pane={boot.pane}>
          <div className="bndz-native-pane-chrome-glow" aria-hidden />
          <div className="bndz-native-pane-chrome-inner">
            <span className="bndz-native-pane-mark" aria-hidden />
            <div className="bndz-native-pane-titles">
              <span className="bndz-native-pane-kicker">BNDZ-Native</span>
              <h1 className="bndz-native-pane-title">{paneTitle(boot)}</h1>
            </div>
            <span className="bndz-native-pane-chip">{boot.pane}</span>
          </div>
        </header>
      )}
      {/* Slim rail only for dialog panes — Spatial/Automation/Preview already own their chrome. */}
      {isWorkspaceDialog && (
        <div className="bndz-native-pane-content-rail" aria-label={paneTitle(boot)}>
          <span className="bndz-native-pane-mark" aria-hidden />
          <span className="bndz-native-pane-kicker">BNDZ-Native</span>
          <span className="bndz-native-pane-content-title">{paneTitle(boot)}</span>
          <span className="bndz-native-pane-chip">{boot.pane}</span>
        </div>
      )}
      <main
        className={`bndz-native-pane-main${isPluginsDock ? ' bndz-native-pane-main--dock' : ''}${
          isWorkspaceContent ? ' bndz-native-pane-main--content' : ''
        }${isPreviewPane ? ' bndz-native-pane-main--preview' : ''}`}
      >
        {body}
      </main>
      <div
        id="bndz-bottom-immersive-host"
        className={`bndz-bottom-immersive-host${immersive ? ' is-open' : ''}`}
        aria-hidden={!immersive}
      />
      {toast && (
        <div className={`bndz-native-pane-toast bndz-native-pane-toast--${toast.tone || 'info'}`} role="status">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
