import type {
  AiChatSnapshot,
  AiConversation,
  LauncherBridgeMessage,
  LauncherBridgePost,
  LauncherBridgeRpcMessage,
  LauncherCommand,
  LauncherQueryResult,
  QuickLinkRecord,
  SnippetRecord,
  NoteRecord,
  ClipboardRecord,
  PluginRecord,
} from '../types';

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

type BridgeListener = (message: LauncherBridgeMessage) => void;
type RpcListener = (message: LauncherBridgeRpcMessage) => void;
const bridgeListeners = new Set<BridgeListener>();
const rpcListeners = new Set<RpcListener>();

const KNOWN_BRIDGE_TYPES = new Set<string>([
  'LAUNCHER_READY', 'QUERY', 'QUERY_RESULT', 'EXECUTE', 'EXECUTE_RESULT',
  'HIDE', 'OPEN_LAUNCHER_SETTINGS', 'OPEN_BNDZ_FILE_MANAGER', 'OPEN_BNDZ_PATH',
  'LAUNCHER_VISIBLE', 'SET_LAUNCHER_LAYOUT', 'GET_FILE_PREVIEW_META', 'GET_FILE_PREVIEW_META_RESULT',
  'THEME_SYNC', 'AI_STREAM_CHUNK', 'AI_STREAM_DONE', 'AI_STREAM_ERROR',
  'AI_CHAT', 'AI_CHAT_UPSERT', 'AI_CHAT_DELETE', 'AI_CANCEL',
]);

function uid(prefix = 'req') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseMessage(data: unknown): LauncherBridgeMessage | LauncherBridgeRpcMessage | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as LauncherBridgeMessage | LauncherBridgeRpcMessage;
  if (!('type' in msg) || typeof msg.type !== 'string') return null;
  return msg;
}

function dispatchMessage(msg: LauncherBridgeMessage | LauncherBridgeRpcMessage) {
  if (KNOWN_BRIDGE_TYPES.has(msg.type)) {
    bridgeListeners.forEach(fn => fn(msg as LauncherBridgeMessage));
  }
  rpcListeners.forEach(fn => fn(msg));
}

function wireWebView() {
  const webview = window.chrome?.webview;
  if (!webview) return;
  webview.addEventListener('message', (ev: MessageEvent) => {
    const msg = parseMessage(ev.data);
    if (msg) dispatchMessage(msg);
  });
}
wireWebView();

export function postToHost(message: LauncherBridgePost) {
  const webview = window.chrome?.webview;
  if (webview) {
    webview.postMessage(message);
    return;
  }
  if (import.meta.env.DEV) console.debug('[bndz-launcher-bridge]', message);
}

export function onHostMessage(listener: BridgeListener): () => void {
  bridgeListeners.add(listener);
  return () => { bridgeListeners.delete(listener); };
}

function onHostRpc(listener: RpcListener): () => void {
  rpcListeners.add(listener);
  return () => { rpcListeners.delete(listener); };
}

export function hostRequest<T>(type: string, body: Record<string, unknown> = {}, resultType?: string, timeoutMs = 15000): Promise<T> {
  const requestId = uid(type.toLowerCase());
  const expected = resultType ?? `${type}_RESULT`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`${type} timed out`));
    }, timeoutMs);
    const off = onHostRpc(msg => {
      if (msg.type !== expected || msg.requestId !== requestId) return;
      clearTimeout(timer);
      off();
      resolve(('payload' in msg ? msg.payload : msg) as T);
    });
    postToHost({ type, requestId, ...body });
    if (!window.chrome?.webview) {
      clearTimeout(timer);
      off();
      resolve(mockHostResult(type) as T);
    }
  });
}

function mockHostResult(type: string): unknown {
  switch (type) {
    case 'AI_IS_AVAILABLE':
      return { available: false };
    case 'AI_CHAT_SNAPSHOT':
      return { conversations: [] };
    case 'SNIPPET_LIST':
      return [];
    case 'GET_FILE_PREVIEW_META':
      return { path: '', kind: 'unknown', name: '', extension: '', size: 0, sizeLabel: '', modified: '', created: '', contentType: '' };
    case 'NOTE_LIST':
      return [];
    case 'QUICKLINK_LIST':
      return [];
    default:
      return { ok: true };
  }
}

