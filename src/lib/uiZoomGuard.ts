/**
 * Blocks WebView2 / Chromium page zoom (Ctrl+wheel, Ctrl+±) so only explicit
 * settings (interface scale) and workspace-local zoom (Spatial canvas) apply.
 */
type ZoomGuardConfig = {
  lockBrowserZoom?: boolean;
};

let installed = false;
let getConfig: () => ZoomGuardConfig = () => ({ lockBrowserZoom: true });

function isOverWorkspace(el: Element | null): boolean {
  return !!el?.closest?.('[data-bndz-workspace-surface]');
}

function shouldBlockBrowserZoom(e: Event): boolean {
  const cfg = getConfig();
  if (cfg.lockBrowserZoom === false) return false;
  // Workspace surfaces own wheel zoom — never swallow events there.
  if (isOverWorkspace(e.target as Element | null)) return false;
  return true;
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  if (!shouldBlockBrowserZoom(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onKeyDown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key;
  if (k !== '+' && k !== '=' && k !== '-' && k !== '_' && k !== '0') return;
  const overWorkspace = !!(e.target as Element)?.closest?.('[data-bndz-workspace-surface]');
  // Workspace surfaces handle Ctrl+± locally (canvas zoom) — only block browser zoom keys.
  if (overWorkspace && (k === '+' || k === '=' || k === '-' || k === '_')) return;
  if (!shouldBlockBrowserZoom(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function installUiZoomGuard(readConfig: () => ZoomGuardConfig): () => void {
  getConfig = readConfig;
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('keydown', onKeyDown, { capture: true });
  return () => {
    document.removeEventListener('wheel', onWheel, { capture: true });
    document.removeEventListener('keydown', onKeyDown, { capture: true });
    installed = false;
  };
}
