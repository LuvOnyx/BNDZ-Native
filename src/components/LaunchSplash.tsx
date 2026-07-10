import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons8Icon } from './Icons8Icon';

const APP_VERSION = '1.0.0';

export default function LaunchSplash({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 900);
    const done = setTimeout(onDone, 1200);
    return () => { clearTimeout(t); clearTimeout(done); };
  }, [onDone]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="fixed inset-0 z-[900] flex items-center justify-center bg-[#0a0a0e]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(0,120,212,0.08),transparent_60%)]" />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 bg-[#2b2b2b] border border-[#454545] flex items-center justify-center">
              <Icons8Icon id="disk_mgmt" size={32} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white tracking-tight">BNDZ</h1>
              <p className="text-[11px] text-gray-500 mt-1 font-mono">v{APP_VERSION} · 64-bit</p>
            </div>
            <motion.div
              className="w-32 h-0.5 rounded-full bg-white/10 overflow-hidden mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <motion.div
                className="h-full bg-[#0078d4]"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 0.75, ease: 'easeOut' }}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