export function requestQuery(query: string): Promise<LauncherQueryResult> {
  const requestId = uid('query');
  return new Promise(resolve => {
    let settled = false;
    const off = onHostMessage(msg => {
      if (msg.type === 'QUERY_RESULT' && msg.requestId === requestId) {
        const result = msg.result as LauncherQueryResult;
        if (!msg.partial) {
          settled = true;
          off();
          resolve(result);
        }
      }
    });
    postToHost({ type: 'QUERY', query, requestId });
    if (!window.chrome?.webview) {
      setTimeout(() => {
        if (!settled) {
          off();
          resolve(mockQuery(query));
        }
      }, 120);
    }
  });
}

/** Streams local results immediately, then resolves when extension results finish loading. */
export function requestQueryStreaming(
  query: string,
  onUpdate: (result: LauncherQueryResult, partial: boolean) => void,
): Promise<LauncherQueryResult> {
  const requestId = uid('query');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('query timed out'));
    }, 12000);
    const off = onHostMessage(msg => {
      if (msg.type !== 'QUERY_RESULT' || msg.requestId !== requestId) return;
      const result = msg.result as LauncherQueryResult;
      onUpdate(result, !!msg.partial);
      if (!msg.partial) {
        clearTimeout(timer);
        off();
        resolve(result);
      }
    });
    postToHost({ type: 'QUERY', query, requestId });
    if (!window.chrome?.webview) {
      const result = mockQuery(query);
      onUpdate(result, true);
      clearTimeout(timer);
      off();
      resolve(result);
    }
  });
}

export function executeCommand(command: LauncherCommand, opts?: { query?: string }): Promise<boolean> {
  const requestId = uid('exec');
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, 10000);
    const off = onHostMessage(msg => {
      if (msg.type === 'EXECUTE_RESULT' && msg.requestId === requestId) {
        clearTimeout(timer);
        off();
        resolve(!!(msg as { ok?: boolean }).ok);
      }
    });
    postToHost({
      type: 'EXECUTE',
      requestId,
      commandId: command.id,
      pluginId: command.pluginId,
      actionKeyword: command.actionKeyword,
      query: opts?.query,
    });
    if (!window.chrome?.webview) {
      clearTimeout(timer);
      off();
      resolve(true);
    }
  });
}

function mockQuery(query: string): LauncherQueryResult {
  const q = query.trim().toLowerCase();
  const builtins: LauncherCommand[] = [
    { id: 'system-ai-chat', title: 'AI Chat', subtitle: 'Ask Gemini anything', category: 'system', iconGlyph: '✨' },
    { id: 'system-search-snippets', title: 'Search Snippets', subtitle: 'Text expansion snippets', category: 'snippet', iconGlyph: '✂️' },
    { id: 'system-search-quicklinks', title: 'Quick Links', subtitle: 'Bookmarked URLs', category: 'quicklink', iconGlyph: '🔗' },
    { id: 'system-clipboard-manager', title: 'Clipboard History', subtitle: 'Raycast-style pasteboard', category: 'system', iconGlyph: '📋' },
    { id: 'system-file-search', title: 'Search Files', subtitle: 'Find files on disk', category: 'system', iconGlyph: '🔍' },
    { id: 'system-open-extensions', title: 'Extension Hub', subtitle: 'Manage launcher extensions', category: 'extension', iconGlyph: '🧩' },
    { id: 'system-open-plugin-store', title: 'BNDZ Plugin Store', subtitle: 'Properties, Find, Catalog…', category: 'bndz', iconGlyph: '🛒' },
    { id: 'bndz-open', title: 'Open BNDZ File Manager', subtitle: 'Dual-pane workspace', category: 'bndz', iconGlyph: '📁' },
  ];
  const commands = q
    ? builtins.filter(c => c.title.toLowerCase().includes(q) || c.subtitle?.toLowerCase().includes(q))
    : builtins;
  return { query, commands, sections: [{ title: 'BNDZ Commands', items: commands }] };
}

export function notifyReady() {
  postToHost({ type: 'LAUNCHER_READY' });
}

export function hideLauncher() {
  postToHost({ type: 'HIDE' });
}

export function openLauncherSettings() {
  postToHost({ type: 'OPEN_LAUNCHER_SETTINGS' });
}

export function openBndzFileManager() {
  postToHost({ type: 'OPEN_BNDZ_FILE_MANAGER' });
}

export function openBndzPath(path: string) {
  postToHost({ type: 'OPEN_BNDZ_PATH', path });
}

