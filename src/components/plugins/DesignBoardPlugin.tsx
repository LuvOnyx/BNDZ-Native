import React, { useCallback, useEffect, useRef, useState } from 'react';
import PluginPanelShell from './PluginPanelShell';
import { PluginToolbarButton } from './PluginPanelPrimitives';
import { useEditorIframeKeyBridge, type EditorKeyPayload } from '../../lib/editorIframeKeys';
import {
  filesToStudioDropImages,
  hitIsStudioSurface,
  pathsToStudioDropImages,
} from '../../lib/studioDropBridge';

export const DesignBoardPluginDef = {
  id: 'design-board',
  name: 'Design Board',
  icon: 'layers_ui',
  description:
    'Hosted design canvas (Fabric / optional OpenPencil) — shapes, pen, and layers inside BNDZ chrome.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

function editorSrc(): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}editors/bndz-design-board.html`;
}

type Props = {
  /** Full-bleed second-process / pop-out face — skip dock chrome. */
  popout?: boolean;
  immersive?: boolean;
  isPluginTabActive?: boolean;
  selectedItems?: unknown[];
  selectedPaths?: string[];
  currentPath?: string;
};

/**
 * Host for the Figma/ProDesign UI (public/editors/bndz-design-board.html).
 * Chrome stays; Fabric canvas is default. OpenPencil opt-in via ?engine=openpencil.
 */
export default function DesignBoardPlugin({ popout = false }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(!!popout);
  const [boardKey, setBoardKey] = useState(0);
  const [keysArmed, setKeysArmed] = useState(!!popout);
  const [status, setStatus] = useState<string | null>(null);

  const postToBoard = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ source: 'bndz-host', ...msg }, '*');
  }, []);

  const postKey = useCallback(
    (payload: EditorKeyPayload) => postToBoard(payload),
    [postToBoard],
  );

  const placeDropImages = useCallback(async (paths?: string[], files?: File[]) => {
    const fromFiles = files?.length ? await filesToStudioDropImages(files) : [];
    const fromPaths = !fromFiles.length && paths?.length ? await pathsToStudioDropImages(paths) : [];
    const images = fromFiles.length ? fromFiles : fromPaths;
    if (!images.length) {
      setStatus('Drop an image (PNG, JPG, WEBP, SVG, ICO…)');
      return;
    }
    postToBoard({ type: 'placeImages', images });
    setStatus(`Placed ${images.length} image${images.length === 1 ? '' : 's'}`);
  }, [postToBoard]);

  useEditorIframeKeyBridge({
    rootSelector: '.bndz-design-board',
    iframeRef,
    postKey,
    forceActive: popout || expanded || keysArmed,
    passEscape: !popout,
  });

  const newBoard = useCallback(() => {
    // Prefer in-place reset — full iframe reload was blanking before Fabric boot finished.
    postToBoard({ type: 'action', action: 'new' });
    setStatus('Fresh board');
  }, [postToBoard]);

  useEffect(() => {
    if (popout) return;
    const arm = (e: PointerEvent) => {
      const root = document.querySelector('.bndz-design-board');
      if (root && e.target instanceof Node && root.contains(e.target)) {
        setKeysArmed(true);
      } else if (!(e.target as HTMLElement | null)?.closest?.('.bndz-design-board-overlay')) {
        setKeysArmed(false);
      }
    };
    window.addEventListener('pointerdown', arm, true);
    return () => window.removeEventListener('pointerdown', arm, true);
  }, [popout]);

  useEffect(() => {
    if (popout || !expanded) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setExpanded(false);
      setStatus('Docked');
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [expanded, popout]);

  useEffect(() => {
    if (!popout && !expanded && !keysArmed) return;
    const t = window.setTimeout(() => {
      try {
        iframeRef.current?.focus({ preventScroll: true });
        iframeRef.current?.contentWindow?.focus?.();
      } catch { /* ignore */ }
    }, 100);
    return () => window.clearTimeout(t);
  }, [expanded, boardKey, keysArmed, popout]);

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 1600);
    return () => window.clearTimeout(t);
  }, [status]);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || d.source !== 'bndz-openpencil') return;
      if (d.type === 'ready') {
        setStatus(d.degraded ? 'OpenPencil failed — Fabric fallback' : 'OpenPencil live');
      } else if (d.type === 'error' && d.message) {
        setStatus(String(d.message));
      } else if (d.type === 'toolChanged' && d.tool) {
        setStatus(`Tool · ${String(d.tool)}`);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Host OLE drops (WebView2 IDropTarget steals Chromium HTML5 DnD).
  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = detail.paths as string[] | undefined;
      if (!paths?.length) return;
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : null;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : null;
      if (clientX != null && clientY != null) {
        if (!hitIsStudioSurface(clientX, clientY, ['.bndz-design-board', '.bndz-design-board-overlay'])) return;
      }
      void placeDropImages(paths);
    };
    window.addEventListener('bndz-external-drop', onExternalDrop);
    return () => window.removeEventListener('bndz-external-drop', onExternalDrop);
  }, [placeDropImages]);

  const onHostDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types || (![...types].includes('Files') && !e.dataTransfer.files?.length)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onHostDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = [...(e.dataTransfer?.files || [])];
    void placeDropImages(undefined, files);
  }, [placeDropImages]);

  const board = (
    <div
      className={`bndz-design-board bndz-design-board--exact bndz-design-board--no-hostbar${expanded || popout ? ' is-expanded' : ''}${popout ? ' is-popout' : ''}`}
      data-studio-drop-surface="design-board"
      onDragEnter={onHostDragOver}
      onDragOver={onHostDragOver}
      onDrop={onHostDrop}
    >
      {/* No host Expand/New board chrome — duplicates stole clicks from iframe menus.
          Expand via double-click title / View menu postMessage; dock strip removed. */}
      <iframe
        key={boardKey}
        ref={iframeRef}
        className="bndz-design-board-frame"
        title="BNDZ Design Board"
        tabIndex={0}
        src={editorSrc()}
        sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
        onLoad={() => {
          try {
            iframeRef.current?.focus({ preventScroll: true });
          } catch { /* ignore */ }
        }}
      />
      {status && <div className="bndz-design-board-toast">{status}</div>}
    </div>
  );

  if (popout) {
    return (
      <div className="bndz-design-board-popout-root h-full min-h-0 flex flex-col overflow-hidden">
        {board}
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="bndz-design-board-overlay" role="dialog" aria-label="Design Board">
        {board}
        <button
          type="button"
          className="bndz-design-board-dock-fab"
          onClick={() => setExpanded(false)}
          title="Dock Design Board"
        >
          Dock
        </button>
      </div>
    );
  }

  return (
    <PluginPanelShell
      title="Design Board"
      icon="layers_ui"
      iconColor="#0d99ff"
      subtitle="Hosted canvas engine · Fabric / OpenPencil"
      variant="embedded"
      footer={(
        <div className="bndz-design-board-host-actions" style={{ border: 'none', padding: 0, background: 'transparent', width: '100%' }}>
          <PluginToolbarButton onClick={() => setExpanded(true)} title="Expand Design Board to fill workspace">Expand</PluginToolbarButton>
          <PluginToolbarButton onClick={newBoard} title="Start a fresh board">New board</PluginToolbarButton>
        </div>
      )}
    >
      {board}
    </PluginPanelShell>
  );
}
