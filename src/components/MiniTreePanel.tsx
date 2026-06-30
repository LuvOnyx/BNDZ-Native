import React from 'react';
import { Folder } from 'lucide-react';
import type { MiniTreeNode } from '../lib/navigationHistory';

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

  return (
    <div className="flex flex-col gap-0.5 min-h-[48px] max-h-[240px] overflow-y-auto bndz-scrollbar px-1 mx-1">
      {nodes.map(node => {
        const active = normActive === node.path || normActive?.startsWith(`${node.path}/`);
        return (
          <button
            key={node.path}
            type="button"
            title={node.path}
            onClick={() => onNavigate(node.path)}
            className={`flex items-center gap-1.5 py-1 pr-2 rounded text-left text-[11px] w-full transition-colors ${
              active ? 'bg-sky-900/40 text-sky-200' : 'text-gray-400 hover:bg-[#222] hover:text-gray-200'
            }`}
            style={{ paddingLeft: 8 + node.depth * 10 }}
          >
            <Folder size={11} className="shrink-0 opacity-70" />
            <span className="truncate">{node.label}</span>
          </button>
        );
      })}
    </div>
  );
}
