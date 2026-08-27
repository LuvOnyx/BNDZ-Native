import { endFileDragSession, stashOleDragSession, isPointerOutsideScreenWindow } from './fileDragSession';
import { disarmFluidDrag } from '../workstation/drag/fluidDragBridge';

/**
 * Tear down in-app file-drag chrome from any surface (Spatial Canvas, etc.).
 * BNDZUI listens for `bndz-end-file-drag` to clear React ghost state; session + fluid
 * stack are cleared here immediately so overlays cannot freeze after stopPropagation.
 */
function clearOleHandoffDom(): void {
  clearOleHandoffSafetyTimer();
  try { document.documentElement.classList.remove('bndz-ole-drag-handoff'); } catch { /* ignore */ }
  try { document.getElementById('bndz-ole-veil')?.remove(); } catch { /* ignore */ }
  try { document.getElementById('bndz-ole-handoff-hint')?.remove(); } catch { /* ignore */ }
}

export function endInternalFileDragUi(reason = 'drop'): void {
  clearOleHandoffDom();
  endFileDragSession();
  disarmFluidDrag();
  try {
    window.dispatchEvent(new CustomEvent('bndz-end-file-drag', { detail: { reason } }));
  } catch { /* ignore */ }
}

/** Hide drag chrome only — keeps FILE_DRAG_ACTIVE session for host OLE escalate. */
export function hideFileDragGhostForOleHandoff(): void {
  try {
    document.documentElement.classList.add('bndz-ole-drag-handoff');
  } catch { /* ignore */ }
  armOleHandoffSafetyClear();
  try {
    let veil = document.getElementById('bndz-ole-veil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'bndz-ole-veil';
      veil.setAttribute('aria-hidden', 'true');
      veil.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:transparent;opacity:0;';
      document.documentElement.appendChild(veil);
    }
  } catch { /* ignore */ }
  try {
    document.querySelectorAll(
      '.bndz-fluid-drag-stack, .bndz-fluid-drag-lead, .bndz-fluid-drag-card, .bndz-fluid-drag-multi-pill, '
      + '.bndz-fluid-drag-overflow-badge, .bndz-drag-ghost-root, .bndz-drag-ghost-card',
    ).forEach(el => {
      const node = el as HTMLElement;
      node.style.setProperty('display', 'none', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
      node.style.setProperty('opacity', '0', 'important');
      node.style.setProperty('pointer-events', 'none', 'important');
    });
  } catch { /* ignore */ }
  disarmFluidDrag();
  notifyOleDragHandoffListeners();
}

export function isOleDragHandoffActive(): boolean {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains('bndz-ole-drag-handoff');
  } catch {
    return false;
  }
}

type HandoffListener = () => void;
const handoffListeners = new Set<HandoffListener>();

function notifyOleDragHandoffListeners() {
  handoffListeners.forEach(fn => {
    try { fn(); } catch { /* ignore */ }
  });
}

/** React ghosts subscribe so they cannot re-apply display:block after host hide. */
export function subscribeOleDragHandoff(fn: HandoffListener): () => void {
  handoffListeners.add(fn);
  return () => { handoffListeners.delete(fn); };
}

/**
 * Host OLE escalate — kill the fluid ghost *now* (no 140ms snap). WebView2 cannot paint
 * the React card outside the HWND; Windows shell owns the cursor after this.
 */
export function onHostOleDragEscalated(): void {
  stashOleDragSession();
  hideFileDragGhostForOleHandoff();
  try {
    window.dispatchEvent(new CustomEvent('bndz-end-file-drag', { detail: { reason: 'ole-escalate' } }));
  } catch { /* ignore */ }
}

declare global {
  interface Window {
    /** Called from host ExecuteScript before DoDragDrop — must be sync-safe. */
    __bndzDismissDragGhost?: () => void;
  }
}

let oleEscalateHookInstalled = false;
let screenDragMonitorStop: (() => void) | null = null;
let oleHandoffSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearOleHandoffSafetyTimer() {
  if (oleHandoffSafetyTimer != null) {
    clearTimeout(oleHandoffSafetyTimer);
    oleHandoffSafetyTimer = null;
  }
}

function armOleHandoffSafetyClear() {
  clearOleHandoffSafetyTimer();
  // If OLE_DRAG_ENDED never arrives (cancel mid-handoff), don't leave handoff CSS forever.
  oleHandoffSafetyTimer = setTimeout(() => {
    oleHandoffSafetyTimer = null;
    if (!isOleDragHandoffActive()) return;
    clearOleHandoffDom();
    disarmFluidDrag();
    endFileDragSession();
    notifyOleDragHandoffListeners();
  }, 12_000);
}

function stopScreenDragGhostMonitor() {
  screenDragMonitorStop?.();
  screenDragMonitorStop = null;
}

/** Screen-space backup when WebView stops pointermove — only after cursor leaves the window. */
function startScreenDragGhostMonitor() {
  if (screenDragMonitorStop || typeof document === 'undefined') return;
  let hidden = false;
  const onMove = (ev: MouseEvent) => {
    if (hidden) return;
    if (isPointerOutsideScreenWindow(ev.screenX, ev.screenY, 2)) {
      hidden = true;
      hideFileDragGhostForOleHandoff();
    }
  };
  document.addEventListener('mousemove', onMove, true);
  screenDragMonitorStop = () => document.removeEventListener('mousemove', onMove, true);
}

/** Install once — ExecuteScript + PostWebMessage both hit this before DoDragDrop blocks STA. */
export function installOleDragEscalateGhostHook(): void {
  if (oleEscalateHookInstalled || typeof window === 'undefined') return;
  oleEscalateHookInstalled = true;
  window.__bndzDismissDragGhost = onHostOleDragEscalated;
  window.addEventListener('bndz-ole-drag-escalated', () => {
    onHostOleDragEscalated();
  });
  window.addEventListener('bndz-pointer-file-drag-active', (ev: Event) => {
    const active = !!(ev as CustomEvent<{ active?: boolean }>).detail?.active;
    if (active) startScreenDragGhostMonitor();
    else stopScreenDragGhostMonitor();
  });
  window.addEventListener('bndz-end-file-drag', (ev: Event) => {
    stopScreenDragGhostMonitor();
    const reason = (ev as CustomEvent<{ reason?: string }>).detail?.reason;
    // Keep handoff hide through DoDragDrop AND through ole-ended's same-tick clear —
    // removing the class here re-shows the stuck MOVE card under the WinUI menubar.
    if (reason === 'ole-escalate' || reason === 'ole-ended') {
      notifyOleDragHandoffListeners();
      return;
    }
    clearOleHandoffDom();
    notifyOleDragHandoffListeners();
  });
  window.addEventListener('bndz-ole-drag-ended', () => {
    stopScreenDragGhostMonitor();
    // Kill React ghost state BEFORE dropping the handoff CSS class — removing handoff first
    // was re-showing the MOVE card under the WinUI menubar for a frame (or stuck forever
    // if listDragGhost / fluid meta was never cleared).
    try {
      disarmFluidDrag();
      endFileDragSession();
      window.dispatchEvent(new CustomEvent('bndz-end-file-drag', { detail: { reason: 'ole-ended' } }));
    } catch { /* ignore */ }
    // Next frame: handoff class off only after listeners cleared ghost state.
    requestAnimationFrame(() => {
      clearOleHandoffDom();
      notifyOleDragHandoffListeners();
    });
  });
}
