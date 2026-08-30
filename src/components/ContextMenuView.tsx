import React, { useEffect, useState } from 'react';
import ClampedFixedMenu from './ClampedFixedMenu';
import { ContextMenuIcon } from './ContextMenuIcon';
import { Icons8Icon } from './Icons8Icon';
import { ContextMenuItem, ContextSubmenu, ContextNestedSubmenu, menuItemClass } from './ContextSubmenu';
import IconPreviewImage from './plugins/IconStudio/IconPreviewImage';
import {
  ContextMenuState,
  resolveContextTargetPaths,
  resolveContextTargetPanePaths,
  filterSupplementalNativeItems,
  takeShellCascadeByLabel,
  isContextMenuBackground,
  isRecycleBinLocationMenu,
  contextMenuRefreshLabel,
  resolveNativeItemVerb,
  type NativeContextMenuItem,
} from '../lib/contextMenuActions';
import { normalizePanePath, toWindowsPath, joinPanePath, joinPanePathForFs, isValidShellTarget, isRecycleBinPath, RECYCLE_BIN_PATH } from '../lib/pathUtils';
import { isMeshPath } from '../lib/meshPaths';
import { isQueuedIpcResult } from '../lib/transferIpc';
import { isBndzVirtualPath, isFsDropTargetPath, BNDZ_CANVAS, BNDZ_AUTOMATION } from '../lib/bndzVirtualViews';
import { createItemInPane } from '../lib/ramStagingPaths';
import { dispatchAutomationFromPin } from '../lib/workspace/automationPendingSeed';
import { pinPathsToSpatialCanvas } from '../lib/spatialCanvasStore';
import { resolveTagKey, entityHasTag } from '../lib/tagUtils';
import { dedupePinnedFavorites, collapseKnownFolderShadowPath } from '../lib/rapidAccessDefaults';
import { resolveShellPropertiesPath } from '../lib/shellPaths';
import { isOptionalStockContextEnabled, type OptionalStockContextId } from '../lib/shellMenuPresets';
import { isStockContextInstalled } from '../workstation/command-deck/contextToolRegistry';
import { resolveIconFilePath } from '../lib/iconPathUtils';
import { buildSettingsRuntime, getRenameInitialValue } from '../lib/settingsRuntime';
import { getContextBehavior } from '../lib/settingsBehavior';
import { buildShellExecuteOptions } from '../lib/shellExecuteRuntime';
import { isArchiveExt } from '../lib/archiveTypes';
import { isImageExt } from '../lib/mediaTypes';
import { dispatchOpenPhotoStudio } from './preview/BndzPhotoStudio';
import type { SortColumnId } from '../lib/listColumns';
import type { ListGroupBy } from '../lib/listGrouping';
import { LIST_GROUP_BY_OPTIONS } from '../lib/listGrouping';
import { IPC } from '../lib/ipcBridge';
import { requestNativePrompt } from '../lib/nativeDialog';
import type { ClipboardAction } from '../data/ClipboardContext';
import {
  classifyContextItemKind,
  openLocationForApp,
  openLocationForItemParent,
  openLocationForShortcut,
  type ContextItemKind,
  type OpenLocationTarget,
  type ResolvedShortcutInfo,
} from '../lib/contextItemKind';

const SORT_BY_OPTIONS: Array<{ value: SortColumnId; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'size', label: 'Size' },
  { value: 'modified', label: 'Date modified' },
  { value: 'created', label: 'Date created' },
  { value: 'tags', label: 'Tags' },
  { value: 'ghostState', label: 'Ghost' },
  { value: 'ramZone', label: 'RAM zone' },
];

interface ContextMenuViewProps {
  menu: ContextMenuState;
  onClose: () => void;
  config: any;
  updateConfig: (patch: any) => void;
  activePaneId: string;
  addTab: (paneId: string, path: string) => void;
  onOpenBatchRename?: () => void;
  onOpenMeshDrop?: (paths: string[]) => void;
  onGhostLinkOffload?: (paths: string[]) => void | Promise<void>;
  onGhostLinkRestore?: (path: string) => void | Promise<void>;
  onStageToRam?: (paths: string[]) => void | Promise<void>;
  setIsSmartToolsOpen: (v: boolean) => void;
  setToastMessage: (msg: string) => void;
  setInlineRename: (v: { path: string; entityId: string; currentName: string } | null) => void;
  setClipboardState: (items: string[], action: ClipboardAction) => void;
  executePaste: (targetDir: string) => Promise<void>;
  onDeletePaths: (paths: string[]) => void;
  onEmptyRecycleBin?: () => void;
  onRefreshList?: () => void;
  onRefreshTree?: () => void;
  onCopyTo?: (sources: string[]) => void | Promise<void>;
  onMoveTo?: (sources: string[]) => void | Promise<void>;
  availableTags?: Array<{ id?: string; name?: string; label?: string; color?: string }>;
  onToggleTag?: (tag: { id?: string; name?: string; label?: string; color?: string }) => void | Promise<void>;
  /** Tag keys present on the current context-menu selection. */
  selectionTagKeys?: string[];
  onRemoveAllTags?: () => void | Promise<void>;
  /** Paths of sidebar items that are default (non-pinned) rapid-access entries, used to show Hide option. */
  rapidAccessDefaultPaths?: string[];
  /** Begin inline rename of a pinned Rapid Access favorite's display label. */
  onRenameFavorite?: (path: string) => void;
  /** Current sort/group state for the pane this menu was opened on (list-background surface). */
  sortColumn?: SortColumnId;
  sortDirection?: 'asc' | 'desc';
  onSortBy?: (column: SortColumnId) => void;
  onSetSortDirection?: (direction: 'asc' | 'desc') => void;
  listGroupBy?: ListGroupBy;
  onGroupByChange?: (value: ListGroupBy) => void;
  /** Restore the selected item(s) from the Recycle Bin to their original location. */
  onRestoreRecycleItems?: (panePaths: string[]) => void | Promise<void>;
  onPurgeRecycleItems?: (panePaths: string[]) => void | Promise<void>;
  onSelectAll?: () => void;
  onInvertSelection?: () => void;
  onOpenFind?: () => void;
  onNavigateUp?: () => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  /** Open targets inside BNDZ (folders navigate; files open Quick Preview). */
  onOpenInBndz?: (panePaths: string[], opts: { isDirectory: boolean; entityId?: string }) => void;
}

