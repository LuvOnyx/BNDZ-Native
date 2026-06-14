import type { LauncherBridgeMessage, LauncherCommand, LauncherQueryResult } from '../types';

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage: (message: unknown) => void;
        addEventListener: (type: 'message', listener: (ev: MessageEvent) => void) => void;
        removeEventListener: (type: 'message', listener: (ev: MessageEvent) => void) => void;
      };
    };
  }
}

type Listener = (message: LauncherBridgeMessage) => void;

const listeners = new Set<Listener>();

function parseMessage(data: unknown): LauncherBridgeMessage | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as LauncherBridgeMessage;
  if (!('type' in msg)) return null;
  return msg;
}

function wireWebView() {
  const webview = window.chrome?.webview;
  if (!webview) return;
  webview.addEventListener('message', (ev: MessageEvent) => {
    const msg = parseMessage(ev.data);
    if (msg) listeners.forEach(fn => fn(msg));
  });
}

wireWebView();

export function postToHost(message: LauncherBridgeMessage) {
  const webview = window.chrome?.webview;
  if (webview) {
    webview.postMessage(message);
    return;
  }
  // Dev preview — log only
  if (import.meta.env.DEV) {
    console.debug('[bndz-launcher-bridge]', message);
  }
}

export function onHostMessage(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestQuery(query: string): Promise<LauncherQueryResult> {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise(resolve => {
    const off = onHostMessage(msg => {
      if (msg.type === 'QUERY_RESULT' && msg.requestId === requestId) {
        off();
        resolve(msg.result);
      }
    });
    postToHost({ type: 'QUERY', query, requestId });
    // Dev fallback mock
    if (!window.chrome?.webview) {
      setTimeout(() => {
        off();
        resolve(mockQuery(query));
      }, 120);
    }
  });
}

export function executeCommand(command: LauncherCommand) {
  postToHost({
    type: 'EXECUTE',
    commandId: command.id,
    pluginId: command.pluginId,
    actionKeyword: command.actionKeyword,
  });
}

function mockQuery(query: string): LauncherQueryResult {
  const q = query.trim().toLowerCase();
  const builtins: LauncherCommand[] = [
    { id: 'system-clipboard', title: 'Clipboard History', subtitle: 'SuperCmd-style clipboard manager', category: 'clipboard', iconGlyph: '📋' },
    { id: 'system-snippets', title: 'Search Snippets', subtitle: 'Text expansion snippets', category: 'snippet', iconGlyph: '✂️' },
    { id: 'system-quicklinks', title: 'Quick Links', subtitle: 'Bookmarked URLs', category: 'quicklink', iconGlyph: '🔗' },
    { id: 'bndz-open', title: 'Open BNDZ File Manager', subtitle: 'Dual-pane workspace', category: 'bndz', iconGlyph: '📁', actionKeyword: 'bndz' },
  ];
  const commands = q
    ? builtins.filter(c => c.title.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q))
    : builtins;
  return {
    query,
    commands,
    sections: [{ title: 'BNDZ Commands', items: commands }],
  };
}

export function notifyReady() {
  postToHost({ type: 'LAUNCHER_READY' });
}
