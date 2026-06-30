import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'animejs';
import LauncherSearchHeader from './components/LauncherSearchHeader';
import LauncherCommandList from './components/LauncherCommandList';
import LauncherPreviewPanel from './components/LauncherPreviewPanel';
import LauncherFooter from './components/LauncherFooter';
import LauncherSurface from './components/LauncherSurface';
import { useLauncherActions } from './components/LauncherActionsOverlay';
import LauncherShellContextMenu from './components/LauncherShellContextMenu';
import BndzAiChatView from './views/BndzAiChatView';
import BndzSnippetManager from './views/BndzSnippetManager';
import BndzQuickLinkManager from './views/BndzQuickLinkManager';
import BndzClipboardManager from './views/BndzClipboardManager';
import BndzNotesManager from './views/BndzNotesManager';
import BndzExtensionHubView from './views/BndzExtensionHubView';
import BndzPluginStoreView from './views/BndzPluginStoreView';
import BndzWindowManagerView from './views/BndzWindowManagerView';
import BndzFileSearchView from './views/BndzFileSearchView';
import { useBndzLauncherViews } from './hooks/useBndzLauncherViews';
import { useBndzAiChat } from './hooks/useBndzAiChat';
import { executeCommand, notifyReady, onHostMessage, requestQueryStreaming, setLauncherLayout } from './bridge/flowBridge';
import type { LauncherCommand } from './types';
import { tryEvaluateCalculator } from './smart-calculator';
import { buildInlineArgFields, resolveCommandWithInlineArgs } from './lib/inlineArgs';

const VIEW_COMMANDS = new Set([
  'system-ai-chat',
  'system-cursor-prompt',
  'system-search-snippets',
  'system-search-quicklinks',
  'system-search-notes',
  'system-clipboard-manager',
  'system-open-extensions',
  'system-open-plugin-store',
  'system-window-management',
  'system-file-search',
  'system-search-files',
  'system-open-settings',
]);

