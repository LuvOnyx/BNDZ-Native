/** Boot detection for FilesMerge-hosted React panes (architecture #3 Phase 3). */

export type BndzPaneKind = 'automation' | 'canvas' | 'plugins' | 'preview';

export type BndzPaneBoot = {
  pane: BndzPaneKind;
  /** Optional plugin id when pane=plugins */
  plugin?: string;
  /** Optional file path when pane=preview */
  path?: string;
};

const PANE_KINDS: readonly BndzPaneKind[] = ['automation', 'canvas', 'plugins', 'preview'];

function isPaneKind(value: string | null): value is BndzPaneKind {
  return !!value && (PANE_KINDS as readonly string[]).includes(value);
}

export function readPaneBootFromUrl(): BndzPaneBoot | null {
  try {
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get('pane');
    if (!isPaneKind(raw)) return null;
    return {
      pane: raw,
      plugin: sp.get('plugin') || undefined,
      path: sp.get('path') || undefined,
    };
  } catch {
    return null;
  }
}

export function applyPaneDocumentMark(boot: BndzPaneBoot | null): void {
  try {
    if (!boot) return;
    document.documentElement.dataset.bndzPane = boot.pane;
    document.documentElement.dataset.bndzShell = 'files-pane';
    document.body?.classList.add('bndz-native-pane-body');
  } catch {
    /* ignore */
  }
}

export function paneTitle(boot: BndzPaneBoot): string {
  switch (boot.pane) {
    case 'automation':
      return 'Automation';
    case 'canvas':
      return 'Spatial Canvas';
    case 'plugins':
      return boot.plugin ? `Plugin · ${boot.plugin}` : 'Plugins & Command Deck';
    case 'preview':
      return 'Preview';
    default: {
      const _exhaustive: never = boot.pane;
      return _exhaustive;
    }
  }
}
