import React, { useState, useEffect } from 'react';
import { Search, Command, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function CommandPalette({ isOpen, onClose }: any) {
    const [query, setQuery] = useState('');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (isOpen) onClose();
                // We rely on BNDZUI to open it, so we shouldn't toggle it directly here unless via callback
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh] bg-black/55 backdrop-blur-md"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.97, opacity: 0, y: -12 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.98, opacity: 0, y: -8 }}
                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                    className="bndz-command-palette w-full max-w-xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60"
                    onClick={(e: any) => e.stopPropagation()}
                >
                    <div className="flex items-center px-4 py-3.5 border-b border-white/8 bg-gradient-to-r from-[#1a1a22]/98 to-[#14141a]/98">
                        <Search size={18} className="text-sky-400/70 mr-3 shrink-0" />
                        <input
                            type="text"
                            autoFocus
                            placeholder="Type a command or search..."
                            className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder-gray-500"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                        <div className="flex items-center gap-1 text-[9px] font-bold text-gray-500 uppercase tracking-widest bg-black/30 border border-white/8 px-2 py-1 rounded-md">
                            <Command size={10} /> K
                        </div>
                    </div>
                    <div className="p-2 min-h-[150px] max-h-[300px] overflow-y-auto styled-scrollbar bg-gradient-to-b from-[#121218]/98 to-[#0e0e14]/98">
                        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600">Suggestions</div>
                        <button className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-sky-500/10 rounded-lg text-left text-gray-300 transition-colors group border border-transparent hover:border-sky-500/20">
                            <div className="flex items-center gap-3">
                                <ArrowRight size={14} className="text-gray-600 group-hover:text-sky-400 transition-colors" />
                                <span className="text-sm">Open Configuration...</span>
                            </div>
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
