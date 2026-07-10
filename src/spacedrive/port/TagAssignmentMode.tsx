/**
 * Spacedrive TagAssignmentMode port — keyboard-driven quick tagging overlay.
 * Source: spacedrive/packages/interface/src/routes/explorer/TagAssignmentMode.tsx
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons8Icon } from '../../components/Icons8Icon';
import { resolveTagKey } from '../../lib/tagUtils';

export type TagPaletteItem = {
  id?: string;
  name?: string;
  label?: string;
  color?: string;
};

type Props = {
  isActive: boolean;
  onExit: () => void;
  tags: TagPaletteItem[];
  selectedCount: number;
  onToggleTag: (tag: TagPaletteItem, index: number) => void;
  tagActiveOnSelection?: (tag: TagPaletteItem) => boolean;
};

export default function TagAssignmentMode({
  isActive,
  onExit,
  tags,
  selectedCount,
  onToggleTag,
  tagActiveOnSelection,
}: Props) {
  const palette = tags.slice(0, 10);

  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
        return;
      }
      const num = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
      if (num >= 0 && num < 10 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = palette[num];
        if (tag) {
          e.preventDefault();
          onToggleTag(tag, num);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, palette, onExit, onToggleTag]);

  if (!isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="sd-tag-assignment-mode absolute bottom-2 left-2 right-2 z-50 border border-[#454545] bg-[#2a2a2a]/95  rounded-md shadow-lg p-3"
      >
        <div className="flex items-center gap-2 mb-2">
          <Icons8Icon id="tag_manager" size={14} className="text-[#7eb8e8]" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-200">Tag mode</span>
          {selectedCount > 0 && (
            <span className="text-[10px] text-gray-500">
              {selectedCount} {selectedCount === 1 ? 'item' : 'items'}
            </span>
          )}
          <button
            type="button"
            onClick={onExit}
            className="ml-auto px-2 py-0.5 text-[11px] bg-[#094771] hover:bg-[#0a5a8c] text-white rounded-sm"
          >
            Done
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {palette.map((tag, index) => {
            const key = resolveTagKey(tag);
            const label = tag.label || tag.name || key;
            const active = tagActiveOnSelection?.(tag) ?? false;
            const number = index === 9 ? 0 : index + 1;
            const color = tag.color || '#3B82F6';
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggleTag(tag, index)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                  active ? 'scale-105 shadow-md' : 'hover:scale-105'
                }`}
                style={{
                  backgroundColor: active ? `${color}40` : `${color}20`,
                  color,
                }}
              >
                <span className="w-4 h-4 flex items-center justify-center rounded bg-black/20 text-[10px] font-bold">
                  {number}
                </span>
                {label}
                {active && <span>✓</span>}
              </button>
            );
          })}
        </div>

        {selectedCount === 0 && (
          <p className="text-[10px] text-gray-500 mt-2">
            Select files to tag · Press 1–9/0 to toggle · Esc to exit
          </p>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
