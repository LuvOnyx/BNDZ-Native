import React from 'react';
import { Icons8Icon } from './Icons8Icon';
import type { MiniTreeNode } from '../lib/navigationHistory';
import { formatUiPath } from '../lib/displayPath';

type Props = {
  nodes: MiniTreeNode[];
  activePath?: string;
  onNavigate: (path: string) => void;
};

/** XYplorer Mini Tree — folders you've visited, newest first */
export default function MiniTreePanel({ nodes, activePath, onNavigate }: Props) {
  if (!nodes.length) {
    return (
      <div className="px-3 py-2 text-[10px] text-gray-600 italic">
        Visit folders to populate the mini tree.
      </div>
    );
  }

  const normActive = activePath?.replace(/\\/g, '/');

  // No module scrollbar — items show fully; the left sidebar panel scrolls.
  return (
    <div className="flex flex-col gap-0.5 px-1.5 mx-1.5">
      {nodes.map(node => {
        const active = normActive === node.path || normActive?.startsWith(`${node.path}/`);
        return (
          <button
            key={node.path}
            type="button"
            title={formatUiPath(node.path) || node.label}
            onClick={() => onNavigate(node.path)}
            className={`flex items-center gap-1.5 py-1 pr-2 rounded text-left text-[11px] w-full transition-colors ${
              active ? 'bg-[#094771]/40 text-[#cce4f7]' : 'text-gray-400 hover:bg-[#222] hover:text-gray-200'
            }`}
            style={{ paddingLeft: 10 + node.depth * 12 }}
          >
            <Icons8Icon id="explorer" size={11} className="shrink-0 opacity-70" />
            <span className="truncate">{node.label}</span>
          </button>
        );
      })}
    </div>
  );
}
