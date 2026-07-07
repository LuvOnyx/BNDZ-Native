import React, { useCallback, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';

export const ComparePluginDef = {
  id: 'compare',
  name: 'Compare',
  icon: 'compare_ui',
  targetPanel: 'bottom' as const,
  installOnFirstUse: false,
};

type Props = {
  selectedPaths?: string[];
  focusedPath?: string;
  onNavigate?: (path: string) => void;
};

export default function ComparePlugin({ selectedPaths = [], focusedPath }: Props) {
  const [pathA, setPathA] = useState('');
  const [pathB, setPathB] = useState('');
  const [loading, setLoading] = useState(false);
  const [dirResults, setDirResults] = useState<any[]>([]);
  const [fileResult, setFileResult] = useState<any>(null);
  const [mode, setMode] = useState<'files' | 'dirs'>('files');

  React.useEffect(() => {
    if (selectedPaths.length >= 2) {
      setPathA(toWindowsPath(selectedPaths[0]));
      setPathB(toWindowsPath(selectedPaths[1]));
    } else if (selectedPaths.length === 1) {
      setPathA(toWindowsPath(selectedPaths[0]));
    } else if (focusedPath) {
      setPathA(toWindowsPath(focusedPath));
    }
  }, [selectedPaths, focusedPath]);

  const runFileCompare = useCallback(async () => {
    if (!pathA.trim() || !pathB.trim()) {
      pushToast({ kind: 'warning', title: 'Compare', message: 'Select two files to compare.' });
      return;
    }
    setLoading(true);
    setFileResult(null);
    try {
      const r = await IPC.compareFiles(pathA, pathB);
      setFileResult(r);
      if (r.ok) {
        pushToast({
          kind: r.identical ? 'success' : 'info',
          title: 'File compare',
          message: r.identical ? 'Files are identical.' : 'Files differ.',
        });
      }
    } catch {
      pushToast({ kind: 'error', title: 'Compare failed', message: 'Could not compare files.' });
    } finally {
      setLoading(false);
    }
  }, [pathA, pathB]);

  const runDirCompare = useCallback(async () => {
    if (!pathA.trim() || !pathB.trim()) return;
    setLoading(true);
    setDirResults([]);
    try {
      const items = await IPC.compareDirectories(pathA, pathB, true);
      setDirResults(Array.isArray(items) ? items : []);
    } catch {
      pushToast({ kind: 'error', title: 'Compare failed', message: 'Directory compare failed.' });
    } finally {
      setLoading(false);
    }
  }, [pathA, pathB]);

  return (
    <PluginPanelShell
      title="Compare"
      icon="compare_ui"
      iconColor="#34d399"
      subtitle="XYplorer-style binary file & folder diff"
      variant="embedded"
      toolbar={
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode('files')}
            className={`px-2 py-1 text-[10px] uppercase font-bold rounded ${mode === 'files' ? 'bg-emerald-900/50 text-emerald-200' : 'text-gray-500'}`}
          >
            Files
          </button>
          <button
            type="button"
            onClick={() => setMode('dirs')}
            className={`px-2 py-1 text-[10px] uppercase font-bold rounded ${mode === 'dirs' ? 'bg-emerald-900/50 text-emerald-200' : 'text-gray-500'}`}
          >
            Folders
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full min-h-0 p-3 gap-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={pathA}
            onChange={e => setPathA(e.target.value)}
            placeholder="Path A"
            className="bg-[#111] border border-[#333] rounded px-2 py-1.5 text-[11px] text-gray-200"
          />
          <input
            value={pathB}
            onChange={e => setPathB(e.target.value)}
            placeholder="Path B"
            className="bg-[#111] border border-[#333] rounded px-2 py-1.5 text-[11px] text-gray-200"
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void (mode === 'files' ? runFileCompare() : runDirCompare())}
          className="self-start flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold"
        >
          {loading ? <Icons8Icon id="loading" size={12} spin /> : <Icons8Icon id="compare_ui" size={12} />}
          Compare
        </button>

        {mode === 'files' && fileResult?.ok && (
          <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar border border-[#222] rounded p-3 text-[11px] space-y-2">
            <div className={fileResult.identical ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              {fileResult.identical ? 'Identical files' : 'Files differ'}
            </div>
            <div className="text-gray-400">SHA-256 A: <span className="text-gray-300 font-mono break-all">{fileResult.hashA}</span></div>
            <div className="text-gray-400">SHA-256 B: <span className="text-gray-300 font-mono break-all">{fileResult.hashB}</span></div>
            {!fileResult.identical && fileResult.firstDiffOffset >= 0 && (
              <>
                <div className="text-gray-500">First difference at byte {fileResult.firstDiffOffset}</div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <pre className="bg-[#0a0a0a] p-2 rounded overflow-x-auto">{fileResult.previewA || '—'}</pre>
                  <pre className="bg-[#0a0a0a] p-2 rounded overflow-x-auto">{fileResult.previewB || '—'}</pre>
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'dirs' && dirResults.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar border border-[#222] rounded">
            {dirResults.map(row => (
              <div key={row.id || row.name} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.04] text-[11px]">
                <span className={`shrink-0 w-16 uppercase text-[10px] ${
                  row.status === 'same' ? 'text-emerald-400' :
                  row.status === 'different' ? 'text-amber-400' : 'text-gray-500'
                }`}>{row.status}</span>
                <Icons8Icon id="file_ui" size={12} className="shrink-0" />
                <span className="truncate flex-1">{row.name}</span>
              </div>
            ))}
          </div>
        )}

        {mode === 'dirs' && !loading && dirResults.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-6 flex flex-col items-center gap-2">
            <Icons8Icon id="compare_ui" size={20} className="opacity-40" />
            Run folder compare to see diff rows
          </div>
        )}
      </div>
    </PluginPanelShell>
  );
}