function ContextMenuView({
  menu, onClose, config, updateConfig, activePaneId, addTab,
  onOpenBatchRename, onOpenMeshDrop, onGhostLinkOffload, onGhostLinkRestore, onStageToRam, setIsSmartToolsOpen, setToastMessage, setInlineRename,
  setClipboardState, executePaste, onDeletePaths, onEmptyRecycleBin, onRefreshList, onRefreshTree,
  onCopyTo, onMoveTo, availableTags, onToggleTag, selectionTagKeys, onRemoveAllTags, rapidAccessDefaultPaths,
  sortColumn, sortDirection, onSortBy, onSetSortDirection, listGroupBy, onGroupByChange, onRenameFavorite,
  onRestoreRecycleItems, onPurgeRecycleItems, onSelectAll, onInvertSelection,
  onOpenFind, onNavigateUp, onGoBack, onGoForward,
  onOpenInBndz,
}: ContextMenuViewProps) {
  const rt = buildSettingsRuntime(config);
  const ctxBeh = getContextBehavior(config);
  const installedPlugins = Array.isArray(config.installedPlugins) ? config.installedPlugins : [];
  const meshPluginInstalled = isStockContextInstalled('mesh-drop', installedPlugins);
  /** Optional stock row + Command Deck install gate (plugin-backed rows need install). */
  const stockOn = (id: OptionalStockContextId) =>
    isOptionalStockContextEnabled(config, id) && isStockContextInstalled(id, installedPlugins);
  const targetPaths = resolveContextTargetPaths(menu);
  const isBackground = isContextMenuBackground(menu);
  const isRecycleLocation = isRecycleBinLocationMenu(menu);
  const refreshLabel = contextMenuRefreshLabel(menu.surface);
  const runRefresh = () => {
    const surface = menu.surface;
    if (surface === 'tree-background' || surface === 'tree-item') onRefreshTree?.();
    else onRefreshList?.();
  };
  const supplementalNativeAll = (() => {
    let items = filterSupplementalNativeItems(menu.nativeContextItems);
    const hidden: string[] = Array.isArray(config.shellMenuHiddenIds) ? config.shellMenuHiddenIds : [];
    const pinned: string[] = Array.isArray(config.shellMenuPinnedIds) ? config.shellMenuPinnedIds : [];
    if (config.hideShellExtensionsFromShellContextMenu) return [] as NativeContextMenuItem[];
    if (hidden.length) {
      items = items.filter(i => {
        if (i.separator || (i.children && i.children.length)) return true;
        const id = i.id || i.verb || i.label || '';
        return !hidden.includes(id);
      });
    }
    if (pinned.length) {
      const pinSet = new Set(pinned);
      const pinnedItems = items.filter(i => !i.separator && pinSet.has(i.id || i.verb || i.label || ''));
      const rest = items.filter(i => i.separator || !pinSet.has(i.id || i.verb || i.label || ''));
      items = [...pinnedItems, ...(pinnedItems.length && rest.length ? [{ separator: true } as NativeContextMenuItem] : []), ...rest];
    }
    return items;
  })();
  // Promote shell "New" cascade into the folder background New submenu (avoid duplicate at bottom).
  const { cascade: shellNewCascade, rest: supplementalNative } = isBackground
    ? takeShellCascadeByLabel(supplementalNativeAll, 'New')
    : { cascade: null as NativeContextMenuItem | null, rest: supplementalNativeAll };
  const [iconLibs, setIconLibs] = useState<any[]>(config.iconLibraries || []);
  const [iconLibsLoaded, setIconLibsLoaded] = useState(false);
  const [shareItems, setShareItems] = useState<import('../lib/ipcBridge').ShareMenuItem[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareRequested, setShareRequested] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [menuFilter, setMenuFilter] = useState('');

  const staticShareMain: import('../lib/ipcBridge').ShareMenuItem[] = !isBackground && targetPaths.length > 0
    ? [
        { id: 'share', label: 'Share with apps…', kind: 'verb' as const, verb: 'share', group: 'main' as const },
        ...(menu.isDirectory
          ? [{ id: 'grantaccess', label: 'Give access to…', kind: 'verb' as const, verb: 'grantaccess', group: 'main' as const }]
          : []),
      ]
    : [];

  const runIpc = async () => (await import('../lib/ipcBridge')).IPC;

  const itemKind: ContextItemKind = isBackground
    ? 'folder'
    : classifyContextItemKind({
        isDirectory: menu.isDirectory,
        name: menu.entityName,
        extension: menu.entityExtension,
        path: targetPaths[0],
      });

  const [shortcutInfo, setShortcutInfo] = useState<ResolvedShortcutInfo | null>(null);

  useEffect(() => {
    setShortcutInfo(null);
    if (isBackground || itemKind !== 'shortcut' || targetPaths.length !== 1) return;
    let active = true;
    (async () => {
      try {
        const IPC = await runIpc();
        const res = await IPC.resolveShortcut(toWindowsPath(targetPaths[0]));
        if (active) setShortcutInfo(res as ResolvedShortcutInfo);
      } catch {
        if (active) setShortcutInfo({ success: false, error: 'Could not resolve shortcut' });
      }
    })();
    return () => { active = false; };
  }, [isBackground, itemKind, targetPaths[0], menu.x, menu.y]);

  /** Open file location — shortcut target, app folder, or cross-folder item parent. */
  const openLocationTarget: OpenLocationTarget | null = (() => {
    if (isBackground || targetPaths.length !== 1) return null;
    const win = toWindowsPath(targetPaths[0]);
    if (!win) return null;
    const cwd = toWindowsPath(menu.path);
    if (itemKind === 'shortcut') return openLocationForShortcut(shortcutInfo);
    if (itemKind === 'app') return openLocationForApp(win, cwd);
    return openLocationForItemParent(win, cwd);
  })();

  const goOpenFileLocation = async (loc: OpenLocationTarget) => {
    const cwd = toWindowsPath(menu.path).replace(/[/\\]+$/, '');
    if (loc.folderWin.replace(/[/\\]+$/, '').toLowerCase() !== cwd.toLowerCase()) {
      addTab(activePaneId, loc.folderPane);
    } else {
      setToastMessage('Already viewing this location.');
    }
    onClose();
  };

  useEffect(() => {
    setShareRequested(false);
    setShareItems([]);
    setShareLoading(false);
  }, [menu.entityId, menu.path, menu.x, menu.y]);

  useEffect(() => {
    if (!iconLibsLoaded) return;
    let active = true;
    (async () => {
      try {
        const IPC = await runIpc();
        const libs = await IPC.getIconLibraries();
        if (!active) return;
        if (libs?.length) setIconLibs(libs);
        else if (config.iconLibraries?.length) setIconLibs(config.iconLibraries);
      } catch {
        if (active && config.iconLibraries?.length) setIconLibs(config.iconLibraries);
      }
    })();
    return () => { active = false; };
  }, [menu.x, menu.y, config.iconLibraries, iconLibsLoaded]);

  const ensureIconLibraries = () => {
    if (!iconLibsLoaded) setIconLibsLoaded(true);
  };

  useEffect(() => {
    if (isBackground || !targetPaths.length || !shareRequested) {
      setShareItems([]);
      setShareLoading(false);
      setShareError(null);
      return;
    }
    let active = true;
    setShareLoading(true);
    setShareError(null);
    (async () => {
      try {
        const IPC = await runIpc();
        const items = await IPC.fetchShareMenuItems(targetPaths[0]);
        if (active) setShareItems(items || []);
      } catch (err: unknown) {
        if (active) {
          setShareItems([]);
          setShareError(err instanceof Error ? err.message : 'Could not load share options.');
        }
      } finally {
        if (active) setShareLoading(false);
      }
    })();
    return () => { active = false; };
  }, [menu.entityId, menu.path, isBackground, targetPaths[0], shareRequested]);

  const handleShareItem = async (item: import('../lib/ipcBridge').ShareMenuItem) => {
    const wins = targetPaths.filter(isValidShellTarget).map(p => toWindowsPath(p));
    if (!wins.length) {
      setToastMessage('No valid target path.');
      onClose();
      return;
    }
    const IPC = await runIpc();
    if (item.kind === 'sendto' && item.target) {
      IPC.executeContextMenuVerb(wins.length === 1 ? wins[0] : wins, 'sendto', undefined, undefined, false, item.target);
    } else if (item.kind === 'copy-to-device' && item.target) {
      IPC.executeContextMenuVerb(wins.length === 1 ? wins[0] : wins, 'copy-to-device', undefined, undefined, false, item.target);
      setToastMessage(`Sending to ${item.label?.replace(/^Send to\s+/i, '').replace(/…$/, '') || 'device'}…`);
    } else if (item.kind === 'open' && item.target) {
      addTab(activePaneId, item.target);
    } else if (item.verb) {
      IPC.executeContextMenuVerb(wins.length === 1 ? wins[0] : wins, item.verb);
    }
    onClose();
  };

  const shareMain = shareItems.filter(i => i.group === 'main');
  const shareDevices = shareItems.filter(i => i.group === 'device');
  const shareSendTo = shareItems.filter(i => i.group === 'sendto');
  const shareCloud = shareItems.filter(i => i.group === 'cloud');
  const effectiveShareMain = shareMain.length > 0 ? shareMain : staticShareMain;
  const showShareMenu = !isBackground && (effectiveShareMain.length > 0 || shareDevices.length > 0);

  const handleVerb = async (verb: string) => {
    const v = (verb || '').toLowerCase();
    const shellExempt = new Set(['paste', 'properties', 'openas', 'openwith', 'settings']);
    const wins = targetPaths.filter(isValidShellTarget).map(p => toWindowsPath(p));
    if (!wins.length && !shellExempt.has(v)) {
      setToastMessage('No valid target path.');
      onClose();
      return;
    }
    if (v === 'copy') {
      setClipboardState(wins, 'copy');
      onClose();
      return;
    }
    if (v === 'cut') {
      setClipboardState(wins, 'cut');
      onClose();
      return;
    }
    if (v === 'paste') {
      if (isBndzVirtualPath(menu.path)) {
        setToastMessage('Smart views are read-only. Open a folder to paste.');
        onClose();
        return;
      }
      await executePaste(menu.path);
      onClose();
      return;
    }
    if (v === 'rename' && menu.entityId && menu.entityName) {
      setInlineRename({
        path: menu.path,
        entityId: menu.entityId,
        currentName: getRenameInitialValue({
          name: menu.entityName,
          extension: menu.entityExtension || undefined,
          type: menu.isDirectory ? 'directory' : 'file',
        }, config),
      });
      onClose();
      return;
    }
    if (v === 'delete' || v === 'trash') {
      if (isRecycleBinPath(menu.path)) {
        onPurgeRecycleItems?.(wins);
      } else {
        onDeletePaths(wins);
      }
      onClose();
      return;
    }
    const IPC = await runIpc();
    if (v === 'properties') {
      const panePaths = resolveContextTargetPanePaths(menu);
      const targets = panePaths
        .filter(isValidShellTarget)
        .map(p => resolveShellPropertiesPath(p))
        .filter(Boolean) as string[];
      if (!targets.length) {
        setToastMessage('Cannot open properties for this location.');
        onClose();
        return;
      }
      IPC.executeContextMenuVerb(targets.length === 1 ? targets[0] : targets, 'properties');
      onClose();
      return;
    }
    if (v === 'open') {
      const panePaths = resolveContextTargetPanePaths(menu);
      const dirs = menu.isDirectory || itemKind === 'folder';
      if (onOpenInBndz && panePaths.length) {
        onOpenInBndz(panePaths, { isDirectory: dirs, entityId: menu.entityId });
        onClose();
        return;
      }
      // Fallback: folder → stay in BNDZ via open-in-new-tab path; never ShellExecute 'open'.
      if (dirs && panePaths[0]) {
        addTab(activePaneId, panePaths[0]);
        onClose();
        return;
      }
      if (wins[0]) {
        IPC.executeContextMenuVerb(wins[0], 'open');
      }
      onClose();
      return;
    }
    IPC.executeContextMenuVerb(wins, v, undefined, undefined, rt.shell.bypassRecycle);
    onClose();
  };

  const renderNativeItem = (item: NativeContextMenuItem, i: number, keyPrefix = 'native'): React.ReactNode => {
    if (item.separator) return <div key={`${keyPrefix}-sep-${i}`} className="bndz-context-menu-sep" />;
    const iconSrc = typeof item.iconBase64 === 'string' && item.iconBase64.startsWith('data:')
      ? item.iconBase64
      : null;
    if (item.children && item.children.length > 0) {
      return (
        <ContextSubmenu
          key={`${keyPrefix}-${item.id || item.label || i}`}
          label={item.label || item.id || 'More'}
          iconVerb={item.icon || 'shell'}
        >
          {item.children.map((child, j) => renderNativeItem(child, j, `${keyPrefix}-${i}`))}
        </ContextSubmenu>
      );
    }
    const verb = resolveNativeItemVerb(item);
    if (!verb) return null;
    return (
      <ContextMenuItem
        key={`${keyPrefix}-${item.id || verb || i}`}
        label={item.label || item.id}
        verb={verb}
        iconSrc={iconSrc}
        iconVerb={iconSrc ? undefined : (item.icon || item.verb || 'shell')}
        className={item.isPrimary ? 'font-semibold' : ''}
        onClick={() => handleVerb(verb)}
      />
    );
  };

  const fullEntityPath = () => {
    if (menu.entityId && menu.entityName) {
      return joinPanePath(menu.path, { name: menu.entityName });
    }
    if (menu.entityName && menu.entityId === null) {
      return normalizePanePath(menu.path);
    }
    return menu.path;
  };

  const resolveScriptPath = (rel: string) => {
    const baseDir = (typeof window !== 'undefined' && (window as any).chrome?.webview)
      ? '' : '';
    const combined = baseDir ? `${baseDir}\\${rel}` : rel;
    return combined.replace(/\//g, '\\');
  };

  // The rich BNDZ context menu is ALWAYS the primary menu (file list, tree, sidebar,
  // preview). Native OS shell verbs never render as a standalone menu that could
  // preempt/replace it after an async fetch — they only appear MERGED into the rich
  // menu via `filterSupplementalNativeItems` (rendered as `supplementalNative` below).
  // This guarantees the tree and listview show identical structure with no swap/flicker.

  if (isBackground || isRecycleLocation) {
    if (isRecycleBinPath(menu.path) || isRecycleLocation) {
      return (
        <ClampedFixedMenu
          x={menu.x}
          y={menu.y}
          className="min-w-[220px] text-sm"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <ContextMenuItem label="Open" iconVerb="open" className="font-semibold" onClick={() => { addTab(activePaneId, RECYCLE_BIN_PATH); onClose(); }} />
          <ContextMenuItem
            label="Empty Recycle Bin"
            iconVerb="delete"
            className="text-red-300"
            onClick={() => { onEmptyRecycleBin?.(); onClose(); }}
          />
          <div className="bndz-context-menu-sep" />
          <ContextMenuItem label={refreshLabel} iconVerb="refresh" onClick={() => { runRefresh(); onClose(); }} />
          <ContextMenuItem
            label="Properties"
            iconVerb="properties"
            onClick={async () => {
              const IPC = await runIpc();
              IPC.shellExecute('properties', RECYCLE_BIN_PATH, undefined, buildShellExecuteOptions(config));
              onClose();
            }}
          />
        </ClampedFixedMenu>
      );
    }

    return (
      <ClampedFixedMenu
        x={menu.x}
        y={menu.y}
        className="min-w-[220px] text-sm"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <ContextMenuItem label={refreshLabel} iconVerb="refresh" onClick={() => { runRefresh(); onClose(); }} />

        {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
          <ContextSubmenu label="Smart Tools" iconVerb="sparkles" groupClass="bg-smart">
            {stockOn('ask-agent') && targetPaths.length > 0 && (
              <ContextMenuItem
                label="Ask about selection"
                iconVerb="sparkles"
                onClick={e => {
                  e.stopPropagation();
                  const prompt = `What can you tell me about these ${targetPaths.length} item(s)?\n${targetPaths.slice(0, 8).map(p => toWindowsPath(p)).join('\n')}`;
                  window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'assistant', prompt } }));
                  onClose();
                }}
              />
            )}
            <ContextMenuItem
              label="Assistant"
              iconVerb="sparkles"
              onClick={e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'assistant' } }));
                onClose();
              }}
            />
            <ContextMenuItem
              label="Find duplicates"
              iconVerb="copy"
              onClick={e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'duplicates' } }));
                onClose();
              }}
            />
            <ContextMenuItem
              label="Auto-organize folder"
              iconVerb="folder"
              onClick={e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'organize' } }));
                onClose();
              }}
            />
            <ContextMenuItem
              label="Detect BPM + Key"
              iconVerb="music"
              onClick={e => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'music' } }));
                onClose();
              }}
            />
            <div className="bndz-context-menu-sep" />
            {[
              ['Create folders 01-12.bat', 'Assets/Resources/Scripts/Create folders 01-12.bat'],
              ['Example parsing selection with PowerShell.ps1', 'Assets/Resources/Scripts/Example parsing selection with PowerShell.ps1'],
              ['Powershell create folder with current date_time.ps1', 'Assets/Resources/Scripts/Powershell create folder with current date_time.ps1'],
              ['Save details of selected files as text file.bat', 'Assets/Resources/Scripts/Save details of selected files as text file.bat'],
              ['Save folder list as text.bat', 'Assets/Resources/Scripts/Save folder list as text.bat'],
            ].map(([label, script]) => (
              <ContextMenuItem
                key={label}
                label={label}
                iconVerb="terminal"
                onClick={async e => {
                  e.stopPropagation();
                  const IPC = await runIpc();
                  IPC.shellExecute('executeScript', resolveScriptPath(script), menu.path);
                  onClose();
                }}
              />
            ))}
          </ContextSubmenu>
        )}

        {isFsDropTargetPath(menu.path) && !isRecycleBinPath(menu.path) && (
          <ContextSubmenu label="New" iconVerb="newfolder" groupClass="bg-new">
            <ContextMenuItem
              label="Folder"
              iconVerb="folder"
              onClick={async e => {
                e.stopPropagation();
                const r = await createItemInPane(menu.path, 'New folder', 'dir');
                setToastMessage(r.ok ? 'Folder created.' : (r.error || 'Failed to create folder.'));
                if (r.ok) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            <div className="bndz-context-menu-sep" />
            <ContextMenuItem
              label="Text Document"
              iconVerb="filetext"
              onClick={async e => {
                e.stopPropagation();
                const r = await createItemInPane(menu.path, 'New Text Document.txt', 'file');
                setToastMessage(r.ok ? 'Text document created.' : (r.error || 'Failed to create file.'));
                if (r.ok) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            <ContextMenuItem
              label="Markdown Document"
              iconVerb="filetext"
              onClick={async e => {
                e.stopPropagation();
                const r = await createItemInPane(menu.path, 'New Document.md', 'file');
                setToastMessage(r.ok ? 'Markdown document created.' : (r.error || 'Failed to create file.'));
                if (r.ok) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            <ContextMenuItem
              label="Compressed (zipped) Folder"
              iconVerb="zip"
              onClick={async e => {
                e.stopPropagation();
                const IPC = await runIpc();
                const base = await (await import('../lib/ramStagingPaths')).resolvePanePathForFs(menu.path);
                if (!base || /^bndz\\/i.test(base)) {
                  setToastMessage('Cannot create archives here.');
                  onClose();
                  return;
                }
                const zipPath = `${base.replace(/\\+$/, '')}\\New Compressed Folder.zip`;
                const res = await IPC.createArchive([], zipPath, 'zip');
                setToastMessage(isQueuedIpcResult(res) ? 'Archive queued — see transfer panel.' : (res.ok ? 'Compressed folder created.' : (res.error || 'Failed to create zip.')));
                if (!isQueuedIpcResult(res) && res.ok) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            <ContextMenuItem
              label="Shortcut"
              iconVerb="shortcut"
              onClick={async e => {
                e.stopPropagation();
                const IPC = await runIpc();
                const base = await (await import('../lib/ramStagingPaths')).resolvePanePathForFs(menu.path);
                if (!base || /^bndz\\/i.test(base)) {
                  setToastMessage('Cannot create shortcuts here.');
                  onClose();
                  return;
                }
                const linkPath = `${base.replace(/\\+$/, '')}\\New Shortcut.lnk`;
                const target = base;
                const res = await IPC.createLink(linkPath, target, 'shortcut');
                setToastMessage(isQueuedIpcResult(res) ? 'Shortcut queued — see transfer panel.' : (res.success ? 'Shortcut created.' : (res.error || 'Failed to create shortcut.')));
                if (!isQueuedIpcResult(res) && res.success) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            <ContextMenuItem
              label="Symbolic Link"
              iconVerb="link"
              onClick={async e => {
                e.stopPropagation();
                const IPC = await runIpc();
                const base = await (await import('../lib/ramStagingPaths')).resolvePanePathForFs(menu.path);
                if (!base || /^bndz\\/i.test(base)) {
                  setToastMessage('Cannot create symlinks here.');
                  onClose();
                  return;
                }
                const linkPath = `${base.replace(/\\+$/, '')}\\New Symlink`;
                const res = await IPC.createLink(linkPath, base, 'symlink');
                setToastMessage(res.success ? 'Symbolic link created.' : (res.error || 'Failed to create symlink. Try running as Administrator.'));
                if (res.success) {
                  runRefresh();
                  window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: menu.path } }));
                }
                onClose();
              }}
            />
            {shellNewCascade?.children && shellNewCascade.children.length > 0 && (
              <>
                <div className="bndz-context-menu-sep" />
                <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-white/35 select-none">Windows New</div>
                {shellNewCascade.children.map((child, j) => renderNativeItem(child, j, 'shell-new'))}
              </>
            )}
          </ContextSubmenu>
        )}

        {menu.surface === 'list-background' && (onSortBy || onGroupByChange) && (
          <>
            <div className="bndz-context-menu-sep" />
            {onSortBy && (
              <ContextSubmenu label="Sort by" iconVerb="type">
                {SORT_BY_OPTIONS.map(opt => (
                  <ContextMenuItem
                    key={opt.value}
                    label={opt.label}
                    iconNode={<span className="w-3.5 shrink-0 text-center text-[#99c9f0]">{sortColumn === opt.value ? '●' : ''}</span>}
                    onClick={() => { onSortBy(opt.value); onClose(); }}
                  />
                ))}
                <div className="bndz-context-menu-sep" />
                <ContextMenuItem
                  label="Ascending"
                  iconNode={<span className="w-3.5 shrink-0 text-center text-[#99c9f0]">{sortDirection === 'asc' ? '●' : ''}</span>}
                  onClick={() => { onSetSortDirection?.('asc'); onClose(); }}
                />
                <ContextMenuItem
                  label="Descending"
                  iconNode={<span className="w-3.5 shrink-0 text-center text-[#99c9f0]">{sortDirection === 'desc' ? '●' : ''}</span>}
                  onClick={() => { onSetSortDirection?.('desc'); onClose(); }}
                />
              </ContextSubmenu>
            )}
            {onGroupByChange && (
              <ContextSubmenu label="Group by" iconVerb="layers">
                {LIST_GROUP_BY_OPTIONS.map(opt => (
                  <ContextMenuItem
                    key={opt.value}
                    label={opt.label}
                    iconNode={<span className="w-3.5 shrink-0 text-center text-[#99c9f0]">{(listGroupBy || 'none') === opt.value ? '●' : ''}</span>}
                    onClick={() => { onGroupByChange(opt.value); onClose(); }}
                  />
                ))}
              </ContextSubmenu>
            )}
          </>
        )}

        <div className="bndz-context-menu-sep" />
        <ContextMenuItem label="Paste" iconVerb="paste" onClick={() => handleVerb('paste')} />
        {menu.surface === 'list-background' && onSelectAll && (
          <ContextMenuItem label="Select all" iconVerb="check" onClick={() => { onSelectAll(); onClose(); }} />
        )}
        {menu.surface === 'list-background' && onInvertSelection && (
          <ContextMenuItem label="Invert selection" iconVerb="type" onClick={() => { onInvertSelection(); onClose(); }} />
        )}
        {menu.surface === 'list-background' && ctxBeh.findFilesCommandsInListContextMenu && onOpenFind && (
          <ContextMenuItem label="Find Files…" iconVerb="find" onClick={() => { onOpenFind(); onClose(); }} />
        )}
        {menu.surface === 'list-background' && ctxBeh.navigationCommandsInListContextMenu && (
          <>
            {onNavigateUp && <ContextMenuItem label="Go up" iconVerb="parent" onClick={() => { onNavigateUp(); onClose(); }} />}
            {onGoBack && <ContextMenuItem label="Back" iconVerb="back" onClick={() => { onGoBack(); onClose(); }} />}
            {onGoForward && <ContextMenuItem label="Forward" iconVerb="forward" onClick={() => { onGoForward(); onClose(); }} />}
          </>
        )}
        <ContextMenuItem label="Properties" iconVerb="properties" onClick={() => handleVerb('properties')} />
        {supplementalNative.length > 0 && (
          <>
            <div className="bndz-context-menu-sep" />
            {supplementalNative.map((item, i) => renderNativeItem(item, i))}
          </>
        )}
      </ClampedFixedMenu>
    );
  }

  if (menu.surface === 'sidebar-item') {
    const itemPath = normalizePanePath(menu.path);
    const norm = itemPath.replace(/\\/g, '/').toLowerCase();
    const pinned = config.pinnedFavorites || [];
    const isPinned = pinned.some((p: any) => normalizePanePath(p.path).replace(/\\/g, '/').toLowerCase() === norm);
    const isHidden = (config.hiddenRapidAccess || []).some((p: string) => normalizePanePath(p).replace(/\\/g, '/').toLowerCase() === norm);
    const isDefault = (rapidAccessDefaultPaths || []).some(p => normalizePanePath(p).replace(/\\/g, '/').toLowerCase() === norm);

    return (
      <ClampedFixedMenu
        x={menu.x}
        y={menu.y}
        className="min-w-[200px]"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <ContextMenuItem
          label="Open"
          iconVerb="open"
          className="font-semibold"
          onClick={() => handleVerb('open')}
        />
        {isPinned && onRenameFavorite && (
          <ContextMenuItem
            label="Rename"
            iconVerb="rename"
            onClick={() => { onRenameFavorite(itemPath); onClose(); }}
          />
        )}
        {isPinned && (
          <ContextMenuItem
            label="Unpin from Rapid access"
            iconVerb="star"
            onClick={() => {
              updateConfig({ pinnedFavorites: dedupePinnedFavorites(pinned.filter((p: any) => normalizePanePath(p.path).replace(/\\/g, '/').toLowerCase() !== norm)) });
              setToastMessage(`Unpinned "${menu.entityName || 'folder'}" from Rapid access.`);
              onClose();
            }}
          />
        )}
        {isDefault && !isHidden && (
          <ContextMenuItem
            label="Hide from Rapid access"
            iconVerb="delete"
            onClick={() => {
              updateConfig({ hiddenRapidAccess: [...(config.hiddenRapidAccess || []), itemPath] });
              setToastMessage(`Hidden "${menu.entityName || 'folder'}" from Rapid access. Restore in Settings → Rapid access.`);
              onClose();
            }}
          />
        )}
        <div className="bndz-context-menu-sep" />
        <ContextMenuItem label="Properties" iconVerb="properties" onClick={() => handleVerb('properties')} />
      </ClampedFixedMenu>
    );
  }

  const entityPath = fullEntityPath();
  const pinned = config.pinnedFavorites || [];
  const normEntityPath = normalizePanePath(entityPath);
  const isPinned = pinned.some((p: any) => normalizePanePath(p.path) === normEntityPath);
  const fileName = menu.entityName || targetPaths[0]?.split(/[/\\]/).pop() || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const isArchive = targetPaths.length === 1 && isArchiveExt(ext);
  const isInRecycleBin = isRecycleBinPath(menu.path);
  const isFolder = itemKind === 'folder' || menu.isDirectory;

  const extractHere = async () => {
    const panePaths = resolveContextTargetPanePaths(menu);
    const win = toWindowsPath(panePaths[0] || targetPaths[0]);
    const { archiveQuickExtractDest } = await import('../lib/archiveExtractDest');
    const dest = archiveQuickExtractDest(win);
    const IPC = await runIpc();
    const res = await IPC.extractArchive(win, dest);
    const folder = dest.split('\\').pop() || 'extracted';
    setToastMessage(isQueuedIpcResult(res) ? 'Extract queued — see transfer panel.' : (res.ok ? `Extracted to ${folder}` : (res.error || 'Extract failed.')));
    onClose();
  };

  const extractToBrowse = async () => {
    const panePaths = resolveContextTargetPanePaths(menu);
    const win = toWindowsPath(panePaths[0] || targetPaths[0]);
    const IPC = await runIpc();
    const dest = await IPC.openFolderDialog('Extract archive to…');
    if (!dest) {
      onClose();
      return;
    }
    const res = await IPC.extractArchive(win, dest);
    setToastMessage(isQueuedIpcResult(res) ? 'Extract queued — see transfer panel.' : (res.ok ? `Extracted to ${dest}` : (res.error || 'Extract failed.')));
    onClose();
  };

  return (
    <ClampedFixedMenu
      x={menu.x}
      y={menu.y}
      className="min-w-[220px]"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {isInRecycleBin && onRestoreRecycleItems && (
        <>
          <ContextMenuItem
            label="Restore"
            iconVerb="undo"
            className="font-semibold"
            onClick={() => { void onRestoreRecycleItems(targetPaths); onClose(); }}
          />
          <div className="bndz-context-menu-sep" />
        </>
      )}

      {isArchive && (
        <>
          <ContextMenuItem
            label="Extract…"
            iconVerb="extract"
            className="font-semibold"
            onClick={() => void extractToBrowse()}
          />
          <ContextMenuItem
            label="Quick Extract"
            iconVerb="extract"
            onClick={() => void extractHere()}
          />
        </>
      )}

      {(config.pinnedContextActions || []).length > 0 && (
        <>
          {(config.pinnedContextActions || []).map((action: { id: string; label: string; verb?: string }) => (
            <ContextMenuItem
              key={action.id}
              label={action.label}
              iconVerb={(action.verb as any) || 'filetext'}
              onClick={() => { if (action.verb) void handleVerb(action.verb); }}
            />
          ))}
          <div className="bndz-context-menu-sep" />
        </>
      )}

      {/* Primary open — folder / shortcut / app / file */}
      <ContextMenuItem
        label="Open"
        iconVerb="open"
        className="font-semibold"
        onClick={() => handleVerb('open')}
      />

      {itemKind === 'folder' && (
        <ContextMenuItem
          label="Open in New Tab"
          iconVerb="open"
          onClick={() => { addTab(activePaneId, entityPath); onClose(); }}
        />
      )}

      {itemKind === 'shortcut' && (
        <>
          <ContextMenuItem
            label={openLocationTarget ? openLocationTarget.label : 'Open file location'}
            iconVerb="openexplorer"
            disabled={!openLocationTarget}
            onClick={() => {
              if (!openLocationTarget) {
                setToastMessage(shortcutInfo?.error || 'Could not resolve shortcut target.');
                onClose();
                return;
              }
              void goOpenFileLocation(openLocationTarget);
            }}
          />
          {shortcutInfo?.targetExists && !shortcutInfo.targetIsDirectory && /\.exe$/i.test(shortcutInfo.targetPath || '') && (
            <ContextMenuItem
              label="Run as administrator"
              iconVerb="runas"
              onClick={() => handleVerb('runas')}
            />
          )}
        </>
      )}

      {itemKind === 'app' && (
        <>
          <ContextMenuItem
            label="Run as administrator"
            iconVerb="runas"
            onClick={() => handleVerb('runas')}
          />
          {openLocationTarget && (
            <ContextMenuItem
              label={openLocationTarget.label}
              iconVerb="openexplorer"
              onClick={() => void goOpenFileLocation(openLocationTarget)}
            />
          )}
        </>
      )}

      {itemKind === 'file' && (
        <>
          <ContextMenuItem label="Open With..." iconVerb="openas" onClick={() => handleVerb('openas')} />
          <ContextMenuItem
            label="Edit"
            iconVerb="edit"
            onClick={() => handleVerb('edit')}
            disabled={!['txt', 'md', 'log', 'json', 'xml', 'csv', 'ini', 'bat', 'ps1'].includes(ext)}
          />
          {openLocationTarget && (
            <ContextMenuItem
              label={openLocationTarget.label}
              iconVerb="openexplorer"
              onClick={() => void goOpenFileLocation(openLocationTarget)}
            />
          )}
        </>
      )}

      {(itemKind === 'shortcut' || itemKind === 'app') && (
        <ContextMenuItem label="Open With..." iconVerb="openas" onClick={() => handleVerb('openas')} />
      )}

      <div className="bndz-context-menu-sep" />

      {!isBackground && targetPaths.length > 0 && stockOn('ask-agent') && (
        <ContextMenuItem
          label="Ask Agent about selection"
          iconVerb="sparkles"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-open-smart-tools', { detail: { tab: 'agent' } }));
            onClose();
          }}
        />
      )}

      {/* Standard file operations */}
      {!isInRecycleBin && (
        <>
          <ContextMenuItem label="Cut" iconVerb="cut" onClick={() => handleVerb('cut')} />
          <ContextMenuItem label="Copy" iconVerb="copy" onClick={() => handleVerb('copy')} />
          <ContextMenuItem label="Paste" iconVerb="paste" onClick={() => handleVerb('paste')} />
        </>
      )}
      {!isBackground && !isInRecycleBin && onCopyTo && (
        <ContextMenuItem
          label="Copy to..."
          iconVerb="copy"
          onClick={() => {
            const sources = resolveContextTargetPanePaths(menu);
            onClose();
            void onCopyTo(sources);
          }}
        />
      )}
      {!isBackground && !isInRecycleBin && onMoveTo && (
        <ContextMenuItem
          label="Move to..."
          iconVerb="moveto"
          onClick={() => {
            const sources = resolveContextTargetPanePaths(menu);
            onClose();
            void onMoveTo(sources);
          }}
        />
      )}
      {isInRecycleBin ? (
        <ContextMenuItem label="Delete permanently" iconVerb="delete" onClick={() => handleVerb('delete')} />
      ) : (
        <>
          <ContextMenuItem label="Delete" iconVerb="delete" onClick={() => handleVerb('delete')} />
          <ContextMenuItem label="Rename" iconVerb="rename" onClick={() => handleVerb('rename')} />
        </>
      )}

      {!isBackground && showShareMenu && (
        <ContextSubmenu label="Share" iconVerb="share" onOpen={() => setShareRequested(true)}>
          {effectiveShareMain.map(item => (
            <ContextMenuItem
              key={item.id || item.label}
              label={item.label || 'Share'}
              iconVerb="share"
              onClick={() => void handleShareItem(item)}
            />
          ))}
          {shareDevices.length > 0 && (
            <>
              <div className="bndz-context-menu-sep" />
              <ContextNestedSubmenu label="Phone / devices">
                <div className="max-h-[220px] overflow-y-auto overflow-x-hidden bndz-scrollbar">
                  {shareDevices.map(item => (
                    <ContextMenuItem
                      key={item.id || item.label}
                      label={item.label || 'Device'}
                      iconVerb="portable-device"
                      onClick={() => void handleShareItem(item)}
                    />
                  ))}
                </div>
              </ContextNestedSubmenu>
            </>
          )}
          {shareSendTo.length > 0 && (
            <>
              <div className="bndz-context-menu-sep" />
              <ContextNestedSubmenu label="Send to">
                <div className="max-h-[220px] overflow-y-auto overflow-x-hidden bndz-scrollbar">
                  {shareSendTo.map(item => (
                    <ContextMenuItem
                      key={item.id || item.label}
                      label={item.label || 'Send'}
                      iconVerb="share"
                      onClick={() => void handleShareItem(item)}
                    />
                  ))}
                </div>
              </ContextNestedSubmenu>
            </>
          )}
          {shareCloud.length > 0 && (
            <>
              <div className="bndz-context-menu-sep" />
              <ContextNestedSubmenu label="Cloud">
                {shareCloud.map(item => (
                  <ContextMenuItem
                    key={item.id || item.label}
                    label={item.label || 'Cloud'}
                    iconVerb="share"
                    onClick={() => void handleShareItem(item)}
                  />
                ))}
              </ContextNestedSubmenu>
            </>
          )}
          {shareLoading && shareSendTo.length === 0 && shareCloud.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-[#888]">Loading share options…</div>
          )}
          {shareError && !shareLoading && (
            <div className="px-3 py-1.5 text-[11px] text-rose-300/90">{shareError}</div>
          )}
        </ContextSubmenu>
      )}

      <div className="bndz-context-menu-sep" />

      {/* BNDZ features */}
      {!isBackground && availableTags && availableTags.length > 0 && onToggleTag && (
        <ContextSubmenu label="Tags">
          {selectionTagKeys && selectionTagKeys.length > 0 && onRemoveAllTags && (
            <>
              <ContextMenuItem
                label="Remove all tags"
                iconVerb="delete"
                onClick={() => { void onRemoveAllTags(); onClose(); }}
              />
              <div className="bndz-context-menu-sep" />
            </>
          )}
          {availableTags.map(tag => {
            const key = resolveTagKey(tag);
            const label = tag.label || tag.name || key;
            const color = tag.color || '#6b7280';
            const tagged = selectionTagKeys?.some(t => entityHasTag([t], key)) ?? false;
            return (
              <ContextMenuItem
                key={key}
                label={tagged ? `Untag · ${label}` : label}
                onClick={() => { void onToggleTag(tag); onClose(); }}
                trailing={tagged ? '✓' : undefined}
                iconNode={
                  <span
                    className="w-3 h-3 rounded-[3px] shrink-0 border border-white/15"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                }
              />
            );
          })}
        </ContextSubmenu>
      )}

      {menu.isDirectory ? (
        <>
        <ContextMenuItem
          label={isPinned ? 'Unpin from Rapid access' : 'Pin to Rapid access'}
          iconVerb="star"
          onClick={() => {
            if (isPinned) {
              updateConfig({ pinnedFavorites: dedupePinnedFavorites(pinned.filter((p: any) => normalizePanePath(p.path) !== normEntityPath)) });
              setToastMessage(`Unpinned "${menu.entityName || 'folder'}" from Rapid access.`);
            } else if (menu.entityName) {
              const pinPath = collapseKnownFolderShadowPath(normEntityPath);
              updateConfig({ pinnedFavorites: dedupePinnedFavorites([...pinned, { name: menu.entityName, path: pinPath, icon: 'folder' }]) });
              setToastMessage(`Pinned "${menu.entityName}" to Rapid access.`);
            }
            onClose();
          }}
        />
        {stockOn('index') && (
        <ContextMenuItem
          label="Index folder for search"
          iconVerb="search"
          onClick={() => {
            void import('../lib/ipcBridge').then(({ IPC }) => {
              IPC.indexBndzLocation(normEntityPath).then(res => {
                setToastMessage(res.ok ? 'Indexing folder for BNDZ search…' : (res.error || 'Indexing failed.'));
                if (res.ok) window.dispatchEvent(new CustomEvent('bndz-index-roots-changed'));
              });
            });
            onClose();
          }}
        />
        )}
        {stockOn('hello-gate') && (
        <>
        <ContextMenuItem
          label="Require Hello to open"
          iconVerb="lock"
          onClick={() => {
            void (async () => {
              const winPath = toWindowsPath(normEntityPath);
              const passphrase = await requestNativePrompt({
                title: 'Hello gate',
                message: 'Optional backup passphrase (leave blank for Hello-only)',
                defaultValue: '',
              });
              if (passphrase == null) return;
              const res = await IPC.helloGateAdd(winPath, passphrase || undefined);
              setToastMessage(res.ok ? `Hello gate enabled for ${menu.entityName || 'folder'}.` : (res.error || 'Failed to add gate.'));
            })();
            onClose();
          }}
        />
        <ContextMenuItem
          label="Remove Hello gate"
          iconVerb="unlock"
          onClick={() => {
            void import('../lib/ipcBridge').then(({ IPC }) => {
              IPC.helloGateRemove(toWindowsPath(normEntityPath)).then(res => {
                setToastMessage(res.ok ? 'Hello gate removed.' : 'No gate on this folder.');
              });
            });
            onClose();
          }}
        />
        </>
        )}
        {stockOn('zk-vault') && (
        <>
        <ContextMenuItem
          label="Create ZK Vault"
          iconVerb="lock"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'zk-vault' } }));
            onClose();
          }}
        />
        <ContextMenuItem
          label="Unlock ZK Vault"
          iconVerb="key"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'zk-vault' } }));
            onClose();
          }}
        />
        </>
        )}
        {stockOn('job-ticket') && (
        <ContextMenuItem
          label="Attach Job Ticket"
          iconVerb="clock_ui"
          onClick={() => {
            void (async () => {
              const title = await requestNativePrompt({
                title: 'Job ticket',
                message: 'Ticket title',
                defaultValue: menu.entityName ? `${menu.entityName} delivery` : 'Production ticket',
              });
              if (!title?.trim()) return;
              const due = new Date(Date.now() + 24 * 3_600_000);
              const res = await IPC.jobTicketSave({
                folderPath: toWindowsPath(normEntityPath),
                title: title.trim(),
                dueUtc: due.toISOString(),
                status: 'open',
              });
              setToastMessage(res.ok ? 'Job ticket attached.' : (res.error || 'Could not save ticket.'));
              if (res.ok) window.dispatchEvent(new CustomEvent('bndz-job-ticket-changed'));
            })();
            onClose();
          }}
        />
        )}
        {stockOn('cross-volume') && (
        <ContextMenuItem
          label="Cross-volume board"
          iconVerb="sync_folders"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('bndz-twin-volume-seed', {
              detail: { leftRoot: toWindowsPath(normEntityPath) },
            }));
            window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: '/bndz/twin-volume' } }));
            onClose();
          }}
        />
        )}
        </>
      ) : (
        stockOn('smart-rename') ? (
        <ContextMenuItem
          label="Smart Rename"
          iconVerb="sparkles"
          onClick={() => { onOpenBatchRename?.(); onClose(); }}
        />
        ) : null
      )}

      {!isBackground && targetPaths.length === 1 && stockOn('photo-studio') && isImageExt((targetPaths[0].split('.').pop() || '').toLowerCase()) && (
        <ContextMenuItem
          label="Edit in Photo Studio"
          iconVerb="picture_ui"
          onClick={() => {
            dispatchOpenPhotoStudio(targetPaths[0]);
            onClose();
          }}
        />
      )}

      {!isBackground && targetPaths.length > 0 && stockOn('spatial-pin') && (
        <ContextMenuItem
          label="Pin to Spatial Canvas"
          iconVerb="map"
          onClick={() => {
            void pinPathsToSpatialCanvas(targetPaths.map(p => toWindowsPath(p))).then(count => {
              if (count > 0) {
                setToastMessage(`Pinned ${count} item${count === 1 ? '' : 's'} to Spatial Canvas`);
                window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_CANVAS } }));
              } else {
                setToastMessage('Items already pinned on Spatial Canvas');
              }
            });
            onClose();
          }}
        />
      )}

      {!isBackground && targetPaths.length > 0 && stockOn('automation') && (
        <ContextMenuItem
          label="Send to Automation"
          iconVerb="emblem-shared"
          onClick={() => {
            dispatchAutomationFromPin(targetPaths.map(p => toWindowsPath(p)), { navigate: true });
            setToastMessage('Opened Automations with selected paths');
            window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: BNDZ_AUTOMATION } }));
            onClose();
          }}
        />
      )}

      {!isBackground && targetPaths.length > 0 && IPC.isNative && (
        <>
          {isFolder && !isBndzVirtualPath(entityPath) && stockOn('mesh-drop') && (
            <ContextMenuItem
              label="Launch Ephemeral Mesh host…"
              iconVerb="cloud_ui"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('bndz-command-deck-tool', { detail: { id: 'mesh-ephemeral' } }));
                onClose();
              }}
            />
          )}
          {stockOn('mesh-drop') && (
          <ContextMenuItem
            label="Mesh Drop…"
            iconVerb="emblem-shared"
            onClick={() => { onOpenMeshDrop?.(targetPaths); onClose(); }}
          />
          )}
          {meshPluginInstalled && targetPaths.some(p => isMeshPath(p)) && (
            <>
              <ContextMenuItem
                label="Shell Here (Remote Mesh)"
                iconVerb="terminal"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-command-deck-tool', { detail: { id: 'mesh-shell-here' } }));
                  onClose();
                }}
              />
              <ContextMenuItem
                label="Download from Mesh…"
                iconVerb="download"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bndz-command-deck-tool', { detail: { id: 'mesh-download' } }));
                  onClose();
                }}
              />
              {!menu.isDirectory && (
                <ContextMenuItem
                  label="Edit Remote…"
                  iconVerb="edit"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('bndz-command-deck-tool', { detail: { id: 'mesh-edit-remote' } }));
                    onClose();
                  }}
                />
              )}
            </>
          )}
          {meshPluginInstalled && (
          <ContextMenuItem
            label="Add to Shared Libraries"
            iconVerb="emblem-shared"
            onClick={() => {
              const paths = (menu.isDirectory || targetPaths.length === 1)
                ? targetPaths.map(p => toWindowsPath(p))
                : targetPaths.filter(p => !/\.[^./\\]+$/.test(p)).map(p => toWindowsPath(p));
              const usePaths = paths.length ? paths : targetPaths.slice(0, 1).map(p => toWindowsPath(p));
              window.dispatchEvent(new CustomEvent('bndz-add-shared-libraries', { detail: { paths: usePaths } }));
              setToastMessage(usePaths.length > 1 ? `Added ${usePaths.length} shared libraries` : 'Added to Shared Libraries');
              onClose();
            }}
          />
          )}
          {stockOn('ghost-link') && (
          <ContextMenuItem
            label="Ghost-Link offload…"
            iconVerb="emblem-symbolic-link"
            onClick={() => { void onGhostLinkOffload?.(targetPaths); onClose(); }}
          />
          )}
          {stockOn('ram-staging') && (
          <ContextMenuItem
            label="Stage to RAM…"
            iconVerb="hard_drive_ui"
            onClick={() => { void onStageToRam?.(targetPaths); onClose(); }}
          />
          )}
        </>
      )}

      {!isBackground && menu.isGhostLink && menu.entityId && (
        <ContextMenuItem
          label="Restore ghost link"
          iconVerb="refresh"
          onClick={() => { void onGhostLinkRestore?.(fullEntityPath()); onClose(); }}
        />
      )}

      {(!!config.customItemsInTheContextMenu && (config.customContextMenuActions?.length || 0) > 6) && (
        <>
          <div className="px-2 py-1.5">
            <input
              type="text"
              placeholder="Filter menu…"
              value={menuFilter}
              onChange={e => setMenuFilter(e.target.value)}
              className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#0078d4]"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="bndz-context-menu-sep" />
        </>
      )}

      {!!config.customItemsInTheContextMenu && config.customContextMenuActions?.filter((action: any) => {
        const isSep = action.id === 'separator' || String(action.id || '').startsWith('separator_')
          || action.command === 'separator' || action.name === 'separator' || action.name === '—';
        if (isSep) return true;
        const label = (action.name || action.label || '').toLowerCase();
        const q = menuFilter.trim().toLowerCase();
        return !q || label.includes(q);
      }).map((action: any, idx: number) => {
        const isSep = action.id === 'separator' || String(action.id || '').startsWith('separator_')
          || action.command === 'separator' || action.name === 'separator' || action.name === '—';
        if (isSep) return <div key={idx} className="bndz-context-menu-sep" />;
        const cmd = (action.command || '').trim();
        const iconVerb =
          action.id === 'copy-path' || cmd === 'copyPath' ? 'copypath'
          : action.id === 'os-delete' ? 'delete'
          : action.id === 'smart-rename' ? 'sparkles'
          : cmd === 'openTerminal' ? 'terminal'
          : cmd === 'refresh' ? 'refresh'
          : 'filetext';
        return (
          <ContextMenuItem
            key={idx}
            label={action.name || action.label || 'Custom action'}
            iconVerb={iconVerb}
            onClick={async () => {
              const IPC = await runIpc();
              // Legacy hard-coded ids
              if (action.id === 'smart-rename') onOpenBatchRename?.();
              else if (action.id === 'copy-path') IPC.shellExecute('copyPath', targetPaths);
              else if (action.id === 'os-copy') setClipboardState(targetPaths, 'copy');
              else if (action.id === 'os-paste') await executePaste(menu.path);
              else if (action.id === 'os-delete') onDeletePaths(targetPaths);
              // Shell Menus plugin command-based actions
              else if (cmd === 'refresh') runRefresh();
              else if (cmd === 'copyPath') IPC.shellExecute('copyPath', targetPaths);
              else if (cmd === 'openTerminal') IPC.shellExecute('openTerminal', targetPaths, undefined, buildShellExecuteOptions(config));
              else if (cmd === 'openExplorer') IPC.shellExecute('openExplorer', targetPaths);
              else if (cmd) {
                // Arbitrary command: expand %1 with first target and run via shell
                const expanded = cmd.replace(/%1/g, toWindowsPath(targetPaths[0] || ''));
                IPC.shellExecute('runCommand', expanded, menu.path, buildShellExecuteOptions(config));
              }
              onClose();
            }}
          />
        );
      })}

      {itemKind === 'folder' && openLocationTarget && (
        <ContextMenuItem
          label={openLocationTarget.label}
          iconVerb="openexplorer"
          onClick={() => void goOpenFileLocation(openLocationTarget)}
        />
      )}

      <ContextSubmenu label="Open in..." iconVerb="open" groupClass="open-in">
        <ContextMenuItem
          label="Open in Terminal"
          iconVerb="terminal"
          onClick={async () => {
            const IPC = await runIpc();
            IPC.shellExecute('openTerminal', targetPaths, undefined, buildShellExecuteOptions(config));
            onClose();
          }}
        />
        <ContextMenuItem
          label="Show in Explorer"
          iconVerb="openexplorer"
          onClick={async () => {
            const IPC = await runIpc();
            IPC.shellExecute('openExplorer', targetPaths);
            onClose();
          }}
        />
      </ContextSubmenu>

      <ContextSubmenu label="Archive" iconVerb="archive" groupClass="archive">
        <ContextMenuItem
          label="Create ZIP (native)"
          iconVerb="zip"
          onClick={async e => {
            e.stopPropagation();
            const IPC = await runIpc();
            const wins = targetPaths.map(p => toWindowsPath(p));
            const parent = wins[0].replace(/\\[^\\]+$/, '');
            const name = wins.length === 1 ? `${wins[0].split('\\').pop()}.zip` : 'Archive.zip';
            const res = await IPC.createArchive(wins, `${parent}\\${name}`, 'zip');
            setToastMessage(isQueuedIpcResult(res) ? 'Archive queued — see transfer panel.' : (res.ok ? 'ZIP archive created.' : (res.error || 'Archive failed.')));
            onClose();
          }}
        />
        <ContextMenuItem
          label="Create 7z"
          iconVerb="7z"
          onClick={async e => {
            e.stopPropagation();
            const IPC = await runIpc();
            const wins = targetPaths.map(p => toWindowsPath(p));
            const parent = wins[0].replace(/\\[^\\]+$/, '');
            const name = wins.length === 1 ? `${wins[0].split('\\').pop()}.7z` : 'Archive.7z';
            const res = await IPC.createArchive(wins, `${parent}\\${name}`, '7z');
            setToastMessage(isQueuedIpcResult(res) ? 'Archive queued — see transfer panel.' : (res.ok ? '7z archive created.' : (res.error || 'Archive failed.')));
            onClose();
          }}
        />
        <ContextMenuItem
          label="Create RAR (WinRAR)"
          iconVerb="rar"
          onClick={async e => {
            e.stopPropagation();
            const IPC = await runIpc();
            const wins = targetPaths.map(p => toWindowsPath(p));
            const parent = wins[0].replace(/\\[^\\]+$/, '');
            const name = wins.length === 1 ? `${wins[0].split('\\').pop()}.rar` : 'Archive.rar';
            const res = await IPC.createArchive(wins, `${parent}\\${name}`, 'rar' as any);
            setToastMessage(isQueuedIpcResult(res) ? 'Archive queued — see transfer panel.' : (res.ok ? 'RAR archive created.' : (res.error || 'Archive failed.')));
            onClose();
          }}
        />
        <ContextMenuItem
          label="Compress (Shell)"
          iconVerb="compress"
          onClick={async () => {
            const IPC = await runIpc();
            IPC.shellExecute('compress', targetPaths);
            onClose();
          }}
        />
        {isArchive && (
          <>
            <div className="bndz-context-menu-sep" />
            <ContextMenuItem
              label="Extract…"
              iconVerb="extract"
              onClick={async e => { e.stopPropagation(); await extractToBrowse(); }}
            />
            <ContextMenuItem
              label="Quick Extract"
              iconVerb="extract"
              onClick={async e => { e.stopPropagation(); await extractHere(); }}
            />
            <ContextMenuItem
              label="Extract (Shell)"
              iconVerb="extract"
              onClick={async () => {
                const IPC = await runIpc();
                IPC.shellExecute('extract', targetPaths);
                onClose();
              }}
            />
          </>
        )}
      </ContextSubmenu>

      {targetPaths.length === 1 && (
        <ContextSubmenu label="Create Link" iconVerb="link" groupClass="links">
          <ContextMenuItem
            label="Create Shortcut"
            iconVerb="shortcut"
            onClick={async e => {
              e.stopPropagation();
              const target = toWindowsPath(targetPaths[0]);
              const parent = target.replace(/\\[^\\]+$/, '');
              const base = target.split('\\').pop() || 'item';
              const linkPath = `${parent}\\${base} - Shortcut`;
              const IPC = await runIpc();
              const res = await IPC.createLink(linkPath, target, 'shortcut');
              setToastMessage(isQueuedIpcResult(res) ? 'Shortcut queued — see transfer panel.' : (res.success ? 'Shortcut created.' : (res.error || 'Failed to create shortcut.')));
              if (!isQueuedIpcResult(res)) runRefresh();
              onClose();
            }}
          />
          <div className="bndz-context-menu-sep" />
          {([
            ['symlink', 'Symbolic Link'],
            ['hardlink', 'Hard Link'],
            ['junction', 'Junction'],
          ] as const).map(([lt, label]) => (
            <ContextMenuItem
              key={lt}
              label={label}
              iconVerb={lt}
              onClick={async e => {
                e.stopPropagation();
                const target = toWindowsPath(targetPaths[0]);
                const parent = target.replace(/\\[^\\]+$/, '');
                const base = target.split('\\').pop() || 'item';
                const suffix = lt === 'symlink' ? ' - Symlink' : lt === 'hardlink' ? ' - Hardlink' : ' - Junction';
                const linkPath = `${parent}\\${base}${suffix}`;
                const IPC = await runIpc();
                const res = await IPC.createLink(linkPath, target, lt);
                setToastMessage(isQueuedIpcResult(res) ? `${label} queued — see transfer panel.` : (res.success ? `${label} created.` : (res.error || 'Failed to create link.')));
                onClose();
              }}
            />
          ))}
        </ContextSubmenu>
      )}

      <ContextMenuItem
        label="Copy Path"
        iconVerb="copypath"
        onClick={async () => {
          const IPC = await runIpc();
          IPC.shellExecute('copyPath', targetPaths);
          onClose();
        }}
      />

      <div className="bndz-context-menu-sep" />
      <ContextMenuItem label="Properties" iconVerb="properties" onClick={() => handleVerb('properties')} />

      {stockOn('change-icon') && config.enableIconContextSubmenu !== false && targetPaths.length === 1 && (
        <ContextNestedSubmenu
          label={<><Icons8Icon id="picture_ui" size={14} className="mr-0.5" /> Change Icon</>}
          panelClassName="min-w-[180px]"
          onOpen={ensureIconLibraries}
        >
          {iconLibs.length === 0 ? (
            <div className={`${menuItemClass} text-gray-500`}>Loading icon libraries…</div>
          ) : iconLibs.map((lib: any) => (
            <ContextNestedSubmenu
              key={lib.id}
              label={<><ContextMenuIcon verb="layers" />{lib.name}</>}
              panelClassName="w-[260px] flex flex-wrap gap-2 p-2"
            >
              {(lib.icons || []).map((ico: any, idx: number) => {
                const icoStr = typeof ico === 'string' ? ico : (ico.icoStr || '');
                const resolved = resolveIconFilePath(icoStr, lib.sourceFolder);
                if (!resolved) return null;
                return (
                  <button
                    key={idx}
                    type="button"
                    title={typeof ico === 'object' ? (ico.name || '') : undefined}
                    className="w-10 h-10 bg-[#333] hover:bg-[#444] border border-[#555] rounded cursor-pointer flex items-center justify-center p-1 overflow-hidden"
                    onMouseDown={async e => {
                      e.stopPropagation();
                      const targetType = menu.isDirectory ? 'folder' : (menu.entityName?.toLowerCase().endsWith('.lnk') ? 'shortcut' : 'file');
                      const IPC = await runIpc();
                      const { prepareIconForApply } = await import('../lib/iconPathUtils');
                      const icoPath = await prepareIconForApply(resolved);
                      if (!icoPath) {
                        setToastMessage('Could not prepare icon for apply.');
                        onClose();
                        return;
                      }
                      const winPath = toWindowsPath(targetPaths[0]);
                      const result = await IPC.setSystemIcon(winPath, targetType, icoPath, !!config.allowGlobalIconOverwrite);
                      setToastMessage(result.success ? 'Icon applied successfully.' : (result.error || 'Failed to apply icon.'));
                      await IPC.clearIconCache();
                      updateConfig({ iconCacheBuster: Date.now() });
                      runRefresh();
                      onClose();
                    }}
                  >
                    <IconPreviewImage path={resolved} size={32} className="pointer-events-none" />
                  </button>
                );
              })}
            </ContextNestedSubmenu>
          ))}
        </ContextNestedSubmenu>
      )}

      {supplementalNative.length > 0 && (
        <>
          <div className="bndz-context-menu-sep" />
          {supplementalNative.map((item, i) => renderNativeItem(item, i))}
        </>
      )}
    </ClampedFixedMenu>
  );
}

export default React.memo(ContextMenuView);
