import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginSectionTitle,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const CaptureInboxPluginDef = {
  id: 'capture-inbox',
  name: 'Capture Inbox',
  icon: 'clipboard_ui',
  description: 'Screenshot and clipboard images saved as named PNG files via Windows OCR.',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type CaptureEntry = {
  id: string;
  fileName: string;
  suggestedName: string;
  ocrPreview: string;
  size: number;
  capturedUtc: string;
  fullPath: string;
};

function normalizeCapture(raw: Record<string, unknown>): CaptureEntry {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    fileName: String(raw.fileName ?? raw.FileName ?? ''),
    suggestedName: String(raw.suggestedName ?? raw.SuggestedName ?? ''),
    ocrPreview: String(raw.ocrPreview ?? raw.OcrPreview ?? ''),
    size: Number(raw.size ?? raw.Size ?? 0),
    capturedUtc: String(raw.capturedUtc ?? raw.CapturedUtc ?? ''),
    fullPath: String(raw.fullPath ?? raw.FullPath ?? ''),
  };
}

function relativeTime(utc?: string): string {
  if (!utc) return '';
  const ms = Date.now() - new Date(utc).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function captureListSignature(list: { captures?: unknown[]; watching?: boolean; captureFolder?: string }): string {
  const caps = (list.captures || []) as Array<Record<string, unknown>>;
  const ids = caps.map(c => String(c.id ?? c.Id ?? '')).join(',');
  return `${!!list.watching}|${list.captureFolder || ''}|${ids}`;
}

export default function CaptureInboxPlugin({
  currentPath,
  embedded = false,
}: {
  selectedPaths?: string[];
  currentPath?: string;
  /** When nested under Drop Stack / Intake -- skip second shell + SaaS stats. */
  embedded?: boolean;
}) {
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureFolder, setCaptureFolder] = useState('');
  const [folderDraft, setFolderDraft] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSnapshotRef = useRef('');
  const folderEditingRef = useRef(false);
  const visibleRef = useRef(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (!visibleRef.current && !opts?.force) return;
    try {
      const list = await IPC.captureInboxList(40);
      const snapshot = captureListSignature(list);
      if (!opts?.force && snapshot === lastSnapshotRef.current) {
        setLastRefreshedAt(Date.now());
        return;
      }
      lastSnapshotRef.current = snapshot;
      setCaptures((list.captures || []).map(c => normalizeCapture(c as Record<string, unknown>)));
      setWatching(!!list.watching);
      const folder = list.captureFolder || '';
      setCaptureFolder(folder);
      if (!folderEditingRef.current) setFolderDraft(folder);
      setLastRefreshedAt(Date.now());
    } catch (e) {
      pushToast({ kind: 'error', title: 'Capture Inbox refresh failed', message: String(e) });
    }
  }, []);

  useEffect(() => () => { void IPC.captureInboxStopWatching(); }, []);

  useEffect(() => { void refresh({ force: true }); }, [refresh]);

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void refresh(); }, watching ? 12000 : 45000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [watching, refresh]);

  const captureNow = async () => {
    setBusy(true);
    try {
      const r = await IPC.captureFromClipboard();
      if (!r.ok) throw new Error(r.error || 'No image on clipboard');
      pushToast({ kind: 'success', title: 'Captured', message: r.entry?.fileName || 'Saved to Capture Inbox' });
      lastSnapshotRef.current = '';
      await refresh({ force: true });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Capture failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleWatch = async () => {
    setBusy(true);
    try {
      if (watching) {
        await IPC.captureInboxStopWatching();
        setWatching(false);
        pushToast({ kind: 'info', title: 'Capture watcher stopped' });
      } else {
        await IPC.captureInboxStartWatching();
        setWatching(true);
        pushToast({ kind: 'success', title: 'Capture watcher enabled', message: 'Clipboard images auto-save with OCR names.' });
      }
    } catch (e) {
      pushToast({ kind: 'error', title: 'Watcher toggle failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveFolder = async () => {
    if (!folderDraft.trim()) return;
    setBusy(true);
    try {
      const r = await IPC.captureInboxSetFolder(folderDraft.trim());
      if (!r.ok) throw new Error('Could not set capture folder');
      setCaptureFolder(r.captureFolder || folderDraft.trim());
      pushToast({ kind: 'success', title: 'Capture folder updated' });
      lastSnapshotRef.current = '';
      await refresh({ force: true });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Folder update failed', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const openFolder = () => {
    if (!captureFolder) return;
    IPC.shellExecute('openExplorer', toWindowsPath(captureFolder));
  };

  const useCurrentFolder = () => {
    if (currentPath) setFolderDraft(toWindowsPath(currentPath));
  };

  const statusHint = watching
    ? 'Watching clipboard images -- file copy/cut is ignored.'
    : 'Manual capture only -- enable Watch to auto-save new screenshots.';
  const refreshedLabel = lastRefreshedAt
    ? (Date.now() - lastRefreshedAt < 60_000 ? 'Synced just now' : `Synced ${relativeTime(new Date(lastRefreshedAt).toISOString())}`)
    : 'Syncing...';

  const body = (
    <>
      <div className="bndz-capture-opsrail">
        <div className="bndz-capture-opsrail-copy min-w-0">
          <div className="bndz-capture-opsrail-title">Captures</div>
          <div className="bndz-capture-opsrail-meta">
            {captures.length} saved | watcher {watching ? 'on' : 'off'} | {refreshedLabel}
          </div>
          <p className="bndz-capture-opsrail-hint">{statusHint}</p>
        </div>
        <div className="bndz-capture-opsrail-actions">
          <PluginToolbarButton onClick={() => void captureNow()} disabled={busy} title="Capture clipboard image now">
            <Icons8Icon id="image_ui" size={14} />
            Capture
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => void toggleWatch()} disabled={busy} title={watching ? 'Stop watching' : 'Watch clipboard'}>
            <Icons8Icon id={watching ? 'toggle_preview' : 'eye_ui'} size={14} className={watching ? 'text-emerald-400' : ''} />
            {watching ? 'Watching' : 'Watch'}
          </PluginToolbarButton>
          <PluginToolbarButton onClick={openFolder} disabled={!captureFolder} title="Open capture folder">
            <Icons8Icon id="folder_open_ui" size={14} />
          </PluginToolbarButton>
          <PluginToolbarButton onClick={() => void refresh({ force: true })} disabled={busy} title="Refresh">
            <Icons8Icon id="refresh_ui" size={14} />
          </PluginToolbarButton>
        </div>
      </div>

      <PluginSectionTitle>Capture folder</PluginSectionTitle>
      <PluginCard className="mb-3">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className={PLUGIN_INPUT_CLASS}
              value={folderDraft}
              onFocus={() => { folderEditingRef.current = true; }}
              onBlur={() => { folderEditingRef.current = false; }}
              onChange={e => setFolderDraft(e.target.value)}
              placeholder="Folder for saved captures..."
            />
            <button type="button" className="bndz-plugin-btn shrink-0" onClick={useCurrentFolder} disabled={!currentPath}>
              Use pane
            </button>
            <button type="button" className="bndz-plugin-btn-primary shrink-0" onClick={() => void saveFolder()} disabled={busy}>
              Save
            </button>
          </div>
          {captureFolder && (
            <p className="text-[10px] text-gray-500 truncate" title={captureFolder}>{captureFolder}</p>
          )}
        </div>
      </PluginCard>

      <PluginSectionTitle>Last captures</PluginSectionTitle>
      {captures.length === 0 ? (
        <PluginEmptyState
          icon="clipboard_ui"
          title="No captures yet"
          message="Copy a screenshot, then click Capture -- watching is off until you enable it, and only new clipboard images are saved."
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {captures.map(cap => (
            <PluginCard key={cap.id} className="!py-2 !px-3">
              <div className="flex items-start gap-2 min-w-0">
                <Icons8Icon id="image_ui" size={16} className="text-violet-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[12px] font-medium truncate" title={cap.fileName}>{cap.suggestedName || cap.fileName}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{relativeTime(cap.capturedUtc)}</span>
                  </div>
                  {cap.ocrPreview && (
                    <p className="text-[10px] text-gray-400 truncate mt-0.5" title={cap.ocrPreview}>{cap.ocrPreview}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                    <span>{formatBytes(cap.size)}</span>
                    <button
                      type="button"
                      className="text-sky-400 hover:text-sky-300"
                      onClick={() => cap.fullPath && IPC.shellExecute('open', toWindowsPath(cap.fullPath))}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="text-sky-400 hover:text-sky-300"
                      onClick={() => cap.fullPath && IPC.shellExecute('openExplorer', toWindowsPath(cap.fullPath))}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
              </div>
            </PluginCard>
          ))}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="flex flex-col h-full min-h-0 overflow-y-auto bndz-scrollbar p-3">{body}</div>;
  }

  return (
    <PluginPanelShell
      title="Capture Inbox"
      subtitle="Clipboard images → named PNG files"
      icon="clipboard_ui"
      variant="embedded"
    >
      {body}
    </PluginPanelShell>
  );
}
