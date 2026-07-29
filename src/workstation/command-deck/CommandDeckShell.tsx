import React, { useCallback } from 'react';
import CommandDeckMorph from './CommandDeckMorph';
import type { SelectionSignature } from '../selectionSignature';
import type { ContextToolId } from './contextToolRegistry';

type Props = {
  signature: SelectionSignature;
  onTool: (id: ContextToolId) => void;
  enabled?: boolean;
};

export default function CommandDeckShell({ signature, onTool, enabled = true }: Props) {
  const handleTool = useCallback((id: ContextToolId) => onTool(id), [onTool]);

  if (!enabled || signature.kind === 'empty') return null;

  return (
    <div className="bndz-command-deck-shell">
      <CommandDeckMorph signature={signature} onTool={handleTool} />
    </div>
  );
}
