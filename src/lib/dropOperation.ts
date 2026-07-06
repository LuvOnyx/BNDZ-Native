/** Resolve drop operation from drag payload and modifier keys (Explorer-style Ctrl = copy). */
export function resolveDropOperation(opts: {
  payloadCopy?: boolean;
  dropModifierCopy?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): 'copy' | 'move' {
  const copy = !!(opts.payloadCopy || opts.dropModifierCopy || opts.ctrlKey || opts.altKey);
  return copy ? 'copy' : 'move';
}
