import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { formatAddressBarPath } from '../../lib/displayPath';
import { BNDZ_AUTOMATION, BNDZ_CANVAS, BNDZ_HOME } from '../../lib/bndzVirtualViews';
import { IPC } from '../../lib/ipcBridge';

type Props = {
  currentPath?: string;
  onNavigate: (path: string) => void;
  onOpenWorkspace?: (pane: 'automation' | 'canvas' | 'home' | 'settings') => void;
};

type GoItem = { label: string; path?: string; workspace?: 'automation' | 'canvas' | 'home'; icon: string };

const GO_ITEMS: GoItem[] = [
  { label: 'This PC', path: '/', icon: 'this_pc' },
  { label: 'Home', path: BNDZ_HOME, workspace: 'home', icon: 'home' },
  { label: 'Continuum', path: '/bndz/continuum', workspace: 'canvas', icon: 'view_grid' },
  { label: 'Spatial Canvas', path: BNDZ_CANVAS, workspace: 'canvas', icon: 'view_grid' },
  { label: 'Automation', path: BNDZ_AUTOMATION, workspace: 'automation', icon: 'zap_ui' },
  { label: 'Desktop', path: '/shell:Desktop', icon: 'monitor_ui' },
  { label: 'Documents', path: '/shell:Personal', icon: 'file_ui' },
  { label: 'Downloads', path: '/shell:Downloads', icon: 'arrow_down_circle_ui' },
];

/**
 * Top chrome island for BNDZShell split layout — menubar + address + nav.
 * Depth/glass craft adapted from Uiverse into BNDZ soft-squircle language.
 */
export default function NativeShellChrome({ currentPath, onNavigate, onOpenWorkspace }: Props) {
  const [menuOpen, setMenuOpen] = useState<'Go' | 'View' | null>(null);
  const [address, setAddress] = useState(currentPath || '/');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setAddress(currentPath || '/');
  }, [currentPath, editing]);

  useEffect(() => {
    void IPC.init();
    void IPC.notifyUiReady();
  }, []);

  const displayPath = useMemo(
    () => formatAddressBarPath(currentPath || '/') || currentPath || 'This PC',
    [currentPath],
  );

  const go = useCallback((item: GoItem) => {
    setMenuOpen(null);
    if (item.workspace === 'home' || item.label === 'Home') {
      onOpenWorkspace?.('home');
      onNavigate(BNDZ_HOME);
      return;
    }
    if (item.path) onNavigate(item.path);
    else if (item.workspace) onOpenWorkspace?.(item.workspace);
  }, [onNavigate, onOpenWorkspace]);

  const commitAddress = useCallback(() => {
    setEditing(false);
    const next = (address || '').trim();
    if (!next) return;
    onNavigate(next);
  }, [address, onNavigate]);

  const up = useCallback(() => {
    const p = currentPath || '/';
    if (p === '/' || p.startsWith('/bndz/') || p.startsWith('/shell:')) {
      onNavigate('/');
      return;
    }
    const win = p.replace(/\//g, '\\').replace(/\\+$/, '');
    const parent = win.includes('\\') ? win.slice(0, win.lastIndexOf('\\')) : '/';
    onNavigate(parent.length === 2 && parent.endsWith(':') ? parent + '\\' : parent || '/');
  }, [currentPath, onNavigate]);

  return (
    <div className="bndz-ns-chrome" onMouseLeave={() => setMenuOpen(null)}>
      <div className="bndz-ns-chrome-glow" aria-hidden />
      <div className="bndz-ns-menubar">
        <div className="bndz-ns-brand-chip">
          <span className="bndz-ns-brand-mark" />
          <span>BNDZ</span>
        </div>
        <div className="bndz-ns-menu-trigger-wrap">
          <button
            type="button"
            className={`bndz-ns-menu-trigger ${menuOpen === 'Go' ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((m) => (m === 'Go' ? null : 'Go'))}
          >
            Go
          </button>
          {menuOpen === 'Go' && (
            <div className="bndz-ns-menu-flyout" role="menu">
              {GO_ITEMS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="bndz-ns-menu-item"
                  role="menuitem"
                  onMouseDown={(e) => { e.preventDefault(); go(item); }}
                >
                  <Icons8Icon id={item.icon} size={14} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="bndz-ns-menu-trigger"
          onClick={() => onOpenWorkspace?.('settings')}
        >
          Tools
        </button>
      </div>

      <div className="bndz-ns-address-strip">
        <button type="button" className="bndz-ns-nav-btn" title="This PC" onClick={() => onNavigate('/')}>
          <Icons8Icon id="this_pc" size={16} />
        </button>
        <button type="button" className="bndz-ns-nav-btn" title="Up" onClick={up}>
          <Icons8Icon id="nav_up" size={16} />
        </button>
        <button type="button" className="bndz-ns-nav-btn" title="Home" onClick={() => go(GO_ITEMS[1])}>
          <Icons8Icon id="home" size={16} />
        </button>
        <button
          type="button"
          className="bndz-ns-nav-btn bndz-ns-nav-btn--accent"
          title="Continuum"
          onClick={() => go(GO_ITEMS[2])}
        >
          <Icons8Icon id="view_grid" size={16} />
        </button>
        <div className="bndz-ns-address-well">
          {editing ? (
            <input
              className="bndz-ns-address-input"
              value={address}
              autoFocus
              onChange={(e) => setAddress(e.target.value)}
              onBlur={commitAddress}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAddress();
                if (e.key === 'Escape') { setEditing(false); setAddress(currentPath || '/'); }
              }}
            />
          ) : (
            <button type="button" className="bndz-ns-address-display" onClick={() => setEditing(true)}>
              {displayPath}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
