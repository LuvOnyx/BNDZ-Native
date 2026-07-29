import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { ContextTool, ContextToolId } from './contextToolRegistry';

type Props = {
  tools: ContextTool[];
  onTool: (id: ContextToolId) => void;
};

export default function ContextToolRail({ tools, onTool }: Props) {
  return (
    <div className="flex items-center gap-1 flex-wrap min-w-0">
      <AnimatePresence mode="popLayout">
        {tools.map((tool, index) => (
          <motion.button
            key={tool.id}
            type="button"
            layout
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 2 }}
            transition={{ duration: 0.18, delay: index * 0.025 }}
            className="bndz-command-deck-chip shrink-0"
            onClick={() => onTool(tool.id)}
            title={tool.label}
          >
            <Icons8Icon id={tool.icon} size={12} />
            <span>{tool.label}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
