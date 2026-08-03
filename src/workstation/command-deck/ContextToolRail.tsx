import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { ContextTool, ContextToolId } from './contextToolRegistry';

type Props = {
  tools: ContextTool[];
  onTool: (id: ContextToolId) => void;
};

/** Horizontal instrument rail — soft squircles, not pill chrome. */
export default function ContextToolRail({ tools, onTool }: Props) {
  if (tools.length === 0) {
    return (
      <div className="bndz-command-deck-empty">
        No tools for this selection
      </div>
    );
  }

  return (
    <div className="bndz-command-deck-rail" role="toolbar" aria-label="Selection tools">
      <AnimatePresence mode="popLayout">
        {tools.map((tool, index) => (
          <motion.button
            key={tool.id}
            type="button"
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.12) }}
            className={`bndz-command-deck-tool${tool.kind === 'host' ? ' bndz-command-deck-tool--host' : ''}`}
            onClick={() => onTool(tool.id)}
            title={tool.label}
          >
            <span className="bndz-command-deck-tool-glyph" aria-hidden>
              <Icons8Icon id={tool.icon} size={14} />
            </span>
            <span className="bndz-command-deck-tool-label">{tool.label}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
