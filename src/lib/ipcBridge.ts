/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { nativeCall, dedupeInFlight, registerIpcPushHandler } from './ipcCore';
import { isValidOutboundDragPath, normalizePanePath, toWindowsPath } from './pathUtils';
import { EMPTY_LICENSE_STATUS, PENDING_LICENSE_STATUS, type LicenseStatus } from './licenseTypes';
import { entityHasTag } from './tagUtils';
import { formatPathsForClipboard } from './clipboardPathFormat';
import { hydrateShellGlyphMap } from './nativeIconService';
import { dispatchDirAppend } from './dirListingStream';

function clipboardPathConfigFromDom(): { copyPathsToTheClipboardWithATrailingSlash: boolean } {
  if (typeof document === 'undefined') return { copyPathsToTheClipboardWithATrailingSlash: false };
  return {
    copyPathsToTheClipboardWithATrailingSlash:
      document.documentElement.dataset.bndzcopypathstotheclipboardwithatrailingslash === 'true',
  };
}

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
  kind?: 'verb' | 'sendto' | 'open' | 'cloud-share' | 'copy-to-device';
  verb?: string;
  target?: string;
  group?: 'main' | 'sendto' | 'cloud' | 'device';
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

export type FileTransferJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface FileTransferJobDto {
  operationId: string;
  action: string;
  label: string;
  engine: 'bndz' | 'native' | string;
  category?: string;
  priority?: 'low' | 'normal' | 'high' | string;
  status: FileTransferJobStatus;
  progress: number;
  currentFile?: string;
  error?: string;
  queuedUtc?: string;
  startedUtc?: string;
  completedUtc?: string;
  itemsTotal?: number;
  itemsCompleted?: number;
  bytesTransferred?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number | null;
  destinationPath?: string;
  verifyMode?: 'none' | 'size' | 'sha256' | string;
  verifyStatus?: 'pending' | 'verified' | 'skipped' | 'failed' | string;
}

export interface FileTransferQueueState {
  queuedCount: number;
  activeCount: number;
  jobs: FileTransferJobDto[];
}

