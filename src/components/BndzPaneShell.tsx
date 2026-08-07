import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IPC } from '../lib/ipcBridge';
import {
  applyPaneDocumentMark,
  paneTitle,
  type BndzPaneBoot,
  type BndzPaneKind,
} from '../lib/paneBoot';
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

type Props = {
  initial: BndzPaneBoot;
};

type PaneContextMsg = {
  path?: string;
  selectedPaths?: string[];
  selectedNames?: string[];
  selectedTypes?: string[];
};

/**
 * FilesMerge-hosted pane shell — BNDZ surfaces only (no classic 17/71/12 FM layout).
 * Soft squircle paper, depth, aurora edge — distinctive FM craft, not SaaS chrome.
 */
export default function BndzPaneShell({ initial }: Props) {
  const [boot, setBoot] = useState(initial);
  const [ctx, setCtx] = useState<PaneContextMsg>({ path: initial.path });
  const { pluginRegistry } = usePluginRegistry();
  const { config } = useAppConfig();

  useEffect(() => {
    applyPaneDocumentMark(boot);
    document.title = `BNDZ · ${paneTitle(boot)}`;
  }, [boot]);

  useEffect(() => {
    IPC.init();
    IPC.notifyUiReady();

    const onMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
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
          });
        }
      } catch {
        /* ignore */
      }
    };
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
    return () => (window as any).chrome?.webview?.removeEventListener('message', onMsg);
  }, []);

  const installedPluginIds = useMemo(() => {
    const saved = (config as { installedPlugins?: string[] }).installedPlugins;
    if (Array.isArray(saved) && saved.length) return saved;
    return pluginRegistry.map((p: { id: string }) => p.id);
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

  const onCommandDeckTool = useCallback((id: ContextToolId) => {
    try {
      (window as any).chrome?.webview?.postMessage({
        type: 'BNDZ_PANE_TOOL',
        payload: { tool: id, path: ctx.path, selectedPaths },
      });
    } catch {
      /* ignore */
    }
  }, [ctx.path, selectedPaths]);

  const onNavigate = useCallback((path: string) => {
    setCtx((prev) => ({ ...prev, path }));
    try {
      (window as any).chrome?.webview?.postMessage({
        type: 'BNDZ_PANE_NAVIGATE',
        payload: { path },
      });
    } catch {
      /* ignore */
    }
  }, []);

  const previewEntity: FSEntity | null = useMemo(() => {
    if (!selectedPaths[0]) return null;
    const name = ctx.selectedNames?.[0] || selectedPaths[0].split(/[/\\]/).pop() || selectedPaths[0];
    const isDir = (ctx.selectedTypes?.[0] || '').toLowerCase() === 'directory';
    return {
      id: selectedPaths[0],
      name,
      path: selectedPaths[0],
      type: isDir ? 'directory' : 'file',
      size: 0,
      modified: '',
      created: '',
      extension: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '',
    } as FSEntity;
  }, [selectedPaths, ctx.selectedNames, ctx.selectedTypes]);

  const selectedItems = selectedPaths.map((p, i) => ({
    id: p,
    name: ctx.selectedNames?.[i] || p.split(/[/\\]/).pop() || p,
    path: p,
    isDirectory: (ctx.selectedTypes?.[i] || '').toLowerCase() === 'directory',
  }));

  let body: React.ReactNode;
  switch (boot.pane) {
    case 'automation':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--workspace">
          <BndzAutomationView />
        </div>
      );
      break;
    case 'canvas':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--workspace">
          <BndzSpatialCanvasView onNavigate={onNavigate} onOpenPath={onNavigate} />
        </div>
      );
      break;
    case 'plugins':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--plugins">
          {config.commandDeck !== false && (
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
              requestedTab={boot.plugin || null}
              selectedItems={selectedItems}
              selectedPaths={selectedPaths}
              currentPath={ctx.path || ''}
              immersive={false}
              onCommandDeckTool={onCommandDeckTool}
            />
          </div>
        </div>
      );
      break;
    case 'preview':
      body = (
        <div className="bndz-native-pane-surface bndz-native-pane-surface--preview">
          {previewEntity ? (
            <RightPreviewPanel
              entity={previewEntity}
              path={ctx.path || previewEntity.path}
              selectionPaths={selectedPaths}
              onNavigate={onNavigate}
            />
          ) : (
            <div className="bndz-native-pane-empty">
              <div className="bndz-native-pane-empty-card">
                <Icons8Icon id="loupe" size={28} />
                <h2>Preview ready</h2>
                <p>Select a file in the Files list — preview tools stay here as a hosted pane.</p>
              </div>
            </div>
          )}
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
    <div className="bndz-native-pane-root">
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
      <main className="bndz-native-pane-main">{body}</main>
    </div>
  );
}
