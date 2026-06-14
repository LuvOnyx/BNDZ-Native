import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, FolderOpen, HardDrive, Home, X } from 'lucide-react';
import { IPC } from '../lib/ipcBridge';
import { ShellNativeIcon } from './ShellNativeIcon';
import { joinPanePath, normalizePanePath } from '../lib/pathUtils';
import {
  formatPickerPath,
  getBreadcrumbSegments,
  parseUserPathToPane,
} from '../lib/displayPath';

type DriveInfo = { name: string; label?: string };

type FolderRow = {
  name: string;
  path: string;
  isDrive?: boolean;
};

interface DestinationPickerModalProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (panePath: string) => void;
  drives?: DriveInfo[];
}

export default function DestinationPickerModal({
  open,
  title,
  onCancel,
  onConfirm,
  drives = [],
}: DestinationPickerModalProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [folders, setFolders] = useState<{ name: string; path?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState('/');
  const [pathDraft, setPathDraft] = useState('This PC');
  const [editingPath, setEditingPath] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const navigateTo = useCallback((path: string) => {
    const next = normalizePanePath(path);
    setCurrentPath(next);
    setSelectedPath(next);
    setPathDraft(formatPickerPath(next));
    setPathError(null);
    setEditingPath(false);
  }, []);

  const loadFolders = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const items = await IPC.getDirContents(path);
      const dirs = (items || [])
        .filter((i: { type?: string; isDirectory?: boolean }) => i.type === 'directory' || i.isDirectory)
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
      setFolders(dirs);
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    navigateTo('/');
    void loadFolders('/');
  }, [open, loadFolders, navigateTo]);

  useEffect(() => {
    if (!open) return;
    void loadFolders(currentPath);
    if (!editingPath) {
      setSelectedPath(currentPath);
      setPathDraft(formatPickerPath(currentPath));
    }
  }, [currentPath, open, loadFolders, editingPath]);

  const crumbs = useMemo(() => getBreadcrumbSegments(currentPath), [currentPath]);

  const listRows: FolderRow[] = useMemo(() => {
    if (currentPath === '/' && !folders.length && drives.length) {
      return drives.map(d => ({
        name: d.label || d.name.replace(/^\//, ''),
        path: normalizePanePath(d.name),
        isDrive: true,
      }));
    }
    return folders.map(f => ({
      name: f.name,
      path: f.path ? normalizePanePath(f.path) : joinPanePath(currentPath, { name: f.name }),
      isDrive: false,
    }));
  }, [currentPath, folders, drives]);

  const commitPathDraft = async () => {
    const parsed = parseUserPathToPane(pathDraft);
    if (!parsed) {
      setPathError('Could not parse that path');
      return;
    }
    setPathError(null);
    navigateTo(parsed);
    const exists = await IPC.checkPathExists(parsed);
    if (!exists && parsed !== '/') {
      setPathError('Path not found — check spelling or paste a full folder path');
    }
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.replace(/^\//, '').split('/').filter(Boolean);
    parts.pop();
    navigateTo(parts.length ? '/' + parts.join('/') : '/');
  };

  const rowClass = (path: string) => {
    const active = normalizePanePath(selectedPath) === normalizePanePath(path);
    return `bndz-destination-row w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[12px] transition-colors ${
      active ? 'bndz-destination-row-active' : ''
    }`;
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-6 bndz-destination-picker"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150" />
      <div
        className="bndz-destination-picker-modal relative w-full max-w-[780px] max-h-[min(580px,82vh)] rounded-2xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="destination-picker-title"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bndz-destination-picker-header px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 id="destination-picker-title" className="text-[15px] font-bold tracking-tight">{title}</h2>
            <p className="text-[10px] bndz-destination-muted mt-0.5">Browse or paste a folder path (e.g. C:\Users\Documents)</p>
          </div>
          <button type="button" className="bndz-destination-icon-btn p-1.5 rounded-md" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 min-h-[320px]">
          <div className="bndz-destination-sidebar w-[200px] shrink-0 overflow-y-auto styled-scrollbar py-2 px-1.5">
            <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest bndz-destination-muted mb-1">Locations</div>
            <button
              type="button"
              className={rowClass('/')}
              onClick={() => navigateTo('/')}
              onDoubleClick={() => navigateTo('/')}
            >
              <Home size={14} className="text-sky-400 shrink-0" />
              <span className="truncate font-medium">This PC</span>
            </button>
            {drives.map(d => {
              const drivePath = normalizePanePath(d.name);
              return (
                <button
                  key={d.name}
                  type="button"
                  className={rowClass(drivePath)}
                  onClick={() => navigateTo(drivePath)}
                  onDoubleClick={() => navigateTo(drivePath)}
                >
                  <HardDrive size={14} className="text-emerald-400/80 shrink-0" />
                  <span className="truncate">{d.label || d.name.replace(/^\//, '')}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            <div className="bndz-destination-pathbar px-3 py-2 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="bndz-destination-path-input flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] font-mono"
                  value={pathDraft}
                  onChange={e => { setPathDraft(e.target.value); setPathError(null); }}
                  onFocus={() => setEditingPath(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitPathDraft();
                    if (e.key === 'Escape') {
                      setEditingPath(false);
                      setPathDraft(formatPickerPath(selectedPath));
                      setPathError(null);
                    }
                  }}
                  spellCheck={false}
                  aria-label="Destination folder path"
                  placeholder="C:\Users\… or paste a path"
                />
                <button
                  type="button"
                  className="bndz-destination-go-btn px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide shrink-0"
                  onClick={() => void commitPathDraft()}
                >
                  Go
                </button>
              </div>
              {pathError && <div className="text-[10px] text-amber-400/90 px-1">{pathError}</div>}
              <div className="flex items-center gap-1 flex-wrap text-[10px] bndz-destination-muted">
                {crumbs.map((c, i) => (
                  <React.Fragment key={c.path}>
                    {i > 0 && <ChevronRight size={10} className="opacity-40 shrink-0" />}
                    <button
                      type="button"
                      className="hover:text-white truncate max-w-[140px] px-1 py-0.5 rounded bndz-destination-crumb"
                      onClick={() => navigateTo(c.path)}
                    >
                      {c.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto styled-scrollbar p-2">
              {currentPath !== '/' && (
                <button
                  type="button"
                  className="bndz-destination-row w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] mb-1"
                  onClick={goUp}
                >
                  <ArrowUp size={14} className="opacity-60" />
                  <span>Parent folder</span>
                </button>
              )}
              {loading ? (
                <div className="px-3 py-10 text-center text-[11px] bndz-destination-muted">Loading folders…</div>
              ) : listRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 bndz-destination-muted gap-2">
                  <FolderOpen size={28} className="opacity-30" />
                  <span className="text-[11px]">No subfolders — select this folder as destination</span>
                </div>
              ) : (
                listRows.map(row => (
                  <button
                    key={row.path}
                    type="button"
                    className={rowClass(row.path)}
                    onClick={() => setSelectedPath(row.path)}
                    onDoubleClick={() => navigateTo(row.path)}
                  >
                    {row.isDrive ? (
                      <ShellNativeIcon path={row.path} size={16} eager />
                    ) : (
                      <ShellNativeIcon path={row.path} isDir size={16} eager />
                    )}
                    <span className="truncate">{row.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="bndz-destination-picker-footer px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="text-[11px] bndz-destination-muted truncate flex-1 min-w-0">
            <span>Destination: </span>
            <span className="font-mono">{formatPickerPath(selectedPath)}</span>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="bndz-destination-cancel-btn px-3.5 py-1.5 text-[11px] font-semibold rounded-lg" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="bndz-destination-confirm-btn px-4 py-1.5 text-[11px] font-bold rounded-lg"
              onClick={() => onConfirm(selectedPath)}
            >
              Select folder
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