function hexToRgbCsv(hex: string): string {
  const h = hex.replace('#', '').trim();
  if (h.length < 6) return '30, 30, 30';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** SuperCmd App.tsx orchestration — BNDZ Launcher multi-view shell */
export default function BndzLauncherApp() {
  const views = useBndzLauncherViews();
  const ai = useBndzAiChat({ onExitAiMode: views.resetToMain });

  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<LauncherCommand[]>([]);
  const [sections, setSections] = useState<{ title: string; items: LauncherCommand[] }[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingExtensions, setLoadingExtensions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const [showBackground, setShowBackground] = useState(true);
  const [backgroundOpacity, setBackgroundOpacity] = useState(46);
  const [backgroundBlur, setBackgroundBlur] = useState(35);
  const [inlineArgValues, setInlineArgValues] = useState<Record<string, string>>({});
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryGenRef = useRef(0);
  const executingRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

  const flatCommands = useMemo(() => sections.flatMap(s => s.items), [sections]);
  const calcResult = useMemo(() => tryEvaluateCalculator(query), [query]);
  const calcOffset = calcResult ? 1 : 0;
  const selected = flatCommands[selectedIndex - calcOffset] ?? (calcResult && selectedIndex === 0 ? null : commands[selectedIndex - calcOffset] ?? null);

  const inlineArgFields = useMemo(() => {
    const fields = buildInlineArgFields(selected);
    return fields.map(f => ({
      ...f,
      value: inlineArgValues[f.key] ?? '',
      onChange: (v: string) => setInlineArgValues(prev => ({ ...prev, [f.key]: v })),
    }));
  }, [selected, inlineArgValues]);

  useEffect(() => {
    setInlineArgValues({});
  }, [selected?.id]);

  const autocompleteSuffix = useMemo(() => {
    if (!query.trim() || !selected?.title) return '';
    const q = query.toLowerCase();
    const title = selected.title;
    if (title.toLowerCase().startsWith(q) && title.length > query.length) {
      return title.slice(query.length);
    }
    return '';
  }, [query, selected?.title]);

  const expandLauncher = useCallback(() => {
    if (expanded) return;
    setExpanded(true);
    setLauncherLayout('expanded');
    const el = shellRef.current;
    if (el) {
      animate(el, {
        opacity: [0.92, 1],
        scale: [0.98, 1],
        duration: 280,
        ease: 'outCubic',
      });
    }
  }, [expanded]);

  useEffect(() => {
    if (query.length > 0) expandLauncher();
  }, [query, expandLauncher]);

  const resetCompact = useCallback(() => {
    const el = shellRef.current;
    const finish = () => {
      setExpanded(false);
      setQuery('');
      setSelectedIndex(0);
      setLauncherLayout('compact');
    };
    if (expanded && el) {
      animate(el, {
        opacity: [1, 0.92],
        scale: [1, 0.98],
        duration: 220,
        ease: 'inCubic',
        onComplete: finish,
      });
      return;
    }
    finish();
  }, [expanded]);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  const applyResult = useCallback((result: { commands?: LauncherCommand[]; sections?: { title: string; items: LauncherCommand[] }[] }, partial: boolean) => {
    const list = result.sections?.flatMap(s => s.items) ?? result.commands ?? [];
    setCommands(result.commands ?? list);
    setSections(result.sections?.length ? result.sections : [{ title: 'Results', items: list }]);
    setLoadingExtensions(partial);
    setSelectedIndex(prev => {
      const keepId = selectedIdRef.current;
      if (keepId) {
        const idx = list.findIndex(c => c.id === keepId);
        if (idx >= 0) return idx;
      }
      if (!partial) {
        const appIdx = list.findIndex(c => c.category === 'app');
        if (appIdx >= 0) return appIdx;
      }
      if (prev < list.length) return prev;
      return list.length > 0 ? 0 : 0;
    });
  }, []);

  const runQuery = useCallback(async (q: string) => {
    const gen = ++queryGenRef.current;
    setLoadingExtensions(true);
    try {
      await requestQueryStreaming(q, (result, partial) => {
        if (queryGenRef.current !== gen) return;
        applyResult(result, partial);
      });
    } finally {
      if (queryGenRef.current === gen) setLoadingExtensions(false);
    }
  }, [applyResult]);

  useEffect(() => {
    notifyReady();
    setLauncherLayout('compact');
    void runQuery('');
    const off = onHostMessage(msg => {
      if (msg.type === 'THEME_SYNC') {
        document.documentElement.classList.toggle('dark', !!msg.dark);
        if (msg.wallpaperUrl) setWallpaperUrl(msg.wallpaperUrl);
        if (typeof msg.launcherShowBackground === 'boolean') setShowBackground(msg.launcherShowBackground);
        if (typeof msg.launcherBackgroundOpacity === 'number') setBackgroundOpacity(msg.launcherBackgroundOpacity);
        if (typeof msg.launcherBackgroundBlur === 'number') setBackgroundBlur(msg.launcherBackgroundBlur);
        const root = document.documentElement;
        if (msg.surfaceChrome) root.style.setProperty('--surface-base-rgb', hexToRgbCsv(msg.surfaceChrome));
        if (msg.surfaceRaised) root.style.setProperty('--launcher-panel-bg', msg.surfaceRaised);
        if (msg.accent) root.style.setProperty('--accent', msg.accent);
      }
      if (msg.type === 'LAUNCHER_VISIBLE') expandLauncher();
    });
    return off;
  }, [runQuery, resetCompact]);

  useEffect(() => {
    if (!views.isMain) return;
    inputRef.current?.focus();
  }, [views.isMain]);

  useEffect(() => {
    if (!views.isMain) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runQuery(query), query.length === 0 ? 0 : 24);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runQuery, views.isMain]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, flatCommands.length]);

  const handleExecute = useCallback(async (cmd: LauncherCommand, opts?: { openInBndz?: boolean }) => {
    const resolved = resolveCommandWithInlineArgs(cmd, inlineArgValues);
    if (opts?.openInBndz || resolved.id.startsWith('bndz-openpath-')) {
      const path = resolved.openPath || resolved.subtitle;
      if (path) {
        const bridge = await import('./bridge/flowBridge');
        if (resolved.id.startsWith('bndz-openpath-')) {
          await bridge.executeCommand(resolved, { query });
          return;
        }
        bridge.openBndzPath(path);
        return;
      }
    }

    switch (resolved.id) {
      case 'system-ai-chat':
      case 'system-cursor-prompt':
        views.openAiMode();
        ai.startAiChat(query);
        return;
      case 'system-search-snippets':
        views.openSnippetManager('search');
        return;
      case 'system-search-quicklinks':
        views.openQuickLinkManager('search');
        return;
      case 'system-search-notes':
        views.openNotesManager('search');
        return;
      case 'system-clipboard-manager':
        views.openClipboardManager();
        return;
      case 'system-open-extensions':
        views.openExtensionHub();
        return;
      case 'system-open-plugin-store':
        views.openPluginStoreHub();
        return;
      case 'system-window-management':
        views.openWindowManager();
        return;
      case 'system-file-search':
      case 'system-search-files':
        views.openFileSearch(query);
        return;
      case 'system-open-settings':
        void import('./bridge/flowBridge').then(m => m.openLauncherSettings());
        return;
      default:
        break;
    }

    if (VIEW_COMMANDS.has(resolved.id)) return;
    if (executingRef.current) return;
    executingRef.current = true;
    try {
      await executeCommand(resolved, { query });
    } finally {
      executingRef.current = false;
    }
  }, [ai, query, views, inlineArgValues]);

  const handleOpenManager = useCallback((cmd: LauncherCommand) => {
    handleExecute(cmd);
  }, [handleExecute]);

  const { actionsOpen, setActionsOpen, selectedAction, overlay: actionsOverlay } = useLauncherActions(selected, handleExecute);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!expanded) expandLauncher();
      setActionsOpen(true);
      return;
    }

    if (e.key === 'Tab' && query.trim() && !e.shiftKey && !actionsOpen) {
      e.preventDefault();
      views.openAiMode();
      ai.startAiChat(query);
      return;
    }

    const count = flatCommands.length + calcOffset;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      expandLauncher();
      if (count) setSelectedIndex(i => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      expandLauncher();
      if (count) setSelectedIndex(i => (i - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (calcResult && selectedIndex === 0) {
        void navigator.clipboard.writeText(calcResult.formatted);
        return;
      }
      if (selected) void handleExecute(selected, { openInBndz: e.ctrlKey || e.metaKey });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (actionsOpen) setActionsOpen(false);
      else resetCompact();
    }
  };

  if (views.isAi) {
    return (
      <div className="w-full h-full box-border" onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}>
        <BndzAiChatView {...ai} />
        {contextMenu && <LauncherShellContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} />}
      </div>
    );
  }

  if (views.isSnippets) {
    return (
      <div className="w-full h-full box-border">
        <BndzSnippetManager onClose={views.resetToMain} initialView={views.snippetInitialView} />
      </div>
    );
  }

  if (views.isQuickLinks) {
    return (
      <div className="w-full h-full box-border">
        <BndzQuickLinkManager onClose={views.resetToMain} initialView={views.quickLinkInitialView} />
      </div>
    );
  }

  if (views.isNotes) {
    return (
      <div className="w-full h-full box-border">
        <BndzNotesManager onClose={views.resetToMain} initialView={views.notesInitialView} />
      </div>
    );
  }

  if (views.isClipboard) {
    return (
      <div className="w-full h-full box-border">
        <BndzClipboardManager onClose={views.resetToMain} />
      </div>
    );
  }

  if (views.isPluginStore) {
    return (
      <div className="w-full h-full box-border">
        <BndzPluginStoreView
          onClose={views.resetToMain}
          onRunKeyword={kw => { setQuery(kw); views.resetToMain(); inputRef.current?.focus(); }}
        />
      </div>
    );
  }

  if (views.isExtensions) {
    return (
      <div className="w-full h-full box-border">
        <BndzExtensionHubView onClose={views.resetToMain} />
      </div>
    );
  }

  if (views.isWindows) {
    return (
      <div className="w-full h-full box-border">
        <BndzWindowManagerView onClose={views.resetToMain} />
      </div>
    );
  }

  if (views.isFiles) {
    return (
      <div className="w-full h-full box-border">
        <BndzFileSearchView onClose={views.resetToMain} initialQuery={views.fileSearchQuery} />
      </div>
    );
  }

  return (
    <div
      className="w-full h-full box-border"
      onContextMenu={e => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div ref={shellRef} className="h-full">
        <LauncherSurface
          compact={!expanded}
          showBackground={showBackground}
          backgroundImageUrl={wallpaperUrl}
          backgroundOpacityPercent={backgroundOpacity}
          backgroundBlurPercent={backgroundBlur}
        >
          <LauncherSearchHeader
            value={query}
            placeholder={loadingExtensions ? 'Loading apps and extensions…' : 'Search apps, files, notes, snippets, AI…'}
            inputRef={inputRef}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            compact={!expanded}
            autocompleteSuffix={autocompleteSuffix}
            onClear={() => setQuery('')}
            onAskAi={() => { views.openAiMode(); ai.startAiChat(query); }}
            onFocusInput={expandLauncher}
            showAskAi
            inlineFields={inlineArgFields}
          />
          {expanded ? (
            <>
              <div className="flex-1 grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] min-h-0 border-t border-[var(--footer-border)] launcher-expanded-body">
                <LauncherCommandList
                  sections={sections}
                  flatCommands={flatCommands}
                  selectedIndex={selectedIndex}
                  itemRefs={itemRefs}
                  onSelect={(idx) => setSelectedIndex(idx)}
                  onExecute={handleExecute}
                  calcResult={calcResult}
                  onCalculatorCopy={() => {
                    if (calcResult) void navigator.clipboard.writeText(calcResult.formatted);
                  }}
                />
                <div className="border-l border-[var(--footer-border)] min-h-0 bg-black/5">
                  <LauncherPreviewPanel
                    command={selected}
                    onExecute={handleExecute}
                    onOpenManager={handleOpenManager}
                  />
                </div>
              </div>
              <LauncherFooter
                selected={selected}
                resultCount={flatCommands.length}
                selectedAction={selectedAction}
                onOpenActions={() => setActionsOpen(true)}
              />
            </>
          ) : (
            <LauncherFooter
              selected={selected}
              resultCount={flatCommands.length}
              compact
            />
          )}
        </LauncherSurface>
      </div>
      {actionsOverlay}
      {contextMenu && (
        <LauncherShellContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
