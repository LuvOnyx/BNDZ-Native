import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ShellNativeIcon } from '../ShellNativeIcon';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { BNDZ_HOME, BNDZ_RECENT, BNDZ_VIEWS_ROOT, BNDZ_CANVAS, BNDZ_AUTOMATION } from '../../lib/bndzVirtualViews';
import WorkspaceLaunchCard from '../workspace/WorkspaceLaunchCard';
import {
  getHomeDeckCache, setHomeDeckCache, isHomeDeckBodyFresh, isHomeDeckPulseFresh,
} from '../../lib/homeDeckCache';
import type { NavVisit } from '../../lib/navigationHistory';
import { resolveUserPathToPane, formatAddressBarPath } from '../../lib/displayPath';
import { toPanePath } from '../../lib/shellPaths';
import { getGhostTrail, subscribeGhostTrail, type GhostTrailEntry } from '../../lib/ghostTrail';
import { loadSmartCollections } from '../../lib/smartCollections';

type ContinuumItem = {
  id?: string;
  name?: string;
  path?: string;
  type?: string;
  size?: number;
  mediaKind?: string;
  modified?: number;
  openCount?: number;
};

type PlacePlate = {
  name: string;
  path: string;
  icon?: string;
  letter?: string;
  hint?: string;
  kind: 'place' | 'drive';
  freeRatio?: number;
  freeLabel?: string;
};

type FocusStage = {
  path: string;
  name: string;
  kind: 'focus' | 'clipboard' | 'preview';
} | null;

type OmniSuggestion = {
  id: string;
  label: string;
  sub?: string;
  path: string;
  kind: 'place' | 'continuum' | 'collection' | 'alias' | 'ghost';
};

type Props = {
  onNavigate: (path: string) => void;
  onOpenPath: (path: string, meta?: { type?: 'file' | 'directory' }) => void;
  onOpenInNewTab?: (path: string) => void;
  onOpenOpposite?: (path: string) => void;
  onRevealFolder?: (path: string) => void;
  onIndexInvite?: () => void;
  /** Space / Quick Look for Continuum focus (sibling strip + focused rail item). */
  onQuickLook?: (items: Array<{ path: string; name: string; type?: string }>, startIndex: number) => void;
  focusStage?: FocusStage;
  navigationHistory?: NavVisit[];
};

function placeLetter(name: string, explicit?: string): string {
  if (explicit && /^[A-Z]$/i.test(explicit)) return explicit.toUpperCase();
  const c = (name || '?').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '?';
}

