import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { PluginToolbarButton } from './PluginPanelPrimitives';
import { useEditorIframeKeyBridge, type EditorKeyPayload } from '../../lib/editorIframeKeys';

export const DesignBoardPluginDef = {
  id: 'design-board',
  name: 'Design Board',
  icon: 'layers_ui',
  description:
    'ProDesign / Figma chrome with OpenPencil vector engine — real pen nodes, bends, shapes under the existing board face.',
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
 * Chrome stays; OpenPencil fills the workspace. React hosts expand/dock + key trap.
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

  useEditorIframeKeyBridge({
    rootSelector: '.bndz-design-board',
    iframeRef,
    postKey,
    forceActive: popout || expanded || keysArmed,
    passEscape: !popout,
  });

  const newBoard = useCallback(() => {
    if (!window.confirm('Start a fresh board? Unsaved canvas state will clear.')) return;
    setBoardKey((k) => k + 1);
    setStatus('Fresh board');
  }, []);

  const sendAction = useCallback((action: string) => {
    postToBoard({ type: 'action', action });
    if (action === 'undo') {
      postKey({ type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    } else if (action === 'exportPng') {
      postToBoard({ type: 'action', action: 'exportPng' });
    }
  }, [postKey, postToBoard]);

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

  const board = (
    <div className={`bndz-design-board bndz-design-board--exact${expanded || popout ? ' is-expanded' : ''}${popout ? ' is-popout' : ''}`}>
      <header className="bndz-design-board-hostbar">
        <div className="bndz-design-board-brand">
          <Icons8Icon id="layers_ui" size={16} />
          <div>
            <strong>Design Board</strong>
            <span>{popout ? 'Pop-out · stroke tools use Stroke color' : 'ProDesign · Del V R O T · Esc docks'}</span>
          </div>
        </div>
        <div className="bndz-design-board-actions">
          <PluginToolbarButton onClick={() => sendAction('undo')}>Undo</PluginToolbarButton>
          <PluginToolbarButton
            onClick={() => postKey({ type: 'keydown', key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })}
          >
            Redo
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => sendAction('exportPng')}>Export</PluginToolbarButton>
          <PluginToolbarButton onClick={newBoard}>New</PluginToolbarButton>
          {!popout && (
            <PluginToolbarButton onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Dock' : 'Expand'}
            </PluginToolbarButton>
          )}
        </div>
      </header>
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
      </div>
    );
  }

  return (
    <PluginPanelShell
      title="Design Board"
      icon="layers_ui"
      iconColor="#0d99ff"
      subtitle="Figma chrome · Fabric tools (OpenPencil via ?engine=openpencil)"
      variant="embedded"
      toolbar={(
        <>
          <PluginToolbarButton onClick={() => setExpanded(true)}>Expand</PluginToolbarButton>
          <PluginToolbarButton onClick={newBoard}>New board</PluginToolbarButton>
        </>
      )}
    >
      {board}
    </PluginPanelShell>
  );
}
