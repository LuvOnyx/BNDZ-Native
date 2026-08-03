import React, { useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { pushToast } from '../ToastHost';
import { toWindowsPath } from '../../lib/pathUtils';

type PathHealIssue = {
  id: string;
  longPath: string;
  issue: string;
  proposedJunction: string;
  shortLinkPath: string;
};

export default function PathHealerPanel({
  rootPath,
  onNavigate,
}: {
  rootPath: string;
  onNavigate?: (path: string) => void;
}) {
  const [issues, setIssues] = useState<PathHealIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);

  const scan = async () => {
    const win = toWindowsPath(rootPath);
    if (!win) return;
    setScanning(true);
    try {
      const res = await IPC.pathHealerScan(win, 200);
      if (!res.ok) throw new Error(res.error || 'Scan failed');
      const rows = (res.issues ?? []).map((raw: Record<string, unknown>) => ({
        id: String(raw.id ?? raw.Id ?? ''),
        longPath: String(raw.longPath ?? raw.LongPath ?? ''),
        issue: String(raw.issue ?? raw.Issue ?? ''),
        proposedJunction: String(raw.proposedJunction ?? raw.ProposedJunction ?? ''),
        shortLinkPath: String(raw.shortLinkPath ?? raw.ShortLinkPath ?? raw.proposedJunction ?? ''),
      }));
      setIssues(rows);
      setSelected(new Set(rows.map(r => r.id)));
      pushToast({ kind: 'info', title: 'Path scan complete', message: `${rows.length} issue(s) found` });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Scan failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setScanning(false);
    }
  };

  const apply = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setApplying(true);
    try {
      const res = await IPC.pathHealerApply(ids, issues);
      if (!res.ok) throw new Error(res.error || 'Apply failed');
      pushToast({
        kind: 'success',
        title: 'Junctions created',
        message: `${res.applied ?? 0} short link(s) under ShortLinks`,
      });
      if (res.errors?.length) {
        pushToast({ kind: 'warning', title: 'Some paths failed', message: res.errors[0] });
      }
      await scan();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Apply failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setApplying(false);
    }
  };

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="bndz-path-healer-panel space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2">
            <Icons8Icon id="link_broken" size={16} />
            Impossible Path Healer
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            Scan for MAX_PATH disasters and approve junction shortenings.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5"
            onClick={() => void scan()}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Scan tree'}
          </button>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-md bg-sky-600/80 hover:bg-sky-500/90 text-white"
            onClick={() => void apply()}
            disabled={applying || selected.size === 0}
          >
            Approve plan ({selected.size})
          </button>
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="text-sm text-gray-500 border border-white/5 rounded-lg p-4 text-center">
          Run a scan on the current folder tree to surface long or invalid paths.
        </div>
      ) : (
        <div className="space-y-2 max-h-[320px] overflow-y-auto bndz-scrollbar">
          {issues.map(item => (
            <label
              key={item.id}
              className="flex gap-3 p-3 rounded-lg border border-white/8 bg-[#1a1a1e]/60 hover:border-sky-500/25 cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-1 accent-sky-500"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-amber-300">{item.issue}</div>
                <div className="text-xs text-gray-200 truncate mt-1 bndz-mono" title={item.longPath}>
                  {item.longPath}
                </div>
                <div className="text-[10px] text-sky-300/80 mt-1 bndz-mono truncate">
                  → {item.shortLinkPath}
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    className="text-[10px] text-gray-400 hover:text-sky-300 mt-1"
                    onClick={e => { e.preventDefault(); onNavigate(item.longPath); }}
                  >
                    Reveal in tree
                  </button>
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
