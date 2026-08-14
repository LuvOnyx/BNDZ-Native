import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import DriveCard, { type DriveCardData } from '../DriveCard';
import { Icons8Icon } from '../Icons8Icon';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { formatDriveDisplayName } from '../../lib/displayPath';
import { BNDZ_AUTOMATION, BNDZ_CANVAS, BNDZ_HOME } from '../../lib/bndzVirtualViews';

type Props = {
  currentPath?: string;
  onNavigate: (path: string) => void;
};

type Place = { id: string; label: string; path: string; icon: string };

const PLACES: Place[] = [
  { id: 'this-pc', label: 'This PC', path: '/', icon: 'this_pc' },
  { id: 'home', label: 'Home', path: BNDZ_HOME, icon: 'home' },
  { id: 'continuum', label: 'Continuum', path: '/bndz/continuum', icon: 'view_grid' },
  { id: 'workspace-tools', label: 'Workspace Tools', path: BNDZ_CANVAS, icon: 'layers_ui' },
  { id: 'spatial', label: 'Spatial Canvas', path: BNDZ_CANVAS, icon: 'view_grid' },
  { id: 'automation', label: 'Automation', path: BNDZ_AUTOMATION, icon: 'zap_ui' },
  { id: 'desktop', label: 'Desktop', path: '/shell:Desktop', icon: 'monitor_ui' },
  { id: 'docs', label: 'Documents', path: '/shell:Personal', icon: 'file_ui' },
  { id: 'downloads', label: 'Downloads', path: '/shell:Downloads', icon: 'arrow_down_circle_ui' },
];

function normKey(p: string) {
  return (p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * Native-shell sidebar island — glass sections, drive cards, Continuum discoverability.
 * Craft language adapted from Uiverse depth/glass patterns into BNDZ tokens.
 */
export default function NativeShellSidebar({ currentPath, onNavigate }: Props) {
  const [drives, setDrives] = useState<DriveCardData[]>([]);
  const [expanded, setExpanded] = useState({ places: true, drives: true });

  useEffect(() => {
    let cancelled = false;
    const pull = (force = false) => {
      void IPC.getSystemDrives(force ? { force: true } : undefined)
        .then((d) => { if (!cancelled) setDrives(Array.isArray(d) ? d : []); })
        .catch(() => { if (!cancelled) setDrives([]); });
    };
    void IPC.init();
    void IPC.notifyUiReady();
    pull(false);
    const t1 = window.setTimeout(() => pull(true), 1200);
    const t2 = window.setTimeout(() => pull(true), 3200);
    const unsub = IPC.onDrivesChanged((d) => {
      if (!cancelled) setDrives(Array.isArray(d) ? d : []);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      unsub?.();
    };
  }, []);

  const active = useMemo(() => normKey(currentPath || ''), [currentPath]);

  const openPlace = useCallback((place: Place) => {
    onNavigate(place.path);
  }, [onNavigate]);

  return (
    <aside className="bndz-ns-sidebar" aria-label="Navigation">
      <div className="bndz-ns-sidebar-aurora" aria-hidden />
      <header className="bndz-ns-sidebar-brand">
        <span className="bndz-ns-sidebar-mark" />
        <div>
          <div className="bndz-ns-sidebar-title">BNDZ</div>
          <div className="bndz-ns-sidebar-sub">Navigate</div>
        </div>
      </header>

      <section className="bndz-ns-section">
        <button
          type="button"
          className="bndz-ns-section-head"
          onClick={() => setExpanded((s) => ({ ...s, places: !s.places }))}
        >
          <span>Places</span>
          <Icons8Icon id={expanded.places ? 'chevron_down' : 'chevron_right'} size={12} />
        </button>
        {expanded.places && (
          <div className="bndz-ns-section-body">
            {PLACES.map((place) => {
              const selected = active === normKey(place.path)
                || (place.id === 'continuum' && active.includes('bndz'));
              return (
                <button
                  key={place.id}
                  type="button"
                  className={`bndz-ns-place ${selected ? 'is-selected' : ''}`}
                  onClick={() => openPlace(place)}
                >
                  <Icons8Icon id={place.icon} size={14} />
                  <span>{place.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="bndz-ns-section bndz-ns-section--grow">
        <button
          type="button"
          className="bndz-ns-section-head"
          onClick={() => setExpanded((s) => ({ ...s, drives: !s.drives }))}
        >
          <span>Drives</span>
          <Icons8Icon id={expanded.drives ? 'chevron_down' : 'chevron_right'} size={12} />
        </button>
        {expanded.drives && (
          <div className="bndz-ns-section-body bndz-ns-drives">
            {drives.length === 0 ? (
              <div className="bndz-ns-empty">Scanning volumes…</div>
            ) : (
              drives.map((drive) => {
                const selected = active === normKey(drive.name) || active === normKey(drive.path || '');
                return (
                  <button
                    key={drive.name}
                    type="button"
                    className={`bndz-ns-drive-hit ${selected ? 'is-selected' : ''}`}
                    onClick={() => onNavigate(drive.name)}
                    title={formatDriveDisplayName(drive.label, drive.name)}
                  >
                    <DriveCard drive={drive} layout="compact" selected={selected} />
                  </button>
                );
              })
            )}
          </div>
        )}
      </section>

      <footer className="bndz-ns-sidebar-foot">
        <ShellNativeIcon path={currentPath || '/'} isDir size={14} eager />
        <span className="truncate" title={currentPath || ''}>{currentPath || 'This PC'}</span>
      </footer>
    </aside>
  );
}