export interface ConflictPayload {
  operationId: string;
  fileName: string;
  sourcePath?: string;
  destPath?: string;
  /** File size in bytes; 0 if not available */
  sourceSize?: number;
  /** Unix timestamp (seconds) of source file's last-write UTC */
  sourceModifiedUtc?: number;
  destSize?: number;
  destModifiedUtc?: number;
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
            const { toVirtualStreamUrl } = await import('./pathUtils');
            const virtualUrl = toVirtualStreamUrl(path);
            const response = await window.fetch(virtualUrl);
            if (response.ok) return await response.text();
        } else {
            return Promise.reject(new Error('Native host required'));
        }
        return "";
    } catch (err) {
        if (err instanceof Error && err.message === 'Native host required') throw err;
        return '';
    }
  },

  _listeners: [] as Array<(events: any[]) => void>,
  _initialized: false as boolean,
  _hostReady: false as boolean,
  _hostReadyPromise: null as Promise<boolean> | null,
  _progressListeners: [] as Array<(progress: any) => void>,
  _conflictListeners: [] as Array<(conflict: any) => void>,
  _elevationListeners: [] as Array<(payload: { title?: string; message: string; context?: string }) => void>,
  _drivesListeners: [] as Array<(drives: any[]) => void>,
  _folderSizeListeners: [] as Array<(progress: any) => void>,
  _duplicateProgressListeners: [] as Array<(progress: any) => void>,
  _storageCleanupProgressListeners: [] as Array<(progress: { percent: number; phase: string; currentPath: string }) => void>,
  _folderSyncProgressListeners: [] as Array<(progress: any) => void>,
  _meshSyncProgressListeners: [] as Array<(progress: any) => void>,
  _meshTerminalOutputListeners: [] as Array<(payload: { sessionId: string; data: string }) => void>,
  _meshHostsChangedListeners: [] as Array<(hosts: any[]) => void>,
  _closeRequestListeners: [] as Array<(payload?: { source?: string }) => void>,
  _openPathListeners: [] as Array<(path: string) => void>,
  _pendingOpenPaths: [] as string[],
  _actionLogListeners: [] as Array<(state: { canUndo: boolean; canRedo: boolean; lastActionUtc?: string }) => void>,
  _fileTransferQueueListeners: [] as Array<(state: FileTransferQueueState) => void>,
  _startupActionListeners: [] as Array<(action: string) => void>,
  _aiDownloadProgressListeners: [] as Array<(progress: { percent: number }) => void>,
  _indexProgressListeners: [] as Array<(progress: { currentPath: string; filesIndexed: number; done: boolean; root?: string; error?: string }) => void>,
  _aiStreamChunkListeners: new Map<string, (chunk: string) => void>(),
  _aiStreamDoneListeners: new Map<string, () => void>(),
  _aiStreamErrorListeners: new Map<string, (error: string) => void>(),

  init() {
    if (this.isNative && !this._initialized) {
      registerIpcPushHandler((data) => {
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
          const drives = Array.isArray(data.payload) ? data.payload : [];
          this._drivesListeners.forEach(cb => cb(drives));
        } else if (data.type === 'EXTERNAL_FILES_DROPPED') {
          window.dispatchEvent(new CustomEvent('bndz-external-drop', { detail: data.payload }));
        } else if (data.type === 'EXTERNAL_FILES_DROP_FAILED') {
          window.dispatchEvent(new CustomEvent('bndz-external-drop-failed', { detail: data.payload }));
        } else if (data.type === 'OLE_DRAG_ESCALATED') {
          window.dispatchEvent(new CustomEvent('bndz-ole-drag-escalated', { detail: data.payload }));
        } else if (data.type === 'OLE_DRAG_ENDED') {
          window.dispatchEvent(new CustomEvent('bndz-ole-drag-ended', { detail: data.payload }));
        } else if (data.type === 'EXTERNAL_FILES_DRAG_HOVER') {
          window.dispatchEvent(new CustomEvent('bndz-external-drag-hover', { detail: data.payload }));
        } else if (data.type === 'FOLDER_SIZE_PROGRESS') {
          this._folderSizeListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'DUPLICATE_SCAN_PROGRESS') {
          this._duplicateProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'STORAGE_CLEANUP_SCAN_PROGRESS') {
          this._storageCleanupProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'FOLDER_SYNC_PROGRESS') {
          this._folderSyncProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'MESH_SYNC_PROGRESS') {
          this._meshSyncProgressListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'MESH_TERMINAL_OUTPUT') {
          this._meshTerminalOutputListeners.forEach(cb => cb(data.payload));
        } else if (data.type === 'MESH_HOSTS_CHANGED') {
          const hosts = Array.isArray(data.payload) ? data.payload : [];
          this._meshHostsChangedListeners.forEach(cb => cb(hosts));
          window.dispatchEvent(new CustomEvent('bndz-mesh-hosts-changed', { detail: { hosts } }));
        } else if (data.type === 'MESH_DROP_SESSION_CHANGED') {
          window.dispatchEvent(new CustomEvent('bndz-mesh-drop-session', { detail: data.payload }));
        } else if (data.type === 'GHOST_LINK_PROGRESS') {
          window.dispatchEvent(new CustomEvent('bndz-ghost-link-progress', { detail: data.payload }));
        } else if (data.type === 'RAM_STAGING_ZONE_CHANGED') {
          window.dispatchEvent(new CustomEvent('bndz-ram-zone-changed', { detail: data.payload }));
        } else if (data.type === 'RAM_STAGING_MEMORY_PRESSURE') {
          window.dispatchEvent(new CustomEvent('bndz-ram-memory-pressure', { detail: data.payload }));
        } else if (data.type === 'GLOBAL_HOTKEY') {
          const id = data.payload?.id ?? '';
          window.dispatchEvent(new CustomEvent('bndz-global-hotkey', { detail: { id } }));
        } else if (data.type === 'BNDZ_QUICK_LOOK_OPEN') {
          const paths = Array.isArray(data.payload?.paths) ? data.payload.paths.filter((p: unknown) => typeof p === 'string' && p) : [];
          const items = Array.isArray(data.payload?.items) ? data.payload.items : null;
          window.dispatchEvent(new CustomEvent('bndz-quick-look-open', { detail: { paths, items } }));
        } else if (data.type === 'BNDZ_QUICK_LOOK_CLOSE') {
          window.dispatchEvent(new CustomEvent('bndz-quick-look-close'));
        } else if (data.type === 'CLOSE_REQUEST') {
          const source = data.payload?.source;
          this._closeRequestListeners.forEach(cb => cb({ source }));
        } else if (data.type === 'BNDZ_OPEN_PATH') {
          const path = data.payload?.path ?? '';
          if (path) this._dispatchOpenPath(path);
        } else if (data.type === 'ACTION_LOG_CHANGED') {
          const payload = data.payload ?? {};
          this._actionLogListeners.forEach(cb => cb({
            canUndo: !!payload.canUndo,
            canRedo: !!payload.canRedo,
            lastActionUtc: payload.lastActionUtc,
          }));
        } else if (data.type === 'FILE_TRANSFER_QUEUE_CHANGED') {
          const payload = data.payload ?? {};
          const state: FileTransferQueueState = {
            queuedCount: payload.queuedCount ?? 0,
            activeCount: payload.activeCount ?? 0,
            jobs: Array.isArray(payload.jobs) ? payload.jobs : [],
          };
          this._fileTransferQueueListeners.forEach(cb => cb(state));
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

  onConflictContent(callback: (conflict: ConflictPayload) => void) {
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

  onStorageCleanupScanProgress(callback: (progress: { percent: number; phase: string; currentPath: string }) => void) {
    this.init();
    this._storageCleanupProgressListeners.push(callback);
    return () => {
      this._storageCleanupProgressListeners = this._storageCleanupProgressListeners.filter(cb => cb !== callback);
    };
  },

  onFolderSyncProgress(callback: (progress: { jobId: string; status: string; percent: number; currentFile?: string; message?: string }) => void) {
    this.init();
    this._folderSyncProgressListeners.push(callback);
    return () => {
      this._folderSyncProgressListeners = this._folderSyncProgressListeners.filter(cb => cb !== callback);
    };
  },

  onMeshSyncProgress(callback: (progress: { ruleId: string; status: string; percent: number; currentFile?: string; message?: string }) => void) {
    this.init();
    this._meshSyncProgressListeners.push(callback);
    return () => {
      this._meshSyncProgressListeners = this._meshSyncProgressListeners.filter(cb => cb !== callback);
    };
  },

  onMeshTerminalOutput(callback: (payload: { sessionId: string; data: string }) => void) {
    this.init();
    this._meshTerminalOutputListeners.push(callback);
    return () => {
      this._meshTerminalOutputListeners = this._meshTerminalOutputListeners.filter(cb => cb !== callback);
    };
  },

  onMeshHostsChanged(callback: (hosts: any[]) => void) {
    this.init();
    this._meshHostsChangedListeners.push(callback);
    return () => {
      this._meshHostsChangedListeners = this._meshHostsChangedListeners.filter(cb => cb !== callback);
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
    if (this._pendingOpenPaths.length) {
      const pending = [...this._pendingOpenPaths];
      this._pendingOpenPaths = [];
      for (const p of pending) callback(p);
    }
    return () => {
      this._openPathListeners = this._openPathListeners.filter(cb => cb !== callback);
    };
  },

  _dispatchOpenPath(path: string) {
    if (!path) return;
    if (!this._openPathListeners.length) {
      this._pendingOpenPaths.push(path);
      return;
    }
    this._openPathListeners.forEach(cb => cb(path));
  },

  notifyUiReady() {
    if (!this.isNative) return;
    let bundle = 'unknown';
    try {
      const scriptEl = document.querySelector('script[type="module"][src*="index-"]') as HTMLScriptElement | null;
      const src = scriptEl?.src ?? '';
      const tail = src.split('/').pop() ?? '';
      const m = tail.match(/index-([A-Za-z0-9_-]+)\.js/i);
      if (m) bundle = m[1];
    } catch { /* ignore */ }
    (window as any).chrome.webview.postMessage({
      type: 'BNDZ_UI_READY',
      payload: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        bundle,
      },
    });
  },

  requestClose(source: 'x' | 'menu' | 'tray' | 'exit-without-saving' | 'restart-without-saving' | 'restart' = 'x'): void {
    if (this.isNative) {
      if (source === 'x') {
        this.windowChrome('close');
        return;
      }
      if (source === 'restart' || source === 'restart-without-saving') {
        (window as any).chrome.webview.postMessage({ type: 'RESTART_APP', payload: { save: source === 'restart' } });
        return;
      }
      if (source === 'exit-without-saving') {
        (window as any).chrome.webview.postMessage({ type: 'REQUEST_CLOSE', payload: { source: 'exit-without-saving' } });
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

  meshListHosts(): Promise<any[]> {
    if (!this.isNative) return Promise.resolve([]);
    const id = `${Date.now()}_meshHosts`;
    return _nativeCall<any>('MESH_LIST_HOSTS', 'MESH_LIST_HOSTS_RESULT', id, {}, 15000).then(r => {
      if (Array.isArray(r)) return r;
      if (r && Array.isArray(r.hosts)) return r.hosts;
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return [];
    });
  },

  meshImportSshConfig(): Promise<{ imported: number; hosts: any[] }> {
    if (!this.isNative) return Promise.resolve({ imported: 0, hosts: [] });
    const id = `${Date.now()}_meshImport`;
    return _nativeCall<any>('MESH_IMPORT_SSH_CONFIG', 'MESH_IMPORT_SSH_CONFIG_RESULT', id, {}, 30000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return r || { imported: 0, hosts: [] };
    });
  },

  meshUpsertHost(host: Record<string, unknown>): Promise<any> {
    if (!this.isNative) return Promise.resolve(host);
    const id = `${Date.now()}_meshUpsert`;
    return _nativeCall<any>('MESH_UPSERT_HOST', 'MESH_UPSERT_HOST_RESULT', id, host, 30000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return r;
    });
  },

  meshDeleteHost(hostId: string): Promise<void> {
    if (!this.isNative) return Promise.resolve();
    const id = `${Date.now()}_meshDel`;
    return _nativeCall<any>('MESH_DELETE_HOST', 'MESH_DELETE_HOST_RESULT', id, { hostId }, 15000).then(() => {});
  },

  meshConnect(hostId: string): Promise<any> {
    if (!this.isNative) return Promise.resolve({ error: 'Native host required' });
    const id = `${Date.now()}_meshConn`;
    return _nativeCall<any>('MESH_CONNECT', 'MESH_CONNECT_RESULT', id, { hostId }, 60000);
  },

  meshDisconnect(hostId: string): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({ type: 'MESH_DISCONNECT', payload: { hostId } });
  },

  meshGetSyncRules(): Promise<any[]> {
    if (!this.isNative) return Promise.resolve([]);
    const id = `${Date.now()}_meshRules`;
    return _nativeCall<any[]>('MESH_SYNC_GET_RULES', 'MESH_SYNC_GET_RULES_RESULT', id, {}, 15000).then(r => r || []);
  },

  meshSaveSyncRules(rules: any[]): Promise<void> {
    if (!this.isNative) return Promise.resolve();
    const id = `${Date.now()}_meshSaveRules`;
    return _nativeCall<any>('MESH_SYNC_SAVE_RULES', 'MESH_SYNC_SAVE_RULES_RESULT', id, rules, 15000).then(() => {});
  },

  meshRunSync(ruleId: string): Promise<any> {
    if (!this.isNative) return Promise.resolve({ error: 'Native host required' });
    const id = `${Date.now()}_meshRun`;
    return _nativeCall<any>('MESH_SYNC_RUN', 'MESH_SYNC_RUN_RESULT', id, { ruleId }, 600000);
  },

  meshTerminalOpen(opts: { hostId?: string; cwd?: string; local?: boolean }): Promise<any> {
    if (!this.isNative) return Promise.resolve({ error: 'Native host required' });
    const id = `${Date.now()}_meshTerm`;
    return _nativeCall<any>('MESH_TERMINAL_OPEN', 'MESH_TERMINAL_OPEN_RESULT', id, opts, 60000);
  },

  meshTerminalInput(sessionId: string, data: string): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({ type: 'MESH_TERMINAL_INPUT', payload: { sessionId, data } });
  },

  meshTerminalClose(sessionId: string): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({ type: 'MESH_TERMINAL_CLOSE', payload: { sessionId } });
  },

  meshTerminalResize(sessionId: string, cols: number, rows: number): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({
      type: 'MESH_TERMINAL_RESIZE',
      payload: { sessionId, cols, rows },
    });
  },

  meshStat(path: string): Promise<any> {
    if (!this.isNative) return Promise.resolve({ error: 'Native host required' });
    const id = `${Date.now()}_meshStat`;
    return _nativeCall<any>('MESH_STAT', 'MESH_STAT_RESULT', id, { path }, 30000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return r;
    });
  },

  meshWrite(opts: {
    path: string;
    localFile?: string;
    contentBase64?: string;
    expectedRemoteMtime?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshWrite`;
    return _nativeCall<any>('MESH_WRITE', 'MESH_WRITE_RESULT', id, opts, 120000).then(r => ({
      ok: r?.ok !== false && !r?.error,
      error: r?.error,
    }));
  },

  meshTransfer(payload: {
    operationId: string;
    direction: 'upload' | 'download' | 'replicate' | 'relay';
    hostId?: string;
    srcHostId?: string;
    destHostId?: string;
    localPaths?: string[];
    meshPaths?: string[];
    localDestDir?: string;
    remoteDestDir?: string;
    move?: boolean;
  }): Promise<{ ok: boolean; error?: string; operationId?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshXfer`;
    return _nativeCall<any>('MESH_TRANSFER', 'MESH_TRANSFER_RESULT', id, payload, 3600000).then(r => {
      if (r?.error) return { ok: false, error: String(r.error), operationId: r.operationId };
      return { ok: r?.ok !== false, operationId: r?.operationId ?? payload.operationId };
    });
  },

  meshHydratePaths(paths: string[]): Promise<{ paths: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ paths: [] });
    const id = `${Date.now()}_meshHydrate`;
    return _nativeCall<any>('MESH_HYDRATE_PATHS', 'MESH_HYDRATE_PATHS_RESULT', id, { paths }, 600000).then(r => {
      if (r?.error) return { paths: [], error: String(r.error) };
      return { paths: Array.isArray(r?.paths) ? r.paths : [] };
    });
  },

  meshDropSetConfig(opts: {
    stunServers?: string;
    lanDiscovery?: boolean;
    turnUrl?: string;
    turnUsername?: string;
    turnCredential?: string;
  }): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({ type: 'MESH_DROP_SET_CONFIG', payload: opts });
  },

  meshDropCreateOffer(paths: string[], label?: string): Promise<{ ok: boolean; sessionId?: string; meshCode?: string; session?: unknown; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropOffer`;
    return _nativeCall<any>('MESH_DROP_CREATE_OFFER', 'MESH_DROP_CREATE_OFFER_RESULT', id, { paths, label }, 120000).then(r => ({
      ok: r?.ok !== false,
      sessionId: r?.sessionId,
      meshCode: r?.meshCode,
      session: r?.session,
      error: r?.error,
    }));
  },

  meshDropAcceptOffer(meshCode: string, destDir: string): Promise<{ ok: boolean; sessionId?: string; answerCode?: string; session?: unknown; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropAccept`;
    return _nativeCall<any>('MESH_DROP_ACCEPT_OFFER', 'MESH_DROP_ACCEPT_OFFER_RESULT', id, { meshCode, destDir }, 120000).then(r => ({
      ok: r?.ok !== false,
      sessionId: r?.sessionId,
      answerCode: r?.answerCode,
      session: r?.session,
      error: r?.error,
    }));
  },

  meshDropConnect(sessionId: string, answerCode: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropConnect`;
    return _nativeCall<any>('MESH_DROP_CONNECT', 'MESH_DROP_CONNECT_RESULT', id, { sessionId, answerCode }, 60000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  meshDropSend(sessionId: string, operationId?: string): Promise<{ ok: boolean; operationId?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropSend`;
    const opId = operationId ?? `${Date.now()}_mdop`;
    return _nativeCall<any>('MESH_DROP_SEND', 'MESH_DROP_SEND_RESULT', id, { sessionId, operationId: opId }, 3600000).then(r => ({
      ok: r?.ok !== false,
      operationId: r?.operationId ?? opId,
      error: r?.error,
    }));
  },

  meshDropCancel(sessionId: string): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({ type: 'MESH_DROP_CANCEL', payload: { sessionId } });
  },

  meshDropListSessions(): Promise<{ sessions: unknown[] }> {
    if (!this.isNative) return Promise.resolve({ sessions: [] });
    const id = `${Date.now()}_meshDropList`;
    return _nativeCall<any>('MESH_DROP_LIST_SESSIONS', 'MESH_DROP_LIST_SESSIONS_RESULT', id, {}, 15000).then(r => ({
      sessions: Array.isArray(r?.sessions) ? r.sessions : [],
    }));
  },

  meshDropDiscoverLan(): Promise<{ peers: unknown[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ peers: [] });
    const id = `${Date.now()}_meshDropLan`;
    return _nativeCall<any>('MESH_DROP_DISCOVER_LAN', 'MESH_DROP_DISCOVER_LAN_RESULT', id, {}, 10000).then(r => ({
      peers: Array.isArray(r?.peers) ? r.peers : [],
      error: r?.error,
    }));
  },

  meshDropFetchLanOffer(address: string, port: number): Promise<{ ok: boolean; meshCode?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropLanOffer`;
    return _nativeCall<any>('MESH_DROP_FETCH_LAN_OFFER', 'MESH_DROP_FETCH_LAN_OFFER_RESULT', id, { address, port }, 15000).then(r => ({
      ok: r?.ok === true,
      meshCode: r?.meshCode,
      error: r?.error,
    }));
  },

  meshDropRelayCreate(relayUrl: string, meshCode: string, label?: string): Promise<{ ok: boolean; room?: { roomId: string; joinUrl: string; pollUrl: string }; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_meshDropRelay`;
    return _nativeCall<any>('MESH_DROP_RELAY_CREATE', 'MESH_DROP_RELAY_CREATE_RESULT', id, { relayUrl, meshCode, label }, 30000).then(r => ({
      ok: r?.ok === true,
      room: r?.room,
      error: r?.error,
    }));
  },

  meshDropRelayPoll(pollUrl: string): Promise<{ ok: boolean; answer?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_meshDropRelayPoll`;
    return _nativeCall<any>('MESH_DROP_RELAY_POLL', 'MESH_DROP_RELAY_POLL_RESULT', id, { pollUrl }, 15000).then(r => ({
      ok: r?.ok === true,
      answer: r?.answer,
      error: r?.error,
    }));
  },

  meshDropRelaySubmitAnswer(relayUrl: string, roomId: string, answerCode: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_meshDropRelayAns`;
    return _nativeCall<any>('MESH_DROP_RELAY_SUBMIT_ANSWER', 'MESH_DROP_RELAY_SUBMIT_ANSWER_RESULT', id, { relayUrl, roomId, answerCode }, 15000).then(r => ({
      ok: r?.ok === true,
      error: r?.error,
    }));
  },

  meshDropRelayResolveOffer(relayUrl: string, roomId: string): Promise<{ ok: boolean; meshCode?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_meshDropRelayRes`;
    return _nativeCall<any>('MESH_DROP_RELAY_RESOLVE_OFFER', 'MESH_DROP_RELAY_RESOLVE_OFFER_RESULT', id, { relayUrl, roomId }, 15000).then(r => ({
      ok: r?.ok === true,
      meshCode: r?.meshCode,
      error: r?.error,
    }));
  },

  meshIncusListEndpoints(): Promise<any[]> {
    if (!this.isNative) return Promise.resolve([]);
    const id = `${Date.now()}_incusEndpoints`;
    return _nativeCall<any>('MESH_INCUS_LIST_ENDPOINTS', 'MESH_INCUS_LIST_ENDPOINTS_RESULT', id, {}, 15000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return Array.isArray(r?.endpoints) ? r.endpoints : [];
    });
  },

  meshIncusUpsertEndpoint(endpoint: Record<string, unknown>): Promise<any> {
    if (!this.isNative) return Promise.resolve(endpoint);
    const id = `${Date.now()}_incusUpsert`;
    return _nativeCall<any>('MESH_INCUS_UPSERT_ENDPOINT', 'MESH_INCUS_UPSERT_ENDPOINT_RESULT', id, endpoint, 30000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return r;
    });
  },

  meshIncusDeleteEndpoint(endpointId: string): Promise<void> {
    if (!this.isNative) return Promise.resolve();
    const id = `${Date.now()}_incusDelEp`;
    return _nativeCall<any>('MESH_INCUS_DELETE_ENDPOINT', 'MESH_INCUS_DELETE_ENDPOINT_RESULT', id, { endpointId }, 60000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
    });
  },

  meshIncusTestEndpoint(endpointId: string): Promise<{ ok: boolean; info?: any; endpoints?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_incusTest`;
    return _nativeCall<any>('MESH_INCUS_TEST_ENDPOINT', 'MESH_INCUS_TEST_ENDPOINT_RESULT', id, { endpointId }, 60000).then(r => ({
      ok: r?.ok === true,
      info: r?.info,
      endpoints: Array.isArray(r?.endpoints) ? r.endpoints : undefined,
      error: r?.error,
    }));
  },

  meshIncusListEphemeral(): Promise<any[]> {
    if (!this.isNative) return Promise.resolve([]);
    const id = `${Date.now()}_incusEph`;
    return _nativeCall<any>('MESH_INCUS_LIST_EPHEMERAL', 'MESH_INCUS_LIST_EPHEMERAL_RESULT', id, {}, 15000).then(r => {
      if (r?.error) return Promise.reject(new Error(String(r.error)));
      return Array.isArray(r?.instances) ? r.instances : [];
    });
  },

  meshIncusLaunch(req: Record<string, unknown>): Promise<{ ok: boolean; instance?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_incusLaunch`;
    return _nativeCall<any>('MESH_INCUS_LAUNCH', 'MESH_INCUS_LAUNCH_RESULT', id, req, 600000).then(r => ({
      ok: r?.ok === true,
      instance: r?.instance,
      error: r?.error,
    }));
  },

  meshIncusRefresh(ephemeralId: string): Promise<{ ok: boolean; instance?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_incusRefresh`;
    return _nativeCall<any>('MESH_INCUS_REFRESH', 'MESH_INCUS_REFRESH_RESULT', id, { ephemeralId }, 120000).then(r => ({
      ok: r?.ok === true,
      instance: r?.instance,
      error: r?.error,
    }));
  },

  meshIncusDestroy(ephemeralId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_incusDestroy`;
    return _nativeCall<any>('MESH_INCUS_DESTROY', 'MESH_INCUS_DESTROY_RESULT', id, { ephemeralId }, 300000).then(r => ({
      ok: r?.ok === true,
      error: r?.error,
    }));
  },

  meshIncusListImages(endpointId: string): Promise<{ ok: boolean; aliases: Array<{ name: string; description?: string; type?: string }>; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, aliases: [], error: 'Native host required' });
    const id = `${Date.now()}_incusImages`;
    return _nativeCall<any>('MESH_INCUS_LIST_IMAGES', 'MESH_INCUS_LIST_IMAGES_RESULT', id, { endpointId }, 60000).then(r => ({
      ok: r?.ok === true,
      aliases: Array.isArray(r?.aliases) ? r.aliases : [],
      error: r?.error,
    }));
  },

  ghostLinkGetRules(): Promise<{ rules: unknown[] }> {
    if (!this.isNative) return Promise.resolve({ rules: [] });
    const id = `${Date.now()}_ghostRules`;
    return _nativeCall<any>('GHOST_LINK_GET_RULES', 'GHOST_LINK_GET_RULES_RESULT', id, {}, 15000).then(r => ({
      rules: Array.isArray(r?.rules) ? r.rules : [],
    }));
  },

  ghostLinkSaveRules(rules: unknown[]): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_ghostSave`;
    return _nativeCall<any>('GHOST_LINK_SAVE_RULES', 'GHOST_LINK_SAVE_RULES_RESULT', id, rules, 15000).then(() => ({ ok: true }));
  },

  ghostLinkRunScan(ruleId?: string): Promise<{ ok: boolean; count?: number; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ghostScan`;
    return _nativeCall<any>('GHOST_LINK_RUN_SCAN', 'GHOST_LINK_RUN_SCAN_RESULT', id, { ruleId }, 3600000).then(r => ({
      ok: r?.ok !== false,
      count: r?.count,
      error: r?.error,
    }));
  },

  ghostLinkOffloadPaths(paths: string[], coldStorageRoot: string): Promise<{ ok: boolean; reclaimed?: number; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ghostOffload`;
    return _nativeCall<any>('GHOST_LINK_OFFLOAD_PATHS', 'GHOST_LINK_OFFLOAD_PATHS_RESULT', id, { paths, coldStorageRoot }, 3600000).then(r => ({
      ok: r?.ok !== false,
      reclaimed: r?.reclaimed,
      error: r?.error,
    }));
  },

  ghostLinkRestore(path: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ghostRestore`;
    return _nativeCall<any>('GHOST_LINK_RESTORE', 'GHOST_LINK_RESTORE_RESULT', id, { path }, 120000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ghostLinkGetStats(): Promise<{ stats: unknown; ghosts: unknown[] }> {
    if (!this.isNative) return Promise.resolve({ stats: {}, ghosts: [] });
    const id = `${Date.now()}_ghostStats`;
    return _nativeCall<any>('GHOST_LINK_GET_STATS', 'GHOST_LINK_GET_STATS_RESULT', id, {}, 15000).then(r => ({
      stats: r?.stats ?? {},
      ghosts: Array.isArray(r?.ghosts) ? r.ghosts : [],
    }));
  },

  ramStagingListZones(): Promise<{ zones: unknown[]; status: unknown }> {
    if (!this.isNative) return Promise.resolve({ zones: [], status: {} });
    const id = `${Date.now()}_ramList`;
    return _nativeCall<any>('RAM_STAGING_LIST_ZONES', 'RAM_STAGING_LIST_ZONES_RESULT', id, {}, 15000)
      .then(r => ({
        zones: Array.isArray(r?.zones) ? r.zones : [],
        status: r?.status ?? {},
      }))
      .catch(() => ({ zones: [], status: {} }));
  },

  ramStagingCreateZone(name: string, sizeBudgetMb: number, preferRam = true): Promise<{ ok: boolean; zone?: unknown; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramCreate`;
    return _nativeCall<any>('RAM_STAGING_CREATE_ZONE', 'RAM_STAGING_CREATE_ZONE_RESULT', id, { name, sizeBudgetMb, preferRam }, 120000).then(r => ({
      ok: r?.ok !== false,
      zone: r?.zone,
      error: r?.error,
    }));
  },

  ramStagingDeleteZone(zoneId: string, flushFirst = true): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramDelete`;
    return _nativeCall<any>('RAM_STAGING_DELETE_ZONE', 'RAM_STAGING_DELETE_ZONE_RESULT', id, { zoneId, flushFirst }, 3600000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ramStagingStagePaths(zoneId: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramStage`;
    return _nativeCall<any>('RAM_STAGING_STAGE_PATHS', 'RAM_STAGING_STAGE_PATHS_RESULT', id, { zoneId, paths }, 3600000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ramStagingFlushZone(zoneId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramFlush`;
    return _nativeCall<any>('RAM_STAGING_FLUSH_ZONE', 'RAM_STAGING_FLUSH_ZONE_RESULT', id, { zoneId }, 3600000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ramStagingInstallImDisk(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramImdisk`;
    return _nativeCall<any>('RAM_STAGING_INSTALL_IMDISK', 'RAM_STAGING_INSTALL_IMDISK_RESULT', id, {}, 600000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ramStagingInstallAim(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramAim`;
    return _nativeCall<any>('RAM_STAGING_INSTALL_AIM', 'RAM_STAGING_INSTALL_AIM_RESULT', id, {}, 600000).then(r => ({
      ok: r?.ok !== false,
      error: r?.error,
    }));
  },

  ramStagingRemountZone(zoneId: string): Promise<{ ok: boolean; zone?: unknown; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_ramRemount`;
    return _nativeCall<any>('RAM_STAGING_REMOUNT_ZONE', 'RAM_STAGING_REMOUNT_ZONE_RESULT', id, { zoneId }, 120000).then(r => ({
      ok: r?.ok !== false,
      zone: r?.zone,
      error: r?.error,
    }));
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
    return Promise.resolve({ groups: [], error: 'Native host required' });
  },

  cancelDuplicateScan(): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'CANCEL_DUPLICATE_SCAN' });
    }
  },

  scanStorageCleanup(options?: {
    categoryIds?: string[];
    largeFileMinBytes?: number;
    largeFileLimit?: number;
  }): Promise<{
    categories: Array<{
      id: string;
      name: string;
      description: string;
      risk: 'safe' | 'moderate' | 'advanced';
      totalBytes: number;
      itemCount: number;
      items: Array<{
        id: string;
        path: string;
        name: string;
        size: number;
        isDirectory: boolean;
        detail?: string;
        defaultSelected: boolean;
      }>;
    }>;
    totalBytes?: number;
    cancelled?: boolean;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_cleanup`;
      return _nativeCall<any>('STORAGE_CLEANUP_SCAN', 'STORAGE_CLEANUP_SCAN_RESULT', id, {
        categoryIds: options?.categoryIds,
        largeFileMinBytes: options?.largeFileMinBytes,
        largeFileLimit: options?.largeFileLimit,
      }, 900000).then(r => ({
        categories: r?.categories ?? r?.Categories ?? [],
        totalBytes: r?.totalBytes ?? r?.TotalBytes,
        cancelled: r?.cancelled ?? r?.Cancelled,
        error: r?.error,
      }));
    }
    return Promise.resolve({ categories: [], error: 'Native only' });
  },

  cancelStorageCleanupScan(): void {
    if (this.isNative) {
      (window as any).chrome.webview.postMessage({ type: 'CANCEL_STORAGE_CLEANUP_SCAN' });
    }
  },

  executeStorageCleanup(items: Array<{ categoryId: string; path: string; isDirectory: boolean; size: number }>): Promise<{
    processedCount: number;
    freedBytes: number;
    errors: string[];
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_cleanexec`;
      return _nativeCall<any>('STORAGE_CLEANUP_EXECUTE', 'STORAGE_CLEANUP_EXECUTE_RESULT', id, { items }, 600000).then(r => ({
        processedCount: r?.processedCount ?? r?.ProcessedCount ?? 0,
        freedBytes: r?.freedBytes ?? r?.FreedBytes ?? 0,
        errors: r?.errors ?? r?.Errors ?? [],
      }));
    }
    return Promise.resolve({ processedCount: 0, freedBytes: 0, errors: ['Native only'] });
  },

  listInstalledApps(includeSystemComponents = false): Promise<{
    apps: Array<{
      id: string;
      name: string;
      publisher?: string;
      version?: string;
      installDate?: string;
      estimatedSizeBytes: number;
      installLocation?: string;
      canUninstall: boolean;
      isSystemComponent: boolean;
      isStoreApp: boolean;
      source: string;
    }>;
    totalCount: number;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_apps`;
      return _nativeCall<any>('LIST_INSTALLED_APPS', 'LIST_INSTALLED_APPS_RESULT', id, { includeSystemComponents }, 120000).then(r => ({
        apps: r?.apps ?? r?.Apps ?? [],
        totalCount: r?.totalCount ?? r?.TotalCount ?? 0,
        error: r?.error,
      }));
    }
    return Promise.resolve({ apps: [], totalCount: 0, error: 'Native only' });
  },

  uninstallApp(appId: string, quiet = false): Promise<{ success: boolean; error?: string; launchedCommand?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_uninst`;
      return _nativeCall<any>('UNINSTALL_APP', 'UNINSTALL_APP_RESULT', id, { appId, quiet }, 60000).then(r => ({
        success: !!(r?.success ?? r?.Success),
        error: r?.error ?? r?.Error,
        launchedCommand: r?.launchedCommand ?? r?.LaunchedCommand,
      }));
    }
    return Promise.resolve({ success: false, error: 'Native only' });
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
    bypassRecycleBin: boolean = false,
    label?: string,
    priority?: 'low' | 'normal' | 'high',
    recreateSourceStructure?: boolean,
  ): Promise<{ ok: boolean; error?: string; background?: boolean }> {
    if (this.isNative) {
      const timeoutMs = action === 'copy' || action === 'move' ? 600_000 : 120_000;
      return _nativeCall<{ ok: boolean; error?: string; background?: boolean }>(
        'EXECUTE_FS_OPERATION',
        'FS_OPERATION_RESULT',
        operationId,
        {
          operationId,
          action,
          source,
          target,
          bypassRecycleBin,
          label,
          priority,
          recreateSourceStructure: !!recreateSourceStructure,
        },
        timeoutMs,
      );
    }
    if (action === 'undo' || action === 'redo' || action === 'copy') {
      return { ok: false, error: 'Native host required' };
    }
    return { ok: false, error: 'Native host required' };
  },

  executeBatchRename(
    operationId: string,
    renames: Array<{ source: string; target: string }>,
    label?: string,
  ): Promise<{ ok: boolean; renamed?: number; skipped?: number; failed?: number; error?: string }> {
    if (this.isNative) {
      return _nativeCall(
        'EXECUTE_BATCH_RENAME',
        'EXECUTE_BATCH_RENAME_RESULT',
        operationId,
        { operationId, renames, label },
        300_000,
      );
    }
    return Promise.resolve({ ok: false, error: 'Native only' });
  },

  startDrag(paths: string | string[], opts?: { extended?: boolean }) {
    if (!this.isNative) return;
    const raw = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    const normalized = raw.map(p => toWindowsPath(String(p)));
    const list = normalized.filter(isValidOutboundDragPath);
    const rejected = normalized.filter(p => !isValidOutboundDragPath(p));
    (window as any).chrome.webview.postMessage({
      type: 'START_DRAG',
      payload: {
        paths: list,
        rejected: rejected.length ? rejected : undefined,
        extended: !!opts?.extended,
      },
    });
  },

  /** Forensic drag logging — always on in native shell (ole-dnd.log). */
  postOleDndDebug(payload: Record<string, unknown>) {
    if (!this.isNative) return;
    try {
      (window as any).chrome.webview.postMessage({ type: 'OLE_DND_DEBUG', payload });
    } catch { /* ignore */ }
  },

  /** Arm host OLE escalate poll while an in-app file drag is active (leave-WebView → DoDragDrop). */
  notifyFileDragActive(active: boolean, paths?: string | string[]) {
    if (!this.isNative) return;
    const raw = paths == null ? [] : (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    const normalized = raw.map(p => toWindowsPath(String(p)));
    const list = normalized.filter(isValidOutboundDragPath);
    const rejected = normalized.filter(p => !isValidOutboundDragPath(p));
    (window as any).chrome.webview.postMessage({
      type: 'FILE_DRAG_ACTIVE',
      payload: {
        active: !!active && list.length > 0,
        paths: list,
        rejected: rejected.length ? rejected : undefined,
      },
    });
    this.postOleDndDebug({
      kind: 'FILE_DRAG_ACTIVE',
      active: !!active && list.length > 0,
      rawCount: raw.length,
      pathCount: list.length,
      rejectedCount: rejected.length,
    });
  },

  /**
   * Force host OLE handoff now (WebView2 pointercancel at left/right/bottom often fires
   * before the cursor reaches the host rim poll zone).
   */
  requestOleEscalateNow(why = 'fe') {
    if (!this.isNative) return;
    try {
      (window as any).chrome.webview.postMessage({
        type: 'OLE_ESCALATE_NOW',
        payload: { why },
      });
    } catch { /* ignore */ }
  },

  clearThumbnailCache(): Promise<{ success: boolean; filesRemoved?: number; bytesFreed?: number; error?: string }> {
    if (this.isNative) {
      return _nativeCall('CLEAR_THUMBNAIL_CACHE', 'CLEAR_THUMBNAIL_CACHE_RESULT', undefined, undefined, 60_000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  executeUndo(opts?: number | { entryId?: string; timeoutMs?: number }): Promise<{ ok: boolean; message: string }> {
    const timeoutMs = typeof opts === 'number' ? opts : (opts?.timeoutMs ?? 120_000);
    const entryId = typeof opts === 'object' && opts ? opts.entryId : undefined;
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; message: string }>(
        'EXECUTE_UNDO',
        'UNDO_REDO_RESULT',
        undefined,
        entryId ? { entryId } : undefined,
        timeoutMs,
      );
    }
    return Promise.resolve({ ok: false, message: 'Undo requires native host' });
  },

  executeRedo(opts?: number | { entryId?: string; timeoutMs?: number }): Promise<{ ok: boolean; message: string }> {
    const timeoutMs = typeof opts === 'number' ? opts : (opts?.timeoutMs ?? 120_000);
    const entryId = typeof opts === 'object' && opts ? opts.entryId : undefined;
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; message: string }>(
        'EXECUTE_REDO',
        'UNDO_REDO_RESULT',
        undefined,
        entryId ? { entryId } : undefined,
        timeoutMs,
      );
    }
    return Promise.resolve({ ok: false, message: 'Redo requires native host' });
  },

  getActionLog(max?: number): Promise<{
    items: Array<{ id: string; kind: string; label: string; utc: string; canUndo: boolean }>;
    redoItems?: Array<{ id: string; kind: string; label: string; utc: string; canUndo: boolean }>;
    canUndo: boolean;
    canRedo: boolean;
  }> {
    if (this.isNative) {
      return _nativeCall('GET_ACTION_LOG', 'ACTION_LOG_RESULT', undefined, max != null ? { max } : undefined);
    }
    return Promise.resolve({ items: [], redoItems: [], canUndo: false, canRedo: false });
  },

  onActionLogChanged(callback: (state: { canUndo: boolean; canRedo: boolean; lastActionUtc?: string }) => void) {
    this.init();
    this._actionLogListeners.push(callback);
    return () => {
      this._actionLogListeners = this._actionLogListeners.filter(cb => cb !== callback);
    };
  },

  getFileTransferQueue(): Promise<FileTransferQueueState> {
    if (this.isNative) {
      return _nativeCall<FileTransferQueueState>('GET_FILE_TRANSFER_QUEUE', 'FILE_TRANSFER_QUEUE_RESULT', undefined)
        .catch(() => ({ queuedCount: 0, activeCount: 0, jobs: [] as FileTransferJobDto[] }));
    }
    return Promise.resolve({ queuedCount: 0, activeCount: 0, jobs: [] });
  },

  cancelFileTransfer(operationId: string): Promise<{ ok: boolean; operationId: string }> {
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; operationId: string }>(
        'CANCEL_FILE_TRANSFER',
        'CANCEL_FILE_TRANSFER_RESULT',
        undefined,
        { operationId },
      );
    }
    return Promise.resolve({ ok: false, operationId });
  },

  pauseFileTransfer(operationId: string): Promise<{ ok: boolean; operationId: string }> {
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; operationId: string }>(
        'PAUSE_FILE_TRANSFER',
        'PAUSE_FILE_TRANSFER_RESULT',
        undefined,
        { operationId },
      );
    }
    return Promise.resolve({ ok: false, operationId });
  },

  resumeFileTransfer(operationId: string): Promise<{ ok: boolean; operationId: string }> {
    if (this.isNative) {
      return _nativeCall<{ ok: boolean; operationId: string }>(
        'RESUME_FILE_TRANSFER',
        'RESUME_FILE_TRANSFER_RESULT',
        undefined,
        { operationId },
      );
    }
    return Promise.resolve({ ok: false, operationId });
  },

  clearFileTransferHistory(): Promise<{ cleared: number }> {
    if (this.isNative) {
      return _nativeCall<{ cleared: number }>(
        'CLEAR_FILE_TRANSFER_HISTORY',
        'CLEAR_FILE_TRANSFER_HISTORY_RESULT',
        undefined,
      );
    }
    return Promise.resolve({ cleared: 0 });
  },

  onFileTransferQueueChanged(callback: (state: FileTransferQueueState) => void) {
    this.init();
    this._fileTransferQueueListeners.push(callback);
    return () => {
      this._fileTransferQueueListeners = this._fileTransferQueueListeners.filter(cb => cb !== callback);
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

  /** Put real FS paths on the Windows clipboard (CF_HDROP + Preferred DropEffect) like Explorer. */
  setShellClipboard(paths: string[], action: 'copy' | 'cut'): Promise<{ ok?: boolean; count?: number; cut?: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false, count: 0 });
    const normalize = (p: string) => {
      let s = (p || '').trim();
      if (!s || s.startsWith('::{') || s.toLowerCase().startsWith('shell:')) return s;
      if (s.startsWith('/bndz/')) return ''; // virtual — caller must resolve first
      if (s.startsWith('/')) s = s.substring(1);
      s = s.replace(/\//g, '\\');
      while (s.includes('\\\\')) s = s.replace('\\\\', '\\');
      if (/^[A-Za-z]:$/.test(s)) s += '\\';
      return s;
    };
    const winPaths = paths.map(normalize).filter(p => p && /^[A-Za-z]:\\/.test(p));
    if (!winPaths.length) return Promise.resolve({ ok: false, count: 0 });
    const id = `${Date.now()}_setShellClipboard`;
    return _nativeCall<{ ok?: boolean; count?: number; cut?: boolean }>(
      'SET_SHELL_CLIPBOARD',
      'SET_SHELL_CLIPBOARD_RESULT',
      id,
      { paths: winPaths, cut: action === 'cut' },
      10000,
    ).catch(() => ({ ok: false, count: 0 }));
  },

  /** Read Explorer-compatible FileDrop clipboard for paste / cut ghosting. */
  getShellClipboard(): Promise<{ ok?: boolean; paths?: string[]; action?: '' | 'copy' | 'cut'; cut?: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false, paths: [], action: '' });
    const id = `${Date.now()}_getShellClipboard`;
    return _nativeCall<{ ok?: boolean; paths?: string[]; action?: '' | 'copy' | 'cut'; cut?: boolean }>(
      'GET_SHELL_CLIPBOARD',
      'GET_SHELL_CLIPBOARD_RESULT',
      id,
      {},
      8000,
    ).catch(() => ({ ok: false, paths: [], action: '' }));
  },

  /** Clear Windows FileDrop after a cut paste (Explorer parity). */
  clearShellClipboard(): Promise<{ ok?: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_clearShellClipboard`;
    return _nativeCall<{ ok?: boolean }>(
      'CLEAR_SHELL_CLIPBOARD',
      'CLEAR_SHELL_CLIPBOARD_RESULT',
      id,
      {},
      5000,
    ).catch(() => ({ ok: false }));
  },

  shellExecute(
    action: 'open' | 'openWith' | 'copyPath' | 'compress' | 'openTerminal' | 'openExplorer' | 'executeScript' | string,
    path: string | string[],
    workingDir?: string,
    shell?: { useCustom?: boolean; interpreter?: string; args?: string },
  ) {
    const resolvedPath = action === 'copyPath'
      ? (() => {
          const text = formatPathsForClipboard(clipboardPathConfigFromDom(), path);
          return text.includes('\n') ? text.split('\n') : text;
        })()
      : path;

    if (this.isNative) {
      (window as any).chrome.webview.postMessage({
        type: 'SHELL_EXECUTE',
        payload: { action, path: resolvedPath, workingDir, ...(shell ? { shell } : {}) },
      });
    } else {
      if (action === 'copyPath') {
        const text = Array.isArray(resolvedPath) ? resolvedPath.join('\n') : String(resolvedPath);
        void import('./clipboardSafe').then(({ writeClipboardText }) => {
          writeClipboardText(text).then(ok => {
            if (!ok) {
              window.dispatchEvent(new CustomEvent('bndz-native-alert', {
                detail: { title: 'Clipboard', message: 'Clipboard failed' },
              }));
            }
          });
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
      const result = await _nativeCall<{ ok?: boolean; error?: string }>('AI_DOWNLOAD_MODEL', 'AI_DOWNLOAD_MODEL_RESULT', id, {}, 7_200_000);
      if (!result?.ok) {
        const { pushToast } = await import('../components/ToastHost');
        pushToast({ kind: 'error', title: 'Model download failed', message: result?.error || 'Host returned failure.' });
        return false;
      }
      return true;
    } catch (e) {
      const { pushToast } = await import('../components/ToastHost');
      pushToast({
        kind: 'error',
        title: 'Model download failed',
        message: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },

  async aiGenerate(prompt: string, timeoutMs = 120000): Promise<string> {
    if (!this.isNative) {
      const { pushToast } = await import('../components/ToastHost');
      pushToast({ kind: 'error', title: 'Assistant unavailable', message: 'Native host required.' });
      throw new Error('Native host required.');
    }
    const { ensureAiModelReady } = await import('./aiModelGate');
    const ready = await ensureAiModelReady();
    if (!ready) {
      const { pushToast } = await import('../components/ToastHost');
      pushToast({ kind: 'warning', title: 'Assistant not ready', message: 'Download or load the local model first.' });
      throw new Error('AI model not ready.');
    }
    const id = `${Date.now()}_aiGenerate`;
    try {
      const result = await _nativeCall<{ text?: string; error?: string }>('AI_GENERATE', 'AI_GENERATE_RESULT', id, { prompt }, timeoutMs);
      if (result?.error) throw new Error(result.error);
      return result?.text ?? '';
    } catch (e) {
      const { pushToast } = await import('../components/ToastHost');
      const message = e instanceof Error ? e.message : String(e);
      pushToast({ kind: 'error', title: 'Assistant unavailable', message });
      throw e instanceof Error ? e : new Error(message);
    }
  },

  aiGenerateStream(prompt: string, onChunk?: (chunk: string) => void, timeoutMs = 120000): Promise<string> {
    if (!this.isNative) {
      return Promise.reject(new Error('Native host required.'));
    }
    this.init();
    const id = `${Date.now()}_aiStream`;
    return new Promise(async (resolve, reject) => {
      const { ensureAiModelReady } = await import('./aiModelGate');
      const ready = await ensureAiModelReady();
      if (!ready) {
        const { pushToast } = await import('../components/ToastHost');
        pushToast({ kind: 'warning', title: 'Assistant not ready', message: 'Download or load the local model first.' });
        reject(new Error('AI model not ready.'));
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

  syncFolders(
    source: string,
    target: string,
    entityId: string,
    action: 'copy' | 'move' = 'move',
    mirrorMode = false,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const operationId = `sync-${Date.now()}`;
      const id = `${Date.now()}_syncFolders`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'SYNC_FOLDERS',
        'SYNC_FOLDERS_RESULT',
        id,
        { source, target, entityId, action, operationId, mirrorMode },
        600_000,
      );
    }
    return Promise.resolve({ ok: false, error: 'Native only' });
  },

  getCloudProviders(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_cloudProviders`;
      return _nativeCall<any>('GET_CLOUD_PROVIDERS', 'CLOUD_PROVIDERS_RESULT', id)
        .then(r => (Array.isArray(r) ? r : []))
        .catch(() => []);
    }
    return Promise.resolve([
      { name: 'OneDrive', path: `C:\\Users\\${(window as any).__bndzUser || 'User'}\\OneDrive`, icon: '☁️' }
    ]);
  },

  getSystemDrives(opts?: { force?: boolean }): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_drives`;
      return _nativeCall<any>('GET_DRIVES', 'DRIVES_RESULT', id, opts?.force ? { force: true } : undefined)
        .then(r => (Array.isArray(r) ? r : []))
        .catch(() => []);
    }
    return Promise.resolve([
      { name: '/', letter: '/', label: 'Container Root', totalSpace: 10_000_000_000, freeSpace: 5_000_000_000 },
      { name: '/workspace', letter: '/workspace', label: 'Workspace', totalSpace: 10_000_000_000, freeSpace: 5_000_000_000 }
    ]);
  },

  /** Host liveness probe — resolves quickly if the native IPC pump is healthy. */
  ipcPing(): Promise<boolean> {
    if (!this.isNative) return Promise.resolve(false);
    return _nativeCall<any>('IPC_PING', 'IPC_PING_RESULT', undefined, undefined, 4000)
      .then(r => r?.ok !== false)
      .catch(() => false);
  },

  /** Poll until backend-host answers (FilesMerge cold start race). */
  async waitForHostReady(budgetMs = 8000): Promise<boolean> {
    if (!this.isNative) return false;
    if (this._hostReady === true) return true;
    if (this._hostReadyPromise) return this._hostReadyPromise;

    const started = Date.now();
    this._hostReadyPromise = (async () => {
      while (Date.now() - started < budgetMs) {
        if (await this.ipcPing()) {
          this._hostReady = true;
          return true;
        }
        await new Promise(r => setTimeout(r, 120));
      }
      this._hostReady = false;
      return false;
    })().finally(() => {
      this._hostReadyPromise = null;
    });
    return this._hostReadyPromise;
  },

  getNetworkLocations(opts?: {
    assumeMappedReady?: boolean;
    cacheServers?: boolean;
  }): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_network`;
      return _nativeCall<any[]>(
        'GET_NETWORK_LOCATIONS',
        'NETWORK_LOCATIONS_RESULT',
        id,
        {
          assumeMappedReady: !!opts?.assumeMappedReady,
          cacheServers: !!opts?.cacheServers,
        },
      ).catch(() => []);
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

  checkForLanguageUpdates(manifestUrl?: string): Promise<{
    updates: Array<{ id: string; installedVersion: string; latestVersion: string; url?: string | null }>;
    error?: string | null;
    languagesRoot?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_langUpdates`;
      return _nativeCall<{
        updates: Array<{ id: string; installedVersion: string; latestVersion: string; url?: string | null }>;
        error?: string | null;
        languagesRoot?: string;
      }>('CHECK_LANGUAGE_UPDATES', 'CHECK_LANGUAGE_UPDATES_RESULT', id, {
        manifestUrl: manifestUrl || '',
      }, 20000).catch(err => ({
        updates: [],
        error: String(err?.message || err),
      }));
    }
    return Promise.resolve({ updates: [], error: 'Language updates require native host.' });
  },

  checkForUpdates(manifestUrl?: string, includeBetaVersions = false): Promise<{
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
      }>('CHECK_FOR_UPDATES', 'CHECK_FOR_UPDATES_RESULT', id, {
        manifestUrl: manifestUrl || '',
        includeBetaVersions: !!includeBetaVersions,
      }, 20000)
        .catch(err => ({
          currentVersion: '1.0.0',
          updateAvailable: false,
          error: String(err?.message || err),
        }));
    }
    return Promise.resolve({ currentVersion: '1.0.0', updateAvailable: false, error: 'Updates require native host.' });
  },

  /** Settings → Resolve cache path from current folder — push browse context to disk cache. */
  setMediaCacheBrowseFolder(folder: string | null | undefined): void {
    if (!this.isNative) return;
    (window as any).chrome.webview.postMessage({
      type: 'SET_MEDIA_CACHE_BROWSE_FOLDER',
      payload: { folder: folder || '' },
    });
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

  getVirtualViewContents(view: 'recent' | 'media' | 'audio' | 'documents' | 'large' | 'problems' | 'inbound' | 'portal-health' | 'portal-magnets' | 'portal-sandboxes' | 'portal-capture', limit = 500): Promise<any[]> {
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
      return dedupeInFlight('index-status', () =>
        nativeCall<{ fileCount?: number; folderCount?: number; locations?: Array<{ path: string; lastIndexed: number }>; error?: string }>(
          'GET_INDEX_STATUS',
          'INDEX_STATUS_RESULT',
          {},
          30000,
        ).then(payload => {
          if (payload?.error) throw new Error(payload.error);
          return {
            fileCount: payload?.fileCount ?? 0,
            folderCount: payload?.folderCount ?? 0,
            locations: payload?.locations ?? [],
          };
        }),
      ).catch(err => ({ fileCount: 0, folderCount: 0, locations: [], error: String(err?.message || err) }));
    }
    return Promise.resolve({ fileCount: 0, folderCount: 0, locations: [] });
  },

  getHomeDeck(opts?: { continuumLimit?: number; orbitLimit?: number; sinceFingerprint?: string; pulseOnly?: boolean }): Promise<{
    continuum: any[];
    places: Array<{ name: string; path: string; icon?: string; letter?: string; hint?: string }>;
    drives: any[];
    index: { fileCount?: number; folderCount?: number; locations?: Array<{ path: string; lastIndexed: number }> };
    library?: { images?: number; videos?: number; audio?: number; documents?: number; large?: number };
    pulse: { activeCount: number; queuedCount: number; label: string; transferLabel?: string; queue?: any };
    orbits: Record<string, any[]>;
    mostOpened?: any[];
    continuumFingerprint?: string;
    unchanged?: boolean;
    pulseOnly?: boolean;
    generatedAt?: number;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_homeDeck`;
      return _nativeCall('GET_HOME_DECK', 'HOME_DECK_RESULT', id, {
        continuumLimit: opts?.continuumLimit ?? 28,
        orbitLimit: opts?.orbitLimit ?? 6,
        sinceFingerprint: opts?.sinceFingerprint,
        pulseOnly: !!opts?.pulseOnly,
      }, 20000)
        .then((payload: any) => {
          if (payload?.error) throw new Error(payload.error);
          return {
            continuum: Array.isArray(payload?.continuum) ? payload.continuum : [],
            places: Array.isArray(payload?.places) ? payload.places : [],
            drives: Array.isArray(payload?.drives) ? payload.drives : [],
            index: payload?.index || { fileCount: 0, folderCount: 0, locations: [] },
            library: payload?.library,
            pulse: payload?.pulse || { activeCount: 0, queuedCount: 0, label: 'Idle' },
            orbits: payload?.orbits && typeof payload.orbits === 'object' ? payload.orbits : {},
            mostOpened: Array.isArray(payload?.mostOpened) ? payload.mostOpened : undefined,
            continuumFingerprint: payload?.continuumFingerprint,
            unchanged: !!payload?.unchanged,
            pulseOnly: !!payload?.pulseOnly,
            generatedAt: payload?.generatedAt,
          };
        })
        .catch(err => ({
          continuum: [],
          places: [],
          drives: [],
          index: { fileCount: 0, folderCount: 0, locations: [] },
          pulse: { activeCount: 0, queuedCount: 0, label: 'Idle' },
          orbits: {},
          error: String(err?.message || err),
        }));
    }
    return Promise.resolve({
      continuum: [],
      places: [],
      drives: [],
      index: { fileCount: 0, folderCount: 0, locations: [] },
      pulse: { activeCount: 0, queuedCount: 0, label: 'Idle' },
      orbits: {},
    });
  },

  getLensStage(path: string): Promise<{
    focus?: any;
    sha256?: string | null;
    twins?: any[];
    orbit?: any[];
    sameSize?: any[];
    mediaPeers?: any[];
    facts?: any;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_lensStage`;
      return _nativeCall('GET_LENS_STAGE', 'LENS_STAGE_RESULT', id, { path }, 20000)
        .then((payload: any) => {
          if (payload?.error) throw new Error(payload.error);
          return {
            focus: payload?.focus ?? null,
            sha256: payload?.sha256 ?? null,
            twins: Array.isArray(payload?.twins) ? payload.twins : [],
            orbit: Array.isArray(payload?.orbit) ? payload.orbit : [],
            sameSize: Array.isArray(payload?.sameSize) ? payload.sameSize : [],
            mediaPeers: Array.isArray(payload?.mediaPeers) ? payload.mediaPeers : [],
            facts: payload?.facts || {},
          };
        })
        .catch(err => ({
          twins: [],
          orbit: [],
          sameSize: [],
          mediaPeers: [],
          facts: {},
          error: String(err?.message || err),
        }));
    }
    return Promise.resolve({ twins: [], orbit: [], sameSize: [], mediaPeers: [], facts: {} });
  },

  openPathInNewWindow(path: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_newWindow`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'OPEN_PATH_IN_NEW_WINDOW',
        'OPEN_PATH_IN_NEW_WINDOW_RESULT',
        id,
        { path },
        15000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, error: 'Requires native host.' });
  },

  /** Spawn a Stage-style second process hosting one plugin (or sticky widget). */
  openPluginWindow(
    pluginId: string,
    opts?: { stickyId?: string; title?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_pluginWindow`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'OPEN_PLUGIN_WINDOW',
        'OPEN_PLUGIN_WINDOW_RESULT',
        id,
        {
          pluginId,
          stickyId: opts?.stickyId,
          title: opts?.title,
        },
        15000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    return Promise.resolve({ ok: false, error: 'Requires native host.' });
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

  setInContextMenu(enable: boolean, allUsers = false): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_setContextMenu`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'setContextMenu', enable, allUsers }, 60000)
        .then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  setIconStudioShellMenu(enable: boolean): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_setIconStudioShell`;
      return _nativeCall<ShellIntegrationResult>('SHELL_INTEGRATION', 'SHELL_INTEGRATION_RESULT', id, { action: 'setIconStudioShell', enable }, 60000)
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

  relaunchAsAdmin(extraArgs?: string): Promise<ShellIntegrationResult> {
    if (this.isNative) {
      const id = `${Date.now()}_relaunchAdmin`;
      return _nativeCall<ShellIntegrationResult>(
        'SHELL_INTEGRATION',
        'SHELL_INTEGRATION_RESULT',
        id,
        { action: 'relaunchAdmin', extraArgs: extraArgs || '' },
        60000,
      ).then(r => r ?? { success: false, message: 'No response from shell integration.' });
    }
    return Promise.resolve({ success: false, message: 'Shell integration requires the native host.' });
  },

  saveSettings(settings: any): Promise<{ ok: boolean }> {
    if (this.isNative) {
      const id = `${Date.now()}_saveSettings`;
      return _nativeCall<{ ok: boolean }>('SAVE_SETTINGS', 'SAVE_SETTINGS_RESULT', id, settings, 15000)
        .then(r => ({ ok: r?.ok !== false }))
        .catch(() => ({ ok: false }));
    }
    try {
      localStorage.setItem('bndz_config', JSON.stringify(settings));
    } catch { /* ignore */ }
    return Promise.resolve({ ok: true });
  },

  loadSettings(): Promise<any> {
    if (this.isNative) {
      const id = `${Date.now()}_loadSettings`;
      return _nativeCall<any>('LOAD_SETTINGS', 'LOAD_SETTINGS_RESULT', id).catch(() => null);
    }
    return Promise.resolve(null);
  },

  fetchNativeContextMenuItems(path: string | string[]): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_ctxItems`;
      const paths = (Array.isArray(path) ? path : [path]).filter(Boolean);
      return _nativeCall<any[]>('GET_CONTEXT_MENU_ITEMS', 'CONTEXT_MENU_ITEMS_RESULT', id, {
        path: paths[0],
        paths,
      });
    }
    // Never fabricate Explorer-looking menus outside the host.
    return Promise.resolve([]);
  },

  /** Live Windows shell popup (Vanara IContextMenu / TrackPopupMenu) — never opens Explorer. */
  showNativeContextMenu(path: string | string[], x: number, y: number) {
    if (!this.isNative) return;
    const paths = (Array.isArray(path) ? path : [path]).filter(Boolean);
    if (!paths.length) return;
    (window as any).chrome.webview.postMessage({
      type: 'SHOW_CONTEXT_MENU',
      payload: { path: paths[0], paths, x, y },
    });
  },

  fetchShareMenuItems(path: string): Promise<ShareMenuItem[]> {
    if (this.isNative) {
      const id = `${Date.now()}_shareItems`;
      return _nativeCall<ShareMenuItem[]>('GET_SHARE_MENU_ITEMS', 'SHARE_MENU_ITEMS_RESULT', id, { path });
    }
    return Promise.resolve([]);
  },

  checkPathExists(path: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_checkPath`;
      return _nativeCall<boolean>('CHECK_PATH_EXISTS', 'CHECK_PATH_RESULT', id, { path });
    }
    return Promise.resolve(false);
  },

  /** Expand `%AppData%` / `shell:Desktop` / etc. to a real Windows path via the host. */
  expandEnvironmentPath(path: string): Promise<string> {
    if (this.isNative) {
      const id = `${Date.now()}_expandPath`;
      return _nativeCall<string>('EXPAND_ENVIRONMENT_PATH', 'EXPAND_ENVIRONMENT_PATH_RESULT', id, { path })
        .then(r => (typeof r === 'string' && r.length ? r : path));
    }
    return Promise.resolve(path);
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

  purgeRecycleItems(paths: string[]): Promise<{ purged: number; failed: number }> {
    if (this.isNative) {
      const id = `${Date.now()}_purgeRecycleItems`;
      return _nativeCall<{ purged: number; failed: number }>('PURGE_RECYCLE_ITEMS', 'PURGE_RECYCLE_ITEMS_RESULT', id, { paths }, 60000);
    }
    return Promise.resolve({ purged: 0, failed: paths.length });
  },

  getDirContents(path: string): Promise<any[]> {
    if (this.isNative) {
      const norm = normalizePanePath(path);
      const isMesh = norm === '/mesh' || norm.startsWith('/mesh/');
      const timeoutMs = isMesh ? 90000 : 60000;
      return dedupeInFlight(`dir:${norm}`, async () => {
        // Cold start: wait for named-pipe host before the first listing races ConnectAsync failures.
        await this.waitForHostReady(8000);
        const payload = await _nativeCall<any>('GET_DIR_CONTENTS', 'DIR_CONTENTS_RESULT', '', { path: norm }, timeoutMs);
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const err = (payload as { error?: string }).error;
            if (err) throw new Error(err);
            const glyphs = (payload as { glyphs?: Record<string, string> }).glyphs;
            if (glyphs && typeof glyphs === 'object') hydrateShellGlyphMap(glyphs);
            const items = (payload as { items?: unknown[] }).items;
            const list = Array.isArray(items) ? items : [];
            const partial = !!(payload as { partial?: boolean }).partial;
            if (partial && list.length > 0) {
              const resumePath = String((payload as { path?: string }).path || norm);
              const runMore = (attempt: number) => {
                void _nativeCall<any>(
                  'GET_DIR_CONTENTS_MORE',
                  'DIR_CONTENTS_RESULT',
                  '',
                  { path: resumePath },
                  timeoutMs,
                )
                  .then(more => {
                    if (!more || typeof more !== 'object') {
                      if (attempt < 1) { runMore(attempt + 1); return; }
                      window.dispatchEvent(new CustomEvent('bndz-dir-more-failed', {
                        detail: { path: resumePath, error: 'Empty MORE response' },
                      }));
                      return;
                    }
                    if ((more as { error?: string }).error) {
                      if (attempt < 1) { runMore(attempt + 1); return; }
                      window.dispatchEvent(new CustomEvent('bndz-dir-more-failed', {
                        detail: { path: resumePath, error: String((more as { error?: string }).error) },
                      }));
                      return;
                    }
                    const moreGlyphs = (more as { glyphs?: Record<string, string> }).glyphs;
                    if (moreGlyphs && typeof moreGlyphs === 'object') hydrateShellGlyphMap(moreGlyphs);
                    const moreItems = Array.isArray((more as { items?: unknown[] }).items)
                      ? (more as { items: unknown[] }).items
                      : Array.isArray(more)
                        ? more
                        : [];
                    dispatchDirAppend(resumePath, moreItems as any[]);
                  })
                  .catch((err: unknown) => {
                    if (attempt < 1) { runMore(attempt + 1); return; }
                    window.dispatchEvent(new CustomEvent('bndz-dir-more-failed', {
                      detail: {
                        path: resumePath,
                        error: err instanceof Error ? err.message : String(err ?? 'MORE failed'),
                      },
                    }));
                  });
              };
              runMore(0);
            }
            return list;
          }
          return Array.isArray(payload) ? payload : [];
      });
    }
    return Promise.reject(new Error('Native host required'));
  },

  performGlobalSearch(
    query: string,
    limit: number,
    useRegex = false,
    rootPath = '',
    useEverything = true,
    searchContent = false,
    opts?: { booleanMode?: boolean; rootPaths?: string[]; preferBndzIndex?: boolean; matchCase?: boolean },
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
          matchCase: !!opts?.matchCase,
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

  /**
   * Host-owned WPF context menu — paints outside the WebView/app frame.
   * Returns the selected item id, or null if dismissed.
   */
  showHostContextMenu(opts: {
    clientX: number;
    clientY: number;
    items: Array<{ id: string; label: string; separator?: boolean; disabled?: boolean; danger?: boolean; bold?: boolean }>;
  }): Promise<string | null> {
    if (this.isNative) {
      const id = `${Date.now()}_hostCtxMenu`;
      return _nativeCall<string | null>('SHOW_HOST_CONTEXT_MENU', 'HOST_CONTEXT_MENU_RESULT', id, opts, 120000);
    }
    return Promise.resolve(null);
  },

  getNativeShellIconBase64(path: string, isDirectory: boolean, size = 48): Promise<string | null> {
    if (this.isNative) {
      return _nativeCall<string | null>(
        'GET_SHELL_ICON',
        'SHELL_ICON_RESULT',
        '',
        { path, isDirectory, size: Math.max(16, Math.min(512, Math.round(size) || 48)) },
        45000,
      );
    }
    return Promise.resolve(null);
  },

  getNativeShellIconsBatch(
    items: Array<{ path: string; isDirectory: boolean; size?: number }>,
    size = 48,
  ): Promise<Record<string, string | null>> {
    if (this.isNative) {
      return _nativeCall<Record<string, string | null>>(
        'GET_SHELL_ICONS_BATCH',
        'SHELL_ICONS_BATCH_RESULT',
        '',
        { items, size: Math.max(16, Math.min(512, Math.round(size) || 48)) },
        90000,
      );
    }
    return Promise.resolve({});
  },

  getNativeThumbnailBase64(path: string, size = 256): Promise<string | null> {
    if (this.isNative) {
      const key = `${path.replace(/\//g, '\\').toLowerCase()}@${size}`;
      return dedupeInFlight(`thumb:${key}`, () =>
        nativeCall<string | null>(
          'GET_THUMBNAIL',
          'THUMBNAIL_RESULT',
          { path, size },
          18000,
        ),
      );
    }
    return new Promise(resolve => setTimeout(() => resolve(null), 50));
  },

  getNativeThumbnailsBatch(paths: string[], size = 96): Promise<Record<string, string | null>> {
    if (this.isNative) {
      return _nativeCall<Record<string, string | null>>(
        'GET_THUMBNAILS_BATCH',
        'THUMBNAILS_BATCH_RESULT',
        '',
        { paths, size },
        45000,
      );
    }
    return Promise.resolve({});
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

  saveFileDialog(
    defaultPath: string,
    filter = 'PNG (*.png)|*.png|JPEG (*.jpg;*.jpeg)|*.jpg;*.jpeg|WebP (*.webp)|*.webp|All files (*.*)|*.*',
  ): Promise<string | null> {
    if (this.isNative) {
      const id = `${Date.now()}_saveFile`;
      return _nativeCall<string | null>('SAVE_FILE_DIALOG', 'SAVE_FILE_DIALOG_RESULT', id, { defaultPath, filter })
        .then(p => (p && String(p).trim() ? String(p) : null));
    }
    return Promise.resolve(defaultPath || null);
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
      const key = path.replace(/\//g, '\\').toLowerCase();
      return dedupeInFlight(`extmeta:${key}`, () =>
        nativeCall<Record<string, string>>(
          'GET_EXTENDED_METADATA',
          'EXTENDED_METADATA_RESULT',
          { path },
          30000,
        ),
      );
    }
    // Never fake EXIF/media fields outside the host — hybrid tell.
    return Promise.resolve({});
  },

  getExtendedMetadataBatch(paths: string[]): Promise<Record<string, Record<string, string>>> {
    if (!this.isNative || !paths?.length) return Promise.resolve({});
    return nativeCall<{ results?: Record<string, Record<string, string>> }>(
      'GET_EXTENDED_METADATA_BATCH',
      'EXTENDED_METADATA_BATCH_RESULT',
      { paths },
      60000,
    ).then(payload => payload?.results ?? {});
  },

  writeMediaTags(path: string, fields: Record<string, string | null | undefined>): Promise<{ ok?: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_writeMediaTags`;
      return _nativeCall<{ ok?: boolean; error?: string }>('WRITE_MEDIA_TAGS', 'WRITE_MEDIA_TAGS_RESULT', id, { path, fields }, 30000);
    }
    return Promise.resolve({ ok: false, error: 'Native only' });
  },

  getPerfStats(): Promise<Record<string, number>> {
    if (this.isNative) {
      const id = `${Date.now()}_perfStats`;
      return _nativeCall<Record<string, number>>('GET_PERF_STATS', 'PERF_STATS_RESULT', id, {}, 5000);
    }
    return Promise.resolve({});
  },

  /** Honest Chromium/CDP GPU + compositor status (hardware vs SwiftShader/software). */
  getGpuStatus(): Promise<Record<string, unknown>> {
    if (this.isNative) {
      const id = `${Date.now()}_gpuStatus`;
      return _nativeCall<Record<string, unknown>>('GET_GPU_STATUS', 'GPU_STATUS_RESULT', id, {}, 8000)
        .then(r => (r && typeof r === 'object' ? r : { ok: false, error: 'empty' }));
    }
    return Promise.resolve({ ok: false, error: 'Not native' });
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

  /** Resolve a WebGL-ready preview path for 3D / RAGE assets (.ydr/.ybn → cached GLB). */
  getModelPreview(path: string): Promise<{
    path?: string;
    format?: string;
    kind?: string;
    vertices?: number;
    triangles?: number;
    converted?: boolean;
    error?: string;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_modelPreview`;
      return _nativeCall(
        'GET_MODEL_PREVIEW', 'MODEL_PREVIEW_RESULT', id, { path }, 120000
      );
    }
    return Promise.resolve({ error: 'Not native', path });
  },

  getIconLibraries(): Promise<any[]> {
    if (this.isNative) {
      const id = `${Date.now()}_getIconLibs`;
      return _nativeCall<any[]>('GET_ICON_LIBRARIES', 'ICON_LIBRARIES_RESULT', id, undefined, 8000)
        .then(libs => (Array.isArray(libs) ? libs : []))
        .catch(() => []);
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

  createArchive(
    sources: string[],
    target: string,
    format: 'zip' | '7z' | 'tar' | 'gz' | 'rar' = 'zip',
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const operationId = `archive-${Date.now()}`;
      const id = `${Date.now()}_createArchive`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'CREATE_ARCHIVE',
        'CREATE_ARCHIVE_RESULT',
        id,
        { operationId, sources, target, format },
        600_000,
      );
    }
    return Promise.resolve({ ok: false, error: 'Native only' });
  },

  extractArchive(archivePath: string, destination: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const operationId = `extract-${Date.now()}`;
      const id = `${Date.now()}_extractArchive`;
      return _nativeCall<{ ok: boolean; error?: string }>(
        'EXTRACT_ARCHIVE',
        'EXTRACT_ARCHIVE_RESULT',
        id,
        { operationId, path: archivePath, destination },
        600_000,
      );
    }
    return Promise.resolve({ ok: false, error: 'Native only' });
  },

  createLink(linkPath: string, targetPath: string, linkType: 'symlink' | 'hardlink' | 'junction' | 'shortcut'): Promise<{ success: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_createLink`;
      return _nativeCall<{ success: boolean; error?: string }>('CREATE_LINK', 'CREATE_LINK_RESULT', id, { linkPath, targetPath, linkType }, 15000);
    }
    return Promise.resolve({ success: false, error: 'Native only' });
  },

  resolveShortcut(path: string): Promise<{
    success: boolean;
    error?: string;
    targetPath?: string;
    workingDirectory?: string;
    arguments?: string;
    description?: string;
    targetExists?: boolean;
    targetIsDirectory?: boolean;
    locationPath?: string;
    isUrl?: boolean;
  }> {
    if (this.isNative) {
      const id = `${Date.now()}_resolveShortcut`;
      return _nativeCall('RESOLVE_SHORTCUT', 'RESOLVE_SHORTCUT_RESULT', id, { path }, 8000);
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

  /** Native WinRT PrintManager / shell print verb for a file path. */
  printDocument(path?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_print`;
      if (path && String(path).trim()) {
        return _nativeCall<{ ok: boolean; error?: string }>(
          'PRINT_DOCUMENT',
          'PRINT_RESULT',
          id,
          { path },
          60000,
        ).catch(err => ({ ok: false, error: String(err?.message || err) }));
      }
      return _nativeCall<{ ok: boolean; error?: string }>(
        'PRINT_UI',
        'PRINT_RESULT',
        id,
        {},
        60000,
      ).catch(err => ({ ok: false, error: String(err?.message || err) }));
    }
    try {
      window.print();
      return Promise.resolve({ ok: true });
    } catch (err: any) {
      return Promise.resolve({ ok: false, error: String(err?.message || err) });
    }
  },

  /** Drop a toast into Windows Notification Center (AppNotificationBuilder). */
  showAppNotification(title: string, message: string, tag?: string): void {
    if (!this.isNative) return;
    try {
      (window as any).chrome.webview.postMessage({
        type: 'SHOW_APP_NOTIFICATION',
        payload: { title, message, tag },
      });
    } catch { /* ignore */ }
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

  writeBinaryFile(path: string, base64: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_writeBin`;
      return _nativeCall<boolean>('WRITE_BINARY_FILE', 'WRITE_BINARY_FILE_RESULT', id, { path, base64 }, 60000);
    }
    return Promise.resolve(false);
  },

  getLicenseStatus(): Promise<LicenseStatus> {
    if (this.isNative) {
      const id = `${Date.now()}_licenseStatus`;
      return _nativeCall<LicenseStatus>(
        'GET_LICENSE_STATUS', 'LICENSE_STATUS_RESULT', id, undefined, 10000,
      ).then(s => ({ ...PENDING_LICENSE_STATUS, ...s, statusPending: false }));
      // Let callers retry / fail-closed — do not swallow errors into a grant.
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
            statusPending: false,
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
        statusPending: false,
      });
    } catch {
      return Promise.resolve({ ...EMPTY_LICENSE_STATUS, statusPending: false, canUseApp: true });
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

  getBndzMeta(key: string): Promise<string | null> {
    if (this.isNative) {
      const id = `${Date.now()}_getMeta`;
      return _nativeCall<{ value?: string | null }>('GET_BNDZ_META', 'BNDZ_META_RESULT', id, { key }, 20000)
        .then(r => r?.value ?? null);
    }
    return Promise.resolve(localStorage.getItem(`bndz_meta_${key}`));
  },

  getInstalledFonts(): Promise<string[]> {
    if (this.isNative) {
      const id = `${Date.now()}_fonts`;
      return _nativeCall<{ families?: string[] }>('GET_SYSTEM_FONTS', 'SYSTEM_FONTS_RESULT', id, {}, 12000)
        .then(r => Array.isArray(r?.families) ? r.families.filter(f => typeof f === 'string' && f.trim()) : [])
        .catch(() => []);
    }
    return Promise.resolve([]);
  },

  setBndzMeta(key: string, value: string): Promise<boolean> {
    if (this.isNative) {
      const id = `${Date.now()}_setMeta`;
      return _nativeCall<{ ok?: boolean }>('SET_BNDZ_META', 'BNDZ_META_SET_RESULT', id, { key, value }, 60000)
        .then(r => !!r?.ok)
        .catch(err => {
          console.warn(`[IPC] setBndzMeta(${key}) failed:`, err);
          return false;
        });
    }
    localStorage.setItem(`bndz_meta_${key}`, value);
    return Promise.resolve(true);
  },

  trimAudioFile(path: string, startSec: number, endSec: number): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_trimAudio`;
      return _nativeCall<{ ok: boolean; path?: string; error?: string }>(
        'TRIM_AUDIO_FILE', 'TRIM_AUDIO_RESULT', id, { path, startSec, endSec }, 120000,
      );
    }
    return Promise.resolve({ ok: false, error: 'Native host required.' });
  },

  recordPathOpen(path: string): void {
    if (!this.isNative || !path) return;
    (window as any).chrome.webview.postMessage({ type: 'RECORD_PATH_OPEN', payload: { path } });
  },

  ensureFfmpegTools(): Promise<{ ok: boolean; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_ffmpegBootstrap`;
      return _nativeCall<{ ok: boolean; error?: string }>('ENSURE_FFMPEG_TOOLS', 'FFMPEG_TOOLS_RESULT', id, {}, 180000);
    }
    return Promise.resolve({ ok: false, error: 'Native host required.' });
  },

  runAutomationGraph(graph: unknown): Promise<{ ok: boolean; log: string[]; error?: string }> {
    if (this.isNative) {
      const id = `${Date.now()}_automation`;
      return _nativeCall<{ ok: boolean; log?: string[]; error?: string }>(
        'RUN_AUTOMATION_GRAPH', 'AUTOMATION_RUN_RESULT', id, graph, 600000,
      ).then(r => ({ ok: !!r?.ok, log: r?.log || [], error: r?.error }));
    }
    return Promise.resolve({ ok: false, log: [], error: 'Native host required.' });
  },

  syncAutomationLive(graph: unknown): Promise<{
    watchers: Array<{ path: string; pipelineName: string; live: boolean; lastTriggeredAt?: number; lastError?: string }>;
    schedules: Array<{ nodeId: string; pipelineName: string; intervalMinutes: number; active: boolean; lastTriggeredAt?: number; lastError?: string }>;
  } | null> {
    if (!this.isNative) return Promise.resolve(null);
    const id = `${Date.now()}_automationLive`;
    return _nativeCall<{ watchers?: unknown[]; schedules?: unknown[] }>(
      'SYNC_AUTOMATION_LIVE', 'AUTOMATION_LIVE_STATUS', id, graph, 30000,
    ).then(r => ({
      watchers: (r?.watchers || []) as Array<{ path: string; pipelineName: string; live: boolean; lastTriggeredAt?: number; lastError?: string }>,
      schedules: (r?.schedules || []) as Array<{ nodeId: string; pipelineName: string; intervalMinutes: number; active: boolean; lastTriggeredAt?: number; lastError?: string }>,
    }));
  },

  _automationStatusCache: null as { result: any; at: number } | null,
  getAutomationLiveStatus(): Promise<{
    watchers: Array<{ path: string; pipelineName: string; live: boolean; lastTriggeredAt?: number; lastError?: string }>;
    schedules: Array<{ nodeId: string; pipelineName: string; intervalMinutes: number; active: boolean; lastTriggeredAt?: number; lastError?: string }>;
  } | null> {
    if (!this.isNative) return Promise.resolve(null);
    const now = Date.now();
    const cached = this._automationStatusCache;
    if (cached && now - cached.at < 2000) return Promise.resolve(cached.result);
    const id = `${now}_automationStatus`;
    return _nativeCall<{ watchers?: unknown[]; schedules?: unknown[] }>(
      'GET_AUTOMATION_LIVE_STATUS', 'AUTOMATION_LIVE_STATUS', id, {}, 15000,
    ).then(r => {
      const result = {
        watchers: (r?.watchers || []) as Array<{ path: string; pipelineName: string; live: boolean; lastTriggeredAt?: number; lastError?: string }>,
        schedules: (r?.schedules || []) as Array<{ nodeId: string; pipelineName: string; intervalMinutes: number; active: boolean; lastTriggeredAt?: number; lastError?: string }>,
      };
      this._automationStatusCache = { result, at: Date.now() };
      return result;
    });
  },

  /** Fire armed spatialPin pipelines with the given pin paths (live Spatial Canvas trigger). */
  fireAutomationSpatialPins(paths: string[]): Promise<{ ok: boolean; fired: number; log: string[]; error?: string; queued?: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false, fired: 0, log: [], error: 'Native host required.' });
    const id = `${Date.now()}_automationSpatial`;
    // Backend acks immediately (queued run). Keep timeout short so Send-to-automation never hangs the UI.
    return _nativeCall<{ ok?: boolean; fired?: number; log?: string[]; error?: string; queued?: boolean }>(
      'FIRE_AUTOMATION_SPATIAL_PINS', 'AUTOMATION_SPATIAL_PIN_RESULT', id, { paths }, 15000,
    ).then(r => ({ ok: !!r?.ok, fired: r?.fired ?? 0, log: r?.log || [], error: r?.error, queued: !!r?.queued }));
  },

  analyzeMusicFile(path: string): Promise<{
    ok: boolean;
    bpm?: number;
    key?: string;
    mode?: string;
    keyConfidence?: number;
    durationSec?: number;
    peakDb?: number;
    title?: string;
    artist?: string;
    camelot?: string;
    suggestedHalfTime?: number;
    suggestedDoubleTime?: number;
    sidecarTags?: string[];
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required.' });
    const id = `${Date.now()}_analyzeMusic`;
    return _nativeCall(
      'ANALYZE_MUSIC_FILE', 'ANALYZE_MUSIC_RESULT', id, { path }, 180000,
    );
  },

  analyzeMusicBatch(paths: string[], writeTags = false): Promise<{
    ok: boolean;
    analyzed?: number;
    failed?: number;
    results?: Array<{
      ok: boolean;
      path?: string;
      bpm?: number;
      key?: string;
      mode?: string;
      keyConfidence?: number;
      peakDb?: number;
      camelot?: string;
      sidecarTags?: string[];
      tagsWritten?: boolean;
      error?: string;
    }>;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required.' });
    const id = `${Date.now()}_analyzeMusicBatch`;
    return _nativeCall(
      'ANALYZE_MUSIC_BATCH', 'ANALYZE_MUSIC_BATCH_RESULT', id, { paths, writeTags }, 600000,
    );
  },

  sandboxStart(rootPath: string, name?: string): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_sandboxStart`;
    return _nativeCall<any>('SANDBOX_START', 'SANDBOX_START_RESULT', id, { rootPath, name }, 30000);
  },

  sandboxGetActive(): Promise<{ sessions: any[] }> {
    if (!this.isNative) return Promise.resolve({ sessions: [] });
    const id = `${Date.now()}_sandboxActive`;
    return _nativeCall<any>('SANDBOX_GET_ACTIVE', 'SANDBOX_GET_ACTIVE_RESULT', id, {}, 15000)
      .then(r => ({ sessions: Array.isArray(r?.sessions) ? r.sessions : [] }));
  },

  sandboxList(): Promise<{ sessions: any[] }> {
    if (!this.isNative) return Promise.resolve({ sessions: [] });
    const id = `${Date.now()}_sandboxList`;
    return _nativeCall<any>('SANDBOX_LIST', 'SANDBOX_LIST_RESULT', id, {}, 15000)
      .then(r => ({ sessions: Array.isArray(r?.sessions) ? r.sessions : [] }));
  },

  sandboxCommit(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_sandboxCommit`;
    return _nativeCall<any>('SANDBOX_COMMIT', 'SANDBOX_COMMIT_RESULT', id, { sessionId }, 120000);
  },

  sandboxDiscard(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_sandboxDiscard`;
    return _nativeCall<any>('SANDBOX_DISCARD', 'SANDBOX_DISCARD_RESULT', id, { sessionId }, 30000);
  },

  sandboxCheckpoint(sessionId: string, name: string): Promise<{ ok: boolean; checkpointId?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_sandboxCp`;
    return _nativeCall<any>('SANDBOX_CHECKPOINT', 'SANDBOX_CHECKPOINT_RESULT', id, { sessionId, name }, 30000);
  },

  sandboxListCheckpoints(sessionId: string): Promise<{ checkpoints: any[] }> {
    if (!this.isNative) return Promise.resolve({ checkpoints: [] });
    const id = `${Date.now()}_sandboxCps`;
    return _nativeCall<any>('SANDBOX_LIST_CHECKPOINTS', 'SANDBOX_LIST_CHECKPOINTS_RESULT', id, { sessionId }, 15000)
      .then(r => ({ checkpoints: Array.isArray(r?.checkpoints) ? r.checkpoints : [] }));
  },

  sandboxRestoreCheckpoint(sessionId: string, checkpointId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_sandboxRestore`;
    return _nativeCall<any>('SANDBOX_RESTORE_CHECKPOINT', 'SANDBOX_RESTORE_CHECKPOINT_RESULT', id, { sessionId, checkpointId }, 60000);
  },

  sandboxGetStatus(sessionId: string): Promise<{
    sessionId?: string; status?: string; name?: string; rootWinPath?: string;
    pendingOpsCount?: number; shadowSizeBytes?: number; createdUtc?: string;
    lastCheckpoint?: { id: string; name: string; createdUtc?: string } | null;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ error: 'Native host required' });
    const id = `${Date.now()}_sandboxStatus`;
    return _nativeCall<any>('SANDBOX_GET_STATUS', 'SANDBOX_GET_STATUS_RESULT', id, { sessionId }, 15000);
  },

  branchWatch(rootPath: string): Promise<{ ok: boolean; watched?: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_branchWatch`;
    return _nativeCall<any>('BRANCH_WATCH', 'BRANCH_WATCH_RESULT', id, { rootPath }, 15000);
  },

  branchListWatched(): Promise<{ watched: string[] }> {
    if (!this.isNative) return Promise.resolve({ watched: [] });
    const id = `${Date.now()}_branchWatched`;
    return _nativeCall<any>('BRANCH_LIST_WATCHED', 'BRANCH_LIST_WATCHED_RESULT', id, {}, 15000)
      .then(r => ({ watched: Array.isArray(r?.watched) ? r.watched : [] }));
  },

  branchCreate(rootPath: string, name: string, parentBranchId?: string): Promise<{ ok: boolean; branch?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_branchCreate`;
    return _nativeCall<any>('BRANCH_CREATE', 'BRANCH_CREATE_RESULT', id, { rootPath, name, parentBranchId }, 600000);
  },

  branchList(rootPath?: string): Promise<{ branches: any[] }> {
    if (!this.isNative) return Promise.resolve({ branches: [] });
    const id = `${Date.now()}_branchList`;
    return _nativeCall<any>('BRANCH_LIST', 'BRANCH_LIST_RESULT', id, { rootPath }, 30000)
      .then(r => ({ branches: Array.isArray(r?.branches) ? r.branches : [] }));
  },

  branchPeek(branchId: string): Promise<{ ok: boolean; peek?: any }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_branchPeek`;
    return _nativeCall<any>('BRANCH_PEEK', 'BRANCH_PEEK_RESULT', id, { branchId }, 30000);
  },

  branchRestore(branchId: string, relPaths?: string[]): Promise<{ ok: boolean; restored?: number; skipped?: number; errors?: string[] }> {
    if (!this.isNative) return Promise.resolve({ ok: false, errors: ['Native host required'] });
    const id = `${Date.now()}_branchRestore`;
    return _nativeCall<any>('BRANCH_RESTORE', 'BRANCH_RESTORE_RESULT', id, { branchId, relPaths }, 600000);
  },

  branchDelete(branchId: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_branchDelete`;
    return _nativeCall<any>('BRANCH_DELETE', 'BRANCH_DELETE_RESULT', id, { branchId }, 15000);
  },

  healthScan(rootPath: string): Promise<{ ok: boolean; problemCount?: number; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_healthScan`;
    return _nativeCall<any>('HEALTH_SCAN', 'HEALTH_SCAN_RESULT', id, { rootPath }, 600000);
  },

  healthListProblems(rootPrefix?: string, limit?: number): Promise<{ problems: any[] }> {
    if (!this.isNative) return Promise.resolve({ problems: [] });
    const id = `${Date.now()}_healthProblems`;
    return _nativeCall<any>('HEALTH_LIST_PROBLEMS', 'HEALTH_LIST_PROBLEMS_RESULT', id, { rootPrefix, limit }, 30000)
      .then(r => ({ problems: Array.isArray(r?.problems) ? r.problems : [] }));
  },

  healthGetSummary(): Promise<{ total: number; critical: number; warning: number; info: number }> {
    if (!this.isNative) return Promise.resolve({ total: 0, critical: 0, warning: 0, info: 0 });
    const id = `${Date.now()}_healthSummary`;
    return _nativeCall<any>('HEALTH_GET_SUMMARY', 'HEALTH_GET_SUMMARY_RESULT', id, {}, 15000)
      .then(r => ({
        total: r?.total ?? 0,
        critical: r?.critical ?? 0,
        warning: r?.warning ?? 0,
        info: r?.info ?? 0,
      }));
  },

  healthClear(rootPrefix?: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_healthClear`;
    return _nativeCall<any>('HEALTH_CLEAR', 'HEALTH_CLEAR_RESULT', id, { rootPrefix }, 15000);
  },

  healthFixProblem(problemId: string): Promise<{ ok: boolean; action?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_healthFix`;
    return _nativeCall<any>('HEALTH_FIX_PROBLEM', 'HEALTH_FIX_PROBLEM_RESULT', id, { problemId }, 30000);
  },

  healthBuildRepairPlan(goals?: {
    zeroBrokenLinks?: boolean;
    clearEmptyDirs?: boolean;
    clearOrphanSidecars?: boolean;
    fixAllAuto?: boolean;
  }): Promise<any> {
    if (!this.isNative) return Promise.resolve({ actions: [], totalActions: 0 });
    const id = `${Date.now()}_healthPlan`;
    return _nativeCall<any>('HEALTH_BUILD_REPAIR_PLAN', 'HEALTH_BUILD_REPAIR_PLAN_RESULT', id, goals ?? {}, 30000);
  },

  healthApprovePlan(planId: string, actionIds?: string[]): Promise<{ ok: boolean; fixedCount?: number; failedCount?: number; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_healthApprove`;
    return _nativeCall<any>('HEALTH_APPROVE_PLAN', 'HEALTH_APPROVE_PLAN_RESULT', id, { planId, actionIds }, 120000);
  },

  tombstoneSnapshot(opId: string, kind: string, entries: Array<Record<string, unknown>>): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_tombSnap`;
    return _nativeCall<any>('TOMBSTONE_SNAPSHOT', 'TOMBSTONE_SNAPSHOT_RESULT', id, { opId, kind, entries }, 10000);
  },

  tombstoneClear(opId: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_tombClear`;
    return _nativeCall<any>('TOMBSTONE_CLEAR', 'TOMBSTONE_CLEAR_RESULT', id, { opId }, 5000);
  },

  tombstoneRestoreFailed(opId: string): Promise<{ ok: boolean; snapshot?: any }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_tombRestore`;
    return _nativeCall<any>('TOMBSTONE_RESTORE_FAILED', 'TOMBSTONE_RESTORE_FAILED_RESULT', id, { opId }, 10000);
  },

  branchCreateVss(rootPath: string, name: string): Promise<{ ok: boolean; branch?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_branchVss`;
    return _nativeCall<any>('BRANCH_CREATE_VSS', 'BRANCH_CREATE_VSS_RESULT', id, { rootPath, name }, 120000);
  },

  branchListVss(): Promise<{ branches: any[] }> {
    if (!this.isNative) return Promise.resolve({ branches: [] });
    const id = `${Date.now()}_branchListVss`;
    return _nativeCall<any>('BRANCH_LIST_VSS', 'BRANCH_LIST_VSS_RESULT', id, {}, 15000)
      .then(r => ({ branches: Array.isArray(r?.branches) ? r.branches : [] }));
  },

  branchBrowseVss(branchId: string, relative?: string): Promise<{ ok: boolean; items?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, items: [] });
    const id = `${Date.now()}_branchBrowseVss`;
    return _nativeCall<any>('BRANCH_BROWSE_VSS', 'BRANCH_BROWSE_VSS_RESULT', id, { id: branchId, relative }, 30000);
  },

  branchDeleteVss(branchId: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_branchDelVss`;
    return _nativeCall<any>('BRANCH_DELETE_VSS', 'BRANCH_DELETE_VSS_RESULT', id, { id: branchId }, 30000);
  },

  branchRestoreVss(branchId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_branchRestoreVss`;
    return _nativeCall<any>('BRANCH_RESTORE_VSS', 'BRANCH_RESTORE_VSS_RESULT', id, { id: branchId }, 300000);
  },

  /** List all existing system VSS shadow copies for the volume containing path. */
  branchListSystemShadows(path: string): Promise<{ ok: boolean; shadows: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: true, shadows: [] });
    const id = `${Date.now()}_branchListSysShadows`;
    return _nativeCall<any>('BRANCH_LIST_SYSTEM_SHADOWS', 'BRANCH_LIST_SYSTEM_SHADOWS_RESULT', id, { path }, 30000)
      .then(r => ({ ok: r?.ok ?? false, shadows: Array.isArray(r?.shadows) ? r.shadows : [], error: r?.error }));
  },

  /** Restore files from a system shadow copy (identified by its WMI DeviceObject path). */
  branchRestoreSystemShadow(deviceObject: string, originalPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_branchRestoreSysShadow`;
    return _nativeCall<any>('BRANCH_RESTORE_SYSTEM_SHADOW', 'BRANCH_RESTORE_SYSTEM_SHADOW_RESULT', id, { deviceObject, originalPath }, 300000);
  },

  lineageGet(path: string, depth?: number): Promise<{ edges: any[]; inbound?: any[]; outbound?: any[]; timeline?: any[] }> {
    if (!this.isNative) return Promise.resolve({ edges: [] });
    const id = `${Date.now()}_lineageGet`;
    return _nativeCall<any>('LINEAGE_GET', 'LINEAGE_GET_RESULT', id, { path, depth }, 30000)
      .then(r => {
        const timeline = Array.isArray(r?.timeline) ? r.timeline
          : Array.isArray(r?.Timeline) ? r.Timeline
          : Array.isArray(r?.edges) ? r.edges
          : [];
        return {
          edges: timeline,
          inbound: r?.inbound ?? r?.Inbound ?? [],
          outbound: r?.outbound ?? r?.Outbound ?? [],
          timeline,
        };
      });
  },

  lineageGetRecent(limit?: number): Promise<{ edges: any[] }> {
    if (!this.isNative) return Promise.resolve({ edges: [] });
    const id = `${Date.now()}_lineageRecent`;
    return _nativeCall<any>('LINEAGE_GET_RECENT', 'LINEAGE_GET_RECENT_RESULT', id, { limit }, 15000)
      .then(r => ({ edges: Array.isArray(r?.edges) ? r.edges : [] }));
  },

  lineageContentDag(path: string, depth?: number): Promise<{ focusHash: string; nodes: any[]; edges: any[] }> {
    if (!this.isNative) return Promise.resolve({ focusHash: '', nodes: [], edges: [] });
    const id = `${Date.now()}_lineageDag`;
    return _nativeCall<any>('LINEAGE_CONTENT_DAG', 'LINEAGE_CONTENT_DAG_RESULT', id, { path, depth }, 30000)
      .then(r => ({
        focusHash: r?.focusHash ?? r?.FocusHash ?? '',
        nodes: Array.isArray(r?.nodes ?? r?.Nodes) ? (r?.nodes ?? r?.Nodes) : [],
        edges: Array.isArray(r?.edges ?? r?.Edges) ? (r?.edges ?? r?.Edges) : [],
      }));
  },

  lineageHashFile(path: string): Promise<{ ok: boolean; hash?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_lineageHash`;
    return _nativeCall<any>('LINEAGE_HASH_FILE', 'LINEAGE_HASH_FILE_RESULT', id, { path }, 60000)
      .then(r => ({ ok: !!r?.ok, hash: r?.hash ?? r?.Hash, error: r?.error }));
  },

  capacityBuildPlan(path: string, targetFreeBytes?: number): Promise<{ ok: boolean; plan?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_capPlan`;
    return _nativeCall<any>('CAPACITY_BUILD_PLAN', 'CAPACITY_BUILD_PLAN_RESULT', id, { path, targetFreeBytes }, 120000);
  },

  capacityWhatIf(path: string, scrubbers: {
    keepHotDays?: number;
    recencyDays?: number;
    minFileSizeMb?: number;
    includeDuplicates?: boolean;
    includeGhostOffload?: boolean;
    includeArchive?: boolean;
    includeEmptyDirs?: boolean;
  }, targetFreeBytes?: number): Promise<{ ok: boolean; projection?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_capWhatIf`;
    return _nativeCall<any>('CAPACITY_WHAT_IF', 'CAPACITY_WHAT_IF_RESULT', id, { path, scrubbers, targetFreeBytes }, 120000);
  },

  capacityApprove(path: string, actionIds: string[]): Promise<{ ok: boolean; actionsDispatched?: number; bytesTargeted?: number; dispatchedOperationIds?: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_capApprove`;
    return _nativeCall<any>('CAPACITY_APPROVE', 'CAPACITY_APPROVE_RESULT', id, { path, actionIds }, 120000);
  },

  budgetGovernorGetPolicies(): Promise<{ ok: boolean; policies?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_govPolicies`;
    return _nativeCall<any>('BUDGET_GOVERNOR_GET_POLICIES', 'BUDGET_GOVERNOR_GET_POLICIES_RESULT', id, {}, 15000);
  },

  budgetGovernorSetPolicy(policy: {
    volumeRoot: string;
    enforcement: 'off' | 'soft' | 'hard';
    softLimitBytes: number;
    hardLimitBytes: number;
    enabled?: boolean;
  }): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_govSetPolicy`;
    return _nativeCall<any>('BUDGET_GOVERNOR_SET_POLICY', 'BUDGET_GOVERNOR_SET_POLICY_RESULT', id, policy, 15000);
  },

  budgetGovernorRemovePolicy(volumeRoot: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_govRemove`;
    return _nativeCall<any>('BUDGET_GOVERNOR_REMOVE_POLICY', 'BUDGET_GOVERNOR_REMOVE_POLICY_RESULT', id, { volumeRoot }, 15000);
  },

  budgetGovernorCheck(targetPath: string, incomingBytes: number): Promise<{
    ok: boolean;
    allowed?: boolean;
    softWarning?: boolean;
    hardBlock?: boolean;
    message?: string;
    currentUsedBytes?: number;
    afterUsedBytes?: number;
    softLimitBytes?: number;
    hardLimitBytes?: number;
    totalBytes?: number;
    afterUsedPct?: number;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_govCheck`;
    return _nativeCall<any>('BUDGET_GOVERNOR_CHECK', 'BUDGET_GOVERNOR_CHECK_RESULT', id, { targetPath, incomingBytes }, 15000);
  },

  inboundList(): Promise<{ entries: any[]; watching?: boolean }> {
    if (!this.isNative) return Promise.resolve({ entries: [], watching: false });
    const id = `${Date.now()}_inboundList`;
    return _nativeCall<any>('INBOUND_LIST', 'INBOUND_LIST_RESULT', id, {}, 15000)
      .then(r => ({
        entries: Array.isArray(r?.entries) ? r.entries : [],
        watching: !!r?.watching,
      }));
  },

  inboundCaptureNow(): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_inboundCapture`;
    return _nativeCall<any>('INBOUND_CAPTURE_NOW', 'INBOUND_CAPTURE_NOW_RESULT', id, {}, 15000);
  },

  inboundStartWatching(): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_inboundWatch`;
    return _nativeCall<any>('INBOUND_START_WATCHING', 'INBOUND_START_WATCHING_RESULT', id, {}, 15000);
  },

  inboundStopWatching(): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_inboundStop`;
    return _nativeCall<any>('INBOUND_STOP_WATCHING', 'INBOUND_STOP_WATCHING_RESULT', id, {}, 15000);
  },

  inboundDelete(entryId: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_inboundDel`;
    return _nativeCall<any>('INBOUND_DELETE', 'INBOUND_DELETE_RESULT', id, { id: entryId }, 15000);
  },

  inboundGetPaths(entryId: string): Promise<{ paths: string[] }> {
    if (!this.isNative) return Promise.resolve({ paths: [] });
    const id = `${Date.now()}_inboundPaths`;
    return _nativeCall<any>('INBOUND_GET_PATHS', 'INBOUND_GET_PATHS_RESULT', id, { id: entryId }, 15000)
      .then(r => ({ paths: Array.isArray(r?.paths) ? r.paths : [] }));
  },

  inboundGetRoot(): Promise<{ root: string; watching?: boolean }> {
    if (!this.isNative) return Promise.resolve({ root: '', watching: false });
    const id = `${Date.now()}_inboundRoot`;
    return _nativeCall<any>('INBOUND_GET_ROOT', 'INBOUND_GET_ROOT_RESULT', id, {}, 15000)
      .then(r => ({
        root: r?.root ?? r?.path ?? '',
        watching: !!r?.watching,
      }));
  },

  inboundCopyToLibrary(entryId: string, destination: string): Promise<{
    ok: boolean; copiedCount?: number; failedCount?: number;
    copiedNames?: string[]; errors?: string[]; error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_inboundCopyLib`;
    return _nativeCall<any>('INBOUND_COPY_TO_LIBRARY', 'INBOUND_COPY_TO_LIBRARY_RESULT', id, { entryId, destination }, 120000);
  },

  captureInboxStatus(): Promise<{
    captureFolder: string; watching: boolean; captureCount: number; lastCapture?: any;
  }> {
    if (!this.isNative) return Promise.resolve({ captureFolder: '', watching: false, captureCount: 0 });
    const id = `${Date.now()}_capInboxStatus`;
    return _nativeCall<any>('CAPTURE_INBOX_STATUS', 'CAPTURE_INBOX_STATUS_RESULT', id, {}, 15000)
      .then(r => ({
        captureFolder: r?.captureFolder ?? r?.CaptureFolder ?? '',
        watching: !!(r?.watching ?? r?.Watching),
        captureCount: r?.captureCount ?? r?.CaptureCount ?? 0,
        lastCapture: r?.lastCapture ?? r?.LastCapture,
      }));
  },

  captureFromClipboard(): Promise<{ ok: boolean; entry?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_capFromClip`;
    return _nativeCall<any>('CAPTURE_FROM_CLIPBOARD', 'CAPTURE_FROM_CLIPBOARD_RESULT', id, {}, 20000);
  },

  captureInboxSetFolder(folder: string): Promise<{ ok: boolean; captureFolder?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_capSetFolder`;
    return _nativeCall<any>('CAPTURE_INBOX_SET_FOLDER', 'CAPTURE_INBOX_SET_FOLDER_RESULT', id, { folder }, 15000)
      .then(r => ({ ok: !!r?.ok, captureFolder: r?.captureFolder ?? r?.CaptureFolder }));
  },

  captureInboxStartWatching(): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_capWatch`;
    return _nativeCall<any>('CAPTURE_INBOX_START_WATCHING', 'CAPTURE_INBOX_START_WATCHING_RESULT', id, {}, 15000);
  },

  captureInboxStopWatching(): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_capStopWatch`;
    return _nativeCall<any>('CAPTURE_INBOX_STOP_WATCHING', 'CAPTURE_INBOX_STOP_WATCHING_RESULT', id, {}, 15000);
  },

  captureInboxList(limit = 50): Promise<{ captures: any[]; watching: boolean; captureFolder: string }> {
    if (!this.isNative) return Promise.resolve({ captures: [], watching: false, captureFolder: '' });
    const id = `${Date.now()}_capList`;
    return _nativeCall<any>('CAPTURE_INBOX_LIST', 'CAPTURE_INBOX_LIST_RESULT', id, { limit }, 15000)
      .then(r => ({
        captures: Array.isArray(r?.captures) ? r.captures : [],
        watching: !!(r?.watching ?? r?.Watching),
        captureFolder: r?.captureFolder ?? r?.CaptureFolder ?? '',
      }));
  },

  realityCheckScan(rootPath: string): Promise<{
    ok: boolean; rootPath?: string; projectFileCount?: number;
    totalRefs?: number; missingCount?: number; okCount?: number;
    scannedUtc?: string; references?: any[]; error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_rcScan`;
    return _nativeCall<any>('REALITY_CHECK_SCAN', 'REALITY_CHECK_SCAN_RESULT', id, { rootPath }, 300000);
  },

  realityCheckSetActive(active: boolean): Promise<{ ok: boolean; active?: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_rcActive`;
    return _nativeCall<any>('REALITY_CHECK_SET_ACTIVE', 'REALITY_CHECK_SET_ACTIVE_RESULT', id, { active }, 15000);
  },

  realityCheckGetState(): Promise<{
    active: boolean; missingPaths: string[]; lastScan?: any;
  }> {
    if (!this.isNative) return Promise.resolve({ active: false, missingPaths: [] });
    const id = `${Date.now()}_rcState`;
    return _nativeCall<any>('REALITY_CHECK_GET_STATE', 'REALITY_CHECK_GET_STATE_RESULT', id, {}, 15000)
      .then(r => ({
        active: !!(r?.active ?? r?.Active),
        missingPaths: Array.isArray(r?.missingPaths) ? r.missingPaths : [],
        lastScan: r?.lastScan ?? r?.LastScan,
      }));
  },

  contentDnaScan(folderPath: string, includeSubfolders = true): Promise<{ ok: boolean; scanned?: number; folder?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_dnaScan`;
    return _nativeCall<any>('CONTENT_DNA_SCAN', 'CONTENT_DNA_SCAN_RESULT', id, { folderPath, includeSubfolders }, 45000)
      .catch(err => ({ ok: false, error: String(err?.message || err) }));
  },

  contentDnaForPath(path: string, maxResults = 12): Promise<{
    ok: boolean;
    path?: string;
    kind?: string;
    relatives?: Array<{ path: string; kind: string; score: number; reason: string }>;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_dnaPath`;
    return _nativeCall<any>('CONTENT_DNA_FOR_PATH', 'CONTENT_DNA_FOR_PATH_RESULT', id, { path, maxResults }, 20000)
      .then(r => ({
        ok: !!r?.ok,
        path: r?.path,
        kind: r?.kind,
        relatives: Array.isArray(r?.relatives) ? r.relatives : [],
        error: r?.error,
      }))
      .catch(err => ({ ok: false, error: String(err?.message || err), relatives: [] }));
  },

  twinVolumeCompare(leftRoot: string, rightRoot: string, useHashing = true): Promise<{
    ok: boolean;
    leftRoot?: string;
    rightRoot?: string;
    items?: Array<{
      relativePath: string;
      status: string;
      leftPath?: string;
      rightPath?: string;
      leftSize?: number;
      rightSize?: number;
      leftModifiedUtc?: string;
      rightModifiedUtc?: string;
    }>;
    summary?: Record<string, number>;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_twinCmp`;
    return _nativeCall<any>('TWIN_VOLUME_COMPARE', 'TWIN_VOLUME_COMPARE_RESULT', id, { leftRoot, rightRoot, useHashing }, 300000);
  },

  twinVolumeResolve(leftRoot: string, rightRoot: string, relativePath: string, direction: 'leftToRight' | 'rightToLeft'): Promise<{
    ok: boolean;
    copiedTo?: string;
    direction?: string;
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_twinRes`;
    return _nativeCall<any>('TWIN_VOLUME_RESOLVE', 'TWIN_VOLUME_RESOLVE_RESULT', id, { leftRoot, rightRoot, relativePath, direction }, 120000);
  },

  jobTicketList(folderPath?: string): Promise<{ ok: boolean; tickets?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_jtList`;
    return _nativeCall<any>('JOB_TICKET_LIST', 'JOB_TICKET_LIST_RESULT', id, { folderPath: folderPath ?? '' }, 15000);
  },

  jobTicketListOverdue(folderPaths: string[]): Promise<{ ok: boolean; overdueMap?: Record<string, { folderPath: string; count: number; earliestDueUtc: string; title: string }>; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_jtOverdue`;
    return _nativeCall<any>('JOB_TICKET_LIST_OVERDUE', 'JOB_TICKET_LIST_OVERDUE_RESULT', id, { folderPaths }, 15000);
  },

  jobTicketSave(ticket: { id?: string; folderPath: string; title: string; dueUtc: string; status?: string; notes?: string }): Promise<{ ok: boolean; ticket?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_jtSave`;
    return _nativeCall<any>('JOB_TICKET_SAVE', 'JOB_TICKET_SAVE_RESULT', id, ticket, 15000);
  },

  jobTicketDelete(ticketId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_jtDel`;
    return _nativeCall<any>('JOB_TICKET_DELETE', 'JOB_TICKET_DELETE_RESULT', id, { id: ticketId }, 15000);
  },

  magnetList(): Promise<{ magnets: any[] }> {
    if (!this.isNative) return Promise.resolve({ magnets: [] });
    const id = `${Date.now()}_magnetList`;
    return _nativeCall<any>('MAGNET_LIST', 'MAGNET_LIST_RESULT', id, {}, 15000)
      .then(r => ({ magnets: Array.isArray(r?.magnets) ? r.magnets : [] }));
  },

  magnetSave(magnet: Record<string, unknown>): Promise<{ ok: boolean; magnet?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_magnetSave`;
    return _nativeCall<any>('MAGNET_SAVE', 'MAGNET_SAVE_RESULT', id, magnet, 15000);
  },

  magnetDelete(magnetId: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_magnetDel`;
    return _nativeCall<any>('MAGNET_DELETE', 'MAGNET_DELETE_RESULT', id, { id: magnetId }, 15000);
  },

  magnetApplyDrop(
    magnetId: string,
    paths: string[],
    action: 'copy' | 'move' = 'copy',
    operationId?: string,
  ): Promise<{ ok: boolean; transferred?: number; destinations?: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const opId = operationId ?? `magnet-${Date.now()}`;
    const id = `${Date.now()}_magnetApply`;
    return _nativeCall<any>('MAGNET_APPLY_DROP', 'MAGNET_APPLY_DROP_RESULT', id, {
      magnetId,
      paths,
      action,
      operationId: opId,
    }, 600000);
  },

  temporalDiffSnapshot(rootPath: string): Promise<{ ok: boolean; snapshotId?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_tdSnap`;
    return _nativeCall<any>('TEMPORAL_DIFF_SNAPSHOT', 'TEMPORAL_DIFF_SNAPSHOT_RESULT', id, { rootPath }, 300000);
  },

  temporalDiffCompare(
    rootPath: string,
    minutesAgo: number,
    checkpointId?: string,
  ): Promise<{ ok: boolean; diff?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_tdCompare`;
    return _nativeCall<any>('TEMPORAL_DIFF_COMPARE', 'TEMPORAL_DIFF_COMPARE_RESULT', id, {
      rootPath,
      minutesAgo,
      checkpointId,
    }, 300000);
  },

  temporalDiffListSnapshots(rootPath: string, limit = 20): Promise<{ ok: boolean; snapshots?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, snapshots: [] });
    const id = `${Date.now()}_tdList`;
    return _nativeCall<any>('TEMPORAL_DIFF_LIST_SNAPSHOTS', 'TEMPORAL_DIFF_LIST_SNAPSHOTS_RESULT', id, {
      rootPath,
      limit,
    }, 30000);
  },

  verbForgeList(): Promise<{ ok: boolean; verbs?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_verbList`;
    return _nativeCall<any>('VERB_FORGE_LIST', 'VERB_FORGE_LIST_RESULT', id, {}, 15000);
  },

  verbForgeSave(verb: {
    id?: string;
    label: string;
    verbKey?: string;
    targetClass?: string;
    argTemplate?: string;
    icon?: string;
    deployed?: boolean;
  }): Promise<{ ok: boolean; verb?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_verbSave`;
    return _nativeCall<any>('VERB_FORGE_SAVE', 'VERB_FORGE_SAVE_RESULT', id, verb, 15000);
  },

  verbForgeDeploy(verbId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_verbDeploy`;
    return _nativeCall<any>('VERB_FORGE_DEPLOY', 'VERB_FORGE_DEPLOY_RESULT', id, { id: verbId }, 15000);
  },

  verbForgeRemove(verbId: string, undeploy = true): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_verbRemove`;
    return _nativeCall<any>('VERB_FORGE_REMOVE', 'VERB_FORGE_REMOVE_RESULT', id, { id: verbId, undeploy }, 15000);
  },

  transcodeEnqueue(
    paths: string[],
    format: 'jpeg' | 'png' | 'webp',
    quality: number,
    destFolder?: string,
  ): Promise<{ ok: boolean; jobIds?: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_transcodeEnq`;
    return _nativeCall<any>('TRANSCODE_ENQUEUE', 'TRANSCODE_ENQUEUE_RESULT', id, { paths, format, quality, destFolder }, 120000);
  },

  transcodeStatus(): Promise<{ ok: boolean; status?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_transcodeStat`;
    return _nativeCall<any>('TRANSCODE_STATUS', 'TRANSCODE_STATUS_RESULT', id, {}, 15000);
  },

  semanticDeskCluster(payload: {
    folder?: string;
    paths?: string[];
    clusterCount?: number;
  }): Promise<{ ok: boolean; result?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_semanticCluster`;
    return _nativeCall<any>('SEMANTIC_DESK_CLUSTER', 'SEMANTIC_DESK_CLUSTER_RESULT', id, payload, 60000);
  },

  recycleArchList(): Promise<{ branches: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ branches: [] });
    const id = `${Date.now()}_recycleArchList`;
    return _nativeCall<any>('RECYCLE_ARCH_LIST', 'RECYCLE_ARCH_LIST_RESULT', id, {}, 120000)
      .then(r => ({ branches: Array.isArray(r?.branches) ? r.branches : [], error: r?.error }));
  },

  recycleArchRestoreBranch(parentPath: string): Promise<{ restored: number; failed: number; error?: string }> {
    if (!this.isNative) return Promise.resolve({ restored: 0, failed: 0 });
    const id = `${Date.now()}_recycleArchRestore`;
    return _nativeCall<any>('RECYCLE_ARCH_RESTORE_BRANCH', 'RECYCLE_ARCH_RESTORE_BRANCH_RESULT', id, { parentPath }, 120000)
      .then(r => ({ restored: r?.restored ?? 0, failed: r?.failed ?? 0, error: r?.error }));
  },

  helloGateList(): Promise<{ gates: Array<{ path: string; addedUtc?: string; hasPassphrase?: boolean }> }> {
    if (!this.isNative) return Promise.resolve({ gates: [] });
    const id = `${Date.now()}_helloGateList`;
    return _nativeCall<any>('HELLO_GATE_LIST', 'HELLO_GATE_LIST_RESULT', id, {}, 15000)
      .then(r => ({ gates: Array.isArray(r?.gates) ? r.gates : [] }));
  },

  helloGateAdd(path: string, passphrase?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_helloGateAdd`;
    return _nativeCall<any>('HELLO_GATE_ADD', 'HELLO_GATE_ADD_RESULT', id, { path, passphrase }, 15000)
      .then(r => ({ ok: !!r?.ok, error: r?.error }));
  },

  helloGateRemove(path: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_helloGateRemove`;
    return _nativeCall<any>('HELLO_GATE_REMOVE', 'HELLO_GATE_REMOVE_RESULT', id, { path }, 15000)
      .then(r => ({ ok: !!r?.ok }));
  },

  helloGateCheck(path: string): Promise<{ blocked: boolean; gatePath?: string }> {
    if (!this.isNative) return Promise.resolve({ blocked: false });
    // Fast local JSON check — keep timeout short and fail-open so callers never hang folder UX.
    return _nativeCall<any>('HELLO_GATE_CHECK', 'HELLO_GATE_CHECK_RESULT', '', { path }, 4000)
      .then(r => ({ blocked: !!r?.blocked, gatePath: r?.gatePath }))
      .catch(() => ({ blocked: false }));
  },

  helloGateUnlock(path: string, passphrase?: string): Promise<{ ok: boolean; error?: string; method?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_helloGateUnlock`;
    return _nativeCall<any>('HELLO_GATE_UNLOCK', 'HELLO_GATE_UNLOCK_RESULT', id, { path, passphrase }, 60000)
      .then(r => ({ ok: !!r?.ok, error: r?.error, method: r?.method }));
  },

  liveShareStart(folderPath: string): Promise<{ ok: boolean; peerId?: string; machineName?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_liveShareStart`;
    return _nativeCall<any>('LIVE_SHARE_START', 'LIVE_SHARE_START_RESULT', id, { folderPath }, 15000)
      .then(r => ({ ok: !!r?.ok, peerId: r?.peerId, machineName: r?.machineName }));
  },

  liveShareStop(folderPath: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_liveShareStop`;
    return _nativeCall<any>('LIVE_SHARE_STOP', 'LIVE_SHARE_STOP_RESULT', id, { folderPath }, 15000)
      .then(r => ({ ok: !!r?.ok }));
  },

  liveShareUpdate(folderPath: string, selectionPaths: string[], cursorPath?: string): Promise<{ ok: boolean }> {
    if (!this.isNative) return Promise.resolve({ ok: false });
    const id = `${Date.now()}_liveShareUpdate`;
    return _nativeCall<any>('LIVE_SHARE_UPDATE', 'LIVE_SHARE_UPDATE_RESULT', id, { folderPath, selectionPaths, cursorPath }, 15000)
      .then(r => ({ ok: !!r?.ok }));
  },

  liveShareGetPeers(folderPath: string): Promise<{ peers: any[] }> {
    if (!this.isNative) return Promise.resolve({ peers: [] });
    const id = `${Date.now()}_liveSharePeers`;
    return _nativeCall<any>('LIVE_SHARE_GET_PEERS', 'LIVE_SHARE_GET_PEERS_RESULT', id, { folderPath }, 15000)
      .then(r => ({ peers: Array.isArray(r?.peers) ? r.peers : [] }));
  },

  policyPackList(): Promise<{ ok: boolean; packs?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_policyList`;
    return _nativeCall<any>('POLICY_PACK_LIST', 'POLICY_PACK_LIST_RESULT', id, {}, 15000);
  },

  policyPackSave(pack: Record<string, unknown>): Promise<{ ok: boolean; pack?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_policySave`;
    return _nativeCall<any>('POLICY_PACK_SAVE', 'POLICY_PACK_SAVE_RESULT', id, pack, 15000);
  },

  policyPackApply(folderPath: string, packId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_policyApply`;
    return _nativeCall<any>('POLICY_PACK_APPLY', 'POLICY_PACK_APPLY_RESULT', id, { folderPath, packId }, 15000);
  },

  policyPackValidate(destinationPath: string, sourcePaths: string[]): Promise<{
    ok: boolean; allowed?: boolean; packId?: string; packName?: string;
    violations?: Array<{ sourcePath: string; rule: string; message: string }>; error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_policyValidate`;
    return _nativeCall<any>('POLICY_PACK_VALIDATE', 'POLICY_PACK_VALIDATE_RESULT', id, { destinationPath, sourcePaths }, 30000);
  },

  pathHealerScan(path: string, maxResults = 200): Promise<{ ok: boolean; issues?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_pathHealScan`;
    return _nativeCall<any>('PATH_HEALER_SCAN', 'PATH_HEALER_SCAN_RESULT', id, { path, maxResults }, 120000);
  },

  pathHealerApply(issueIds: string[], issues: any[]): Promise<{ ok: boolean; applied?: number; errors?: string[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_pathHealApply`;
    return _nativeCall<any>('PATH_HEALER_APPLY', 'PATH_HEALER_APPLY_RESULT', id, { issueIds, issues }, 120000);
  },

  zkVaultCreate(folderPath: string, password: string, mode: 'files' | 'container' = 'files'): Promise<{ ok: boolean; vaultId?: string; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_zkCreate`;
    return _nativeCall<any>('ZK_VAULT_CREATE', 'ZK_VAULT_CREATE_RESULT', id, { folderPath, password, mode }, 300000);
  },

  zkVaultUnlock(vaultPath: string, password: string): Promise<{ ok: boolean; session?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_zkUnlock`;
    return _nativeCall<any>('ZK_VAULT_UNLOCK', 'ZK_VAULT_UNLOCK_RESULT', id, { vaultPath, password }, 300000);
  },

  zkVaultLock(vaultId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_zkLock`;
    return _nativeCall<any>('ZK_VAULT_LOCK', 'ZK_VAULT_LOCK_RESULT', id, { vaultId }, 15000);
  },

  zkVaultStatus(): Promise<{ ok: boolean; status?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_zkStatus`;
    return _nativeCall<any>('ZK_VAULT_STATUS', 'ZK_VAULT_STATUS_RESULT', id, {}, 15000);
  },

  aclDramaSnapshot(path: string): Promise<{ ok: boolean; snapshot?: any; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_aclSnap`;
    return _nativeCall<any>('ACL_DRAMA_SNAPSHOT', 'ACL_DRAMA_SNAPSHOT_RESULT', id, { path }, 15000);
  },

  aclDramaHistory(path: string, limit = 50): Promise<{ ok: boolean; history?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_aclHist`;
    return _nativeCall<any>('ACL_DRAMA_HISTORY', 'ACL_DRAMA_HISTORY_RESULT', id, { path, limit }, 15000);
  },

  namespaceList(): Promise<{ ok: boolean; roots?: any[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_nsList`;
    return _nativeCall<any>('NAMESPACE_LIST', 'NAMESPACE_LIST_RESULT', id, {}, 15000);
  },

  /**
   * Wave 9 — Semantic search reranking.
   * Re-orders candidatePaths by cosine similarity of their name embeddings to query.
   * Returns { ok, modelPresent, items: [{ path, score }] }.
   * When modelPresent is false the backend returns paths in original order with score 0.
   */
  semanticRank(
    query: string,
    paths: string[],
    limit = 200,
  ): Promise<{ ok: boolean; modelPresent?: boolean; items?: { path: string; score: number }[]; error?: string }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_semRank`;
    return _nativeCall<any>('SEMANTIC_RANK', 'SEMANTIC_RANK_RESULT', id, { query, paths, limit }, 30000);
  },

  /**
   * Wave 9 — Get embedding model status (loaded, dimension, file paths).
   */
  embeddingStatus(): Promise<{
    ok: boolean;
    status?: {
      modelLoaded: boolean;
      embeddingDimension: number;
      modelPath: string;
      vocabPath: string;
      modelExists: boolean;
      vocabExists: boolean;
    };
    error?: string;
  }> {
    if (!this.isNative) return Promise.resolve({ ok: false, error: 'Native host required' });
    const id = `${Date.now()}_embStatus`;
    return _nativeCall<any>('EMBEDDING_STATUS', 'EMBEDDING_STATUS_RESULT', id, {}, 5000);
  },
};
