import React, { useCallback, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import PluginPanelShell from './PluginPanelShell';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { pushToast } from '../ToastHost';
import {
  PluginToolbarButton,
  PluginTabStrip,
  PluginTab,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

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
      subtitle="Binary file and folder diff"
      variant="embedded"
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="compare_ui" size={52} className="opacity-90" />}
          name={pathA && pathB ? 'Compare paths' : 'File & folder compare'}
          typeLabel={mode === 'files' ? 'Binary file diff' : 'Directory diff'}
          meta={
            <span className="bndz-panel-muted text-xs">
              {fileResult?.ok
                ? (fileResult.identical ? 'Files are identical' : 'Files differ')
                : dirResults.length
                  ? `${dirResults.length} difference(s)`
                  : 'Select two paths to compare'}
            </span>
          }
          actions={
            <PluginHeroActionButton
              icon={loading ? 'loading' : 'compare_ui'}
              variant="primary"
              onClick={() => void (mode === 'files' ? runFileCompare() : runDirCompare())}
              disabled={loading || !pathA.trim() || !pathB.trim()}
            >
              Compare
            </PluginHeroActionButton>
          }
        />
        <PluginTabStrip>
          <PluginTab active={mode === 'files'} onClick={() => setMode('files')}>Files</PluginTab>
          <PluginTab active={mode === 'dirs'} onClick={() => setMode('dirs')}>Folders</PluginTab>
        </PluginTabStrip>
        <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
        <div className="grid grid-cols-2 gap-2">
          <input value={pathA} onChange={e => setPathA(e.target.value)} placeholder="Path A" className={PLUGIN_INPUT_CLASS} />
          <input value={pathB} onChange={e => setPathB(e.target.value)} placeholder="Path B" className={PLUGIN_INPUT_CLASS} />
        </div>

        {mode === 'files' && fileResult?.ok && (
          <PluginCard className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar space-y-2">
            <div className={`text-sm font-semibold ${fileResult.identical ? 'text-emerald-400' : 'text-amber-400'}`}>
              {fileResult.identical ? 'Identical files' : 'Files differ'}
            </div>
            <div className="text-xs bndz-panel-muted">SHA-256 A: <span className="text-gray-300 bndz-mono break-all">{fileResult.hashA}</span></div>
            <div className="text-xs bndz-panel-muted">SHA-256 B: <span className="text-gray-300 bndz-mono break-all">{fileResult.hashB}</span></div>
            {!fileResult.identical && fileResult.firstDiffOffset >= 0 && (
              <>
                <div className="text-xs bndz-panel-muted">First difference at byte {fileResult.firstDiffOffset}</div>
                <div className="grid grid-cols-2 gap-2 bndz-mono text-xs">
                  <pre className="bg-black/30 p-2 rounded overflow-x-auto border border-white/[0.06]">{fileResult.previewA || '—'}</pre>
                  <pre className="bg-black/30 p-2 rounded overflow-x-auto border border-white/[0.06]">{fileResult.previewB || '—'}</pre>
                </div>
              </>
            )}
          </PluginCard>
        )}

        {mode === 'dirs' && dirResults.length > 0 && (
          <PluginCard className="flex-1 min-h-0 overflow-y-auto bndz-scrollbar !p-0">
            {dirResults.map(row => (
              <div key={row.id || row.name} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] text-xs">
                <span className={`shrink-0 bndz-plugin-kind-pill ${
                  row.status === 'same' ? 'text-emerald-400 border-emerald-500/30' :
                  row.status === 'different' ? 'text-amber-400 border-amber-500/30' : 'text-gray-500'
                }`}>{row.status}</span>
                <Icons8Icon id="file_ui" size={12} className="shrink-0" />
                <span className="truncate flex-1">{row.name}</span>
              </div>
            ))}
          </PluginCard>
        )}

        {mode === 'dirs' && !loading && dirResults.length === 0 && (
          <PluginEmptyState icon="compare_ui" description="Run folder compare to see diff rows." />
        )}
        </div>
      </div>
    </PluginPanelShell>
  );
}