export function setLauncherLayout(mode: 'compact' | 'expanded') {
  postToHost({ type: 'SET_LAUNCHER_LAYOUT', mode });
}

export function getFilePreviewMeta(path: string): Promise<import('../types').FilePreviewMeta> {
  return hostRequest<import('../types').FilePreviewMeta>('GET_FILE_PREVIEW_META', { path }, 'GET_FILE_PREVIEW_META_RESULT');
}

export type { FilePreviewMeta } from '../types';

// ─── AI bridge (SuperCmd electron.ai* port) ─────────────────────────

export async function aiIsAvailable(): Promise<boolean> {
  const res = await hostRequest<{ available: boolean }>('AI_IS_AVAILABLE');
  return !!res.available;
}

export async function getAiChatSnapshot(): Promise<AiChatSnapshot> {
  return hostRequest<AiChatSnapshot>('AI_CHAT_SNAPSHOT');
}

export function upsertAiChatConversation(conversation: AiConversation) {
  postToHost({ type: 'AI_CHAT_UPSERT', conversation });
}

export function deleteAiChatConversation(conversationId: string) {
  postToHost({ type: 'AI_CHAT_DELETE', conversationId });
}

export function aiChat(requestId: string, messages: Array<{ role: string; content: string }>) {
  postToHost({ type: 'AI_CHAT', requestId, messages });
}

export function aiCancel(requestId: string) {
  postToHost({ type: 'AI_CANCEL', requestId });
}

export function onAIStreamChunk(handler: (data: { requestId: string; chunk: string }) => void) {
  return onHostMessage(msg => {
    if (msg.type === 'AI_STREAM_CHUNK' && msg.requestId && typeof msg.chunk === 'string') {
      handler({ requestId: msg.requestId, chunk: msg.chunk });
    }
  });
}

export function onAIStreamDone(handler: (data: { requestId: string }) => void) {
  return onHostMessage(msg => {
    if (msg.type === 'AI_STREAM_DONE' && msg.requestId) handler({ requestId: msg.requestId });
  });
}

export function onAIStreamError(handler: (data: { requestId: string; error: string }) => void) {
  return onHostMessage(msg => {
    if (msg.type === 'AI_STREAM_ERROR' && msg.requestId && typeof msg.error === 'string') {
      handler({ requestId: msg.requestId, error: msg.error });
    }
  });
}

// ─── Snippet / Quick link bridge ────────────────────────────────────

export function listSnippets(): Promise<SnippetRecord[]> {
  return hostRequest<SnippetRecord[]>('SNIPPET_LIST');
}

export function upsertSnippet(data: { id?: string; name: string; content: string; keyword?: string }) {
  return hostRequest<SnippetRecord>('SNIPPET_UPSERT', data);
}

export function deleteSnippet(id: string) {
  return hostRequest<{ ok: boolean }>('SNIPPET_DELETE', { id });
}

export function listQuickLinks(): Promise<QuickLinkRecord[]> {
  return hostRequest<QuickLinkRecord[]>('QUICKLINK_LIST');
}

export function upsertQuickLink(data: { id?: string; name: string; urlTemplate: string }) {
  return hostRequest<QuickLinkRecord>('QUICKLINK_UPSERT', data);
}

export function deleteQuickLink(id: string) {
  return hostRequest<{ ok: boolean }>('QUICKLINK_DELETE', { id });
}

export function listNotes(): Promise<NoteRecord[]> {
  return hostRequest<NoteRecord[]>('NOTE_LIST');
}

export function upsertNote(data: { id?: string; title: string; content: string }) {
  return hostRequest<NoteRecord>('NOTE_UPSERT', data);
}

export function deleteNote(id: string) {
  return hostRequest<{ ok: boolean }>('NOTE_DELETE', { id });
}

export function listInstalledPlugins(): Promise<PluginRecord[]> {
  return hostRequest<PluginRecord[]>('PLUGIN_LIST');
}

export function openPluginStore() {
  return hostRequest<{ ok: boolean }>('OPEN_PLUGIN_STORE');
}

export function listClipboardHistory(): Promise<ClipboardRecord[]> {
  return hostRequest<ClipboardRecord[]>('CLIPBOARD_LIST');
}

export function pasteClipboardItem(id: string) {
  return hostRequest<{ ok: boolean }>('CLIPBOARD_PASTE', { id });
}

export function deleteClipboardItem(id: string) {
  return hostRequest<{ ok: boolean }>('CLIPBOARD_DELETE', { id });
}
