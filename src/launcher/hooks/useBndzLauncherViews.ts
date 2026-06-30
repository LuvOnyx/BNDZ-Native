import { useCallback, useState } from 'react';

export type LauncherView =
  | 'main'
  | 'ai'
  | 'snippets-search'
  | 'snippets-create'
  | 'quicklinks-search'
  | 'quicklinks-create'
  | 'notes-search'
  | 'notes-create'
  | 'clipboard'
  | 'extensions'
  | 'plugin-store'
  | 'windows'
  | 'files';

/** SuperCmd-style view manager — one active sub-view in BNDZ Launcher shell. */
export function useBndzLauncherViews() {
  const [view, setView] = useState<LauncherView>('main');
  const [fileSearchQuery, setFileSearchQuery] = useState('');

  const resetToMain = useCallback(() => setView('main'), []);

  const openAiMode = useCallback(() => setView('ai'), []);
  const openSnippetManager = useCallback((mode: 'search' | 'create' = 'search') => {
    setView(mode === 'create' ? 'snippets-create' : 'snippets-search');
  }, []);
  const openQuickLinkManager = useCallback((mode: 'search' | 'create' = 'search') => {
    setView(mode === 'create' ? 'quicklinks-create' : 'quicklinks-search');
  }, []);
  const openNotesManager = useCallback((mode: 'search' | 'create' = 'search') => {
    setView(mode === 'create' ? 'notes-create' : 'notes-search');
  }, []);
  const openClipboardManager = useCallback(() => setView('clipboard'), []);
  const openExtensionHub = useCallback(() => setView('extensions'), []);
  const openPluginStoreHub = useCallback(() => setView('plugin-store'), []);
  const openWindowManager = useCallback(() => setView('windows'), []);
  const openFileSearch = useCallback((initialQuery = '') => {
    setFileSearchQuery(initialQuery);
    setView('files');
  }, []);

  return {
    view,
    resetToMain,
    openAiMode,
    openSnippetManager,
    openQuickLinkManager,
    openNotesManager,
    openClipboardManager,
    openExtensionHub,
    openPluginStoreHub,
    openWindowManager,
    openFileSearch,
    fileSearchQuery,
    isMain: view === 'main',
    isAi: view === 'ai',
    isSnippets: view.startsWith('snippets'),
    isQuickLinks: view.startsWith('quicklinks'),
    isNotes: view.startsWith('notes'),
    isClipboard: view === 'clipboard',
    isExtensions: view === 'extensions',
    isPluginStore: view === 'plugin-store',
    isWindows: view === 'windows',
    isFiles: view === 'files',
    snippetInitialView: view === 'snippets-create' ? 'create' as const : 'search' as const,
    quickLinkInitialView: view === 'quicklinks-create' ? 'create' as const : 'search' as const,
    notesInitialView: view === 'notes-create' ? 'create' as const : 'search' as const,
  };
}
