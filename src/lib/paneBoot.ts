/** Boot detection for FilesMerge / BNDZShell craft pane islands. */

export type BndzPaneKind =
  | 'automation'
  | 'canvas'
  | 'plugins'
  | 'preview'
  | 'smart-tools'
  | 'marketplace'
  | 'settings'
  | 'sidebar'
  | 'chrome'
  | 'home';

export type BndzPaneBoot = {
  pane: BndzPaneKind;
  /** Optional plugin id when pane=plugins */
  plugin?: string;
  /** Optional file path when pane=preview */
  path?: string;
};

const PANE_KINDS: readonly BndzPaneKind[] = [
  'automation',
  'canvas',
  'plugins',
  'preview',
  'smart-tools',
  'marketplace',
  'settings',
  'sidebar',
  'chrome',
  'home',
];

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
    const shell = new URLSearchParams(window.location.search).get('nativeShell') === '1'
      ? 'native-craft'
      : 'files-pane';
    document.documentElement.dataset.bndzShell = shell;
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
    case 'smart-tools':
      return 'Smart Tools';
    case 'marketplace':
      return 'Extension Hub';
    case 'settings':
      return 'Configuration';
    case 'sidebar':
      return 'Sidebar';
    case 'chrome':
      return 'Chrome';
    case 'home':
      return 'Home';
    default: {
      const _exhaustive: never = boot.pane;
      return _exhaustive;
    }
  }
}
