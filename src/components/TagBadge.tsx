import React from 'react';
import { findTagMeta, type TagDef } from '../lib/tagUtils';
import { TagGlyph } from './TagGlyph';

type Props = {
  tagKey: string;
  catalog?: TagDef[];
  compact?: boolean;
};

export default function TagBadge({ tagKey, catalog = [], compact }: Props) {
  const meta = findTagMeta(tagKey, catalog);
  const label = meta?.label || meta?.name || tagKey;
  const color = meta?.color || '#6b7280';

  return (
    <span
      className={`inline-flex items-center gap-1 shrink-0 rounded-sm border leading-none font-semibold uppercase tracking-wide ${
        compact ? 'text-[8px] px-1 py-[1px]' : 'text-[9px] px-1.5 py-[2px]'
      }`}
      style={{
        color,
        borderColor: `${color}88`,
        backgroundColor: `${color}22`,
      }}
      title={label}
    >
      <TagGlyph color={color} size={compact ? 9 : 11} />
      {label}
    </span>
  );
}
