import { useEffect, type RefObject } from 'react';

export type EditorKeyPayload = {
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * While an embedded editor iframe is mounted, keep FM list hotkeys from stealing
 * strokes and forward keys into the iframe when it does not own focus.
 */
export function useEditorIframeKeyBridge(opts: {
  rootSelector: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  postKey: (payload: EditorKeyPayload) => void;
  /** When false, only trap if focus is already inside the root. */
  forceActive?: boolean;
  /** Escape stays available to the host (close overlays). Default true. */
  passEscape?: boolean;
}) {
  const { rootSelector, iframeRef, postKey, forceActive = true, passEscape = true } = opts;

  useEffect(() => {
    const focusFrame = () => {
      const frame = iframeRef.current;
      if (!frame) return;
      try {
        frame.focus({ preventScroll: true });
        frame.contentWindow?.focus?.();
      } catch {
        /* ignore cross-doc focus failures */
      }
    };

    const onPointer = (e: PointerEvent) => {
      const root = document.querySelector(rootSelector);
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      // Clicks on host chrome still leave keyboard ownership with the editor.
      if (e.target === iframeRef.current || (e.target as HTMLElement).closest?.('iframe')) {
        focusFrame();
      } else if (forceActive) {
        // Defer so host buttons still receive the click.
        window.setTimeout(focusFrame, 0);
      }
    };

    const trap = (e: KeyboardEvent) => {
      const root = document.querySelector(rootSelector);
      if (!root) return;

      const ae = document.activeElement;
      const frame = iframeRef.current;
      const inFrame = ae === frame;
      const inRoot = !!(ae && root.contains(ae));

      if (!forceActive && !inRoot && !inFrame) return;

      // Never let listview capture-phase handlers see studio keys.
      e.stopPropagation();

      if (passEscape && e.key === 'Escape') return;

      const typingHost =
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae as HTMLElement | null)?.isContentEditable;

      if (typingHost && inRoot && !inFrame) return;

      // Iframe already owns focus — native events go there; parent only stops bubble.
      if (inFrame) return;

      e.preventDefault();
      focusFrame();
      postKey({
        type: e.type === 'keyup' ? 'keyup' : 'keydown',
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
    };

    window.addEventListener('keydown', trap, true);
    window.addEventListener('keyup', trap, true);
    window.addEventListener('pointerdown', onPointer, true);

    // Claim focus once the editor mounts.
    const t = window.setTimeout(focusFrame, 80);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', trap, true);
      window.removeEventListener('keyup', trap, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [forceActive, iframeRef, passEscape, postKey, rootSelector]);
}
