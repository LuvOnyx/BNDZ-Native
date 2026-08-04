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
  PluginHeroStrip,
  PluginHeroActionButton,
  PluginStatCard,
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

export default function CaptureInboxPlugin({
  currentPath,
}: {
  selectedPaths?: string[];
  currentPath?: string;
}) {
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureFolder, setCaptureFolder] = useState('');
  const [folderDraft, setFolderDraft] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([
        IPC.captureInboxList(40),
        IPC.captureInboxStatus(),
      ]);
      setCaptures((list.captures || []).map(c => normalizeCapture(c as Record<string, unknown>)));
      setWatching(!!list.watching || !!status.watching);
      const folder = list.captureFolder || status.captureFolder || '';
      setCaptureFolder(folder);
      setFolderDraft(folder);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Capture Inbox refresh failed', message: String(e) });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void refresh(); }, watching ? 4000 : 12000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [watching, refresh]);

  const captureNow = async () => {
    setBusy(true);
    try {
      const r = await IPC.captureFromClipboard();
      if (!r.ok) throw new Error(r.error || 'No image on clipboard');
      pushToast({ kind: 'success', title: 'Captured', message: r.entry?.fileName || 'Saved to Capture Inbox' });
      await refresh();
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
      await refresh();
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

  return (
    <PluginPanelShell
      title="Capture Inbox"
      subtitle="Clipboard images → named PNG files"
      iconId="clipboard_ui"
      toolbar={(
        <div className="flex items-center gap-1.5">
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
          <PluginToolbarButton onClick={() => void refresh()} disabled={busy} title="Refresh">
            <Icons8Icon id="refresh_ui" size={14} />
          </PluginToolbarButton>
        </div>
      )}
    >
      <PluginHeroStrip accent="#a78bfa">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <PluginHeroActionButton onClick={() => void captureNow()} disabled={busy} accent="#a78bfa">
            <Icons8Icon id="clipboard_ui" size={16} />
            Capture now
          </PluginHeroActionButton>
          <PluginHeroActionButton onClick={() => void toggleWatch()} disabled={busy} accent={watching ? '#34d399' : '#6b7280'}>
            <Icons8Icon id="toggle_preview" size={16} />
            {watching ? 'Watching clipboard' : 'Enable watching'}
          </PluginHeroActionButton>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <PluginStatCard label="Captures" value={String(captures.length)} icon="image_ui" />
          <PluginStatCard label="Watcher" value={watching ? 'On' : 'Off'} icon="eye_ui" accent={watching ? '#34d399' : undefined} />
        </div>
      </PluginHeroStrip>

      <PluginSectionTitle>Capture folder</PluginSectionTitle>
      <PluginCard className="mb-3">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className={PLUGIN_INPUT_CLASS}
              value={folderDraft}
              onChange={e => setFolderDraft(e.target.value)}
              placeholder="Folder for saved captures…"
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
          message="Copy a screenshot or image, then click Capture — or enable watching for automatic saves with OCR-suggested names."
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
    </PluginPanelShell>
  );
}
