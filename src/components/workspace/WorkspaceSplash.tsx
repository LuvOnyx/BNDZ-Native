import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Icons8Icon } from '../Icons8Icon';

type Feature = { icon: string; title: string; desc: string };

type Props = {
  workspaceId: string;
  title: string;
  eyebrow?: string;
  subtitle: string;
  icon: string;
  accent: string;
  features: Feature[];
  onDismiss: () => void;
};

const STORAGE_PREFIX = 'bndz_ws_splash_seen_';
const EMPTY_HINT_PREFIX = 'bndz_ws_splash_empty_';

export type WorkspaceSplashOptions = {
  /** Workspace data finished loading — avoids flashing splash during async hydrate. */
  isReady?: boolean;
  /** True when board/graph has zero pins/blocks. */
  isEmpty?: boolean;
  /** Re-show empty-board intro each time the workspace view mounts. */
  resetEmptyHintOnMount?: boolean;
};

export function useWorkspaceSplash(workspaceId: string, opts?: WorkspaceSplashOptions) {
  const isReady = opts?.isReady ?? true;
  const isEmpty = opts?.isEmpty ?? false;
  const resetEmptyHintOnMount = opts?.resetEmptyHintOnMount ?? false;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!resetEmptyHintOnMount) return;
    try { sessionStorage.removeItem(EMPTY_HINT_PREFIX + workspaceId); } catch { /* */ }
  }, [workspaceId, resetEmptyHintOnMount]);

  useEffect(() => {
    if (!isReady) {
      setVisible(false);
      return;
    }
    try {
      const seenIntro = localStorage.getItem(STORAGE_PREFIX + workspaceId);
      const seenEmptyHint = sessionStorage.getItem(EMPTY_HINT_PREFIX + workspaceId);
      if (!seenIntro) {
        setVisible(true);
        return;
      }
      if (isEmpty && seenEmptyHint !== '1') {
        setVisible(true);
      } else {
        setVisible(false);
      }
    } catch {
      setVisible(true);
    }
  }, [workspaceId, isEmpty, isReady]);

  const dismiss = (remember = true) => {
    if (remember) {
      try {
        localStorage.setItem(STORAGE_PREFIX + workspaceId, '1');
        if (isEmpty) sessionStorage.setItem(EMPTY_HINT_PREFIX + workspaceId, '1');
      } catch { /* */ }
    }
    setVisible(false);
  };

  const replay = () => setVisible(true);

  return { visible, dismiss, replay };
}

export default function WorkspaceSplash({
  workspaceId,
  title,
  eyebrow = 'Workspace',
  subtitle,
  icon,
  accent,
  features,
  onDismiss,
}: Props) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 120);
    const t2 = setTimeout(() => setPhase(2), 380);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [workspaceId]);

  return (
    <motion.div
      className="bndz-ws-splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{ ['--ws-accent' as string]: accent }}
    >
      <div className="bndz-ws-splash-aurora" aria-hidden />
      <div className="bndz-ws-splash-grain" aria-hidden />

      <motion.div
        className="bndz-ws-splash-card"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="bndz-ws-splash-medallion" aria-hidden>
          <span className="bndz-ws-splash-ring" />
          <span className="bndz-ws-splash-icon-wrap">
            <Icons8Icon id={icon} size={36} />
          </span>
        </div>

        <p className="bndz-ws-splash-eyebrow">{eyebrow}</p>
        <h2 className="bndz-ws-splash-title">{title}</h2>
        <p className="bndz-ws-splash-sub">{subtitle}</p>

        <div className={`bndz-ws-splash-features${phase >= 1 ? ' is-visible' : ''}`}>
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="bndz-ws-splash-feature"
              initial={{ opacity: 0, x: -8 }}
              animate={phase >= 2 ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.07, duration: 0.35 }}
            >
              <span className="bndz-ws-splash-feature-icon"><Icons8Icon id={f.icon} size={16} /></span>
              <span className="bndz-ws-splash-feature-body">
                <span className="bndz-ws-splash-feature-title">{f.title}</span>
                <span className="bndz-ws-splash-feature-desc">{f.desc}</span>
              </span>
            </motion.div>
          ))}
        </div>

        <div className="bndz-ws-splash-actions">
          <button type="button" className="bndz-ws-splash-cta" onClick={() => onDismiss()}>
            Enter workspace
          </button>
          <button
            type="button"
            className="bndz-ws-splash-skip"
            onClick={() => onDismiss()}
          >
            Skip intro
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
