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
  isContextMenuBackground,
  contextMenuRefreshLabel,
} from '../lib/contextMenuActions';
import { normalizePanePath, toWindowsPath, joinPanePath, joinPanePathForFs, isValidShellTarget, isRecycleBinPath } from '../lib/pathUtils';
import { isBndzVirtualPath } from '../lib/bndzVirtualViews';
import { resolveTagKey, entityHasTag } from '../lib/tagUtils';
import { dedupePinnedFavorites } from '../lib/rapidAccessDefaults';
import { resolveShellPropertiesPath } from '../lib/shellPaths';
import { resolveIconFilePath } from '../lib/iconPathUtils';
import { buildSettingsRuntime, getRenameInitialValue } from '../lib/settingsRuntime';
import { isArchiveExt } from '../lib/archiveTypes';
import type { SortColumnId } from '../lib/listColumns';
import type { ListGroupBy } from '../lib/listGrouping';
import { LIST_GROUP_BY_OPTIONS } from '../lib/listGrouping';
import type { ClipboardAction } from '../data/ClipboardContext';

const SORT_BY_OPTIONS: Array<{ value: SortColumnId; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'size', label: 'Size' },
  { value: 'modified', label: 'Date modified' },
  { value: 'created', label: 'Date created' },
];

interface ContextMenuViewProps {
  menu: ContextMenuState;
  onClose: () => void;
  config: any;
  updateConfig: (patch: any) => void;
  activePaneId: string;
  addTab: (paneId: string, path: string) => void;
  onOpenBatchRename?: () => void;
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
  onSelectAll?: () => void;
  onInvertSelection?: () => void;
}

