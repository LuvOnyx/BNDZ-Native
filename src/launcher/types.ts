/** Adapted from SuperCmd CommandInfo — trimmed for Flow bridge on Windows */
export type LauncherCommandCategory =
  | 'app'
  | 'extension'
  | 'system'
  | 'clipboard'
  | 'snippet'
  | 'quicklink'
  | 'file'
  | 'bndz';

export interface LauncherCommand {
  id: string;
  title: string;
  subtitle?: string;
  category: LauncherCommandCategory;
  iconUrl?: string;
  iconGlyph?: string;
  alias?: string;
  hotkey?: string;
  score?: number;
  pluginId?: string;
  actionKeyword?: string;
  detail?: string;
  openPath?: string;
  previewPath?: string;
  previewKind?: string;
}

export interface LauncherQueryResult {
  query: string;
  commands: LauncherCommand[];
  sections?: { title: string; items: LauncherCommand[] }[];
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  cancelled?: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface AiChatSnapshot {
  conversations: AiConversation[];
}

export interface SnippetRecord {
  id: string;
  name: string;
  content: string;
  keyword?: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface QuickLinkRecord {
  id: string;
  name: string;
  urlTemplate: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClipboardRecord {
  id: string;
  kind?: 'text' | 'image' | 'files';
  content: string;
  preview: string;
  timestamp: number;
  filePaths?: string[];
  imagePath?: string;
  pinned?: boolean;
}

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PluginRecord {
  id: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  actionKeyword?: string;
  disabled?: boolean;
}

/** Optional correlation fields on host ↔ launcher messages */
export type LauncherBridgeEnvelope = {
  requestId?: string;
  payload?: unknown;
};

export type LauncherBridgeMessage = LauncherBridgeEnvelope & (
  | { type: 'LAUNCHER_READY' }
  | { type: 'QUERY'; query: string; requestId: string }
  | { type: 'QUERY_RESULT'; requestId: string; partial?: boolean; result: LauncherQueryResult }
  | { type: 'EXECUTE'; requestId: string; commandId: string; pluginId?: string; actionKeyword?: string; query?: string }
  | { type: 'EXECUTE_RESULT'; requestId?: string; ok: boolean }
  | { type: 'HIDE' }
  | { type: 'OPEN_LAUNCHER_SETTINGS' }
  | { type: 'OPEN_BNDZ_FILE_MANAGER' }
  | { type: 'OPEN_BNDZ_PATH'; path: string }
  | { type: 'LAUNCHER_VISIBLE' }
  | { type: 'SET_LAUNCHER_LAYOUT'; mode: 'compact' | 'expanded' }
  | { type: 'GET_FILE_PREVIEW_META'; path: string; requestId: string }
  | { type: 'GET_FILE_PREVIEW_META_RESULT'; requestId: string; payload: FilePreviewMeta }
  | {
      type: 'THEME_SYNC';
      dark: boolean;
      accent?: string;
      wallpaperUrl?: string;
      launcherShowBackground?: boolean;
      launcherBackgroundOpacity?: number;
      launcherBackgroundBlur?: number;
    }
  | { type: 'AI_STREAM_CHUNK'; requestId: string; chunk: string }
  | { type: 'AI_STREAM_DONE'; requestId: string }
  | { type: 'AI_STREAM_ERROR'; requestId: string; error: string }
  | { type: 'AI_CHAT'; requestId: string; messages: Array<{ role: string; content: string }> }
  | { type: 'AI_CHAT_UPSERT'; conversation: AiConversation }
  | { type: 'AI_CHAT_DELETE'; conversationId: string }
  | { type: 'AI_CANCEL'; requestId: string }
);

/** Host RPC replies (SNIPPET_LIST_RESULT, etc.) — kept separate so bridge unions narrow cleanly. */
export type LauncherBridgeRpcMessage = LauncherBridgeEnvelope & {
  type: string;
  requestId?: string;
  ok?: boolean;
  payload?: unknown;
};

export type LauncherBridgePost = LauncherBridgeMessage | (LauncherBridgeEnvelope & Record<string, unknown> & { type: string });

export interface FilePreviewMeta {
  path: string;
  kind: string;
  name: string;
  extension: string;
  size: number;
  sizeLabel: string;
  modified: string;
  created: string;
  contentType: string;
  width?: number;
  height?: number;
  archiveEntryCount?: number;
  folderItemCount?: number;
  fields?: Record<string, string>;
}
