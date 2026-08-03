import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icons8Icon } from '../../components/Icons8Icon';
import type { SelectionSignature } from '../selectionSignature';
import { signatureLayoutVariant } from '../selectionSignature';
import {
  deckBadgeLabel,
  filterToolsForInstalled,
  toolsForSignature,
  type ContextToolId,
} from './contextToolRegistry';
import ContextToolRail from './ContextToolRail';

type Props = {
  signature: SelectionSignature;
  onTool: (id: ContextToolId) => void;
  /** Installed bottom-plugin ids — tools requiring a missing plugin are hidden. */
  installedPluginIds?: readonly string[];
  /** Current pane path — used to gate path-sensitive tools (e.g. flush-ram-zone). */
  currentPath?: string;
};

export default function CommandDeckMorph({ signature, onTool, installedPluginIds, currentPath }: Props) {
  const variant = signatureLayoutVariant(signature);
  const installedSet = useMemo(
    () => new Set(installedPluginIds || []),
    [installedPluginIds],
  );
  const tools = useMemo(() => {
    let ts = filterToolsForInstalled(toolsForSignature(signature), installedSet);
    // flush-ram-zone is only meaningful when currently browsing a RAM staging path.
    if (!currentPath?.startsWith('/bndz/ram')) {
      ts = ts.filter(t => t.id !== 'flush-ram-zone');
    }
    return ts;
  }, [signature, installedSet, currentPath]);
  const wide = variant === 'wide' || variant === 'fan';
  const morphKey = useMemo(() => {
    if (signature.kind === 'empty') return 'empty';
    if (signature.kind === 'single') return `single:${signature.media}:${signature.path}`;
    return `multi:${signature.count}:${signature.dominantMedia}`;
  }, [signature]);

  const mediaHint = signature.kind === 'single'
    ? signature.media
    : signature.kind === 'multi'
      ? signature.dominantMedia
      : null;

  return (
    <motion.div
      layout
      key={morphKey}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      className={`bndz-command-deck-island${wide ? ' is-wide' : ''}${variant === 'collapsed' ? ' is-collapsed' : ''}`}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }}
    >
      <div className="bndz-command-deck-paper" aria-hidden />
      <div className="bndz-command-deck-edge" aria-hidden />
      <div className="bndz-command-deck-inner">
        <AnimatePresence mode="wait">
          <motion.div
            key={`badge-${morphKey}`}
            className="bndz-command-deck-badge"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.14 }}
          >
            <span className="bndz-command-deck-badge-icon">
              <Icons8Icon id="zap_ui" size={13} />
            </span>
            <div className="bndz-command-deck-badge-text min-w-0">
              <span className="bndz-command-deck-badge-title truncate">{deckBadgeLabel(signature)}</span>
              {mediaHint && mediaHint !== 'folder' && mediaHint !== 'generic' && (
                <span className="bndz-command-deck-badge-meta">{mediaHint}</span>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="bndz-command-deck-divider" aria-hidden />
        <ContextToolRail tools={tools} onTool={onTool} />
      </div>
    </motion.div>
  );
}
