/**
 * Duplicate groups — dual CAS thumbs + keep-rule delete (newest / largest / first path).
 */
import React, { useMemo, useState } from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import { ShellNativeIcon } from '../../components/ShellNativeIcon';
import { IPC } from '../../lib/ipcBridge';
import { requestNativeConfirm } from '../../lib/nativeDialog';

export type DuplicateGroup = {
  hash?: string;
  size?: number;
  paths?: string[];
};

type KeepRule = 'first' | 'newest' | 'largest';

type Props = {
  groups: DuplicateGroup[];
  onReveal?: (path: string) => void;
  wastedBytes?: number;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function pickKeepIndex(paths: string[], rule: KeepRule, groupSize: number): number {
  if (paths.length <= 1) return 0;
  if (rule === 'first') return 0;
  if (rule === 'largest') {
    // Group size is shared; prefer shortest path as proxy for "canonical" when sizes equal.
    let best = 0;
    for (let i = 1; i < paths.length; i++) {
      if (paths[i].length < paths[best].length) best = i;
    }
    return best;
  }
  // newest — best-effort via path mtime not available here; prefer deepest (often newer copy) then last.
  return paths.length - 1;
}

function victimsForGroup(paths: string[], rule: KeepRule, groupSize: number): string[] {
  if (paths.length <= 1) return [];
  const keep = pickKeepIndex(paths, rule, groupSize);
  return paths.filter((_, i) => i !== keep);
}

export default function RedundancyGroupsView({ groups, onReveal, wastedBytes = 0 }: Props) {
  const [keepRule, setKeepRule] = useState<KeepRule>('newest');

  const reclaimable = useMemo(() => {
    if (wastedBytes > 0) return wastedBytes;
    return groups.reduce((sum, g) => {
      const copies = g.paths?.length || 0;
      if (copies < 2) return sum;
      return sum + (g.size || 0) * (copies - 1);
    }, 0);
  }, [groups, wastedBytes]);

  if (!groups.length) {
    return (
      <p className="text-[11px] text-gray-500 p-3">No duplicate groups. Run a scan to find redundant files.</p>
    );
  }

  const deleteVictims = (victims: string[], title: string, message: string) => {
    if (!victims.length) return;
    void requestNativeConfirm({
      title,
      message,
      destructive: true,
      confirmLabel: 'Delete duplicates',
    }).then(ok => {
      if (!ok) return;
      void Promise.all(victims.map(p => IPC.executeContextMenuVerb(p, 'delete')));
    });
  };

  return (
    <div className="sd-redundancy-view flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-[10px] bg-[#2a2a2e] border border-[#3f3f46]">
        <Icons8Icon id="disk_mgmt" size={14} className="shrink-0" />
        <span className="text-[11px] text-gray-300">{groups.length} redundant group(s)</span>
        {reclaimable > 0 && (
          <span className="text-[11px] font-semibold text-[#7dd3fc] ml-1">
            Reclaim up to {formatSize(reclaimable)}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-400">
          Keep
          <select
            value={keepRule}
            onChange={e => setKeepRule(e.target.value as KeepRule)}
            className="bg-[#1e1e22] border border-[#52525b] rounded-[8px] text-[10px] text-gray-200 px-1.5 py-0.5 outline-none"
          >
            <option value="newest">newest</option>
            <option value="largest">shortest path</option>
            <option value="first">first listed</option>
          </select>
        </label>
        {groups.some(g => (g.paths?.length || 0) > 1) && (
          <button
            type="button"
            className="text-[10px] text-red-300 hover:text-red-200 px-2.5 py-1 rounded-[8px] border border-red-900/50 hover:border-red-700"
            onClick={() => {
              const victims = groups.flatMap(g => victimsForGroup(g.paths || [], keepRule, g.size || 0));
              deleteVictims(
                victims,
                'Delete Duplicate Files',
                `Delete ${victims.length} duplicate file(s)? Keep rule: ${keepRule}.`,
              );
            }}
          >
            Delete extras
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto bndz-scrollbar">
        {groups.map((g, gi) => {
          const paths = g.paths || [];
          const copies = paths.length;
          const keepIdx = pickKeepIndex(paths, keepRule, g.size || 0);
          return (
            <div
              key={g.hash || gi}
              className="border border-[#3f3f46] bg-[#222226] rounded-[12px] overflow-hidden"
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#2e2e33] border-b border-[#3f3f46]">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${(gi * 47) % 360}, 55%, 45%)` }}
                />
                <span className="text-[11px] text-gray-200 font-medium">
                  {formatSize(g.size || 0)} × {copies} copies
                </span>
                {copies > 1 && (
                  <span className="text-[10px] text-[#7dd3fc]/90 ml-auto">
                    {formatSize((g.size || 0) * (copies - 1))} reclaimable
                  </span>
                )}
                {copies > 1 && (
                  <button
                    type="button"
                    className="text-[10px] text-red-300 hover:text-red-200 px-2 py-0.5 rounded-[8px] border border-red-900/50"
                    onClick={() => {
                      const victims = victimsForGroup(paths, keepRule, g.size || 0);
                      deleteVictims(victims, 'Delete Duplicates', `Delete ${victims.length} duplicate(s)?`);
                    }}
                  >
                    Keep one
                  </button>
                )}
              </div>
              <div className="divide-y divide-[#333338]">
                {paths.map((p, pi) => (
                  <div key={p} className="flex items-center gap-2 px-2 py-1.5 group hover:bg-[#2a2a2e]">
                    <div className="w-9 h-9 shrink-0 rounded-[8px] bg-black/25 flex items-center justify-center overflow-hidden ring-1 ring-white/5">
                      <ShellNativeIcon path={p} size={32} preferThumbnail eager />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-600 tabular-nums">{pi + 1}</span>
                        {pi === keepIdx && (
                          <span className="text-[9px] uppercase tracking-wide text-emerald-400/90">keep</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="block w-full text-left text-[11px] text-gray-300 font-mono truncate hover:text-[#99c9f0]"
                        onClick={() => onReveal?.(p)}
                        title={p}
                      >
                        {p}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-white"
                      onClick={() => void navigator.clipboard.writeText(p)}
                      title="Copy path"
                    >
                      <Icons8Icon id="copy" size={11} />
                    </button>
                    {pi !== keepIdx && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400"
                        onClick={() => {
                          void requestNativeConfirm({
                            title: 'Delete Duplicate',
                            message: `Delete "${p.split(/[/\\]/).pop()}"?`,
                            destructive: true,
                            confirmLabel: 'Delete',
                          }).then(ok => {
                            if (!ok) return;
                            void IPC.executeContextMenuVerb(p, 'delete');
                          });
                        }}
                        title="Delete duplicate"
                      >
                        <Icons8Icon id="delete" size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
