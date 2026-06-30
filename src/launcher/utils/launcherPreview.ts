import type { LauncherCommand } from '../types';
import { isArchiveExt } from '../../lib/archiveTypes';
import { isAudioExt, isImageExt, isVideoExt } from '../../lib/mediaTypes';

export type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'code'
  | 'archive'
  | 'folder'
  | 'color'
  | 'app'
  | 'unknown'
  | 'none';

const CODE_EXTENSIONS = new Set([
  'js', 'ts', 'tsx', 'jsx', 'cs', 'cpp', 'c', 'h', 'py', 'rb', 'go', 'rs', 'php', 'sql', 'css', 'scss', 'html', 'htm', 'vue', 'java',
]);

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'xml', 'csv', 'yaml', 'yml', 'ini', 'log']);

export function looksLikeWindowsPath(text?: string): boolean {
  if (!text) return false;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  if (text.startsWith('\\\\')) return true;
  return false;
}

export function inferPreviewKind(path: string): PreviewKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (!ext && path.endsWith('\\')) return 'folder';
  if (isArchiveExt(ext)) return 'archive';
  if (ext === 'pdf') return 'pdf';
  if (isImageExt(ext)) return 'image';
  if (isVideoExt(ext)) return 'video';
  if (isAudioExt(ext)) return 'audio';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (ext === 'exe' || ext === 'lnk') return 'app';
  if (ext === 'folcolor') return 'color';
  return 'unknown';
}

export function resolvePreviewForCommand(command: LauncherCommand | null): { path: string | null; kind: PreviewKind } {
  if (!command) return { path: null, kind: 'none' };

  if (command.previewPath) {
    return {
      path: command.previewPath,
      kind: (command.previewKind as PreviewKind) || inferPreviewKind(command.previewPath),
    };
  }

  if (command.openPath) {
    return { path: command.openPath, kind: inferPreviewKind(command.openPath) };
  }

  if (command.category === 'file' && looksLikeWindowsPath(command.subtitle)) {
    const path = command.subtitle!;
    return { path, kind: inferPreviewKind(path) };
  }

  if (command.previewKind === 'text' || command.category === 'snippet') {
    return { path: null, kind: 'text' };
  }

  return { path: null, kind: 'none' };
}

export function launcherStreamUrl(path: string): string {
  return `https://bndz.launcher.local/stream?path=${encodeURIComponent(path)}`;
}

export function launcherIconUrl(path: string): string {
  return `https://bndz.launcher.local/icon?path=${encodeURIComponent(path)}`;
}