function ContextMenuView({
  menu, onClose, config, updateConfig, activePaneId, addTab,
  onOpenBatchRename, setIsSmartToolsOpen, setToastMessage, setInlineRename,
  setClipboardState, executePaste, onDeletePaths, onEmptyRecycleBin, onRefreshList, onRefreshTree,
  onCopyTo, onMoveTo, availableTags, onToggleTag, selectionTagKeys, onRemoveAllTags, rapidAccessDefaultPaths,
  sortColumn, sortDirection, onSortBy, onSetSortDirection, listGroupBy, onGroupByChange, onRenameFavorite,
  onRestoreRecycleItems, onSelectAll, onInvertSelection,
}: ContextMenuViewProps) {
  const rt = buildSettingsRuntime(config);
  const targetPaths = resolveContextTargetPaths(menu);
  const isBackground = isContextMenuBackground(menu);
  const refreshLabel = contextMenuRefreshLabel(menu.surface);
  const runRefresh = () => {
    const surface = menu.surface;
    if (surface === 'tree-background' || surface === 'tree-item') onRefreshTree?.();
    else onRefreshList?.();
  };
  const supplementalNative = filterSupplementalNativeItems(menu.nativeContextItems);
  const [iconLibs, setIconLibs] = useState<any[]>(config.iconLibraries || []);
  const [iconLibsLoaded, setIconLibsLoaded] = useState(false);
  const [shareItems, setShareItems] = useState<import('../lib/ipcBridge').ShareMenuItem[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareRequested, setShareRequested] = useState(false);
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
      return;
    }
    let active = true;
    setShareLoading(true);
    (async () => {
      try {
        const IPC = await runIpc();
        const items = await IPC.fetchShareMenuItems(targetPaths[0]);
        if (active) setShareItems(items || []);
      } catch {
        if (active) setShareItems([]);
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
    } else if (item.kind === 'open' && item.target) {
      addTab(activePaneId, item.target);
    } else if (item.verb) {
      IPC.executeContextMenuVerb(wins.length === 1 ? wins[0] : wins, item.verb);
    }
    onClose();
  };

  const shareMain = shareItems.filter(i => i.group === 'main');
  const shareSendTo = shareItems.filter(i => i.group === 'sendto');
  const shareCloud = shareItems.filter(i => i.group === 'cloud');
  const effectiveShareMain = shareMain.length > 0 ? shareMain : staticShareMain;
  const showShareMenu = !isBackground && effectiveShareMain.length > 0;

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
      onDeletePaths(wins);
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
    if (v === 'open' && menu.isDirectory && wins[0]) {
      IPC.executeContextMenuVerb(wins[0], 'open');
    } else {
      IPC.executeContextMenuVerb(wins, v, undefined, undefined, rt.shell.bypassRecycle);
    }
    onClose();
  };

  const renderNativeItem = (item: any, i: number) => {
    if (item.separator) return <div key={`sep-${i}`} className="bndz-context-menu-sep" />;
    return (
      <ContextMenuItem
        key={item.id || i}
        label={item.label || item.id}
        verb={item.verb || item.id}
        iconVerb={item.icon || item.verb}
        className={item.isPrimary ? 'font-semibold' : ''}
        onClick={() => handleVerb(item.verb || item.id)}
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

  if (isBackground) {
    if (isRecycleBinPath(menu.path)) {
      return (
        <ClampedFixedMenu
          x={menu.x}
          y={menu.y}
          className="bndz-context-menu py-1 min-w-[220px] text-sm bndz-scrollbar"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <ContextMenuItem label="Open" iconVerb="open" className="font-semibold" onClick={() => { onClose(); }} />
          <ContextMenuItem
            label="Empty Recycle Bin"
            iconVerb="delete"
            className="text-red-300"
            onClick={() => { onEmptyRecycleBin?.(); onClose(); }}
          />
          <div className="bndz-context-menu-sep" />
          <ContextMenuItem label={refreshLabel} iconVerb="refresh" onClick={() => { runRefresh(); onClose(); }} />
        </ClampedFixedMenu>
      );
    }

    return (
      <ClampedFixedMenu
        x={menu.x}
        y={menu.y}
        className="bndz-context-menu py-1 min-w-[220px] text-sm bndz-scrollbar"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <ContextMenuItem label={refreshLabel} iconVerb="refresh" onClick={() => { runRefresh(); onClose(); }} />

        {config.enableContextSubmenus !== false && (
          <>
            <ContextSubmenu label="Smart Tools" iconVerb="sparkles" groupClass="bg-smart">
              {targetPaths.length > 0 && (
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

            <ContextSubmenu label="New" iconVerb="newfolder" groupClass="bg-new">
              <ContextMenuItem
                label="Folder"
                iconVerb="folder"
                onClick={async e => {
                  e.stopPropagation();
                  const IPC = await runIpc();
                  IPC.executeFsOperation(`new-folder-${Date.now()}`, 'create-dir', joinPanePathForFs(menu.path, 'New folder'), '');
                  runRefresh();
                  onClose();
                }}
              />
              <div className="bndz-context-menu-sep" />
              <ContextMenuItem
                label="Text Document"
                iconVerb="filetext"
                onClick={async e => {
                  e.stopPropagation();
                  const IPC = await runIpc();
                  IPC.executeFsOperation(`new-file-${Date.now()}`, 'create-file', joinPanePathForFs(menu.path, 'New Text Document.txt'), '');
                  runRefresh();
                  onClose();
                }}
              />
            </ContextSubmenu>
          </>
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
                    iconNode={<span className="w-3.5 shrink-0 text-center text-sky-300">{sortColumn === opt.value ? '●' : ''}</span>}
                    onClick={() => { onSortBy(opt.value); onClose(); }}
                  />
                ))}
                <div className="bndz-context-menu-sep" />
                <ContextMenuItem
                  label="Ascending"
                  iconNode={<span className="w-3.5 shrink-0 text-center text-sky-300">{sortDirection === 'asc' ? '●' : ''}</span>}
                  onClick={() => { onSetSortDirection?.('asc'); onClose(); }}
                />
                <ContextMenuItem
                  label="Descending"
                  iconNode={<span className="w-3.5 shrink-0 text-center text-sky-300">{sortDirection === 'desc' ? '●' : ''}</span>}
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
                    iconNode={<span className="w-3.5 shrink-0 text-center text-sky-300">{(listGroupBy || 'none') === opt.value ? '●' : ''}</span>}
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
        <ContextMenuItem label="Properties" iconVerb="properties" onClick={() => handleVerb('properties')} />
        {supplementalNative.length > 0 && (
          <>
            <div className="bndz-context-menu-sep" />
            {supplementalNative.map(renderNativeItem)}
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
        className="bndz-context-menu py-1 min-w-[200px] bndz-scrollbar"
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

  const extractHere = async () => {
    const panePaths = resolveContextTargetPanePaths(menu);
    const win = toWindowsPath(panePaths[0] || targetPaths[0]);
    const parent = win.replace(/\\[^\\]+$/, '');
    const folder = win.split('\\').pop()?.replace(/\.[^.]+$/, '') || 'extracted';
    const IPC = await runIpc();
    IPC.extractArchive(win, `${parent}\\${folder}`);
    setToastMessage(`Extracting to ${folder}…`);
    onClose();
  };

  return (
    <ClampedFixedMenu
      x={menu.x}
      y={menu.y}
      className="bndz-context-menu py-1 min-w-[220px] bndz-scrollbar"
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
        <ContextMenuItem
          label="Extract Here"
          iconVerb="extract"
          className="font-semibold"
          onClick={() => void extractHere()}
        />
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

      {/* Primary open */}
      <ContextMenuItem
        label="Open"
        iconVerb="open"
        className="font-semibold"
        onClick={() => handleVerb('open')}
      />

      {menu.isDirectory ? (
        <ContextMenuItem
          label="Open in New Tab"
          iconVerb="open"
          onClick={() => { addTab(activePaneId, entityPath); onClose(); }}
        />
      ) : (
        <>
          <ContextMenuItem label="Open With..." iconVerb="openas" onClick={() => handleVerb('openas')} />
          <ContextMenuItem
            label="Edit"
            iconVerb="edit"
            onClick={() => handleVerb('edit')}
            disabled={!['txt', 'md', 'log', 'json', 'xml', 'csv', 'ini', 'bat', 'ps1'].includes(ext)}
          />
        </>
      )}

      <div className="bndz-context-menu-sep" />

      {!isBackground && targetPaths.length > 0 && (
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
      <ContextMenuItem label="Cut" iconVerb="cut" onClick={() => handleVerb('cut')} />
      <ContextMenuItem label="Copy" iconVerb="copy" onClick={() => handleVerb('copy')} />
      <ContextMenuItem label="Paste" iconVerb="paste" onClick={() => handleVerb('paste')} />
      {!isBackground && onCopyTo && (
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
      {!isBackground && onMoveTo && (
        <ContextMenuItem
          label="Move to..."
          iconVerb="cut"
          onClick={() => {
            const sources = resolveContextTargetPanePaths(menu);
            onClose();
            void onMoveTo(sources);
          }}
        />
      )}
      <ContextMenuItem label="Delete" iconVerb="delete" onClick={() => handleVerb('delete')} />
      <ContextMenuItem label="Rename" iconVerb="rename" onClick={() => handleVerb('rename')} />

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
              updateConfig({ pinnedFavorites: dedupePinnedFavorites([...pinned, { name: menu.entityName, path: normEntityPath, icon: 'folder' }]) });
              setToastMessage(`Pinned "${menu.entityName}" to Rapid access.`);
            }
            onClose();
          }}
        />
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
        </>
      ) : (
        <ContextMenuItem
          label="Smart Rename"
          iconVerb="sparkles"
          onClick={() => { onOpenBatchRename?.(); onClose(); }}
        />
      )}

      {(config.customContextMenuActions?.length || 0) > 6 && (
        <>
          <div className="px-2 py-1.5">
            <input
              type="text"
              placeholder="Filter menu…"
              value={menuFilter}
              onChange={e => setMenuFilter(e.target.value)}
              className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-[11px] text-white outline-none focus:border-sky-500"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="bndz-context-menu-sep" />
        </>
      )}

      {config.customContextMenuActions?.filter((action: any) => {
        if (action.id === 'separator') return true;
        const label = (action.name || action.label || '').toLowerCase();
        const q = menuFilter.trim().toLowerCase();
        return !q || label.includes(q);
      }).map((action: any, idx: number) => {
        if (action.id === 'separator') return <div key={idx} className="bndz-context-menu-sep" />;
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
              else if (cmd === 'openTerminal') IPC.shellExecute('openTerminal', targetPaths);
              else if (cmd === 'openExplorer') IPC.shellExecute('openExplorer', targetPaths);
              else if (cmd) {
                // Arbitrary command: expand %1 with first target and run via shell
                const expanded = cmd.replace(/%1/g, toWindowsPath(targetPaths[0] || ''));
                IPC.shellExecute('runCommand', expanded);
              }
              onClose();
            }}
          />
        );
      })}

      <ContextSubmenu label="Open in..." iconVerb="monitor" groupClass="open-in">
        <ContextMenuItem
          label="Open in Terminal"
          iconVerb="terminal"
          onClick={async () => {
            const IPC = await runIpc();
            IPC.shellExecute('openTerminal', targetPaths);
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
            IPC.createArchive(wins, `${parent}\\${name}`, 'zip');
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
            IPC.createArchive(wins, `${parent}\\${name}`, '7z');
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
            IPC.createArchive(wins, `${parent}\\${name}`, 'rar' as any);
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
              label="Extract Here"
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
              setToastMessage(res.success ? 'Shortcut created.' : (res.error || 'Failed to create shortcut.'));
              runRefresh();
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
                setToastMessage(res.success ? `${label} created.` : (res.error || 'Failed to create link.'));
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

      {config.enableIconContextSubmenu && targetPaths.length === 1 && (
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
          {supplementalNative.map(renderNativeItem)}
        </>
      )}
    </ClampedFixedMenu>
  );
}

export default React.memo(ContextMenuView);
