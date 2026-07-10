/**
 * Spacedrive redundancy / duplicate groups visual layout.
 * Wired to BNDZ DuplicateFinderService via IPC.scanDuplicates.
 */
import React from 'react';
import { Icons8Icon } from '../../components/Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { requestNativeConfirm } from '../../lib/nativeDialog';

export type DuplicateGroup = {
  hash?: string;
  size?: number;
  paths?: string[];
};

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

export default function RedundancyGroupsView({ groups, onReveal, wastedBytes = 0 }: Props) {
  if (!groups.length) {
    return (
      <p className="text-[11px] text-gray-500 p-3">No duplicate groups. Run a scan to find redundant files.</p>
    );
  }

  return (
    <div className="sd-redundancy-view flex flex-col gap-2">
      <div className="flex items-center gap-2 px-2 py-1 bg-[#2a2a2a] border border-[#454545] text-[11px]">
        <Icons8Icon id="disk_mgmt" size={14} className="shrink-0" />
        <span className="text-gray-300">{groups.length} redundant group(s)</span>
        {wastedBytes > 0 && (
          <span className="text-[#99c9f0]/90 ml-auto">Up to {formatSize(wastedBytes)} recoverable</span>
        )}
        {groups.some(g => (g.paths?.length || 0) > 1) && (
          <button
            type="button"
            className="text-[10px] text-[#7eb8e8] hover:text-[#99c9f0] px-2 py-0.5 border border-[#0078d4]/30 hover:border-[#0078d4] ml-1"
            onClick={() => {
              const victims = groups.flatMap(g => (g.paths || []).slice(1));
              if (!victims.length) return;
              window.dispatchEvent(new CustomEvent('bndz-select-paths', { detail: { paths: victims } }));
            }}
            title="Select all duplicate copies in the file list, keeping one per group unselected"
          >
            Select all except one per group
          </button>
        )}
        {groups.some(g => (g.paths?.length || 0) > 1) && (
          <button
            type="button"
            className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-900/50 hover:border-red-700 ml-1"
            onClick={() => {
              const victims = groups.flatMap(g => (g.paths || []).slice(1));
              if (!victims.length) return;
              void requestNativeConfirm({
                title: 'Delete Duplicate Files',
                message: `Delete ${victims.length} duplicate file(s) across all groups? The first copy in each group will be kept.`,
                destructive: true,
                confirmLabel: 'Delete duplicates',
              }).then(ok => {
                if (!ok) return;
                void Promise.all(victims.map(p => IPC.executeContextMenuVerb(p, 'delete')));
              });
            }}
            title="Delete all duplicates, keeping the first file in each group"
          >
            Keep first in all
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto bndz-scrollbar">
        {groups.map((g, gi) => {
          const paths = g.paths || [];
          const copies = paths.length;
          return (
            <div
              key={g.hash || gi}
              className="border border-[#454545] bg-[#252525] rounded-sm overflow-hidden"
            >
              <div className="flex items-center gap-2 px-2 py-1.5 bg-[#333] border-b border-[#454545]">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(${(gi * 47) % 360}, 55%, 45%)` }}
                />
                <span className="text-[11px] text-gray-200 font-medium">
                  {formatSize(g.size || 0)} × {copies} copies
                </span>
                {copies > 1 && (
                  <span className="text-[10px] text-gray-500 ml-auto">
                    {formatSize((g.size || 0) * (copies - 1))} wasted
                  </span>
                )}
                {copies > 1 && (
                  <button
                    type="button"
                    className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-900/50 hover:border-red-700"
                    onClick={() => {
                      const victims = paths.slice(1);
                      void requestNativeConfirm({
                        title: 'Delete Duplicates',
                        message: `Delete ${victims.length} duplicate file(s)? The first copy will be kept.`,
                        destructive: true,
                        confirmLabel: 'Delete duplicates',
                      }).then(ok => {
                        if (!ok) return;
                        void Promise.all(victims.map(p => IPC.executeContextMenuVerb(p, 'delete')));
                      });
                    }}
                    title="Delete all but the first copy"
                  >
                    Keep first
                  </button>
                )}
              </div>
              <div className="divide-y divide-[#3a3a3a]">
                {paths.map((p, pi) => (
                  <div key={p} className="flex items-center gap-1 px-2 py-1 group hover:bg-[#2a2a2a]">
                    <span className="text-[10px] text-gray-600 w-4 shrink-0">{pi + 1}</span>
                    <button
                      type="button"
                      className="flex-1 text-left text-[11px] text-gray-300 font-mono truncate hover:text-[#99c9f0]"
                      onClick={() => onReveal?.(p)}
                      title={p}
                    >
                      {p}
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-white"
                      onClick={() => void navigator.clipboard.writeText(p)}
                      title="Copy path"
                    >
                      <Icons8Icon id="copy" size={11} />
                    </button>
                    {pi > 0 && (
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
