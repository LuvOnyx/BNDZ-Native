/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { nativeCall, dedupeInFlight } from './ipcCore';
import { normalizePanePath } from './pathUtils';
import { EMPTY_LICENSE_STATUS, type LicenseStatus } from './licenseTypes';
import { entityHasTag } from './tagUtils';

export type TagMetaBatchItem = {
  path: string;
  label?: string;
  comment?: string;
  tags: string[];
};

export type { LicenseStatus };

export interface RenameOperation {
  originalName: string;
  newName: string;
  reason?: string;
}

export interface ShareMenuItem {
  id?: string;
  label?: string;
  kind?: 'verb' | 'sendto' | 'open' | 'cloud-share';
  verb?: string;
  target?: string;
  group?: 'main' | 'sendto' | 'cloud';
  separator?: boolean;
}

export interface ShellIntegrationResult {
  success: boolean;
  message: string;
  needsElevation?: boolean;
}

export interface DefaultFileManagerStatus {
  active: boolean;
  directoryOpen: boolean;
  folderOpen: boolean;
  driveOpen: boolean;
}

function _parseWebViewMessage(raw: unknown): any {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function _nativeCall<T>(
  type: string,
  responseType: string,
  _legacyId: string,
  payload?: any,
  timeoutMs = 15000,
): Promise<T> {
  return nativeCall<T>(type, responseType, payload, timeoutMs);
}

export const IPC = {
  // True when running inside WebView2 C# host
  isNative: typeof window !== 'undefined' && !!(window as any).chrome?.webview,

  async readFileContent(path: string): Promise<string> {
    try {
        if (this.isNative) {
            const { toWindowsPath, encodeLocalStreamPath } = await import('./pathUtils');
            const virtualUrl = `http://bndz.local/local-stream/${encodeLocalStreamPath(toWindowsPath(path))}`;
            const response = await window.fetch(virtualUrl);
            if (response.ok) return await response.text();
        } else {
            const cleanPath = path.startsWith('C:\\') ? path.replace('C:\\', '/') : path;
            const res = await fetch('/api/fs/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: cleanPath })
            });
            if (res.ok) {
                const data = await res.json();
                return data.content;
            }
        }
        return "";
    } catch {
        return `// Content of ${path}\n`;
    }
  },

  _listeners: [] as Array<(events: any[]) => void>,
  _initialized: false as boolean,
  _progressListeners: [] as Array<(progress: any) => void>,
  _conflictListeners: [] as Array<(conflict: any) => void>,
  _elevationListeners: [] as Array<(payload: { title?: string; message: string; context?: string }) => void>,
  _drivesListeners: [] as Array<(drives: any[]) => void>,
  _folderSizeListeners: [] as Array<(progress: any) => void>,
  _duplicateProgressListeners: [] as Array<(progress: any) => void>,
  _folderSyncProgressListeners: [] as Array<(progress: any) => void>,
  _closeRequestListeners: [] as Array<(payload?: { source?: string }) => void>,
  _openPathListeners: [] as Array<(path: string) => void>,
  _actionLogListeners: [] as Array<(state: { canUndo: boolean; canRedo: boolean }) => void>,
  _startupActionListeners: [] as Array<(action: string) => void>,
  _aiDownloadProgressListeners: [] as Array<(progress: { percent: number }) => void>,
  _indexProgressListeners: [] as Array<(progress: { currentPath: string; filesIndexed: number; done: boolean; root?: string; error?: string }) => void>,
  _aiStreamChunkListeners: new Map<string, (chunk: string) => void>(),
  _aiStreamDoneListeners: new Map<string, () => void>(),
  _aiStreamErrorListeners: new Map<string, (error: string) => void>(),

  init() {
    if (this.isNative && !this._initialized) {
      (window as any).chrome.webview.addEventListener('message', (e: any) => {
        const data = _parseWebViewMessage(e.data);
        if (!data?.type) return;
        if (data.type === 'FS_EVENT_BATCH') {
          this._listeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'PROGRESS_UPDATE') {
          this._progressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'CONFLICT_DETECTED') {
          this._conflictListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'ELEVATION_REQUIRED') {
          this._elevationListeners.forEach(cb => cb(data.payload ?? { message: 'Administrator approval may be required.' }));
        } else if (data.type === 'DRIVES_CHANGED') {
          this._drivesListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'EXTERNAL_FILES_DROPPED') {
          window.dispatchEvent(new CustomEvent('bndz-external-drop', { detail: data.payload }));
        } else if (data.type === 'FOLDER_SIZE_PROGRESS') {
          this._folderSizeListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'DUPLICATE_SCAN_PROGRESS') {
          this._duplicateProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'FOLDER_SYNC_PROGRESS') {
          this._folderSyncProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'CLOSE_REQUEST') {
          const source = data.payload?.source;
          this._closeRequestListeners.forEach(cb => cb({ source }));
        } else if (data.type === 'BNDZ_OPEN_PATH') {
          const path = data.payload?.path ?? '';
          this._openPathListeners.forEach(cb => cb(path));
        } else if (data.type === 'ACTION_LOG_CHANGED') {
          const payload = data.payload ?? {};
          this._actionLogListeners.forEach(cb => cb({
            canUndo: !!payload.canUndo,
            canRedo: !!payload.canRedo,
          }));
        } else if (data.type === 'BNDZ_STARTUP_ACTION') {
          const action = data.payload ?? '';
          if (action) this._startupActionListeners.forEach(cb => cb(String(action)));
        } else if (data.type === 'AI_DOWNLOAD_PROGRESS') {
          this._aiDownloadProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'INDEX_PROGRESS') {
          this._indexProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'AI_STREAM_CHUNK' && data.requestId && typeof data.chunk === 'string') {
          this._aiStreamChunkListeners.get(data.requestId)?.(data.chunk);
        } else if (data.type === 'AI_STREAM_DONE' && data.requestId) {
          this._aiStreamDoneListeners.get(data.requestId)?.();
          this._aiStreamChunkListeners.delete(data.requestId);
          this._aiStreamDoneListeners.delete(data.requestId);
          this._aiStreamErrorListeners.delete(data.requestId);
        } else if (data.type === 'AI_STREAM_ERROR' && data.requestId && typeof data.error === 'string') {
          this._aiStreamErrorListeners.get(data.requestId)?.(data.error);
          this._aiStreamChunkListeners.delete(data.requestId);
          this._aiStreamDoneListeners.delete(data.requestId);
          this._aiStreamErrorListeners.delete(data.requestId);
        }
      });
      this._initialized = true;
    }
  },

  onDrivesChanged(callback: (drives: any[]) => void) {
    this.init();
    this._drivesListeners.push(callback);
    return () => {
      this._drivesListeners = this._drivesListeners.filter(cb => cb !== callback);
    };
  },

  onFsEvents(callback: (events: any[]) => void) {
    this.init();
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  },

  onProgress(callback: (progress: any) => void) {
    this.init();
    this._progressListeners.push(callback);
    return () => {
      this._progressListeners = this._progressListeners.filter(cb => cb !== callback);
    };
  },

  onConflictContent(callback: (conflict: any) => void) {
    this.init();
    this._conflictListeners.push(callback);
    return () => {
      this._conflictListeners = this._conflictListeners.filter(cb => cb !== callback);
    };
  },

  onElevationRequired(callback: (payload: { title?: string; message: string; context?: string }) => void) {
    this.init();
    this._elevationListeners.push(callback);
    return () => {
      this._elevationListeners = this._elevationListeners.filter(cb => cb !== callback);
    };
  },

  onFolderSizeProgress(callback: (progress: { current: number; total: number; path: string; percent: number; bytesScanned?: number }) => void) {
    this.init();
    this._folderSizeListeners.push(callback);
    return () => {
      this._folderSizeListeners = this._folderSizeListeners.filter(cb => cb !== callback);
    };
  },

  onIndexProgress(callback: (progress: { currentPath: string; filesIndexed: number; done: boolean; root?: string; error?: string }) => void) {
    this.init();
    this._indexProgressListeners.push(callback);
    return () => {
      this._indexProgressListeners = this._indexProgressListeners.filter(cb => cb !== callback);
    };
  },

  onDuplicateScanProgress(callback: (progress: { filesScanned: number; totalFiles: number; currentPath: string; percent: number }) => void) {
    this.init();
    this._duplicateProgressListeners.push(callback);
    return () => {
      this._duplicateProgressListeners = this._duplicateProgressListeners.filter(cb => cb !== callback);
    };
  },

  onFolderSyncProgress(callback: (progress: { jobId: string; status: string; percent: number; currentFile?: string; message?: string }) => void) {
    this.init();
    this._folderSyncProgressListeners.push(callback);
    return () => {
      this._folderSyncProgressListeners = this._folderSyncProgressListeners.filter(cb => cb !== callback);
    };
  },

  onCloseRequest(callback: (payload?: { source?: string }) => void) {
    this.init();
    this._closeRequestListeners.push(callback);
    return () => {
      this._closeRequestListeners = this._closeRequestListeners.filter(cb => cb !== callback);
    };
  },

  onOpenPath(callback: (path: string) => void) {
    this.init();
    this._openPathListeners.push(callback);
    return () => {
      this._openPathListeners = this._openPathListeners.filter(cb => cb !== callback);
    };
  },

  requestClose(source: 'x' | 'menu' | 'tray' = 'x'): void {
    if (this.isNative) {
      if (source === 'x') {
        this.windowChrome('close');
        return;
      }
      (window as any).chrome.webview.postMessage({ type: 'REQUEST_CLOSE', payload: { source } });
    }
  },

  windowCloseResolve(action: 'cancel' | 'tray' | 'quit', rememberTray = false): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'WINDOW_CLOSE_RESOLVE',
        payload: { action, rememberTray },
      });
    }
  },

  restoreFromTray(): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'TRAY_RESTORE' });
    }
  },

  getFolderSyncJobs(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_folderSyncJobs`;
      return _nativeCall<any[]>('FOLDER_SYNC_GET_JOBS', 'FOLDER_SYNC_JOBS_RESULT', id, {}, 15000).then(r => r || []);
    }
    return Promise.resolve([]);
  },

  saveFolderSyncJobs(jobs: any[]): Promise<void> {
    if (this.isNative) {
      const id = `${Date.now()}_folderSyncSave`;
      return _nativeCall<any>('FOLDER_SYNC_SAVE_JOBS', 'FOLDER_SYNC_SAVE_RESULT', id, jobs, 15000).then(() => {});
    }
    return Promise.resolve();
  },

  runFolderSync(jobId: string): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_folderSyncRun`;
      return _nativeCall<any>('FOLDER_SYNC_RUN', 'FOLDER_SYNC_RUN_RESULT', id, { jobId }, 600000);
    }
    return Promise.resolve({ ok: true });
  },

  setFolderSyncWatch(jobId: string, enabled: boolean): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'FOLDER_SYNC_SET_WATCH',
        payload: { jobId, enabled },
      });
    }
  },

  previewFolderSync(jobId: string): Promise<{
    wouldCopy?: string[];
    wouldUpdate?: string[];
    wouldSkip?: string[];
    extraInDest?: string[];
    summary?: string;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_folderSyncPreview`;
      return _nativeCall<any>('FOLDER_SYNC_PREVIEW', 'FOLDER_SYNC_PREVIEW_RESULT', id, { jobId }, 120000).then(r => r || {});
    }
    return Promise.resolve({ summary: 'Preview requires the native host.', wouldCopy: [], wouldUpdate: [], wouldSkip: [], extraInDest: [] });
  },

  scanFolderSizes(paths: string[], forceRescan = false): Promise<{
    sizes: Record<string, number>;
    cancelled?: boolean;
    error?: string;
    scannedCount?: number;
    cachedCount?: number;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_folderSizes`;
      return _nativeCall<any>('SCAN_FOLDER_SIZES', 'FOLDER_SIZE_RESULT', id, { paths, forceRescan }, 600000).then(r => ({
        sizes: r?.sizes ?? r?.Sizes ?? {},
        cancelled: r?.cancelled ?? r?.Cancelled,
        error: r?.error,
        scannedCount: r?.scannedCount ?? r?.ScannedCount ?? 0,
        cachedCount: r?.cachedCount ?? r?.CachedCount ?? 0,
      }));
    }
    return Promise.resolve({ sizes: {}, scannedCount: 0, cachedCount: 0 });
  },

  showNativeNotification(title: string, message: string, tag?: string): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({
      type: 'SHOW_NATIVE_NOTIFICATION',
      payload: { title, message, tag },
    });
  },

  cancelFolderSizeScan(): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'CANCEL_FOLDER_SIZE_SCAN' });
    }
  },

  scanDuplicates(
    rootPath: string,
    recursive = true,
    minSizeBytes = 1024,
  ): Promise<{ groups: Array<{ hash: string; size: number; paths: string[] }>; cancelled?: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_dupes`;
      return _nativeCall<any>('SCAN_DUPLICATES', 'DUPLICATE_SCAN_RESULT', id, { rootPath, recursive, minSizeBytes }, 600000).then(r => ({
        groups: r?.groups ?? r?.Groups ?? [],
        cancelled: r?.cancelled ?? r?.Cancelled,
        error: r?.error,
      }));
    }
    return fetch('/api/fs/scan-duplicates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath, recursive, minSizeBytes }),
    })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { groups: [], error: err.error || res.statusText };
        }
        return res.json();
      })
      .catch(err => ({ groups: [], error: err instanceof Error ? err.message : 'Scan failed' }));
  },

  cancelDuplicateScan(): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'CANCEL_DUPLICATE_SCAN' });
    }
  },

  archiveAddFiles(archivePath: string, files: string[], entryNames?: string[]): Promise<{ success: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_archiveAdd`;
      return _nativeCall<{ success: boolean; error?: string }>('ARCHIVE_ADD_FILES', 'ARCHIVE_ADD_FILES_RESULT', id, { archivePath, files, entryNames }, 120000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  archiveExtractEntry(archivePath: string, entryPath: string, destination: string): Promise<{ success: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_archiveExtract`;
      return _nativeCall<{ success: boolean; error?: string }>('ARCHIVE_EXTRACT_ENTRY', 'ARCHIVE_EXTRACT_ENTRY_RESULT', id, { archivePath, entryPath, destination }, 120000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  archiveExtractEntryToTemp(archivePath: string, entryPath: string): Promise<{ success: boolean; path?: string; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_archiveExtractTemp`;
      return _nativeCall<{ success: boolean; path?: string; error?: string }>('ARCHIVE_EXTRACT_ENTRY_TEMP', 'ARCHIVE_EXTRACT_ENTRY_TEMP_RESULT', id, { archivePath, entryPath }, 120000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  async executeFsOperation(
    operationId: string,
    action: 'copy' | 'move' | 'delete' | 'create-dir' | 'create-file' | 'undo' | 'redo',
    source: string | string[],
    target: string,
    bypassRecycleBin: boolean = false
  ): Promise<void> {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'EXECUTE_FS_OPERATION',
        payload: { operationId, action, source, target, bypassRecycleBin }
      });
      return;
    }
    if (action === 'undo' || action === 'redo' || action === 'copy') {
      return;
    }
    const res = await fetch('/api/fs/operation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, source, target }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `FS operation failed (${res.status})`);
    }
  },

  startDrag(paths: string | string[]) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'START_DRAG', payload: { paths } });
    }
  },

  clearThumbnailCache() {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'CLEAR_THUMBNAIL_CACHE' });
    }
  },

  executeUndo(timeoutMs = 120_000): Promise<{ ok: boolean; message: string }> {
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; message: string }>('EXECUTE_UNDO', 'UNDO_REDO_RESULT', undefined, undefined, timeoutMs);
    }
    return Promise.resolve({ ok: false, message: 'Undo requires native host' });
  },

  executeRedo(timeoutMs = 120_000): Promise<{ ok: boolean; message: string }> {
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; message: string }>('EXECUTE_REDO', 'UNDO_REDO_RESULT', undefined, undefined, timeoutMs);
    }
    return Promise.resolve({ ok: false, message: 'Redo requires native host' });
  },

  getActionLog(): Promise<{ items: Array<{ id: string; kind: string; label: string; utc: string; canUndo: boolean }>; canUndo: boolean; canRedo: boolean }> {
    if (this.isNative) {
      return _nativeCall('GET_ACTION_LOG', 'ACTION_LOG_RESULT', undefined);
    }
    return Promise.resolve({ items: [], canUndo: false, canRedo: false });
  },

  onActionLogChanged(callback: (state: { canUndo: boolean; canRedo: boolean }) => void) {
    this.init();
    this._actionLogListeners.push(callback);
    return () => {
      this._actionLogListeners = this._actionLogListeners.filter(cb => cb !== callback);
    };
  },

  onStartupAction(callback: (action: string) => void) {
    this.init();
    this._startupActionListeners.push(callback);
    return () => {
      this._startupActionListeners = this._startupActionListeners.filter(cb => cb !== callback);
    };
  },

  compareDirectories(pathA: string, pathB: string, useHashing: boolean = false): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_compareDir`;
      return _nativeCall<any>('COMPARE_DIRECTORIES', 'COMPARE_DIRECTORIES_RESULT', id, { pathA, pathB, useHashing });
    }
    return Promise.resolve([]);
  },

  compareFiles(pathA: string, pathB: string): Promise<{
    ok: boolean;
    identical?: boolean;
    message?: string;
    hashA?: string;
    hashB?: string;
    firstDiffOffset?: number;
    previewA?: string;
    previewB?: string;
    sizeA?: number;
    sizeB?: number;
  }> {
    if (this.isNative) {
      return _nativeCall('COMPARE_FILES', 'COMPARE_FILES_RESULT', `${Date.now()}_compareFiles`, { pathA, pathB });
    }
    return Promise.resolve({ ok: false, message: 'Compare requires native host' });
  },

  executeContextMenuVerb(path: string | string[], verb: string, x?: number, y?: number, bypassRecycleBin: boolean = false, sendToTarget?: string) {
    if (this.isNative) {
      const normalize = (p: string) => {
        let s = p.trim();
        if (s.startsWith('::{')) return s;
        if (s.toLowerCase().startsWith('shell:')) return s;
        if (s.startsWith('/')) s = s.substring(1);
        s = s.replace(/\//g, '\\');
        while (s.includes('\\\\')) s = s.replace('\\\\', '\\');
        if (/^[A-Za-z]:$/.test(s)) s += '\\';
        return s;
      };
      const paths = Array.isArray(path) ? path.map(normalize) : normalize(path);
      (window as any).chrome.webview.postMessage({
        type: 'EXECUTE_CONTEXT_MENU_VERB',
        payload: { path: paths, verb, x, y, bypassRecycleBin, sendToTarget }
      });
    }
  },

  shellExecute(action: 'open' | 'openWith' | 'copyPath' | 'compress' | 'openTerminal' | 'openExplorer' | 'executeScript' | string, path: string | string[], workingDir?: string) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SHELL_EXECUTE', payload: { action, path, workingDir } });
    } else {
      if (action === 'copyPath') {
        const text = Array.isArray(path) ? path.join('\n') : path;
        navigator.clipboard.writeText(text).catch(err => {
          window.dispatchEvent(new CustomEvent('bndz-native-alert', {
            detail: { title: 'Clipboard', message: `Clipboard failed: ${err.message}` },
          }));
        });
      }
    }
  },

  resolveConflict(operationId: string, fileName: string, resolution: 'replace' | 'skip' | 'keepboth', applyToAll = false) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'RESOLVE_CONFLICT',
        payload: { operationId, fileName, resolution, applyToAll }
      });
    }
  },

  watchDirectory(path: string) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'WATCH_DIR', payload: { path } });
    }
  },

  onAiDownloadProgress(callback: (progress: { percent: number }) => void) {
    this.init();
    this._aiDownloadProgressListeners.push(callback);
    return () => {
      this._aiDownloadProgressListeners = this._aiDownloadProgressListeners.filter(cb => cb !== callback);
    };
  },

  async getAiModelStatus(): Promise<{
    present: boolean;
    loaded: boolean;
    downloading: boolean;
    progress?: number;
    modelName: string;
    sizeLabel: string;
  }> {
    if (!this.isNative) {
      return { present: false, loaded: false, downloading: false, modelName: '', sizeLabel: '' };
    }
    const id = `${Date.now()}_aiModelStatus`;
    return await _nativeCall('AI_MODEL_STATUS', 'AI_MODEL_STATUS_RESULT', id, {}, 15000);
  },

  async downloadAiModel(): Promise<boolean> {
    if (!this.isNative) return false;
    const id = `${Date.now()}_aiDownload`;
    try {
      const result = await _nativeCall<{ ok?: boolean }>('AI_DOWNLOAD_MODEL', 'AI_DOWNLOAD_MODEL_RESULT', id, {}, 7_200_000);
      return !!result?.ok;
    } catch {
      return false;
    }
  },

  async aiGenerate(prompt: string, timeoutMs = 120000): Promise<string> {
    if (this.isNative) {
      const { ensureAiModelReady } = await import('./aiModelGate');
      const ready = await ensureAiModelReady();
      if (!ready) return '';
      const id = `${Date.now()}_aiGenerate`;
      try {
        const result = await _nativeCall<{ text?: string }>('AI_GENERATE', 'AI_GENERATE_RESULT', id, { prompt }, timeoutMs);
        return result?.text ?? '';
      } catch {
        return '';
      }
    }
    return '';
  },

  aiGenerateStream(prompt: string, onChunk?: (chunk: string) => void, timeoutMs = 120000): Promise<string> {
    if (!this.isNative) return Promise.resolve('');
    this.init();
    const id = `${Date.now()}_aiStream`;
    return new Promise(async (resolve, reject) => {
      const { ensureAiModelReady } = await import('./aiModelGate');
      const ready = await ensureAiModelReady();
      if (!ready) {
        resolve('');
        return;
      }
      const chunks: string[] = [];
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('AI stream timed out'));
      }, timeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        this._aiStreamChunkListeners.delete(id);
        this._aiStreamDoneListeners.delete(id);
        this._aiStreamErrorListeners.delete(id);
      };
      this._aiStreamChunkListeners.set(id, chunk => {
        chunks.push(chunk);
        onChunk?.(chunk);
      });
      this._aiStreamDoneListeners.set(id, () => {
        cleanup();
        resolve(chunks.join(''));
      });
      this._aiStreamErrorListeners.set(id, err => {
        cleanup();
        reject(new Error(err));
      });
      (window as any).chrome.webview.postMessage({ type: 'AI_GENERATE_STREAM', id, payload: { prompt } });
    });
  },

  async aiBatchRename(filenames: string[], instructions: string): Promise<RenameOperation[]> {
    if (this.isNative) {
      const { ensureAiModelReady } = await import('./aiModelGate');
      const ready = await ensureAiModelReady();
      if (!ready) return [];
      const id = `${Date.now()}_aiBatchRename`;
      try {
        return await _nativeCall<RenameOperation[]>('AI_BATCH_RENAME', 'AI_BATCH_RENAME_RESULT', id, { filenames, instructions }, 30000);
      } catch {
        return [];
      }
    }
    // Web fallback
    const res = await fetch('/api/gemini/batch-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames, customInstructions: instructions })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'AI Request Failed');
    }
    const data = await res.json();
    return data.renamedFiles;
  },

  syncFolders(source: string, target: string, entityId: string, action: 'copy' | 'move' = 'move') {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'SYNC_FOLDERS',
        payload: { source, target, entityId, action }
      });
    }
  },

  getCloudProviders(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_cloudProviders`;
      return _nativeCall<any[]>('GET_CLOUD_PROVIDERS', 'CLOUD_PROVIDERS_RESULT', id);
    }
    return Promise.resolve([
      { name: 'OneDrive', path: 'C:\\Users\\' + (window as any).__bndzUser || 'User' + '\\OneDrive', icon: '☁️' }
    ]);
  },

  getSystemDrives(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_drives`;
      return _nativeCall<any[]>('GET_DRIVES', 'DRIVES_RESULT', id);
    }
    return Promise.resolve([
      { name: '/', letter: '/', label: 'Container Root', totalSpace: 10_000_000_000, freeSpace: 5_000_000_000 },
      { name: '/workspace', letter: '/workspace', label: 'Workspace', totalSpace: 10_000_000_000, freeSpace: 5_000_000_000 }
    ]);
  },

  getNetworkLocations(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_network`;
      return _nativeCall<any[]>('GET_NETWORK_LOCATIONS', 'NETWORK_LOCATIONS_RESULT', id).catch(() => []);
    }
    return Promise.resolve([]);
  },

  getAppVersion(): Promise<string> {
    if (this.isNative) {
      const id = `${Date.now()}_appVer`;
      return _nativeCall<string>('GET_APP_VERSION', 'APP_VERSION_RESULT', id).catch(() => '1.0.0');
    }
    return Promise.resolve('1.0.0');
  },

  getAppRuntimeInfo(): Promise<{
    version: string;
    iniPath: string;
    jsonConfigPath: string;
    is64Bit: boolean;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_appRuntime`;
      return _nativeCall<{
        version: string;
        iniPath: string;
        jsonConfigPath: string;
        is64Bit: boolean;
      }>('GET_APP_RUNTIME_INFO', 'APP_RUNTIME_INFO_RESULT', id).catch(() => ({
        version: '1.0.0',
        iniPath: '',
        jsonConfigPath: '',
        is64Bit: true,
      }));
    }
    return Promise.resolve({
      version: '1.0.0',
      iniPath: '%AppData%\\BNDZ64\\BNDZ.ini',
      jsonConfigPath: '%AppData%\\BNDZ64\\bndz_config.json',
      is64Bit: true,
    });
  },

  checkForUpdates(manifestUrl?: string): Promise<{
    currentVersion: string;
    latestVersion?: string | null;
    updateAvailable: boolean;
    releaseUrl?: string | null;
    releaseNotes?: string | null;
    error?: string | null;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_updates`;
      return _nativeCall<{
        currentVersion: string;
        latestVersion?: string | null;
        updateAvailable: boolean;
        releaseUrl?: string | null;
        releaseNotes?: string | null;
        error?: string | null;
      }>('CHECK_FOR_UPDATES', 'CHECK_FOR_UPDATES_RESULT', id, { manifestUrl: manifestUrl || '' }, 20000)
        .catch(err => ({
          currentVersion: '1.0.0',
          updateAvailable: false,
          error: String(err?.message || err),
        }));
    }
    return Promise.resolve({ currentVersion: '1.0.0', updateAvailable: false, error: 'Updates require native host.' });
  },

  getIndexedEntry(panePath: string): Promise<Record<string, unknown> | null> {
    if (this.isNative) {
      const id = `${Date.now()}_indexedEntry`;
      return _nativeCall<Record<string, unknown> | null>(
        'GET_INDEXED_ENTRY',
        'INDEXED_ENTRY_RESULT',
        id,
        { path: panePath },
        10000,
      ).catch(() => null);
    }
    return Promise.resolve(null);
  },

  getVirtualViewContents(view: 'recent' | 'media' | 'large', limit = 500): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_virtualView`;
      return _nativeCall<{ items: any[] }>(
        'GET_VIRTUAL_VIEW_CONTENTS',
        'VIRTUAL_VIEW_CONTENTS_RESULT',
        id,
        { view, limit },
        20000,
      ).then(r => r?.items ?? []).catch(() => []);
    }
    return Promise.resolve([]);
  },

  indexBndzLocation(panePath: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_indexLoc`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'INDEX_BNDZ_LOCATION',
        'INDEX_BNDZ_LOCATION_RESULT',
        id,
        { path: panePath },
        120000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, error: 'Indexing requires native host.' });
  },

  getIndexStatus(): Promise<{ fileCount: number; folderCount: number; locations: Array<{ path: string; lastIndexed: number }>; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_indexStatus`;
      return _nativeCall('GET_INDEX_STATUS', 'INDEX_STATUS_RESULT', id, {}, 15000)
        .then((payload: any) => {
          if (payload?.error) throw new Error(payload.error);
          return {
            fileCount: payload?.fileCount ?? 0,
            folderCount: payload?.folderCount ?? 0,
            locations: payload?.locations ?? [],
          };
        })
        .catch(err => ({ fileCount: 0, folderCount: 0, locations: [], error: String(err?.message || err) }));
    }
    return Promise.resolve({ fileCount: 0, folderCount: 0, locations: [] });
  },

  reindexBndzDefaults(): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_reindexDefaults`;
      return _nativeCall<{ ok: boolean; skipped?: boolean; error?: string }>(
        'REINDEX_BNDZ_DEFAULTS',
        'REINDEX_BNDZ_DEFAULTS_RESULT',
        id,
        {},
        30000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, error: 'Indexing requires native host.' });
  },

  getSystemShortcuts(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_shortcuts`;
      return _nativeCall<any[]>('GET_SYSTEM_SHORTCUTS', 'SYSTEM_SHORTCUTS_RESULT', id).catch(() => IPC._fallbackShortcuts());
    }
    return Promise.resolve(IPC._fallbackShortcuts());
  },

  _fallbackShortcuts(): any[] {
    return [
      { name: 'Home', path: 'shell:Profile', icon: 'home' },
      { name: 'Desktop', path: 'shell:Desktop', icon: 'desktop' },
      { name: 'Documents', path: 'shell:Personal', icon: 'documents' },
      { name: 'Downloads', path: 'shell:Downloads', icon: 'downloads' },
      { name: 'Pictures', path: 'shell:My Pictures', icon: 'pictures' },
      { name: 'Root', path: `/`, icon: 'hard-drive' },
    ];
  },

  setAsDefaultManager(enable: boolean): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_setDefault`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'setDefault', enable }, 60000)
        .then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  setInContextMenu(enable: boolean): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_setContextMenu`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'setContextMenu', enable }, 60000)
        .then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  setWin11MoreOptions(enable: boolean): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_setWin11`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'setWin11MoreOptions', enable }, 60000)
        .then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  isElevated(): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_elevated`;
      return _nativeCall<{ elevated?: boolean }>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'isElevated' }, 30000)
        .then(r => !!r?.elevated)
        .catch(() => false);
    }
    return Promise.resolve(false);
  },

  getDefaultFileManagerStatus(): Promise<DefaultFileManagerStatus> {
    if (this.isNative) {
      const id = `${Date.now()}_defaultFmStatus`;
      return _nativeCall<DefaultFileManagerStatus>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'getDefaultStatus' }, 30000)
        .then(r => r ?? { active: false, directoryOpen: false, folderOpen: false, driveOpen: false });
    }
    return Promise.resolve({ active: false, directoryOpen: false, folderOpen: false, driveOpen: false });
  },

  relaunchAsAdmin(): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_relaunchAdmin`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'relaunchAdmin' }, 60000)
        .then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  saveSettings(settings: any) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SAVE_SETTINGS', payload: settings });
    }
  },

  loadSettings(): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_loadSettings`;
      return _nativeCall<any>('LOAD_SETTINGS', 'LOAD_SETTINGS_RESULT', id).catch(() => null);
    }
    return Promise.resolve(null);
  },

  fetchNativeContextMenuItems(path: string): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_ctxItems`;
      return _nativeCall<any[]>('GET_CONTEXT_MENU_ITEMS', 'CONTEXT_MENU_ITEMS_RESULT', id, { path });
    }
    return Promise.resolve([
      { id: 'open',       label: 'Open',       icon: 'Open'     },
      { id: 'edit',       label: 'Edit',       icon: 'Edit'     },
      { id: 'share',      label: 'Share',      icon: 'Share'    },
      { separator: true },
      { id: 'copy',       label: 'Copy',       icon: 'Copy'     },
      { id: 'cut',        label: 'Cut',        icon: 'Cut'      },
      { id: 'delete',     label: 'Delete',     icon: 'Trash'    },
      { id: 'properties', label: 'Properties', icon: 'Settings' },
    ]);
  },

  fetchShareMenuItems(path: string): Promise<ShareMenuItem[]> {
    if (this.isNative) {
      const id = `${Date.now()}_shareItems`;
      return _nativeCall<ShareMenuItem[]>('GET_SHARE_MENU_ITEMS', 'SHARE_MENU_ITEMS_RESULT', id, { path });
    }
    return Promise.resolve([
      { id: 'share', label: 'Share with apps…', kind: 'verb', verb: 'share', group: 'main' },
    ]);
  },

  checkPathExists(path: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_checkPath`;
      return _nativeCall<boolean>('CHECK_PATH_EXISTS', 'CHECK_PATH_RESULT', id, { path });
    }
    return Promise.resolve(path.length > 2);
  },

  emptyRecycleBin(): Promise<{ success: boolean }> {
    if (this.isNative) {
      const id = `${Date.now()}_emptyRecycleBin`;
      return _nativeCall<{ success: boolean }>('EMPTY_RECYCLE_BIN', 'EMPTY_RECYCLE_BIN_RESULT', id, {}, 60000);
    }
    return Promise.resolve({ success: false });
  },

  /** Restore items from the Recycle Bin to their original location (the shell's own "undelete" verb). */
  restoreRecycleItems(paths: string[]): Promise<{ restored: number; failed: number }> {
    if (this.isNative) {
      const id = `${Date.now()}_restoreRecycleItems`;
      return _nativeCall<{ restored: number; failed: number }>('RESTORE_RECYCLE_ITEMS', 'RESTORE_RECYCLE_ITEMS_RESULT', id, { paths }, 60000);
    }
    return Promise.resolve({ restored: 0, failed: paths.length });
  },

  getDirContents(path: string): Promise<any[]> {
    if (this.isNative) {
      const norm = normalizePanePath(path);
      return dedupeInFlight(`dir:${norm}`, () =>
        _nativeCall<any[]>('GET_DIR_CONTENTS', 'DIR_CONTENTS_RESULT', '', { path: norm }, 60000),
      );
    }
    // Web backend route
    return fetch('/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.startsWith('C:\\') ? path.replace('C:\\', '/') : path })
    }).then(res => res.json()).then(data => data.items || []);
  },

  performGlobalSearch(
    query: string,
    limit: number,
    useRegex = false,
    rootPath = '',
    useEverything = true,
    searchContent = false,
    opts?: { booleanMode?: boolean; rootPaths?: string[]; preferBndzIndex?: boolean },
  ): Promise<{ items: any[]; engine?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_globalSearch`;
      return _nativeCall<{ items: any[]; engine?: string }>(
        'PERFORM_GLOBAL_SEARCH',
        'GLOBAL_SEARCH_RESULT',
        id,
        {
          query,
          limit,
          useRegex,
          rootPath,
          useEverything,
          searchContent,
          booleanMode: !!opts?.booleanMode,
          rootPaths: opts?.rootPaths,
          preferBndzIndex: opts?.preferBndzIndex !== false,
        },
        45000,
      )
        .then(payload => {
          if (Array.isArray(payload)) return { items: payload };
          return { items: payload?.items ?? [], engine: payload?.engine };
        });
    }
    return Promise.resolve({ items: [] });
  },

  openFolderDialog(description = 'Select a folder'): Promise<string> {
    if (this.isNative) {
      const id = `${Date.now()}_openFolder`;
      return _nativeCall<string>('OPEN_FOLDER_DIALOG', 'OPEN_FOLDER_DIALOG_RESULT', id, { description });
    }
    return Promise.resolve('');
  },

  scanIconFolder(folderPath: string, autoConvert = true): Promise<Array<{ name: string; icoStr: string }>> {
    if (this.isNative) {
      const id = `${Date.now()}_scanIcons`;
      return _nativeCall<Array<{ name: string; icoStr: string }>>('SCAN_ICON_FOLDER', 'SCAN_ICON_FOLDER_RESULT', id, { folderPath, autoConvert }, 120000);
    }
    return Promise.resolve([]);
  },

  getSubDirectories(path: string, showHidden: boolean = false): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_subDirs`;
      return _nativeCall<any[]>('GET_SUB_DIRECTORIES', 'SUBDIR_RESULT', id, { path, showHidden });
    }
    return Promise.resolve([]);
  },

  showNativeContextMenu(path: string, x: number, y: number) {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SHOW_CONTEXT_MENU', payload: { path, x, y } });
    }
  },

  getNativeShellIconBase64(path: string, isDirectory: boolean): Promise<string | null> {
    if (this.isNative) {
      return _nativeCall<string | null>('GET_SHELL_ICON', 'SHELL_ICON_RESULT', '', { path, isDirectory }, 45000);
    }
    return Promise.resolve(null);
  },

  getNativeShellIconsBatch(items: Array<{ path: string; isDirectory: boolean }>): Promise<Record<string, string | null>> {
    if (this.isNative) {
      return _nativeCall<Record<string, string | null>>(
        'GET_SHELL_ICONS_BATCH',
        'SHELL_ICONS_BATCH_RESULT',
        '',
        { items },
        90000,
      );
    }
    return Promise.resolve({});
  },

  getNativeThumbnailBase64(path: string): Promise<string | null> {
    if (this.isNative) {
      return import('./iconRequestQueue').then(({ enqueueIconRequest }) =>
        enqueueIconRequest(() =>
          _nativeCall<string | null>('GET_THUMBNAIL', 'THUMBNAIL_RESULT', `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_thumb`, { path }, 45000),
        ),
      );
    }
    return new Promise(resolve => setTimeout(() => resolve(null), 50));
  },

  openFileDialog(filter: string = 'Images (*.png;*.ico;*.jpg;*.jpeg)|*.png;*.ico;*.jpg;*.jpeg|All files (*.*)|*.*'): Promise<string[]> {
    if (this.isNative) {
      const id = `${Date.now()}_openFile`;
      return _nativeCall<string[]>('OPEN_FILE_DIALOG', 'OPEN_FILE_DIALOG_RESULT', id, { filter });
    }
    // Web fallback using simulated input
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = filter.includes('.png') ? '.png,.ico,.jpg,.jpeg' : '*';
      input.onchange = (e: any) => {
        const files = Array.from(e.target.files) as File[];
        // Simulated paths since actual paths aren't available in standard browser
        resolve(files.map(f => `C:\\VirtualPath\\${f.name}`));
      };
      input.click();
    });
  },

  clearIconCache(): Promise<void> {
    if (this.isNative) {
      const id = `${Date.now()}_clearIconCache`;
      return _nativeCall<void>('CLEAR_ICON_CACHE', 'CLEAR_ICON_CACHE_RESULT', id).catch(() => {});
    }
    return Promise.resolve();
  },

  convertToIco(imagePath: string): Promise<string | null> {
    if (this.isNative) {
      const id = `${Date.now()}_convertIco`;
      return _nativeCall<string | null>('CONVERT_TO_ICO', 'CONVERT_TO_ICO_RESULT', id, { path: imagePath }, 30000);
    }
    return Promise.resolve(null);
  },

  /** Download Iconify PNG and cache as .ico for folder/file apply + shell menus */
  materializeIconifyIcon(iconId: string): Promise<string | null> {
    if (this.isNative) {
      const id = `${Date.now()}_materializeIconify`;
      return _nativeCall<string | null>('MATERIALIZE_ICONIFY', 'MATERIALIZE_ICONIFY_RESULT', id, { iconId }, 60000);
    }
    return Promise.resolve(null);
  },

  _normalizeIconPath(p: string): string {
    if (!p) return p;
    let s = p.trim().replace(/\//g, '\\');
    if (s.startsWith('\\') && s.length > 2 && s[2] === ':') s = s.substring(1);
    return s;
  },

  setSystemIcon(targetPath: string, targetType: string, customIcoPath: string, allowGlobal = false): Promise<{ success: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_setIcon`;
      return _nativeCall<{ success: boolean; error?: string }>('SET_SYSTEM_ICON', 'SET_SYSTEM_ICON_RESULT', id, {
        targetPath: this._normalizeIconPath(targetPath),
        targetType,
        customIcoPath: this._normalizeIconPath(customIcoPath),
        allowGlobal,
      }, 90000).then(r => (typeof r === 'boolean' ? { success: r } : { success: !!r?.success, error: r?.error }));
    }
    return Promise.resolve({ success: true });
  },

  restoreSystemIcon(targetPath: string, targetType: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_restoreIcon`;
      return _nativeCall<boolean>('RESTORE_SYSTEM_ICON', 'RESTORE_SYSTEM_ICON_RESULT', id, {
        targetPath: this._normalizeIconPath(targetPath),
        targetType,
      }, 15000)
        .catch(err => {
          console.warn('[IPC] restoreSystemIcon:', err);
          return false;
        });
    }
    return Promise.resolve(true);
  },

  updateGlobalContextMenu(actions: any[]): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_updateCtxMenu`;
      return _nativeCall<boolean>('UPDATE_GLOBAL_CONTEXT_MENU', 'UPDATE_GLOBAL_CONTEXT_MENU_RESULT', id, { actions });
    }
    // Registry deploy only exists in the native host
    return Promise.resolve(false);
  },

  getExtendedMetadata(path: string): Promise<Record<string, string>> {
    if (this.isNative) {
      const id = `${Date.now()}_extMeta`;
      return _nativeCall<Record<string, string>>('GET_EXTENDED_METADATA', 'EXTENDED_METADATA_RESULT', id, { path });
    }
    return new Promise(resolve =>
      setTimeout(() => resolve({ 'Audio Bitrate': '320 kbps', 'Dimensions': '1920x1080' }), 50)
    );
  },

  getAsyncHashes(path: string): Promise<{md5?: string, sha256?: string}> {
    if (this.isNative) {
      const id = `${Date.now()}_hashes`;
      return _nativeCall<{md5?: string, sha256?: string}>('GET_ASYNC_HASHES', 'ASYNC_HASHES_RESULT', id, { path }, 60000);
    }
    return Promise.resolve({});
  },

  /** Read media file as base64 blob for preview fallback when local-stream fails */
  getMediaBlob(path: string, maxBytes = 48 * 1024 * 1024): Promise<{ base64?: string; mime?: string; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_mediaBlob`;
      return _nativeCall<{ base64?: string; mime?: string; error?: string }>(
        'GET_MEDIA_BLOB', 'GET_MEDIA_BLOB_RESULT', id, { path, maxBytes }, 120000
      );
    }
    return Promise.resolve({ error: 'Not native' });
  },

  getIconLibraries(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_getIconLibs`;
      return _nativeCall<any[]>('GET_ICON_LIBRARIES', 'ICON_LIBRARIES_RESULT', id).catch(() => []);
    }
    return Promise.resolve([]);
  },

  syncIconLibraries(libraries: any[]): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_syncIconLibs`;
      return _nativeCall<boolean>('SYNC_ICON_LIBRARIES', 'SYNC_ICON_LIBRARIES_RESULT', id, { libraries }, 30000);
    }
    return Promise.resolve(true);
  },

  getArchiveContents(path: string, limit = 5000): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_archiveContents`;
      return _nativeCall<any>('GET_ARCHIVE_CONTENTS', 'ARCHIVE_CONTENTS_RESULT', id, { path, limit }, 120000);
    }
    return Promise.resolve({ format: 'zip', entries: [], entryCount: 0, totalSize: 0 });
  },

  getTorrentInfo(path: string): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_torrentInfo`;
      return _nativeCall<any>('GET_TORRENT_INFO', 'TORRENT_INFO_RESULT', id, { path }, 30000);
    }
    return Promise.resolve({ name: 'Sample', files: [], totalSize: 0 });
  },

  createArchive(sources: string[], target: string, format: 'zip' | '7z' | 'tar' | 'gz' | 'rar' = 'zip'): void {
    if (this.isNative) {
      const operationId = `archive-${Date.now()}`;
      (window as any).chrome.webview.postMessage({
        type: 'CREATE_ARCHIVE',
        payload: { operationId, sources, target, format },
      });
    }
  },

  extractArchive(archivePath: string, destination: string): void {
    if (this.isNative) {
      const operationId = `extract-${Date.now()}`;
      (window as any).chrome.webview.postMessage({
        type: 'EXTRACT_ARCHIVE',
        payload: { operationId, path: archivePath, destination },
      });
    }
  },

  createLink(linkPath: string, targetPath: string, linkType: 'symlink' | 'hardlink' | 'junction' | 'shortcut'): Promise<{ success: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_createLink`;
      return _nativeCall<{ success: boolean; error?: string }>('CREATE_LINK', 'CREATE_LINK_RESULT', id, { linkPath, targetPath, linkType }, 15000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  refreshWorkspace(): Promise<void> {
    if (this.isNative) {
      const id = `${Date.now()}_refresh`;
      return _nativeCall<void>('REFRESH_WORKSPACE', 'REFRESH_WORKSPACE_RESULT', id).catch(() => {});
    }
    return Promise.resolve();
  },

  setFileAttributes(path: string, attributes: Record<string, boolean>): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_setAttrs`;
      return _nativeCall<boolean>('SET_FILE_ATTRIBUTES', 'SET_FILE_ATTRIBUTES_RESULT', id, { path, attributes });
    }
    return Promise.resolve(false);
  },

  async getTagsConfig(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_getTags`;
      return _nativeCall<any[]>('GET_TAGS_CONFIG', 'TAGS_CONFIG_RESULT', id).catch(() => []);
    }
    const defaultTags = [
      { name: 'red',       label: 'Red',       color: '#EF4444', icon: 'Circle'      },
      { name: 'orange',    label: 'Orange',     color: '#F97316', icon: 'Circle'      },
      { name: 'yellow',    label: 'Yellow',     color: '#EAB308', icon: 'Circle'      },
      { name: 'green',     label: 'Green',      color: '#22C55E', icon: 'Circle'      },
      { name: 'blue',      label: 'Blue',       color: '#3B82F6', icon: 'Circle'      },
      { name: 'purple',    label: 'Purple',     color: '#A855F7', icon: 'Circle'      },
      { name: 'gray',      label: 'Gray',       color: '#6B7280', icon: 'Circle'      },
      { name: 'work',      label: 'Work',       color: '#2563EB', icon: 'Briefcase'   },
      { name: 'personal',  label: 'Personal',   color: '#DB2777', icon: 'User'        },
      { name: 'important', label: 'Important',  color: '#DC2626', icon: 'AlertCircle' },
      { name: 'todo',      label: 'To-Do',      color: '#16A34A', icon: 'CheckSquare' },
    ];
    const stored = localStorage.getItem('bndz_tags_config');
    return stored ? JSON.parse(stored) : defaultTags;
  },

  async saveTagsConfig(tags: any[]): Promise<void> {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SAVE_TAGS_CONFIG', payload: { tags } });
    } else {
      localStorage.setItem('bndz_tags_config', JSON.stringify(tags));
    }
  },

  async applyTags(paths: string[], tags: string[]): Promise<void> {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'APPLY_TAGS', payload: { paths, tags } });
    } else {
      console.log('Applying tags', tags, 'to', paths);
    }
  },

  getTagSidecar(path: string): Promise<{ path: string; tags?: string[]; label?: string; comment?: string } | null> {
    if (this.isNative) {
      const id = `${Date.now()}_tagSidecar`;
      return _nativeCall<{ path: string; tags?: string[]; label?: string; comment?: string } | null>(
        'GET_TAG_SIDECAR', 'TAG_SIDECAR_RESULT', id, { path }, 10000,
      ).catch(() => null);
    }
    return Promise.resolve(null);
  },

  setTagMeta(path: string, label?: string, comment?: string, tags?: string[]): Promise<void> {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SET_TAG_META', payload: { path, label, comment, tags } });
    }
    return Promise.resolve();
  },

  /** Persist tag metadata for many paths in one backend round-trip. */
  setTagMetaBatchItems(items: TagMetaBatchItem[]): Promise<void> {
    if (!items.length) return Promise.resolve();
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'SET_TAG_META_BATCH', payload: { items } });
    }
    return Promise.resolve();
  },

  /** Add or remove a single tag key across many paths (fetches sidecars in parallel). */
  async setTagMetaBatch(paths: string[], tagKey: string, add: boolean): Promise<void> {
    if (!paths.length || !tagKey) return;
    const sidecars = await Promise.all(paths.map(p => this.getTagSidecar(p)));
    const items: TagMetaBatchItem[] = paths.map((path, i) => {
      const side = sidecars[i];
      const current: string[] = Array.isArray(side?.tags) ? [...side.tags] : [];
      const tags = add
        ? (entityHasTag(current, tagKey) ? current : [...current, tagKey])
        : current.filter(t => !entityHasTag([t], tagKey));
      return { path, label: side?.label, comment: side?.comment, tags };
    });
    return this.setTagMetaBatchItems(items);
  },

  listCatalogs(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_catalogList`;
      return _nativeCall<any[]>('CATALOG_LIST', 'CATALOG_LIST_RESULT', id, {}, 15000).then(r => r || []);
    }
    const raw = localStorage.getItem('bndz_catalog');
    return Promise.resolve(raw ? JSON.parse(raw) : []);
  },

  upsertCatalog(entry: { id?: string; name: string; paths?: string[]; query?: string | null }): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_catalogUpsert`;
      return _nativeCall<any>('CATALOG_UPSERT', 'CATALOG_UPSERT_RESULT', id, entry, 15000);
    }
    return this.listCatalogs().then(async list => {
      const now = Date.now();
      let saved: any;
      if (entry.id) {
        const idx = list.findIndex((c: any) => c.id === entry.id);
        saved = { ...list[idx], ...entry, updatedAt: now };
        if (idx >= 0) list[idx] = saved;
        else list.push(saved);
      } else {
        saved = { id: `local-${now}`, ...entry, paths: entry.paths || [], createdAt: now, updatedAt: now };
        list.push(saved);
      }
      localStorage.setItem('bndz_catalog', JSON.stringify(list));
      return saved;
    });
  },

  deleteCatalog(catalogId: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_catalogDelete`;
      return _nativeCall<{ ok?: boolean }>('CATALOG_DELETE', 'CATALOG_DELETE_RESULT', id, { id: catalogId }, 15000)
        .then(r => !!r?.ok);
    }
    return this.listCatalogs().then(list => {
      localStorage.setItem('bndz_catalog', JSON.stringify(list.filter((c: any) => c.id !== catalogId)));
      return true;
    });
  },

  getCatalogContents(path: string): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_catalogContents`;
      return _nativeCall<any[]>('CATALOG_CONTENTS', 'CATALOG_CONTENTS_RESULT', id, { path }, 30000).then(r => r || []);
    }
    return this.listCatalogs().then(catalogs => {
      const norm = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
      if (norm === '/vf' || norm === 'vf://') {
        return catalogs.map((c: any) => ({
          id: `catalog-${c.id}`,
          name: c.name,
          type: 'directory',
          path: `/vf/${c.id}`,
          size: 0,
          itemCount: (c.paths || []).length,
        }));
      }
      const slug = norm.startsWith('/vf/') ? norm.slice(4).split('/')[0] : norm.startsWith('vf://') ? norm.slice(5).split('/')[0] : '';
      const cat = catalogs.find((c: any) => c.id === slug || String(c.name).toLowerCase() === slug.toLowerCase());
      if (!cat) return [];
      return (cat.paths || []).map((p: string, i: number) => ({
        id: `vf-${cat.id}-${i}`,
        name: p.split(/[/\\]/).pop() || p,
        type: 'file',
        path: p.replace(/\\/g, '/'),
        size: 0,
      }));
    });
  },

  runUserScript(shell: string, script: string, cwd?: string): Promise<{ ok: boolean; output: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_runScript`;
      return _nativeCall<{ ok: boolean; output: string }>(
        'RUN_USER_SCRIPT', 'RUN_USER_SCRIPT_RESULT', id, { shell, script, cwd }, 120000,
      ).catch(err => ({ ok: false, output: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, output: 'Script runner requires native host' });
  },

  windowChrome(action: 'minimize' | 'maximize' | 'close' | 'drag'): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'WINDOW_CHROME', payload: { action } });
    }
  },

  setAlwaysOnTop(enabled: boolean): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'WINDOW_CHROME', payload: { action: 'alwaysOnTop', enabled } });
    }
  },

  getWindowState(): Promise<{ maximized?: boolean }> {
    if (this.isNative) {
      const id = `${Date.now()}_winState`;
      return _nativeCall<{ maximized?: boolean }>('GET_WINDOW_STATE', 'WINDOW_STATE_RESULT', id);
    }
    return Promise.resolve({ maximized: false });
  },

  readTextFile(path: string, maxBytes = 2 * 1024 * 1024): Promise<{ content?: string; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_readText`;
      return _nativeCall<{ content?: string; error?: string }>(
        'READ_TEXT_FILE', 'READ_TEXT_FILE_RESULT', id, { path, maxBytes }, 60000
      );
    }
    return Promise.resolve({ error: 'Not native' });
  },

  writeTextFile(path: string, content: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_writeText`;
      return _nativeCall<boolean>('WRITE_TEXT_FILE', 'WRITE_TEXT_FILE_RESULT', id, { path, content }, 60000);
    }
    return Promise.resolve(false);
  },

  getLicenseStatus(): Promise<LicenseStatus> {
    if (this.isNative) {
      const id = `${Date.now()}_licenseStatus`;
      return _nativeCall<LicenseStatus>(
        'GET_LICENSE_STATUS', 'LICENSE_STATUS_RESULT', id, undefined, 10000,
      ).then(s => ({ ...EMPTY_LICENSE_STATUS, ...s }))
        .catch(() => ({ ...EMPTY_LICENSE_STATUS }));
    }
    try {
      const licRaw = localStorage.getItem('bndz_license');
      if (licRaw) {
        const rec = JSON.parse(licRaw);
        if (rec.serial) {
          return Promise.resolve({
            ...EMPTY_LICENSE_STATUS,
            activated: true,
            canUseApp: true,
            trialExpired: false,
            email: rec.email,
            name: rec.name,
            serialMasked: `${String(rec.serial).slice(0, 9)}****`,
          });
        }
      }
      const trialStart = localStorage.getItem('bndz_trial_start');
      const firstRun = trialStart ? new Date(trialStart) : new Date();
      if (!trialStart) localStorage.setItem('bndz_trial_start', firstRun.toISOString());
      const endsAt = new Date(firstRun.getTime() + 14 * 86400000);
      const remaining = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86400000));
      const expired = Date.now() >= endsAt.getTime();
      return Promise.resolve({
        ...EMPTY_LICENSE_STATUS,
        activated: false,
        canUseApp: !expired,
        trialExpired: expired,
        trialDaysRemaining: remaining,
        trialEndsAt: endsAt.toISOString(),
      });
    } catch {
      return Promise.resolve({ ...EMPTY_LICENSE_STATUS });
    }
  },

  activateLicense(serial: string, email: string, name: string): Promise<{ success: boolean; message?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_activateLicense`;
      return _nativeCall<{ success: boolean; message?: string }>(
        'ACTIVATE_LICENSE', 'ACTIVATE_LICENSE_RESULT', id, { serial, email, name }, 15000,
      );
    }
    const ok = /^BNDZ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(serial.trim());
    if (!ok) return Promise.resolve({ success: false, message: 'Invalid serial format.' });
    localStorage.setItem('bndz_license', JSON.stringify({ serial: serial.trim().toUpperCase(), email, name }));
    return Promise.resolve({ success: true, message: 'Activated (preview mode).' });
  },

  deactivateLicense(): Promise<void> {
    if (this.isNative) {
      const id = `${Date.now()}_deactivateLicense`;
      return _nativeCall<void>('DEACTIVATE_LICENSE', 'DEACTIVATE_LICENSE_RESULT', id).catch(() => {});
    }
    localStorage.removeItem('bndz_license');
    return Promise.resolve();
  },

  openLegalDoc(doc: 'eula' | 'privacy' | 'third-party'): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_openLegal`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'OPEN_LEGAL_DOC', 'OPEN_LEGAL_DOC_RESULT', id, { doc }, 10000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, error: 'Legal documents are included with the installed app.' });
  },
};