function parentPane(path: string): string {
  const p = toPanePath(path).replace(/\/+$/, '');
  if (/^\/[A-Za-z]:$/.test(p) || p === '/' || p === '//') return '/';
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)}${u[i]}`;
}

function accessBadge(openCount?: number, navHits?: number): string | null {
  if ((openCount ?? 0) >= 10) return 'Hot';
  if ((openCount ?? 0) >= 4) return 'Often';
  if ((navHits ?? 0) >= 6) return 'Frequent';
  if ((navHits ?? 0) >= 3) return 'Regular';
  return null;
}

function mediaAccent(kind?: string): string {
  switch (kind) {
    case 'image': return '#7eb8e8';
    case 'video': return '#c4a35a';
    case 'audio': return '#34d399';
    case 'document': return '#60a5fa';
    default: return 'rgba(255,255,255,0.22)';
  }
}

export default function BndzHomeView({
  onNavigate,
  onOpenPath,
  onOpenInNewTab,
  onOpenOpposite,
  onRevealFolder,
  onIndexInvite,
  onQuickLook,
  focusStage,
  navigationHistory = [],
}: Props) {
  const reduceMotion = useReducedMotion();
  const omniboxRef = useRef<HTMLInputElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [omnibox, setOmnibox] = useState('');
  const [suggestIx, setSuggestIx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [continuum, setContinuum] = useState<ContinuumItem[]>([]);
  const [places, setPlaces] = useState<PlacePlate[]>([]);
  const [orbits, setOrbits] = useState<Record<string, ContinuumItem[]>>({});
  const [pulseLabel, setPulseLabel] = useState('Idle');
  const [pulseWarmth, setPulseWarmth] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [library, setLibrary] = useState<{ images?: number; videos?: number; audio?: number; documents?: number }>({});
  const [spatialArmed, setSpatialArmed] = useState(false);
  const [ghost, setGhost] = useState<GhostTrailEntry[]>(() => getGhostTrail());
  const [railFocus, setRailFocus] = useState(0);

  const [mostOpened, setMostOpened] = useState<ContinuumItem[]>([]);
  const [deckSyncing, setDeckSyncing] = useState(false);
  const fingerprintRef = useRef<string | undefined>(undefined);

  const applyDeck = useCallback((deck: any, mergeBody = true) => {
    if (mergeBody) {
      if (deck.continuum) setContinuum(deck.continuum || []);
      if (deck.orbits) setOrbits(deck.orbits || {});
      if (deck.library) setLibrary(deck.library || {});
      if (deck.mostOpened) setMostOpened(deck.mostOpened || []);
      if (deck.continuumFingerprint) fingerprintRef.current = deck.continuumFingerprint;
    }
    setFileCount(deck.index?.fileCount ?? 0);
    const warmth = Math.min(1,
      ((deck.pulse?.activeCount || 0) * 0.38)
      + ((deck.pulse?.queuedCount || 0) * 0.12)
      + Math.min(0.42, (deck.index?.fileCount || 0) / 90000));
    setPulseWarmth(warmth);
    setPulseLabel(deck.pulse?.label || 'Idle');

    const placeRows: PlacePlate[] = (deck.places || []).map((p: any) => ({
      name: p.name,
      path: toPanePath(p.path),
      icon: p.icon,
      letter: p.letter,
      hint: p.hint,
      kind: 'place' as const,
    }));
    const driveRows: PlacePlate[] = (deck.drives || [])
      .filter((d: any) => !d?.isCloudVolume)
      .slice(0, 8)
      .map((d: any) => {
        const name = String(d.name || d.label || 'Drive');
        const letter = (name.match(/[A-Za-z]/)?.[0] || 'C').toUpperCase();
        const total = Number(d.totalSpace) || 0;
        const free = Number(d.freeSpace) || 0;
        const freeRatio = total > 0 ? free / total : undefined;
        return {
          name: d.label ? `${letter}: · ${d.label}` : `${letter}:`,
          path: toPanePath(name.startsWith('/') ? name : `/${name}`),
          letter,
          kind: 'drive' as const,
          freeRatio,
          freeLabel: total > 0 ? `${formatBytes(free)} free` : undefined,
          hint: d.label || `${letter}:`,
        };
      });
    setPlaces([...placeRows, ...driveRows]);
    setHomeDeckCache(deck);
  }, []);

  const refreshDeck = useCallback((force = false) => {
    if (!IPC.isNative) {
      setLoading(false);
      return;
    }

    const cached = getHomeDeckCache();
    if (cached && !force) {
      applyDeck(cached, true);
      setLoading(false);
    } else if (force && !cached) {
      setLoading(true);
    }

    const sinceFp = force ? undefined : (fingerprintRef.current || cached?.continuumFingerprint);
    const pulseOnly = !force && !!cached && isHomeDeckBodyFresh() && !isHomeDeckPulseFresh();

    if (!force && cached && isHomeDeckBodyFresh()) {
      setDeckSyncing(false);
      IPC.getHomeDeck({ continuumLimit: 32, orbitLimit: 6, sinceFingerprint: sinceFp, pulseOnly: true }).then(deck => {
        if (deck.unchanged) applyDeck({ ...cached, ...deck, continuum: cached.continuum, orbits: cached.orbits, library: cached.library, mostOpened: cached.mostOpened }, false);
        else applyDeck({ ...cached, ...deck }, true);
      }).finally(() => setLoading(false));
      return;
    }

    if (!cached || force) setDeckSyncing(true);
    IPC.getHomeDeck({
      continuumLimit: 32,
      orbitLimit: 6,
      sinceFingerprint: force ? undefined : sinceFp,
    }).then(deck => {
      if (deck.unchanged && cached) {
        applyDeck({ ...cached, ...deck, continuum: cached.continuum, orbits: cached.orbits, library: cached.library, mostOpened: cached.mostOpened }, false);
      } else {
        applyDeck(deck, true);
      }
    }).finally(() => {
      setLoading(false);
      setDeckSyncing(false);
    });
  }, [applyDeck]);

  useEffect(() => {
    const cached = getHomeDeckCache();
    if (cached) {
      applyDeck(cached, true);
      setLoading(false);
    }
    refreshDeck(!cached);
    // Never leave Continuum stuck on "Loading…" if IPC hangs in headless host.
    const failsafe = window.setTimeout(() => {
      setLoading(false);
      setDeckSyncing(false);
    }, 8000);
    const unsubQ = IPC.onFileTransferQueueChanged(() => refreshDeck(false));
    const unsubG = subscribeGhostTrail(() => setGhost(getGhostTrail()));
    return () => {
      window.clearTimeout(failsafe);
      unsubQ();
      unsubG();
    };
  }, [refreshDeck, applyDeck]);

  const suggestions = useMemo((): OmniSuggestion[] => {
    const q = omnibox.trim().toLowerCase();
    if (!q) return [];
    const out: OmniSuggestion[] = [];
    const aliases: OmniSuggestion[] = [
      { id: 'a-home', label: 'Home', sub: 'Continuum', path: BNDZ_HOME, kind: 'alias' },
      { id: 'a-smart', label: 'Smart views', path: BNDZ_VIEWS_ROOT, kind: 'alias' },
      { id: 'a-recent', label: 'Recent files', path: BNDZ_RECENT, kind: 'alias' },
      { id: 'a-pc', label: 'This PC', path: '/', kind: 'alias' },
    ];
    for (const a of aliases) {
      if (a.label.toLowerCase().includes(q) || (a.sub || '').toLowerCase().includes(q)) out.push(a);
    }
    for (const p of places) {
      if (p.name.toLowerCase().includes(q) || (p.hint || '').toLowerCase().includes(q)) {
        out.push({ id: `p-${p.path}`, label: p.name, sub: p.freeLabel || p.hint, path: p.path, kind: 'place' });
      }
    }
    for (const c of continuum.slice(0, 40)) {
      const name = (c.name || '').toLowerCase();
      if (name.includes(q)) {
        const path = toPanePath(c.path || c.id || '');
        out.push({ id: `c-${path}`, label: c.name || path, sub: formatAddressBarPath(path), path, kind: 'continuum' });
      }
    }
    for (const sc of loadSmartCollections()) {
      if (sc.name.toLowerCase().includes(q)) {
        out.push({
          id: `sc-${sc.id}`,
          label: sc.name,
          sub: 'Smart collection',
          path: sc.scopePath ? toPanePath(sc.scopePath) : BNDZ_RECENT,
          kind: 'collection',
        });
      }
    }
    for (const g of ghost) {
      if (g.name.toLowerCase().includes(q) || g.path.toLowerCase().includes(q)) {
        out.push({ id: `g-${g.path}`, label: g.name, sub: 'Ghost trail', path: g.path, kind: 'ghost' });
      }
    }
    return out.slice(0, 8);
  }, [omnibox, places, continuum, ghost]);

  useEffect(() => { setSuggestIx(0); }, [omnibox]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setSpatialArmed(true);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const tag = (t?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
        e.preventDefault();
        omniboxRef.current?.focus();
        omniboxRef.current?.select();
        return;
      }
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !(e as any).isComposing) {
        const t = e.target as HTMLElement | null;
        const tag = (t?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
        const focusItem = continuum[railFocus];
        if (!focusItem || !onQuickLook) return;
        e.preventDefault();
        e.stopPropagation();
        const focusPath = toPanePath(focusItem.path || focusItem.id || '');
        const siblings = orbits[focusPath] || orbits[toPanePath(focusPath)] || [];
        const pack = [
          { path: focusPath, name: focusItem.name || focusPath.split('/').pop() || 'File', type: focusItem.type },
          ...siblings.map(s => ({
            path: toPanePath(s.path || s.id || ''),
            name: s.name || '',
            type: s.type,
          })).filter(s => s.path && s.path !== focusPath),
        ];
        onQuickLook(pack, 0);
        return;
      }
      if (spatialArmed && !e.ctrlKey && !e.metaKey && /^[a-z]$/i.test(e.key)) {
        const letter = e.key.toUpperCase();
        const hit = places.find(p => placeLetter(p.name, p.letter) === letter);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          onNavigate(hit.path);
          setSpatialArmed(false);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setSpatialArmed(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [spatialArmed, places, onNavigate, continuum, railFocus, orbits, onQuickLook]);

  const peekItems = useMemo(() => {
    const focus = continuum[railFocus];
    if (!focus) return [] as ContinuumItem[];
    const path = toPanePath(focus.path || focus.id || '');
    const sibs = orbits[path] || orbits[toPanePath(path)] || [];
    return sibs;
  }, [continuum, railFocus, orbits]);

  const navHitMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of navigationHistory) {
      const key = toPanePath(v.path).toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [navigationHistory]);

  const frequentFromNav = useMemo(() => {
    const counts = new Map<string, { path: string; label: string; hits: number }>();
    for (const v of navigationHistory) {
      const path = toPanePath(v.path);
      const key = path.toLowerCase();
      const prev = counts.get(key);
      counts.set(key, { path, label: v.label || path.split('/').pop() || path, hits: (prev?.hits || 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.hits - a.hits).slice(0, 8);
  }, [navigationHistory]);

  const commitSuggestion = (s: OmniSuggestion) => {
    if (s.kind === 'continuum') onOpenPath(s.path, { type: 'file' });
    else onNavigate(s.path);
    setOmnibox('');
  };

  const runOmnibox = async () => {
    const raw = omnibox.trim();
    if (!raw) return;
    if (suggestions[suggestIx]) {
      commitSuggestion(suggestions[suggestIx]);
      return;
    }
    const collections = loadSmartCollections();
    const sc = collections.find(c => c.name.toLowerCase() === raw.toLowerCase());
    if (sc) {
      onNavigate(sc.scopePath ? toPanePath(sc.scopePath) : BNDZ_RECENT);
      setOmnibox('');
      return;
    }
    const pane = await resolveUserPathToPane(raw, p => IPC.expandEnvironmentPath(p));
    if (pane) {
      onNavigate(pane);
      setOmnibox('');
    }
  };

  const openContinuum = (item: ContinuumItem, e?: React.MouseEvent) => {
    const path = toPanePath(item.path || item.id || '');
    if (!path) return;
    if (e?.button === 1 || e?.ctrlKey || e?.metaKey) {
      onOpenInNewTab?.(parentPane(path));
      return;
    }
    const kind = item.type === 'directory' ? 'directory' as const : 'file' as const;
    onOpenPath(path, { type: kind });
  };

  const snapRail = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(continuum.length - 1, railFocus + dir));
    setRailFocus(next);
    const el = railRef.current?.querySelector(`[data-rail-ix="${next}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  };

  const stage = focusStage;
  const pulsePct = Math.round(12 + pulseWarmth * 88);

  return (
    <div
      className="bndz-home"
      data-bndz-surface
      data-spatial={spatialArmed ? '1' : '0'}
      style={{ ['--home-pulse' as string]: String(pulseWarmth) }}
    >
      <div className="bndz-home-atmosphere" aria-hidden />
      <div className="bndz-home-mesh" aria-hidden />
      <div className="bndz-home-grain" aria-hidden />

      <div className="bndz-home-deck">
        <header className="bndz-home-hero">
          <motion.div
            className="bndz-home-brand"
            initial={reduceMotion ? false : { opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="bndz-home-wordmark">BNDZ</span>
            <span className="bndz-home-tag">Continuum</span>
          </motion.div>
          <motion.p
            className="bndz-home-lede"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.12, duration: 0.4 }}
          >
            {fileCount > 0
              ? `${fileCount.toLocaleString()} files indexed`
                + (library.images ? ` · ${library.images.toLocaleString()} photos` : '')
                + (library.videos ? ` · ${library.videos.toLocaleString()} videos` : '')
              : 'Places are live. Index libraries to ignite the Continuum rail.'}
          </motion.p>
        </header>

        <section className="bndz-home-omnibox-wrap" aria-label="Go anywhere">
          <div className={`bndz-home-omnibox${suggestions.length ? ' has-suggest' : ''}`}>
            <Icons8Icon id="search" size={14} className="bndz-home-omnibox-ico" />
            <input
              ref={omniboxRef}
              className="bndz-home-omnibox-input"
              value={omnibox}
              onChange={e => setOmnibox(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' && suggestions.length) {
                  e.preventDefault();
                  setSuggestIx(i => Math.min(suggestions.length - 1, i + 1));
                } else if (e.key === 'ArrowUp' && suggestions.length) {
                  e.preventDefault();
                  setSuggestIx(i => Math.max(0, i - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  void runOmnibox();
                } else if (e.key === 'Escape') {
                  setOmnibox('');
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Go anywhere — path, alias, collection…  (/)"
              spellCheck={false}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
            />
            <kbd className="bndz-home-kbd">/</kbd>
          </div>
          <AnimatePresence>
            {suggestions.length > 0 && (
              <motion.ul
                className="bndz-home-suggest"
                initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                role="listbox"
              >
                {suggestions.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`bndz-home-suggest-row${i === suggestIx ? ' is-active' : ''}`}
                      onMouseEnter={() => setSuggestIx(i)}
                      onClick={() => commitSuggestion(s)}
                      role="option"
                      aria-selected={i === suggestIx}
                    >
                      <span className="bndz-home-suggest-kind">{s.kind}</span>
                      <span className="bndz-home-suggest-label">{s.label}</span>
                      {s.sub && <span className="bndz-home-suggest-sub">{s.sub}</span>}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </section>

        <section className="bndz-home-workspaces" aria-label="Workspaces">
          <div className="bndz-home-section-label">
            <span>Workspaces</span>
            <span className="bndz-home-muted">Zero-launch tools · no external setup</span>
          </div>
          <div className="bndz-ws-launch-grid">
            <WorkspaceLaunchCard
              title="Continuum"
              desc="One Spatial board where Sandbox, Health, Inbound, RAM, Capacity, and Automation cohere — live pillars in under 30 seconds."
              icon="view_grid"
              accent="#34d399"
              badge="Compose"
              badgeVariant="gold"
              features={['Live badges', 'Pillar pins', 'One-click open']}
              onClick={() => {
                onNavigate(BNDZ_CANVAS);
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('bndz-open-continuum'));
                }, 120);
              }}
              className="is-canvas"
            />
            <WorkspaceLaunchCard
              title="Spatial Canvas"
              desc="Premium freeform board — organize references across every folder without moving files on disk."
              icon="view_grid"
              accent="#c4a35a"
              features={['Drop from panes', 'Sticky notes', 'Pan & zoom']}
              onClick={() => onNavigate(BNDZ_CANVAS)}
              className="is-canvas"
            />
            <WorkspaceLaunchCard
              title="Automation"
              desc="Visual file pipelines with watch, filter, copy, move, and built-in rsync deploy blocks."
              icon="zap_ui"
              accent="#34d399"
              badge="Pipeline"
              badgeVariant="green"
              features={['Visual editor', 'Remote deploy', 'Auto-save']}
              onClick={() => onNavigate(BNDZ_AUTOMATION)}
              className="is-automation"
            />
          </div>
        </section>

        {(mostOpened.length > 0 || frequentFromNav.length > 0) && (
          <section className="bndz-home-frequent" aria-label="Most accessed">
            <div className="bndz-home-section-label">
              <span>Most accessed</span>
              <span className="bndz-home-muted">Opens + navigation heat</span>
            </div>
            <div className="bndz-home-frequent-row">
              {(mostOpened.length ? mostOpened : frequentFromNav.map(f => ({ path: f.path, name: f.label, openCount: f.hits }))).slice(0, 8).map((item, i) => {
                const path = toPanePath((item as any).path || '');
                const name = (item as any).name || path.split('/').pop() || 'Item';
                const opens = (item as any).openCount as number | undefined;
                const navHits = navHitMap.get(path.toLowerCase()) || 0;
                const badge = accessBadge(opens, navHits);
                return (
                  <button
                    key={path + i}
                    type="button"
                    className="bndz-home-frequent-chip"
                    title={formatAddressBarPath(path)}
                    onClick={() => onOpenPath(path, { type: 'file' })}
                  >
                    <ShellNativeIcon path={path} size={22} preferThumbnail eager />
                    <span className="bndz-home-frequent-name">{name}</span>
                    {badge && <span className={`bndz-home-badge is-${badge.toLowerCase()}`}>{badge}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {stage && (
          <section className="bndz-home-focus" aria-label="Focus stage">
            <motion.div
              className="bndz-home-focus-plate"
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <div className="bndz-home-focus-thumb">
                <ShellNativeIcon path={stage.path} size={56} preferThumbnail eager hero />
              </div>
              <div className="bndz-home-focus-meta">
                <span className="bndz-home-focus-eyebrow">
                  {stage.kind === 'clipboard' ? 'Clipboard' : stage.kind === 'preview' ? 'Preview' : 'Now'}
                </span>
                <div className="bndz-home-focus-name" title={formatAddressBarPath(stage.path)}>{stage.name}</div>
                <div className="bndz-home-focus-path">{formatAddressBarPath(stage.path)}</div>
              </div>
              <div className="bndz-home-focus-actions">
                <button type="button" className="bndz-home-chip" onClick={() => onOpenPath(stage.path)}>Open</button>
                <button type="button" className="bndz-home-chip" onClick={() => onRevealFolder?.(parentPane(stage.path))}>Reveal</button>
                {onOpenOpposite && (
                  <button type="button" className="bndz-home-chip" onClick={() => onOpenOpposite(parentPane(stage.path))}>Opposite</button>
                )}
              </div>
            </motion.div>
          </section>
        )}

        <section className="bndz-home-continuum" aria-label="Continuum">
          <div className="bndz-home-section-label">
            <span>Continuum</span>
            <span className="bndz-home-muted">
              {loading ? 'Loading Continuum…' : deckSyncing ? 'Refreshing pulse…' : '← → snap · Space Quick Look · click opens'}
            </span>
          </div>
          <div
            className="bndz-home-rail-wrap"
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); snapRail(1); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); snapRail(-1); }
              if (e.key === 'Enter' && continuum[railFocus]) openContinuum(continuum[railFocus]);
            }}
            tabIndex={0}
          >
            <motion.div
              ref={railRef}
              className="bndz-home-rail"
              initial={reduceMotion ? false : { opacity: 0, x: 36 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1], delay: 0.06 }}
            >
              {continuum.length === 0 && !loading ? (
                <button
                  type="button"
                  className="bndz-home-rail-empty"
                  onClick={() => { onIndexInvite?.(); }}
                >
                  <span className="bndz-home-rail-empty-title">Continuum is dark</span>
                  <span>Index Desktop, Documents, Pictures, Music, and Videos — then the rail lights with real CAS thumbs.</span>
                </button>
              ) : continuum.map((item, i) => {
                const path = toPanePath(item.path || item.id || '');
                const name = item.name || path.split('/').pop() || 'File';
                const accent = mediaAccent(item.mediaKind);
                const navHits = navHitMap.get(path.toLowerCase()) || 0;
                const badge = accessBadge(item.openCount, navHits);
                return (
                  <button
                    key={path + i}
                    type="button"
                    data-rail-ix={i}
                    className={`bndz-home-rail-item${railFocus === i ? ' is-focus' : ''}`}
                    style={{ ['--rail-accent' as string]: accent }}
                    title={formatAddressBarPath(path)}
                    onMouseEnter={() => setRailFocus(i)}
                    onFocus={() => setRailFocus(i)}
                    onClick={e => openContinuum(item, e)}
                    onAuxClick={e => {
                      if (e.button === 1) {
                        e.preventDefault();
                        openContinuum(item, e);
                      }
                    }}
                  >
                    <span className="bndz-home-rail-thumb">
                      <ShellNativeIcon path={path} size={76} preferThumbnail eager />
                    </span>
                    <span className="bndz-home-rail-name">{name}</span>
                    {badge && <span className={`bndz-home-badge is-${badge.toLowerCase()}`}>{badge}</span>}
                    {item.mediaKind && <span className="bndz-home-rail-kind">{item.mediaKind}</span>}
                  </button>
                );
              })}
            </motion.div>
          </div>

          {(continuum[railFocus] || peekItems.length > 0) && (
            <div className="bndz-home-peek" aria-label="Folder peek">
              <div className="bndz-home-peek-head">
                <span>Folder peek</span>
                <span className="bndz-home-muted">
                  {peekItems.length > 0
                    ? `${peekItems.length} neighbor${peekItems.length === 1 ? '' : 's'} · same folder`
                    : 'Open folder · Space for Quick Look'}
                </span>
              </div>
              <div className="bndz-home-peek-rail">
                {continuum[railFocus] && (
                  <button
                    type="button"
                    className="bndz-home-peek-tile is-folder"
                    title="Open containing folder"
                    onClick={() => {
                      const p = toPanePath(continuum[railFocus].path || continuum[railFocus].id || '');
                      onRevealFolder?.(parentPane(p));
                    }}
                  >
                    <span className="bndz-home-peek-thumb">
                      <Icons8Icon id="folder_open_ui" size={28} />
                    </span>
                    <span className="bndz-home-peek-name">Folder</span>
                  </button>
                )}
                {peekItems.map((sib, i) => {
                  const sp = toPanePath(sib.path || sib.id || '');
                  const sn = sib.name || sp.split('/').pop() || '';
                  return (
                    <button
                      key={sp + i}
                      type="button"
                      className="bndz-home-peek-tile"
                      title={formatAddressBarPath(sp)}
                      onClick={() => onOpenPath(sp, { type: sib.type === 'directory' ? 'directory' : 'file' })}
                    >
                      <span className="bndz-home-peek-thumb">
                        <ShellNativeIcon path={sp} size={40} preferThumbnail eager />
                      </span>
                      <span className="bndz-home-peek-name">{sn}</span>
                    </button>
                  );
                })}
                {peekItems.length === 0 && continuum[railFocus] && (
                  <span className="bndz-home-peek-empty">No indexed neighbors yet — Space still Quick Looks this file.</span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="bndz-home-places" aria-label="Places">
          <div className="bndz-home-section-label">
            <span>Places</span>
            <span className="bndz-home-muted">
              {spatialArmed ? 'Letter opens · release Alt to cancel' : 'Hold Alt · Spatial Jump'}
            </span>
          </div>
          <div className="bndz-home-places-row">
            {places.map((place, ix) => {
              const letter = placeLetter(place.name, place.letter);
              return (
                <motion.button
                  key={place.path + place.name}
                  type="button"
                  data-home-nav-path={place.path}
                  className={`bndz-home-place${place.kind === 'drive' ? ' is-drive' : ''}${spatialArmed ? ' is-spatial' : ''}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 + ix * 0.018, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={reduceMotion ? undefined : { y: -3, transition: { type: 'spring', stiffness: 480, damping: 28 } }}
                  onClick={() => onNavigate(place.path)}
                  onAuxClick={e => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onOpenInNewTab?.(place.path);
                    }
                  }}
                >
                  <span className="bndz-home-place-icon">
                    <ShellNativeIcon path={place.path} isDir size={30} preferThumbnail eager />
                  </span>
                  <span className="bndz-home-place-text">
                    <span className="bndz-home-place-name">{place.name}</span>
                    {place.freeLabel && <span className="bndz-home-place-free">{place.freeLabel}</span>}
                  </span>
                  {place.kind === 'drive' && place.freeRatio != null && (
                    <span
                      className="bndz-home-place-meter"
                      style={{ ['--free' as string]: String(place.freeRatio) }}
                      aria-hidden
                    />
                  )}
                  <AnimatePresence>
                    {spatialArmed && (
                      <motion.span
                        className="bndz-home-place-letter"
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        aria-hidden
                      >
                        {letter}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        </section>

        {ghost.length > 0 && (
          <section className="bndz-home-ghost" aria-label="Ghost trail">
            <div className="bndz-home-section-label">
              <span>Ghost trail</span>
              <span className="bndz-home-muted">This session · fades with time</span>
            </div>
            <div className="bndz-home-ghost-row">
              {ghost.map((g, i) => (
                <button
                  key={g.path + g.at}
                  type="button"
                  className="bndz-home-ghost-chip"
                  style={{ opacity: Math.max(0.42, 1 - i * 0.08) }}
                  title={formatAddressBarPath(g.path)}
                  onClick={() => onNavigate(g.path)}
                >
                  <ShellNativeIcon path={g.path} size={18} preferThumbnail eager />
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <footer className="bndz-home-pulse" aria-label="Pulse">
          <div className="bndz-home-pulse-track">
            <motion.div
              className="bndz-home-pulse-fill"
              style={{ width: `${pulsePct}%` }}
              animate={reduceMotion || pulseWarmth < 0.08 ? undefined : {
                opacity: [0.5, 0.92, 0.5],
              }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
          <div className="bndz-home-pulse-meta">
            <span>{pulseLabel}</span>
            <button type="button" className="bndz-home-linkish" onClick={() => onNavigate(BNDZ_VIEWS_ROOT)}>
              Smart views
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
