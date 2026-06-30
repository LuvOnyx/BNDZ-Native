import React, { useEffect, useState } from 'react';
import { Sparkles, Star, Type, ChevronRight } from 'lucide-react';
import ClampedFixedMenu from './ClampedFixedMenu';
import { ContextMenuIcon } from './ContextMenuIcon';
import { ContextMenuItem, ContextSubmenu, ContextNestedSubmenu, menuItemClass } from './ContextSubmenu';
import IconPreviewImage from './plugins/IconStudio/IconPreviewImage';
import {
  ContextMenuState,
  resolveContextTargetPaths,
  resolveContextTargetPanePaths,
  filterSupplementalNativeItems,
} from '../lib/contextMenuActions';
import { toWindowsPath, joinPanePath, joinPanePathForFs, isValidShellTarget, isRecycleBinPath, normalizePanePath } from '../lib/pathUtils';
import { resolveShellPropertiesPath } from '../lib/shellPaths';
import { resolveIconFilePath } from '../lib/iconPathUtils';
import { buildSettingsRuntime } from '../lib/settingsRuntime';
import { isArchiveExt } from '../lib/archiveTypes';
import type { ClipboardAction } from '../data/ClipboardContext';

interface ContextMenuViewProps {
  menu: ContextMenuState;
  onClose: () => void;
  config: any;
  updateConfig: (patch: any) => void;
  activePaneId: string;
  addTab: (paneId: string, path: string) => void;
  setIsSmartToolsOpen: (v: boolean) => void;
  setToastMessage: (msg: string) => void;
  setInlineRename: (v: { path: string; entityId: string; currentName: string } | null) => void;
  setClipboardState: (items: string[], action: ClipboardAction) => void;
  executePaste: (targetDir: string) => Promise<void>;
  onDeletePaths: (paths: string[]) => void;
  onEmptyRecycleBin?: () => void;
  onRefresh?: () => void;
  onCopyTo?: (sources: string[]) => void | Promise<void>;
  onMoveTo?: (sources: string[]) => void | Promise<void>;
}

