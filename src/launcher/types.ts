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
}

export interface LauncherQueryResult {
  query: string;
  commands: LauncherCommand[];
  sections?: { title: string; items: LauncherCommand[] }[];
}

export type LauncherBridgeMessage =
  | { type: 'LAUNCHER_READY' }
  | { type: 'QUERY'; query: string; requestId: string }
  | { type: 'QUERY_RESULT'; requestId: string; result: LauncherQueryResult }
  | { type: 'EXECUTE'; commandId: string; pluginId?: string; actionKeyword?: string }
  | { type: 'HIDE' }
  | { type: 'THEME_SYNC'; dark: boolean; accent?: string };
