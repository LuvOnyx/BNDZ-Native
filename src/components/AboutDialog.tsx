import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, HardDrive, Sparkles, Download, Loader2, ExternalLink } from 'lucide-react';

const FALLBACK_VERSION = '1.0.0';

type UpdateInfo = {
  currentVersion: string;
  latestVersion?: string | null;
  updateAvailable: boolean;
  releaseUrl?: string | null;
  releaseNotes?: string | null;
  error?: string | null;
};

export default function AboutDialog({
  onClose,
  updateCheckUrl,
}: {
  onClose: () => void;
  updateCheckUrl?: string;
}) {
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getAppVersion().then(v => { if (v) setVersion(v); }).catch(() => {});
    });
  }, []);

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateInfo(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const result = await IPC.checkForUpdates(updateCheckUrl);
      setUpdateInfo(result);
      if (result.currentVersion) setVersion(result.currentVersion);
    } catch (err: any) {
      setUpdateInfo({ currentVersion: version, updateAvailable: false, error: err?.message || 'Check failed' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[420px] rounded-2xl border border-white/10 bg-gradient-to-br from-[#1e1e28] to-[#12121a] shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="h-28 bg-gradient-to-br from-sky-600/40 via-violet-600/30 to-transparent relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(56,189,248,0.35),transparent_55%)]" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="absolute bottom-4 left-5 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center shadow-lg">
              <HardDrive size={24} className="text-sky-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">BNDZ</h2>
              <p className="text-[11px] text-sky-200/80">File Manager for Windows</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-gray-500">Version</span>
            <span className="text-white font-mono">{version}</span>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-gray-500">Build</span>
            <span className="text-gray-300">64-bit · WebView2</span>
          </div>

          <div className="pt-2 border-t border-white/5 space-y-2">
            <button
              type="button"
              disabled={checking}
              onClick={() => void checkUpdates()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12px] text-gray-200 transition-colors disabled:opacity-50"
            >
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Check for updates
            </button>
            {updateInfo && (
              <div className="text-[11px] rounded-lg border border-white/5 bg-black/20 p-3 space-y-1.5">
                {updateInfo.updateAvailable ? (
                  <>
                    <p className="text-emerald-400 font-medium">
                      Update available: v{updateInfo.latestVersion}
                    </p>
                    {updateInfo.releaseNotes && (
                      <p className="text-gray-400 line-clamp-4 whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
                    )}
                    {updateInfo.releaseUrl && (
                      <a
                        href={updateInfo.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sky-400 hover:underline"
                      >
                        Download release <ExternalLink size={11} />
                      </a>
                    )}
                  </>
                ) : updateInfo.error ? (
                  <p className="text-amber-400/90">{updateInfo.error}</p>
                ) : (
                  <p className="text-gray-400">You&apos;re on the latest version.</p>
                )}
              </div>
            )}
          </div>

          <p className="text-[12px] text-gray-400 leading-relaxed pt-1 border-t border-white/5">
            Dual-pane navigation, native shell integration, Shift+hover metadata tooltips,
            Folder Sync, Storage Cleanup, Icon Studio, and hundreds of tuning options.
          </p>
          <ul className="text-[11px] text-gray-500 space-y-1 pt-2">
            <li>· Cross-pane drag &amp; drop · Everything search · Virtualized tree &amp; list</li>
            <li>· Rich preview panel · Background file queue · Offline license activation</li>
          </ul>
          <div className="flex items-center gap-2 text-[10px] text-violet-300/80 pt-1">
            <Sparkles size={12} />
            <span>© {new Date().getFullYear()} BNDZ. All rights reserved.</span>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-white/5 bg-black/20 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