export default function ContextMenuView({
  menu, onClose, config, updateConfig, activePaneId, addTab,
  setIsSmartToolsOpen, setToastMessage, setInlineRename,
  setClipboardState, executePaste, onDeletePaths, onEmptyRecycleBin, onRefresh,
  onCopyTo, onMoveTo,
}: ContextMenuViewProps) {
  const rt = buildSettingsRuntime(config);
  const targetPaths = resolveContextTargetPaths(menu);
  const isBackground = menu.entityId === null && !menu.entityName;
  const supplementalNative = filterSupplementalNativeItems(menu.nativeContextItems);
  const [iconLibs, setIconLibs] = useState<any[]>(config.iconLibraries || []);
  const [shareItems, setShareItems] = useState<import('../lib/ipcBridge').ShareMenuItem[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
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
  }, [menu.x, menu.y, config.iconLibraries]);

  useEffect(() => {
    if (isBackground || !targetPaths.length) {
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
  }, [menu.entityId, menu.path, isBackground, targetPaths[0]]);

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
      await executePaste(menu.path);
      onClose();
      return;
    }
    if (v === 'rename' && menu.entityId && menu.entityName) {
      setInlineRename({ path: menu.path, entityId: menu.entityId, currentName: menu.entityName });
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

  const useCustomMenu = rt.shell.useCustomContextMenu;
  const allNative = menu.nativeContextItems || [];

  if (!useCustomMenu) {
    return (
      <ClampedFixedMenu
        x={menu.x}
        y={menu.y}
        className="bndz-context-menu shadow-2xl rounded-md py-1 min-w-[220px] text-sm bndz-scrollbar"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {allNative.length > 0 ? (
          allNative.map(renderNativeItem)
        ) : (
          <ContextMenuItem label="Loading…" disabled />
        )}
      </ClampedFixedMenu>
    );
  }

  if (isBackground) {
    if (isRecycleBinPath(menu.path)) {
      return (
        <ClampedFixedMenu
          x={menu.x}
          y={menu.y}
          className="bndz-context-menu shadow-2xl rounded-md py-1 min-w-[220px] text-sm bndz-scrollbar"
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
          <ContextMenuItem label="Refresh" iconVerb="refresh" onClick={() => { onRefresh?.(); onClose(); }} />
        </ClampedFixedMenu>
      );
    }

    return (
      <ClampedFixedMenu
        x={menu.x}
        y={menu.y}
        className="bndz-context-menu shadow-2xl rounded-md py-1 min-w-[220px] text-sm bndz-scrollbar"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <ContextMenuItem label="Refresh" iconVerb="refresh" onClick={() => { onRefresh?.(); onClose(); }} />

        {config.enableContextSubmenus !== false && (
          <>
            <ContextSubmenu label="Smart Tools" iconVerb="sparkles" groupClass="bg-smart">
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
                  onRefresh?.();
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
                  onRefresh?.();
                  onClose();
                }}
              />
            </ContextSubmenu>
          </>
        )}

        <div className="bndz-context-menu-sep" />
        <ContextMenuItem label="Paste" iconVerb="paste" onClick={() => handleVerb('paste')} />
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

  const entityPath = fullEntityPath();
  const pinned = config.pinnedFavorites || [];
  const normEntityPath = normalizePanePath(entityPath);
  const isPinned = pinned.some((p: any) => normalizePanePath(p.path) === normEntityPath);
  const fileName = menu.entityName || targetPaths[0]?.split(/[/\\]/).pop() || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const isArchive = targetPaths.length === 1 && isArchiveExt(ext);

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
      className="bndz-context-menu shadow-2xl rounded-md py-1 min-w-[220px] bndz-scrollbar"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
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

      <ContextSubmenu label="Pin to menu" iconVerb="pin">
        {[
          { verb: 'cut', label: 'Cut' },
          { verb: 'copy', label: 'Copy' },
          { verb: 'paste', label: 'Paste' },
          { verb: 'delete', label: 'Delete' },
          { verb: 'properties', label: 'Properties' },
        ].map(({ verb, label }) => {
          const pinned = (config.pinnedContextActions || []).some((p: { verb?: string }) => p.verb === verb);
          return (
            <ContextMenuItem
              key={verb}
              label={`${pinned ? '✓ ' : ''}${label}`}
              iconVerb={verb as any}
              onClick={() => {
                const pins = config.pinnedContextActions || [];
                const next = pinned
                  ? pins.filter((p: { verb?: string }) => p.verb !== verb)
                  : [...pins, { id: `pin-${verb}`, label, verb }];
                updateConfig({ pinnedContextActions: next });
                setToastMessage(pinned ? `Unpinned ${label}` : `Pinned ${label} to menu`);
                onClose();
              }}
            />
          );
        })}
      </ContextSubmenu>

      <div className="bndz-context-menu-sep" />

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
        <ContextSubmenu label="Share" iconVerb="share">
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
      {menu.isDirectory ? (
        <ContextMenuItem
          label={isPinned ? 'Unpin from Rapid access' : 'Pin to Rapid access'}
          icon={Star}
          onClick={() => {
            if (isPinned) {
              updateConfig({ pinnedFavorites: pinned.filter((p: any) => normalizePanePath(p.path) !== normEntityPath) });
            } else if (menu.entityName) {
              updateConfig({ pinnedFavorites: [...pinned, { name: menu.entityName, path: entityPath, icon: 'folder' }] });
            }
            onClose();
          }}
        />
      ) : (
        <ContextMenuItem
          label="Smart Rename"
          iconVerb="sparkles"
          onClick={() => { setIsSmartToolsOpen(true); onClose(); }}
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
              if (action.id === 'smart-rename') setIsSmartToolsOpen(true);
              else if (action.id === 'copy-path') IPC.shellExecute('copyPath', targetPaths);
              else if (action.id === 'os-copy') setClipboardState(targetPaths, 'copy');
              else if (action.id === 'os-paste') await executePaste(menu.path);
              else if (action.id === 'os-delete') onDeletePaths(targetPaths);
              // Shell Menus plugin command-based actions
              else if (cmd === 'refresh') onRefresh?.();
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
              onRefresh?.();
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

      {config.enableIconContextSubmenu && iconLibs.length > 0 && targetPaths.length === 1 && (
        <ContextNestedSubmenu
          label={<><Type size={14} className="text-sky-400" /> Change Icon</>}
          panelClassName="min-w-[180px]"
        >
          {iconLibs.map((lib: any) => (
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
                      onRefresh?.();
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
