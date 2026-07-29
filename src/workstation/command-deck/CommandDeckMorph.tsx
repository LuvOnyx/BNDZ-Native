import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { SelectionSignature } from '../selectionSignature';
import { signatureLayoutVariant } from '../selectionSignature';
import { deckBadgeLabel } from './contextToolRegistry';
import ContextToolRail from './ContextToolRail';
import { toolsForSignature, type ContextToolId } from './contextToolRegistry';

type Props = {
  signature: SelectionSignature;
  onTool: (id: ContextToolId) => void;
};

export default function CommandDeckMorph({ signature, onTool }: Props) {
  const variant = signatureLayoutVariant(signature);
  const tools = toolsForSignature(signature);
  const wide = variant === 'wide' || variant === 'fan';
  const morphKey = useMemo(() => {
    if (signature.kind === 'empty') return 'empty';
    if (signature.kind === 'single') return `single:${signature.media}:${signature.path}`;
    return `multi:${signature.count}:${signature.dominantMedia}`;
  }, [signature]);

  return (
    <motion.div
      layout
      key={morphKey}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      className={`bndz-command-deck-island${wide ? ' is-wide' : ''}${variant === 'collapsed' ? ' is-collapsed' : ''}`}
      transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.85 }}
    >
      <div className="bndz-command-deck-aurora" aria-hidden />
      <div className="bndz-command-deck-sheen" aria-hidden />
      <div className="bndz-command-deck-inner">
        <AnimatePresence mode="wait">
          <motion.div
            key={`badge-${morphKey}`}
            className="bndz-command-deck-badge"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.16 }}
          >
            <span className="bndz-command-deck-badge-icon">
              <Icons8Icon id="zap_ui" size={14} />
            </span>
            <span className="truncate">{deckBadgeLabel(signature)}</span>
          </motion.div>
        </AnimatePresence>
        {tools.length > 0 && (
          <ContextToolRail tools={tools} onTool={onTool} />
        )}
      </div>
    </motion.div>
  );
}
