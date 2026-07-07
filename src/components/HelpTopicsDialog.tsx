import React from 'react';
import { motion } from 'framer-motion';
import { Icons8Icon } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';

const TOPICS = [
  { title: 'Navigation', body: 'Use the tree, breadcrumbs, and address bar to move between folders. Dual pane mode lets you compare two locations side by side.' },
  { title: 'File operations', body: 'Cut, copy, paste, and delete work like Explorer. Hold Ctrl or Alt while dropping to copy instead of move.' },
  { title: 'Drag and drop', body: 'Drag files between list panes and the navigation tree. Hold Alt while dragging to start a native OS drag to other applications.' },
  { title: 'Search & filter', body: 'Press / to fuzzy-filter the current folder. Use Everything integration from the Search menu when enabled.' },
  { title: 'Customization', body: 'Open Configuration from the Tools menu to adjust themes, toolbars, previews, and behavior. Use Jump to Setting to find options quickly.' },
  { title: 'Support', body: 'Register your license from Help → Register Product. For assistance, contact support with your order email and serial number.' },
];

export default function HelpTopicsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-[520px] max-h-[85vh] rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e1e28] to-[#12121a] shadow-2xl overflow-hidden flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center">
            <Icons8Icon id="bookopen_ui" size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-bold text-white">Help Topics</h2>
            <p className="text-[10px] text-gray-500">Quick guide to BNDZ</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10">
            <CloseGlyph size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto bndz-scrollbar flex-1">
          {TOPICS.map(t => (
            <div key={t.title} className="rounded-xl border border-white/5 bg-black/20 px-4 py-3">
              <div className="text-[12px] font-semibold text-sky-300 mb-1">{t.title}</div>
              <p className="text-[11px] text-gray-400 leading-relaxed">{t.body}</p>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-white/5 flex justify-end shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[12px]">
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
