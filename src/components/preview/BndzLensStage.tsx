/**
 * Lens Stage — content twins, folder orbit, media peers for the focused file.
 * Preview-mounted; does not touch list drag/marquee.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { formatAddressBarPath } from '../../lib/displayPath';
import { toPanePath } from '../../lib/shellPaths';
import { toWindowsPath } from '../../lib/pathUtils';

export type LensItem = {
  path?: string;
  name?: string;
  size?: number;
  modified?: number;
  mediaKind?: string;
  type?: string;
  relation?: string;
  sha256?: string;
};

export type LensStagePayload = {
  focus?: LensItem | null;
  sha256?: string | null;
  twins?: LensItem[];
  orbit?: LensItem[];
  sameSize?: LensItem[];
  mediaPeers?: LensItem[];
  facts?: { camera?: string | null; taken?: string | null; mediaKind?: string | null; size?: number; modified?: number };
  error?: string;
};

type Props = {
  path: string | null | undefined;
  isDir?: boolean;
  onNavigate?: (path: string) => void;
  onOpen?: (path: string) => void;
  onOpenInNewWindow?: (path: string) => void;
  compact?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
};

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Section({
  title,
  hint,
  items,
  empty,
  onOpen,
  onNavigate,
  accent,
}: {
  title: string;
  hint?: string;
  items: LensItem[];
  empty?: string;
  onOpen?: (path: string) => void;
  onNavigate?: (path: string) => void;
  accent: string;
}) {
  if (!items.length) {
    return empty ? (
      <div className="bndz-lens-empty">{empty}</div>
    ) : null;
  }
  return (
    <div className="bndz-lens-section">
      <div className="bndz-lens-section-head">
        <span>{title}</span>
        {hint && <span className="bndz-lens-muted">{hint}</span>}
      </div>
      <div className="bndz-lens-rail">
        {items.map((item, i) => {
          const p = toPanePath(item.path || '');
          const name = item.name || p.split('/').pop() || 'File';
          return (
            <button
              key={p + i}
              type="button"
              className="bndz-lens-tile"
              style={{ ['--lens-accent' as string]: accent }}
              title={formatAddressBarPath(p)}
              onClick={() => onOpen?.(p)}
              onAuxClick={e => {
                if (e.button === 1) {
                  e.preventDefault();
                  onNavigate?.(p.includes('.') ? p.slice(0, p.lastIndexOf('/')) || p : p);
                }
              }}
              onDoubleClick={() => onNavigate?.(p.includes('.') ? parentOf(p) : p)}
            >
              <span className="bndz-lens-tile-thumb">
                <ShellNativeIcon path={p} size={48} preferThumbnail />
              </span>
              <span className="bndz-lens-tile-name">{name}</span>
              {item.size != null && item.size > 0 && (
                <span className="bndz-lens-tile-meta">{formatBytes(item.size)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parentOf(path: string): string {
  const p = toPanePath(path).replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

export default function BndzLensStage({
  path,
  isDir,
  onNavigate,
  onOpen,
  onOpenInNewWindow,
  compact,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<LensStagePayload | null>(null);

  useEffect(() => {
    if (!path || isDir || !IPC.isNative || collapsed) {
      if (!collapsed) setStage(null);
      return;
    }
    let active = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      IPC.getLensStage(path).then(payload => {
        if (!active) return;
        setStage(payload);
        setLoading(false);
      }).catch(() => {
        if (!active) return;
        setStage({ error: 'Lens unavailable.' });
        setLoading(false);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [path, isDir, collapsed]);

  if (!path || isDir) return null;

  const twins = stage?.twins || [];
  const orbit = stage?.orbit || [];
  const sameSize = stage?.sameSize || [];
  const media = stage?.mediaPeers || [];
  const facts = stage?.facts;

  const openFile = (p: string) => {
    if (onOpen) onOpen(p);
    else void IPC.executeContextMenuVerb(toWindowsPath(p), 'open');
  };

  return (
    <div className={`bndz-lens${compact ? ' is-compact' : ''}${collapsed ? ' is-collapsed' : ''}`}>
      <div className="bndz-lens-header">
        <button
          type="button"
          className="bndz-lens-brand bndz-lens-brand-btn"
          title={collapsed ? 'Expand Lens' : 'Collapse Lens — preview goes full height'}
          onClick={() => onToggleCollapsed?.()}
        >
          <span className="bndz-lens-mark" aria-hidden />
          <div>
            <div className="bndz-lens-title">Lens</div>
            {!collapsed && (
              <div className="bndz-lens-sub">
                {loading ? 'Resolving twins…'
                  : twins.length > 0
                    ? `${twins.length} content twin${twins.length === 1 ? '' : 's'}`
                    : 'Orbit · peers · twins'}
              </div>
            )}
          </div>
        </button>
        <div className="bndz-lens-actions">
          {onToggleCollapsed && (
            <button
              type="button"
              className="bndz-lens-chip bndz-lens-chip-quiet"
              title={collapsed ? 'Expand Lens' : 'Hide Lens'}
              aria-expanded={!collapsed}
              onClick={() => onToggleCollapsed()}
            >
              {collapsed ? 'Show' : 'Hide'}
            </button>
          )}
          {!collapsed && onOpenInNewWindow && (
            <button
              type="button"
              className="bndz-lens-chip"
              title="Open containing folder in a new Stage window"
              onClick={() => onOpenInNewWindow(parentOf(toPanePath(path)))}
            >
              Stage
            </button>
          )}
        </div>
      </div>

      {!collapsed && (facts?.camera || facts?.taken || stage?.sha256) && (
        <div className="bndz-lens-facts">
          {facts?.camera && <span>{facts.camera}</span>}
          {facts?.taken && <span>{facts.taken}</span>}
          {stage?.sha256 && (
            <span className="bndz-lens-hash" title={stage.sha256}>SHA-256 · {stage.sha256.slice(0, 12)}…</span>
          )}
        </div>
      )}

      {!collapsed && (
      <AnimatePresence mode="wait">
        {loading && !stage ? (
          <motion.div
            key="load"
            className="bndz-lens-loading"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Icons8Icon id="loading" size={16} spin />
            <span>Building Lens…</span>
          </motion.div>
        ) : (
          <motion.div
            key="body"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="bndz-lens-body"
          >
            <Section
              title="Content twins"
              hint="Identical SHA-256"
              items={twins}
              empty={stage && !loading ? 'No identical copies found in the index size cohort.' : undefined}
              onOpen={openFile}
              onNavigate={onNavigate}
              accent="#34d399"
            />
            <Section
              title="Orbit"
              hint="Same folder"
              items={orbit}
              onOpen={openFile}
              onNavigate={onNavigate}
              accent="#7eb8e8"
            />
            <Section
              title="Media peers"
              hint="Same kind · near size"
              items={media}
              onOpen={openFile}
              onNavigate={onNavigate}
              accent="#c4a35a"
            />
            <Section
              title="Same size"
              hint="Candidate twins"
              items={sameSize}
              onOpen={openFile}
              onNavigate={onNavigate}
              accent="#a78bfa"
            />
            {stage?.error && <div className="bndz-lens-error">{stage.error}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      )}
    </div>
  );
}
