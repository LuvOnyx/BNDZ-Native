import React, { useState, useEffect } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { useAppConfig } from '../data/configContext';
import { BndzWindowFrame } from './native/BndzWindowFrame';
import { NativeDialogShell } from './native/NativeDialogShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Checkbox } from './ui/checkbox';
import ConditionalFormattingDialog from './ConditionalFormattingDialog';
import IconConfiguratorTab from './IconConfiguratorTab';
import ContextMenuConfiguratorTab from './ContextMenuConfiguratorTab';
import ThemesTabContent from './settings/ThemesTabContent';
import AppearanceTabContent from './settings/AppearanceTabContent';
import FontsTabContent from './settings/FontsTabContent';
import KeyboardShortcutsTab from './settings/KeyboardShortcutsTab';
import ColorsTabContent from './settings/ColorsTabContent';
import UdcEditorTab from './settings/UdcEditorTab';
import CeaEditorTab from './settings/CeaEditorTab';
import { SettingsTabHeader, SettingsSection } from './settings/SettingsPrimitives';
import { applySettingsRuntime } from '../lib/settingsRuntime';
import { searchJumpSettings } from '../lib/jumpToSettingIndex';
import { mergeUserCommands } from '../lib/userCommands';
import BndzIndexManagerPanel from './settings/BndzIndexManagerPanel';

const DevOnly = ({ children }: { children: React.ReactNode }) => (
  import.meta.env.DEV ? <>{children}</> : null
);

const SectionHeader = ({ title }: { title: string }) => (
  <h3 className="text-[13px] font-bold text-white mt-6 mb-2 px-1 flex items-center gap-2 first:mt-0">
    <span className="bndz-settings-category-accent w-1 h-4 rounded-full shrink-0" />
    {title}
  </h3>
);

const ActionBtn = ({ label, className = '', onClick }: any) => (
  <button className={`bg-[#2a2a2a] hover:bg-[#444] border border-[#555] rounded-sm text-[12px] px-4 py-1 text-white ${className}`} onClick={onClick}>
    {label}
  </button>
)

export default function ConfigurationDialog({ onClose }: { onClose: () => void }) {
  const { config: globalConfig, updateConfig: updateGlobalConfig } = useAppConfig();
  const [localConfig, setLocalConfig] = useState(globalConfig);
  const [hasChanges, setHasChanges] = useState(false);
  const [applyFeedback, setApplyFeedback] = useState<'idle' | 'applied'>('idle');
  const [shellStatus, setShellStatus] = useState<string | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  const updateLocalConfig = (updates: any) => {
    setLocalConfig(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
    setApplyFeedback('idle');
  };
  const applyChanges = () => {
    updateGlobalConfig(localConfig);
    applySettingsRuntime(localConfig);
    setHasChanges(false);
    setApplyFeedback('applied');
    window.setTimeout(() => setApplyFeedback('idle'), 2200);
  };
  const okChanges = () => { applyChanges(); onClose(); };

  const applyShellToggle = async (
    updates: Record<string, boolean>,
    apply: () => Promise<{ success: boolean; message: string; needsElevation?: boolean }>,
    elevationLabel: string,
  ) => {
    setShellBusy(true);
    setShellStatus(null);
    const nextConfig = { ...localConfig, ...updates };
    updateLocalConfig(updates);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const { promptElevationIfNeeded } = await import('../lib/nativeDialog');
      const result = await apply();
      if (!result.success && result.needsElevation) {
        const elevated = await promptElevationIfNeeded(result, {
          title: 'Administrator approval required',
          message: `${result.message}\n\nRestart BNDZ as administrator to ${elevationLabel}?`,
        });
        if (!elevated) {
          setLocalConfig(prev => {
            const reverted = { ...prev };
            for (const key of Object.keys(updates)) {
              (reverted as any)[key] = !(updates as any)[key];
            }
            return reverted;
          });
          setShellStatus('Administrator approval was required but not granted.');
          return;
        }
      } else if (!result.success) {
        setLocalConfig(prev => {
          const reverted = { ...prev };
          for (const key of Object.keys(updates)) {
            (reverted as any)[key] = !(updates as any)[key];
          }
          return reverted;
        });
        setShellStatus(result.message || 'Shell integration change failed.');
      } else {
        setShellStatus(result.message);
        updateGlobalConfig(nextConfig);
        const { markShellIntegrationApplied } = await import('../lib/shellIntegrationRuntime');
        markShellIntegrationApplied(nextConfig);
      }
    } catch (err) {
      setShellStatus(err instanceof Error ? err.message : 'Shell integration change failed.');
    } finally {
      setShellBusy(false);
      window.setTimeout(() => setShellStatus(null), 5000);
    }
  };

  const handleContextMenuToggle = (checked: boolean) => {
    if (!checked && (localConfig.isDefaultFileManager ?? localConfig.bndzIsDefaultFileManager)) {
      void applyShellToggle(
        {
          inContextMenu: false,
          bndzInShellContextMenu: false,
          isDefaultFileManager: false,
          bndzIsDefaultFileManager: false,
        },
        async () => {
          const { IPC } = await import('../lib/ipcBridge');
          const fm = await IPC.setAsDefaultManager(false);
          if (!fm.success) return fm;
          return IPC.setInContextMenu(false);
        },
        'restore Windows Explorer and remove BNDZ from the shell context menu',
      );
      return;
    }
    void applyShellToggle(
      { inContextMenu: checked, bndzInShellContextMenu: checked },
      async () => {
        const { IPC } = await import('../lib/ipcBridge');
        return IPC.setInContextMenu(checked);
      },
      checked ? 'add BNDZ to the shell context menu' : 'remove BNDZ from the shell context menu',
    );
  };

  const handleDefaultFileManagerToggle = (checked: boolean) => {
    const updates: Record<string, boolean> = {
      isDefaultFileManager: checked,
      bndzIsDefaultFileManager: checked,
    };
    if (checked && !(localConfig.inContextMenu ?? localConfig.bndzInShellContextMenu)) {
      updates.inContextMenu = true;
      updates.bndzInShellContextMenu = true;
    }
    void applyShellToggle(
      updates,
      async () => {
        const { IPC } = await import('../lib/ipcBridge');
        if (checked && !(localConfig.inContextMenu ?? localConfig.bndzInShellContextMenu)) {
          const menuResult = await IPC.setInContextMenu(true);
          if (!menuResult.success) return menuResult;
        }
        return IPC.setAsDefaultManager(checked);
      },
      checked ? 'make BNDZ the default file manager' : 'restore Windows Explorer as default',
    );
  };

  const [activeTab, setActiveTab] = useState("Shell Integration");
  const [navFilter, setNavFilter] = useState('');
  const [showConditionalFormattingDialog, setShowConditionalFormattingDialog] = useState(false);
  const [showJumpDialog, setShowJumpDialog] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [runtimeInfo, setRuntimeInfo] = useState<{
    version: string;
    iniPath: string;
    is64Bit: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getAppRuntimeInfo().then(info => {
        if (!active || !info) return;
        setRuntimeInfo({
          version: info.version || '1.0.0',
          iniPath: info.iniPath || '',
          is64Bit: info.is64Bit !== false,
        });
      }).catch(() => {});
      IPC.getDefaultFileManagerStatus().then(status => {
        if (!active || !status) return;
        if (status.active !== !!(localConfig.isDefaultFileManager ?? localConfig.bndzIsDefaultFileManager)) {
          setLocalConfig(prev => ({
            ...prev,
            isDefaultFileManager: status.active,
            bndzIsDefaultFileManager: status.active,
          }));
        }
      }).catch(() => {});
    });
    return () => { active = false; };
  }, []);

  const configTitleSuffix = runtimeInfo?.iniPath
    ? `@ ${runtimeInfo.iniPath} - ${runtimeInfo.version} (${runtimeInfo.is64Bit ? '64' : '32'}-bit)`
    : runtimeInfo
      ? `BNDZ ${runtimeInfo.version}`
      : 'BNDZ';

  const categoryIcons: Record<string, React.ReactNode> = {
    General: <Icons8Icon id="config" size={13} className="opacity-70" />,
    'Colors and Styles': <Icons8Icon id="palette_ui" size={13} className="opacity-70" />,
    Information: <Icons8Icon id="info_ui" size={13} className="opacity-70" />,
    'File Operations': <Icons8Icon id="folder_open_ui" size={13} className="opacity-70" />,
    'Find and Filter': <Icons8Icon id="search" size={13} className="opacity-70" />,
    Preview: <Icons8Icon id="eye_ui" size={13} className="opacity-70" />,
    'Tabs and Panes': <Icons8Icon id="table_ui" size={13} className="opacity-70" />,
    Other: <Icons8Icon id="puzzle_ui" size={13} className="opacity-70" />,
  };

  const categories = [
    { name: "General", items: ["Tree and List", "Sort and Rename", "Refresh, Icons, History", "Menus, Mouse, Usability", "Custom Event Actions", "User Commands", "Safety Belts, Network", "Controls & More", "Startup & Exit", "Keyboard Shortcuts"] },
    { name: "Colors and Styles", items: ["Colors", "Themes", "Appearance", "Highlights & Dark Mode", "Styles", "Color Filters", "Fonts", "Templates", "Icon Configurator", "Context Menu"] },
    { name: "Information", items: ["Tags", "Custom Columns", "File Info Tips & Hover Box", "Report & Data"] },
    { name: "File Operations", items: ["File Operations", "Undo & Action Log"] },
    { name: "Find and Filter", items: ["Find Files & Branch View", "Filters & Type Ahead Find"] },
    { name: "Preview", items: ["Preview", "Previewed Formats", "Thumbnails", "Mouse Down Blow Up"] },
    { name: "Tabs and Panes", items: ["Tabs", "Dual Pane", "Plugin Rack", "Bottom Panel"] },
    { name: "Other", items: ["Shell Integration", "Rapid access", "Features"] }
  ];

  const jumpResults = searchJumpSettings(jumpQuery, categories.flatMap(c => c.items));

  const filteredCategories = categories.map(cat => ({
    ...cat,
    items: cat.items.filter(item => {
      const q = navFilter.trim().toLowerCase();
      if (!q) return true;
      return item.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q);
    }),
  })).filter(cat => cat.items.length > 0);

  const categoryAccent: Record<string, string> = {
    General: 'from-[#0078d4]/18 to-transparent border-[#0078d4]/30',
    'Colors and Styles': 'from-violet-500/22 to-transparent border-violet-500/30',
    Information: 'from-emerald-500/22 to-transparent border-emerald-500/30',
    'File Operations': 'from-amber-500/22 to-transparent border-amber-500/30',
    'Find and Filter': 'from-cyan-500/22 to-transparent border-cyan-500/30',
    Preview: 'from-pink-500/22 to-transparent border-pink-500/30',
    'Tabs and Panes': 'from-indigo-500/22 to-transparent border-indigo-500/30',
    Other: 'from-slate-500/22 to-transparent border-slate-500/35',
  };

  const categoryTabActive: Record<string, string> = {
    General: 'data-[state=active]:bg-[#094771]/35 data-[state=active]:text-[#cce4f7] data-[state=active]:border-[#0078d4]/35',
    'Colors and Styles': 'data-[state=active]:bg-violet-600/18 data-[state=active]:text-violet-100 data-[state=active]:border-violet-500/35',
    Information: 'data-[state=active]:bg-emerald-600/18 data-[state=active]:text-emerald-100 data-[state=active]:border-emerald-500/35',
    'File Operations': 'data-[state=active]:bg-amber-600/18 data-[state=active]:text-amber-100 data-[state=active]:border-amber-500/35',
    'Find and Filter': 'data-[state=active]:bg-cyan-600/18 data-[state=active]:text-cyan-100 data-[state=active]:border-cyan-500/35',
    Preview: 'data-[state=active]:bg-pink-600/18 data-[state=active]:text-pink-100 data-[state=active]:border-pink-500/35',
    'Tabs and Panes': 'data-[state=active]:bg-indigo-600/18 data-[state=active]:text-indigo-100 data-[state=active]:border-indigo-500/35',
    Other: 'data-[state=active]:bg-slate-600/18 data-[state=active]:text-slate-100 data-[state=active]:border-slate-500/35',
  };

  return (
    <BndzWindowFrame
      title="Configuration"
      subtitle={configTitleSuffix}
      iconId="config"
      onClose={onClose}
      widthClass="w-[min(850px,calc(100vw-2rem))]"
      heightClass="h-[min(650px,calc(100vh-2rem))]"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-row flex-1 min-h-0 overflow-hidden" orientation="vertical">
         {/* Sidebar Tabs */}
         <div className="bndz-settings-nav w-[240px] bg-[#141418] border-r border-[#333] shrink-0 flex flex-col min-h-0">
            <div className="shrink-0 p-2.5 border-b border-[#333] bg-[#141418] space-y-2">
              <div className="relative">
                <Icons8Icon id="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-60 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter settings…"
                  value={navFilter}
                  onChange={e => setNavFilter(e.target.value)}
                  className="w-full bg-[#0d0d10] border border-[#333] pl-8 pr-2 py-1.5 text-[11px] text-gray-200 placeholder-gray-600 outline-none focus:border-[#0078d4]/50"
                />
              </div>
              <button
                type="button"
                onClick={() => { setShowJumpDialog(true); setJumpQuery(''); }}
                className="bndz-settings-jump w-full text-gray-500 hover:text-[#7eb8e8] py-1 transition-colors text-left"
              >
                Jump to setting (Ctrl+F)
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
            <TabsList variant="line" className="!flex !flex-col !items-stretch !justify-start !w-full !h-auto !p-2 !gap-0 !rounded-none !bg-transparent">
               {filteredCategories.map((cat, i) => (
                 <div key={i} className="mb-3 last:mb-2">
                    <div className={`bndz-settings-category mb-1 px-2.5 py-1.5 rounded-md border bg-gradient-to-r flex items-center justify-between gap-1.5 ${categoryAccent[cat.name] || categoryAccent.Other}`}>
                      <span className="flex items-center gap-1.5 text-gray-300 min-w-0">
                        {categoryIcons[cat.name]}
                        <span className="truncate">{cat.name}</span>
                      </span>
                      <span className="bndz-panel-muted bndz-mono shrink-0 text-[10px]">{cat.items.length}</span>
                    </div>
                    <div className="flex flex-col gap-px pl-1">
                    {cat.items.map((item, j) => (
                       <TabsTrigger 
                         key={j} 
                         value={item} 
                         className={`!flex-none !grow-0 !shrink-0 !h-auto !min-h-[26px] !w-full !justify-start !text-left !px-2.5 !py-1.5 !text-[12px] !font-normal !rounded-md !border !border-transparent !whitespace-normal !leading-snug text-[#c8c8c8] hover:bg-white/5 !shadow-none after:!hidden ${categoryTabActive[cat.name] || categoryTabActive.Other}`}
                       >
                         {item}
                       </TabsTrigger>
                    ))}
                    </div>
                 </div>
               ))}
               {navFilter && filteredCategories.length === 0 && (
                 <div className="text-[11px] text-gray-500 text-center py-6 px-3">No settings match &ldquo;{navFilter}&rdquo;</div>
               )}
            </TabsList>
            </div>
         </div>

         {/* Content Area */}
         <div className="flex-1 min-w-0 min-h-0 bndz-settings-content bg-[#1a1a1e] p-[16px] pl-[20px] overflow-y-auto styled-scrollbar">
            
            <TabsContent value="Tree and List" className="m-0 border-0 p-0 outline-none">
              <SettingsTabHeader
                title="Tree and List"
                icon="shell_menus"
                description="Navigation tree behavior, list display options, and folder size scanning."
              />

              <SettingsSection title="Navigation tree" description="How folders expand, scroll, and appear in the sidebar.">
                 <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">h</span>idden system folders in tree</span>} checked={localConfig.showHiddenSystemFoldersInTree ?? false} onChange={e => updateLocalConfig({ showHiddenSystemFoldersInTree: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>uto-optimize tree</span>} checked={localConfig.autoOptimizeTree ?? false} onChange={e => updateLocalConfig({ autoOptimizeTree: e.target.checked })} />
                 <Checkbox label={<span>Expand tree nodes on <span className="underline decoration-1 underline-offset-[3px]">b</span>rowse</span>} checked={localConfig.expandTreeNodesOnBrowse ?? false} onChange={e => updateLocalConfig({ expandTreeNodesOnBrowse: e.target.checked })} />
                 <Checkbox label={<span>Expand tree nodes on <span className="underline decoration-1 underline-offset-[3px]">d</span>rag-over</span>} checked={localConfig.expandTreeNodesOnDragOver ?? false} onChange={e => updateLocalConfig({ expandTreeNodesOnDragOver: e.target.checked })} />
                 <Checkbox label={<span>Expand tree nodes on <span className="underline decoration-1 underline-offset-[3px]">s</span>ingle-click</span>} checked={localConfig.expandTreeNodesOnSingleClick ?? false} onChange={e => updateLocalConfig({ expandTreeNodesOnSingleClick: e.target.checked })} />
                 <Checkbox label={<span>Chec<span className="underline decoration-1 underline-offset-[3px]">k</span> existence of subfolders in tree</span>} checked={localConfig.checkExistenceOfSubfoldersInTree ?? false} onChange={e => updateLocalConfig({ checkExistenceOfSubfoldersInTree: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span>In network locations as <span className="underline decoration-1 underline-offset-[3px]">w</span>ell</span>} checked={localConfig.inNetworkLocationsAsWell ?? false} onChange={e => updateLocalConfig({ inNetworkLocationsAsWell: e.target.checked })} disabled={!localConfig.checkExistenceOfSubfoldersInTree} />
                 </div>
                 <Checkbox label={<span>Remembe<span className="underline decoration-1 underline-offset-[3px]">r</span> state of tree</span>} checked={localConfig.rememberStateOfTree ?? false} onChange={e => updateLocalConfig({ rememberStateOfTree: e.target.checked })} />
                 <Checkbox
                   label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">M</span>ini Tree module in sidebar</span>}
                   checked={localConfig.showMiniTree === true}
                   onChange={e => {
                     const enabled = e.target.checked;
                     const patch: Record<string, unknown> = { showMiniTree: enabled };
                     if (enabled) {
                       const order: string[] = [...(localConfig.sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])];
                       if (!order.includes('miniTree')) {
                         const treeIdx = order.indexOf('tree');
                         patch.sidebarOrder = treeIdx >= 0
                           ? [...order.slice(0, treeIdx), 'miniTree', ...order.slice(treeIdx)]
                           : [...order, 'miniTree'];
                       }
                     }
                     updateLocalConfig(patch);
                   }}
                 />
                 <div className="ml-[20px]">
                   <Checkbox
                     label={<span>Allow zombies in the Mini Tree</span>}
                     checked={localConfig.allowZombiesInTheMiniTree ?? false}
                     onChange={e => updateLocalConfig({ allowZombiesInTheMiniTree: e.target.checked })}
                     disabled={localConfig.showMiniTree !== true}
                   />
                 </div>
                 <Checkbox label={<span>S<span className="underline decoration-1 underline-offset-[3px]">h</span>ow localized folder names</span>} checked={localConfig.showLocalizedFolderNames ?? false} onChange={e => updateLocalConfig({ showLocalizedFolderNames: e.target.checked })} />
                 <Checkbox label={<span>Select parent of mo<span className="underline decoration-1 underline-offset-[3px]">v</span>ed folder</span>} checked={localConfig.selectParentOfMovedFolder ?? false} onChange={e => updateLocalConfig({ selectParentOfMovedFolder: e.target.checked })} />
                 <Checkbox label={<span>Select parent of <span className="underline decoration-1 underline-offset-[3px]">d</span>eleted folder</span>} checked={localConfig.selectParentOfDeletedFolder ?? false} onChange={e => updateLocalConfig({ selectParentOfDeletedFolder: e.target.checked })} />
                 <Checkbox label={<span>Scroll selected folder to <span className="underline decoration-1 underline-offset-[3px]">t</span>he top</span>} checked={localConfig.scrollSelectedFolderToTheTop ?? false} onChange={e => updateLocalConfig({ scrollSelectedFolderToTheTop: e.target.checked })} />
                 <Checkbox label={<span>Scroll subf<span className="underline decoration-1 underline-offset-[3px]">o</span>lders into view</span>} checked={localConfig.scrollSubfoldersIntoView ?? false} onChange={e => updateLocalConfig({ scrollSubfoldersIntoView: e.target.checked })} />
              </SettingsSection>

              <SettingsSection title="File list" description="Columns, selection, and display in the main workspace.">
                 <Checkbox label={<span>Show File <span className="underline decoration-1 underline-offset-[3px]">E</span>xtensions</span>} checked={localConfig.showFileExtensions ?? false} onChange={e => updateLocalConfig({ showFileExtensions: e.target.checked })} />
                 <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">u</span>to-select first item</span>} checked={localConfig.autoSelectFirstItem ?? false} onChange={e => updateLocalConfig({ autoSelectFirstItem: e.target.checked })} />
                 <Checkbox label={<span>Select <span className="underline decoration-1 underline-offset-[3px]">l</span>ast used subfolder</span>} checked={localConfig.selectLastUsedSubfolder ?? false} onChange={e => updateLocalConfig({ selectLastUsedSubfolder: e.target.checked })} />
                 <Checkbox label={<span>Select n<span className="underline decoration-1 underline-offset-[3px]">e</span>xt item after delete and move</span>} checked={localConfig.selectNextItemAfterDeleteAndMove ?? false} onChange={e => updateLocalConfig({ selectNextItemAfterDeleteAndMove: e.target.checked })} />
                 <Checkbox label={<span>Add <span className="underline decoration-1 underline-offset-[3px]">n</span>ew items at the end of the list</span>} checked={localConfig.addNewItemsAtTheEndOfTheList ?? false} onChange={e => updateLocalConfig({ addNewItemsAtTheEndOfTheList: e.target.checked })} />
                 <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">l</span>ways show folder sizes</span>} checked={localConfig.alwaysShowFolderSizes ?? false} onChange={e => updateLocalConfig({ alwaysShowFolderSizes: e.target.checked })} />
                 <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">u</span>to sync folder sizes on navigation</span>} checked={localConfig.autoSyncFolderSizes ?? true} onChange={e => updateLocalConfig({ autoSyncFolderSizes: e.target.checked })} />
                 <div className="ml-2 mb-2">
                   <label className="text-[11px] text-gray-400 block mb-1">Size view visualization</label>
                   <select
                     value={localConfig.folderSizeVisualization === 'bubbles' ? 'bubbles' : localConfig.folderSizeVisualization === 'treemap' ? 'treemap' : 'list'}
                     onChange={e => updateLocalConfig({ folderSizeVisualization: e.target.value as 'list' | 'treemap' | 'bubbles' })}
                     className="text-[11px] bg-[#1e1e1e] border border-[#454545] text-gray-300 px-2 py-1 outline-none focus:border-[#0078d4]/50"
                   >
                     <option value="list">Size list (recommended)</option>
                     <option value="treemap">Treemap (advanced)</option>
                     <option value="bubbles">Bubble chart (advanced)</option>
                   </select>
                 </div>
                 <div className="ml-[20px]">
                    <Checkbox label={<span>In network locations as <span className="underline decoration-1 underline-offset-[3px]">w</span>ell</span>} checked={localConfig.inNetworkLocationsAsWell ?? false} onChange={e => updateLocalConfig({ inNetworkLocationsAsWell: e.target.checked })} disabled={!localConfig.alwaysShowFolderSizes} />
                 </div>
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>ache folder sizes</span>} checked={localConfig.cacheFolderSizes ?? false} onChange={e => updateLocalConfig({ cacheFolderSizes: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span>Show cac<span className="underline decoration-1 underline-offset-[3px]">h</span>ed folder sizes only</span>} checked={localConfig.showCachedFolderSizesOnly ?? false} onChange={e => updateLocalConfig({ showCachedFolderSizesOnly: e.target.checked })} disabled={!localConfig.cacheFolderSizes} />
                 </div>
                 <SectionHeader title="Columns" />
                 <div className="ml-2 mb-2 space-y-[6px]">
                    {([
                      ['type', 'Type'],
                      ['size', 'Size'],
                      ['modified', 'Modified'],
                      ['created', 'Created'],
                      ['attributes', 'Attributes'],
                      ['tags', 'Tags'],
                      ['label', 'Label'],
                      ['comment', 'Comment'],
                      ['path', 'Path (global search)'],
                    ] as const).map(([key, label]) => (
                      <Checkbox
                        key={key}
                        label={<span>{label}</span>}
                        checked={(localConfig.listColumnVisibility?.[key] ?? (key === 'created' || key === 'attributes' || key === 'label' || key === 'comment' || key === 'path' ? false : true))}
                        onChange={e => updateLocalConfig({
                          listColumnVisibility: {
                            ...(localConfig.listColumnVisibility || {}),
                            [key]: e.target.checked,
                          },
                        })}
                      />
                    ))}
                 </div>
                 <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">i</span>tem count with folder sizes</span>} checked={localConfig.showItemCountWithFolderSizes ?? false} onChange={e => updateLocalConfig({ showItemCountWithFolderSizes: e.target.checked })} />
                 <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">f</span>older size on Properties tab</span>} checked={localConfig.showFolderSizeOnPropertiesTab ?? false} onChange={e => updateLocalConfig({ showFolderSizeOnPropertiesTab: e.target.checked })} />
                 <Checkbox label={<span>W<span className="underline decoration-1 underline-offset-[3px]">r</span>ap-around list</span>} checked={localConfig.wrapAroundList ?? false} onChange={e => updateLocalConfig({ wrapAroundList: e.target.checked })} />
              </SettingsSection>

              <SettingsSection title="Items in tree and list">
                 <ActionBtn label={<span>Select Item<span className="underline decoration-1 underline-offset-[3px]">s</span>...</span>} className="px-6 py-[2px] bg-[#1a1a1a]" />
              </SettingsSection>
            </TabsContent>

            <TabsContent value="Sort and Rename" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Sort and Rename</h1>
              
              <SectionHeader title="Sort" />
              <div className="flex items-center gap-[42px] ml-2 mb-4 mt-[10px]">
                 <span className="text-[12px] text-[#e0e0e0]">Sort <span className="underline decoration-1 underline-offset-[3px]">m</span>ethod:</span>
                 <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[200px] outline-none" value={localConfig.sortMethod} onChange={(e) => updateLocalConfig({sortMethod: e.target.value})}><option>Natural</option><option>Alphabetical</option><option>Date Modified</option><option>Size</option><option>Type</option></select>
              </div>

              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>ort folders apart</span>} checked={localConfig.sortFoldersApart ?? false} onChange={e => updateLocalConfig({ sortFoldersApart: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">K</span>eep folders on top</span>} checked={localConfig.keepFoldersOnTop ?? false} onChange={e => updateLocalConfig({ keepFoldersOnTop: e.target.checked })} disabled={!localConfig.sortFoldersApart} />
                    <Checkbox label={<span>Sort folders always a<span className="underline decoration-1 underline-offset-[3px]">s</span>cending</span>} checked={localConfig.sortFoldersAlwaysAscending ?? false} onChange={e => updateLocalConfig({ sortFoldersAlwaysAscending: e.target.checked })} disabled={!localConfig.sortFoldersApart} />
                    <Checkbox label={<span>Mixed sort on <span className="underline decoration-1 underline-offset-[3px]">d</span>ate columns</span>} checked={localConfig.mixedSortOnDateColumns ?? false} onChange={e => updateLocalConfig({ mixedSortOnDateColumns: e.target.checked })} disabled={!localConfig.sortFoldersApart} />
                    <Checkbox label={<span>Mixed sort on <span className="underline decoration-1 underline-offset-[3px]">t</span>ag columns</span>} checked={localConfig.mixedSortOnTagColumns ?? false} onChange={e => updateLocalConfig({ mixedSortOnTagColumns: e.target.checked })} disabled={!localConfig.sortFoldersApart} />
                    <Checkbox label={<span>Mixed sort on <span className="underline decoration-1 underline-offset-[3px]">p</span>ath columns</span>} checked={localConfig.mixedSortOnPathColumns ?? false} onChange={e => updateLocalConfig({ mixedSortOnPathColumns: e.target.checked })} disabled={!localConfig.sortFoldersApart} />
                 </div>
                 
                 <div className="h-2"></div>
                 <Checkbox label={<span>Sort filenames by <span className="underline decoration-1 underline-offset-[3px]">b</span>ase</span>} checked={localConfig.sortFilenamesByBase ?? false} onChange={e => updateLocalConfig({ sortFilenamesByBase: e.target.checked })} />
                 <Checkbox label={<span>Treat <span className="underline decoration-1 underline-offset-[3px]">h</span>yphens and apostrophes like normal characters</span>} checked={localConfig.treatHyphensAndApostrophesLikeNormalCharacters ?? false} onChange={e => updateLocalConfig({ treatHyphensAndApostrophesLikeNormalCharacters: e.target.checked })} />
                 <Checkbox label={<span>Sort s<span className="underline decoration-1 underline-offset-[3px]">i</span>ze columns descending by default</span>} checked={localConfig.sortSizeColumnsDescendingByDefault ?? false} onChange={e => updateLocalConfig({ sortSizeColumnsDescendingByDefault: e.target.checked })} />
                 <Checkbox label={<span>Sort <span className="underline decoration-1 underline-offset-[3px]">d</span>ate columns descending by default</span>} checked={localConfig.sortDateColumnsDescendingByDefault ?? false} onChange={e => updateLocalConfig({ sortDateColumnsDescendingByDefault: e.target.checked })} />
                 
                 <div className="h-2"></div>
                 <Checkbox label={<span>Keep current <span className="underline decoration-1 underline-offset-[3px]">i</span>tem in view after resorting</span>} checked={localConfig.keepCurrentItemInViewAfterResorting ?? false} onChange={e => updateLocalConfig({ keepCurrentItemInViewAfterResorting: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>croll to top after resorting</span>} checked={localConfig.scrollToTopAfterResorting ?? false} onChange={e => updateLocalConfig({ scrollToTopAfterResorting: e.target.checked })} />
                 <Checkbox label={<span>Show sort <span className="underline decoration-1 underline-offset-[3px]">h</span>eaders in all views</span>} checked={localConfig.showSortHeadersInAllViews ?? false} onChange={e => updateLocalConfig({ showSortHeadersInAllViews: e.target.checked })} />
                 <Checkbox label={<span>Show implicit secondary sort order arrow</span>} checked={localConfig.showImplicitSecondarySortOrderArrow ?? false} onChange={e => updateLocalConfig({ showImplicitSecondarySortOrderArrow: e.target.checked })} />
              </div>

              <SectionHeader title="Rename" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">P</span>reselect name</span>} checked={localConfig.preselectName ?? false} onChange={e => updateLocalConfig({ preselectName: e.target.checked })} />
                  <Checkbox label={<span>Exclude file <span className="underline decoration-1 underline-offset-[3px]">e</span>xtension from initial selection</span>} checked={localConfig.excludeFileExtensionFromInitialSelection ?? false} onChange={e => updateLocalConfig({ excludeFileExtensionFromInitialSelection: e.target.checked })} />
                  <Checkbox label={<span>Hide extensions from rename edit bo<span className="underline decoration-1 underline-offset-[3px]">x</span></span>} checked={localConfig.hideExtensionsFromRenameEditBox ?? false} onChange={e => updateLocalConfig({ hideExtensionsFromRenameEditBox: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>erial rename with Up and Down keys</span>} checked={localConfig.serialRenameWithUpAndDownKeys ?? false} onChange={e => updateLocalConfig({ serialRenameWithUpAndDownKeys: e.target.checked })} />
                  <Checkbox label={<span>Show name <span className="underline decoration-1 underline-offset-[3px]">l</span>ength while renaming</span>} checked={localConfig.showNameLengthWhileRenaming ?? false} onChange={e => updateLocalConfig({ showNameLengthWhileRenaming: e.target.checked })} />
                  <Checkbox label={<span>Use dialog to re<span className="underline decoration-1 underline-offset-[3px]">n</span>ame single items</span>} checked={localConfig.useDialogToRenameSingleItems ?? false} onChange={e => updateLocalConfig({ useDialogToRenameSingleItems: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Allow <span className="underline decoration-1 underline-offset-[3px]">m</span>ove on rename</span>} checked={localConfig.allowMoveOnRename ?? false} onChange={e => updateLocalConfig({ allowMoveOnRename: e.target.checked })} />
                  <Checkbox label={<span>Pre<span className="underline decoration-1 underline-offset-[3px]">v</span>iew all Rename Special operations</span>} checked={localConfig.previewAllRenameSpecialOperations ?? false} onChange={e => updateLocalConfig({ previewAllRenameSpecialOperations: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">u</span>to-replace invalid characters</span>} checked={localConfig.autoReplaceInvalidCharacters ?? false} onChange={e => updateLocalConfig({ autoReplaceInvalidCharacters: e.target.checked })} />
                  <Checkbox label={<span>Resort list immediately after rename</span>} checked={localConfig.resortListImmediatelyAfterRename ?? false} onChange={e => updateLocalConfig({ resortListImmediatelyAfterRename: e.target.checked })} />
                  <Checkbox label={<span>Set archive attribute on <span className="underline decoration-1 underline-offset-[3px]">f</span>older rename</span>} checked={localConfig.setArchiveAttributeOnFolderRename ?? false} onChange={e => updateLocalConfig({ setArchiveAttributeOnFolderRename: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Refresh, Icons, History" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Refresh, Icons, History</h1>
              
              <SectionHeader title="Auto-Refresh" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Auto-<span className="underline decoration-1 underline-offset-[3px]">r</span>efresh</span>} checked={localConfig.autoRefresh ?? false} onChange={e => updateLocalConfig({ autoRefresh: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>Include removable <span className="underline decoration-1 underline-offset-[3px]">d</span>rives</span>} checked={localConfig.includeRemovableDrives ?? false} onChange={e => updateLocalConfig({ includeRemovableDrives: e.target.checked })} disabled={!localConfig.autoRefresh} />
                    <Checkbox label={<span>Include <span className="underline decoration-1 underline-offset-[3px]">v</span>irtual folders</span>} checked={localConfig.includeVirtualFolders ?? false} onChange={e => updateLocalConfig({ includeVirtualFolders: e.target.checked })} disabled={!localConfig.autoRefresh} />
                    <Checkbox label={<span>Include network <span className="underline decoration-1 underline-offset-[3px]">l</span>ocations</span>} checked={localConfig.includeNetworkLocations ?? false} onChange={e => updateLocalConfig({ includeNetworkLocations: e.target.checked })} disabled={!localConfig.autoRefresh} />
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">R</span>efresh during file operations</span>} checked={localConfig.refreshDuringFileOperations ?? false} onChange={e => updateLocalConfig({ refreshDuringFileOperations: e.target.checked })} disabled={!localConfig.autoRefresh} />
                    <Checkbox label={<span>Respond to file system <span className="underline decoration-1 underline-offset-[3px]">n</span>otifications</span>} checked={localConfig.respondToFileSystemNotifications ?? false} onChange={e => updateLocalConfig({ respondToFileSystemNotifications: e.target.checked })} disabled={!localConfig.autoRefresh} />
                    <div className="ml-[20px]">
                       <Checkbox label={<span>Detect portable devices</span>} checked={localConfig.detectPortableDevices ?? false} onChange={e => updateLocalConfig({ detectPortableDevices: e.target.checked })} disabled={!localConfig.autoRefresh || !localConfig.respondToFileSystemNotifications} />
                    </div>
                 </div>
              </div>

              <SectionHeader title="Icons" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Draw selected list icons <span className="underline decoration-1 underline-offset-[3px]">d</span>immed</span>} checked={localConfig.drawSelectedListIconsDimmed ?? false} onChange={e => updateLocalConfig({ drawSelectedListIconsDimmed: e.target.checked })} />
                 <Checkbox label={<span>Draw hidden icons ghosted</span>} checked={localConfig.drawHiddenIconsGhosted ?? false} onChange={e => updateLocalConfig({ drawHiddenIconsGhosted: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>ache specific icons</span>} checked={localConfig.cacheSpecificIcons ?? false} onChange={e => updateLocalConfig({ cacheSpecificIcons: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span>Show cac<span className="underline decoration-1 underline-offset-[3px]">h</span>ed icons only</span>} checked={localConfig.showCachedIconsOnly ?? false} onChange={e => updateLocalConfig({ showCachedIconsOnly: e.target.checked })} disabled={!localConfig.cacheSpecificIcons && !localConfig.enableNativeThumbnails} />
                 </div>
                 <p className="text-[11px] text-gray-400 ml-1 mb-1 leading-relaxed">Windows shell icons are always enabled. The option below controls high-resolution image/video thumbnails only.</p>
                 <Checkbox label={<span>Enable high-res thumbnails for images &amp; media</span>} checked={localConfig.enableNativeThumbnails !== false} onChange={e => updateLocalConfig({ enableNativeThumbnails: e.target.checked, ...(e.target.checked ? {} : { clearThumbnailCacheOnExit: false }) })} />
                 <Checkbox label={<span>Use Iconify SVG icons for known file types</span>} checked={localConfig.enableIconifyFileIcons ?? true} onChange={e => updateLocalConfig({ enableIconifyFileIcons: e.target.checked })} disabled={!!localConfig.showCachedIconsOnly} />
                 <Checkbox label={<span>Clear Thumbnail Cache on exit</span>} checked={localConfig.clearThumbnailCacheOnExit ?? false} onChange={e => { updateLocalConfig({ clearThumbnailCacheOnExit: e.target.checked }); }} disabled={!localConfig.enableNativeThumbnails} />
                 <ActionBtn label="Clear Thumbnail Cache Now" className="w-[180px] mt-2 mb-2" onClick={() => import('../lib/ipcBridge').then(m => m.IPC.clearThumbnailCache())} disabled={!localConfig.enableNativeThumbnails} />
                 
                 <Checkbox label={<span>Use generic icons for super-fast <span className="underline decoration-1 underline-offset-[3px]">b</span>rowsing</span>} checked={localConfig.useGenericIconsForSuperFastBrowsing ?? false} onChange={e => updateLocalConfig({ useGenericIconsForSuperFastBrowsing: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>But only in network <span className="underline decoration-1 underline-offset-[3px]">l</span>ocations</span>} checked={localConfig.butOnlyInNetworkLocations ?? false} onChange={e => updateLocalConfig({ butOnlyInNetworkLocations: e.target.checked })} disabled={!localConfig.useGenericIconsForSuperFastBrowsing} />
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>pply to all controls</span>} checked={localConfig.applyToAllControls ?? false} onChange={e => updateLocalConfig({ applyToAllControls: e.target.checked })} disabled={!localConfig.useGenericIconsForSuperFastBrowsing} />
                 </div>
                 
                 <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">i</span>con overlays</span>} checked={localConfig.showIconOverlays ?? false} onChange={e => updateLocalConfig({ showIconOverlays: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>In <span className="underline decoration-1 underline-offset-[3px]">t</span>ree as well</span>} checked={localConfig.inTreeAsWell ?? false} onChange={e => updateLocalConfig({ inTreeAsWell: e.target.checked })} disabled={!localConfig.showIconOverlays} />
                    <Checkbox label={<span>In networ<span className="underline decoration-1 underline-offset-[3px]">k</span> locations as well</span>} checked={localConfig.inNetworkLocationsAsWell ?? false} onChange={e => updateLocalConfig({ inNetworkLocationsAsWell: e.target.checked })} disabled={!localConfig.showIconOverlays} />
                 </div>

                 <Checkbox label={<span>Show shortcu<span className="underline decoration-1 underline-offset-[3px]">t</span> overlays</span>} checked={localConfig.showShortcutOverlays ?? false} onChange={e => updateLocalConfig({ showShortcutOverlays: e.target.checked })} />
                 <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">s</span>hared folder overlays</span>} checked={localConfig.showSharedFolderOverlays ?? false} onChange={e => updateLocalConfig({ showSharedFolderOverlays: e.target.checked })} />
                 <Checkbox label={<span>Show embedded icons on <span className="underline decoration-1 underline-offset-[3px]">P</span>roperties tab</span>} checked={localConfig.showEmbeddedIconsOnPropertiesTab ?? false} onChange={e => updateLocalConfig({ showEmbeddedIconsOnPropertiesTab: e.target.checked })} />
                 <Checkbox label={<span>Show c<span className="underline decoration-1 underline-offset-[3px]">u</span>stom file icons</span>} checked={localConfig.showCustomFileIcons ?? false} onChange={e => updateLocalConfig({ showCustomFileIcons: e.target.checked })} />
              </div>

              <SectionHeader title="History" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>History <span className="underline decoration-1 underline-offset-[3px]">w</span>ithout duplicates</span>} checked={localConfig.historyWithoutDuplicates ?? false} onChange={e => updateLocalConfig({ historyWithoutDuplicates: e.target.checked })} />
                 <Checkbox label={<span>History p<span className="underline decoration-1 underline-offset-[3px]">e</span>r tab</span>} checked={localConfig.historyPerTab ?? false} onChange={e => updateLocalConfig({ historyPerTab: e.target.checked })} />
                 <Checkbox label={<span>History retains selections</span>} checked={localConfig.historyRetainsSelections ?? false} onChange={e => updateLocalConfig({ historyRetainsSelections: e.target.checked })} />
                 <Checkbox label={<span>History retains sort <span className="underline decoration-1 underline-offset-[3px]">o</span>rder</span>} checked={localConfig.historyRetainsSortOrder ?? false} onChange={e => updateLocalConfig({ historyRetainsSortOrder: e.target.checked })} />
              </div>
              
              <SectionHeader title="Scripting" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Remember permanent <span className="underline decoration-1 underline-offset-[3px]">v</span>ariables</span>} checked={localConfig.rememberPermanentVariables ?? false} onChange={e => updateLocalConfig({ rememberPermanentVariables: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Menus, Mouse, Usability" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Menus, Mouse, Usability</h1>
              
              <SectionHeader title="Main Menus" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Show Top <span className="underline decoration-1 underline-offset-[3px]">M</span>enu Bar</span>} checked={localConfig.showTopMenuBar ?? false} onChange={e => updateLocalConfig({ showTopMenuBar: e.target.checked })} />
                 <Checkbox label={<span>Enable <span className="underline decoration-1 underline-offset-[3px]">s</span>ubmenus</span>} checked={localConfig.enableSubmenus ?? false} onChange={e => updateLocalConfig({ enableSubmenus: e.target.checked })} />
              </div>

              <SectionHeader title="Context Menus" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">N</span>ative context menu</span>} checked={localConfig.nativeContextMenu ?? false} onChange={e => updateLocalConfig({ nativeContextMenu: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">H</span>old Ctrl to invert the above selection</span>} checked={localConfig.holdCtrlToInvertTheAboveSelection ?? false} onChange={e => updateLocalConfig({ holdCtrlToInvertTheAboveSelection: e.target.checked })} />
                 </div>
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>ustom items in the context menu</span>} checked={localConfig.customItemsInTheContextMenu ?? false} onChange={e => updateLocalConfig({ customItemsInTheContextMenu: e.target.checked })} />
                 <div className="ml-[20px] flex gap-2 mt-4 mb-4">
                    <ActionBtn label="Folder Tree..." className="w-[150px]" />
                    <ActionBtn label="File List..." className="w-[150px]" />
                 </div>
                 
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">H</span>ide shell extensions from shell context menu</span>} checked={localConfig.hideShellExtensionsFromShellContextMenu ?? false} onChange={e => updateLocalConfig({ hideShellExtensionsFromShellContextMenu: e.target.checked })} />
                 <Checkbox label={<span>Native drag and drop context me<span className="underline decoration-1 underline-offset-[3px]">n</span>u</span>} checked={localConfig.nativeDragAndDropContextMenu ?? false} onChange={e => updateLocalConfig({ nativeDragAndDropContextMenu: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">N</span>avigation commands in List context menu</span>} checked={localConfig.navigationCommandsInListContextMenu ?? false} onChange={e => updateLocalConfig({ navigationCommandsInListContextMenu: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">F</span>ind Files commands in List context menu</span>} checked={localConfig.findFilesCommandsInListContextMenu ?? false} onChange={e => updateLocalConfig({ findFilesCommandsInListContextMenu: e.target.checked })} />
              </div>
              
              <SectionHeader title="Cell Context Menu" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Hold Ctrl to show c<span className="underline decoration-1 underline-offset-[3px]">e</span>ll context menu</span>} checked={localConfig.holdCtrlToShowCellContextMenu ?? false} onChange={e => updateLocalConfig({ holdCtrlToShowCellContextMenu: e.target.checked })} />
                 <Checkbox label={<span>Use localized search and filter patterns</span>} checked={localConfig.useLocalizedSearchAndFilterPatterns ?? false} onChange={e => updateLocalConfig({ useLocalizedSearchAndFilterPatterns: e.target.checked })} />
              </div>

              <SectionHeader title="Mouse" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Single-clic<span className="underline decoration-1 underline-offset-[3px]">k</span> to open an item</span>} checked={localConfig.singleClickToOpenAnItem ?? false} onChange={e => updateLocalConfig({ singleClickToOpenAnItem: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>On the <span className="underline decoration-1 underline-offset-[3px]">i</span>con only</span>} checked={localConfig.onTheIconOnly ?? false} onChange={e => updateLocalConfig({ onTheIconOnly: e.target.checked })} disabled={!localConfig.singleClickToOpenAnItem} />
                    <Checkbox label={<span>Folder<span className="underline decoration-1 underline-offset-[3px]">s</span> only</span>} checked={localConfig.foldersOnly ?? false} onChange={e => updateLocalConfig({ foldersOnly: e.target.checked })} disabled={!localConfig.singleClickToOpenAnItem} />
                 </div>
                 
                 <Checkbox label={<span>Po<span className="underline decoration-1 underline-offset-[3px]">i</span>nt to select</span>} checked={localConfig.pointToSelect ?? false} onChange={e => updateLocalConfig({ pointToSelect: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span>To the i<span className="underline decoration-1 underline-offset-[3px]">c</span>on only</span>} checked={localConfig.toTheIconOnly ?? false} onChange={e => updateLocalConfig({ toTheIconOnly: e.target.checked })} disabled={!localConfig.pointToSelect} />
                 </div>
                 
                 <Checkbox label={<span>Full <span className="underline decoration-1 underline-offset-[3px]">n</span>ame column select</span>} checked={localConfig.fullNameColumnSelect ?? false} onChange={e => updateLocalConfig({ fullNameColumnSelect: e.target.checked })} />
                 <Checkbox label={<span>Allow dragging from a <span className="underline decoration-1 underline-offset-[3px]">b</span>ackground window</span>} checked={localConfig.allowDraggingFromABackgroundWindow ?? false} onChange={e => updateLocalConfig({ allowDraggingFromABackgroundWindow: e.target.checked })} />
                 <Checkbox label={<span>Shift+<span className="underline decoration-1 underline-offset-[3px]">W</span>heel scrolls horizontally</span>} checked={localConfig.shiftWheelScrollsHorizontally ?? false} onChange={e => updateLocalConfig({ shiftWheelScrollsHorizontally: e.target.checked })} />
                 <Checkbox label={<span>Ctrl+<span className="underline decoration-1 underline-offset-[3px]">W</span>heel scrolls through the list views</span>} checked={localConfig.ctrlWheelScrollsThroughTheListViews ?? false} onChange={e => updateLocalConfig({ ctrlWheelScrollsThroughTheListViews: e.target.checked })} />
              </div>

              <SectionHeader title="Usability" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>Highlight ho<span className="underline decoration-1 underline-offset-[3px]">v</span>ered items</span>} checked={localConfig.highlightHoveredItems ?? false} onChange={e => updateLocalConfig({ highlightHoveredItems: e.target.checked })} />
                 <Checkbox label={<span>Show tooltip<span className="underline decoration-1 underline-offset-[3px]">s</span></span>} checked={localConfig.showTooltips ?? false} onChange={e => updateLocalConfig({ showTooltips: e.target.checked })} />
                 <div className="ml-[20px] mb-[10px]">
                    <Checkbox label={<span>Show verbati<span className="underline decoration-1 underline-offset-[3px]">m</span> tooltips</span>} checked={localConfig.showVerbatimTooltips ?? false} onChange={e => updateLocalConfig({ showVerbatimTooltips: e.target.checked })} disabled={!localConfig.showTooltips} />
                 </div>
                 
                 <div className="flex flex-col gap-2 pt-2">
                    <div className="flex items-center gap-2">
                       <input type="number" 
                          value={localConfig.tooltipZoom} 
                          onChange={(e) => updateLocalConfig({tooltipZoom: parseInt(e.target.value) || 100})} 
                          className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                       />
                       <span className="text-[12px] text-[#e0e0e0]">Tooltip <span className="underline decoration-1 underline-offset-[3px]">z</span>oom (%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <input type="number" 
                          value={localConfig.scrollMargin} 
                          onChange={(e) => updateLocalConfig({scrollMargin: parseInt(e.target.value) || 0})} 
                          className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                       />
                       <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">S</span>croll margin</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <input type="text" 
                          value={localConfig.wheelScrollLines === 0 ? '' : localConfig.wheelScrollLines} 
                          onChange={(e) => updateLocalConfig({wheelScrollLines: parseInt(e.target.value) || 0})} 
                          className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none placeholder-[#666]"
                       />
                       <span className="text-[12px] text-[#e0e0e0]">Wheel scroll lines</span>
                    </div>
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="Custom Event Actions" className="m-0 border-0 p-0 outline-none">
              <CeaEditorTab
                actions={localConfig.customEventActions || []}
                onChange={actions => updateLocalConfig({ customEventActions: actions })}
              />
            </TabsContent>

            <TabsContent value="User Commands" className="m-0 border-0 p-0 outline-none">
              <UdcEditorTab
                commands={mergeUserCommands(localConfig.customUserCommands)}
                onChange={cmds => updateLocalConfig({
                  customUserCommands: cmds.filter(c =>
                    !['udc-dual', 'udc-inspector', 'udc-finding', 'udc-tabset', 'udc-refresh'].includes(c.id),
                  ),
                })}
              />
            </TabsContent>

            <TabsContent value="Safety Belts, Network" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Safety Belts, Network</h1>
              
              <SectionHeader title="Safety Belts" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">d</span>rag status box</span>} checked={localConfig.showDragStatusBox ?? false} onChange={e => updateLocalConfig({ showDragStatusBox: e.target.checked })} />
                  <Checkbox label={<span>Disallow left-dragging from folder tree</span>} checked={localConfig.disallowLeftDraggingFromFolderTree ?? false} onChange={e => updateLocalConfig({ disallowLeftDraggingFromFolderTree: e.target.checked })} />
                  <Checkbox label={<span>Disallo<span className="underline decoration-1 underline-offset-[3px]">w</span> left-dragging from file list</span>} checked={localConfig.disallowLeftDraggingFromFileList ?? false} onChange={e => updateLocalConfig({ disallowLeftDraggingFromFileList: e.target.checked })} />
                  
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>onfirm drag and drop</span>} checked={localConfig.confirmDragAndDrop ?? false} onChange={e => updateLocalConfig({ confirmDragAndDrop: e.target.checked })} />
                  <Checkbox label={<span>C<span className="underline decoration-1 underline-offset-[3px]">o</span>nfirm copy and move operations</span>} checked={localConfig.confirmCopyAndMoveOperations ?? false} onChange={e => updateLocalConfig({ confirmCopyAndMoveOperations: e.target.checked })} />
                  <Checkbox label={<span>Confirm <span className="underline decoration-1 underline-offset-[3px]">d</span>elete operations</span>} checked={localConfig.confirmDeleteOperations ?? false} onChange={e => updateLocalConfig({ confirmDeleteOperations: e.target.checked })} />
                  <Checkbox label={<span>Bypass Recycle Bin for permanent deletion</span>} checked={localConfig.bypassRecycleBin ?? false} onChange={e => updateLocalConfig({ bypassRecycleBin: e.target.checked })} />
                  <Checkbox label={<span>Delete on key <span className="underline decoration-1 underline-offset-[3px]">u</span>p</span>} checked={localConfig.deleteOnKeyUp ?? false} onChange={e => updateLocalConfig({ deleteOnKeyUp: e.target.checked })} />
                  <Checkbox label={<span>Disallow delete by <span className="underline decoration-1 underline-offset-[3px]">k</span>ey in folder tree</span>} checked={localConfig.disallowDeleteByKeyInFolderTree ?? false} onChange={e => updateLocalConfig({ disallowDeleteByKeyInFolderTree: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">T</span>reat portable devices as read-only</span>} checked={localConfig.treatPortableDevicesAsReadOnly ?? false} onChange={e => updateLocalConfig({ treatPortableDevicesAsReadOnly: e.target.checked })} />
                  <Checkbox label={<span>Directional formatting codes protection</span>} checked={localConfig.directionalFormattingCodesProtection ?? false} onChange={e => updateLocalConfig({ directionalFormattingCodesProtection: e.target.checked })} />
              </div>
              
              <SectionHeader title="Network" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Assume that se<span className="underline decoration-1 underline-offset-[3px]">r</span>vers are available</span>} checked={localConfig.assumeThatServersAreAvailable ?? false} onChange={e => updateLocalConfig({ assumeThatServersAreAvailable: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>ache network servers</span>} checked={localConfig.cacheNetworkServers ?? false} onChange={e => updateLocalConfig({ cacheNetworkServers: e.target.checked })} />
                  <Checkbox label={<span>Assume that <span className="underline decoration-1 underline-offset-[3px]">m</span>apped network drives are available</span>} checked={localConfig.assumeThatMappedNetworkDrivesAreAvailable ?? false} onChange={e => updateLocalConfig({ assumeThatMappedNetworkDrivesAreAvailable: e.target.checked })} />
                  <Checkbox label={<span>Skip calculation of free disk space for mapped <span className="underline decoration-1 underline-offset-[3px]">n</span>etwork drives</span>} checked={localConfig.skipCalculationOfFreeDiskSpaceForMappedNetworkDriv ?? false} onChange={e => updateLocalConfig({ skipCalculationOfFreeDiskSpaceForMappedNetworkDriv: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Controls & More" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Controls & More</h1>
              
              <SectionHeader title="Drop-Down Lists" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">u</span>to-complete recently used items</span>} checked={localConfig.autoCompleteRecentlyUsedItems ?? false} onChange={e => updateLocalConfig({ autoCompleteRecentlyUsedItems: e.target.checked })} />
                  <Checkbox label={<span>Move last <span className="underline decoration-1 underline-offset-[3px]">u</span>sed item to top</span>} checked={localConfig.moveLastUsedItemToTop ?? false} onChange={e => updateLocalConfig({ moveLastUsedItemToTop: e.target.checked })} />
                  <Checkbox label={<span>Select list items on mouse h<span className="underline decoration-1 underline-offset-[3px]">o</span>ver</span>} checked={localConfig.selectListItemsOnMouseHover ?? false} onChange={e => updateLocalConfig({ selectListItemsOnMouseHover: e.target.checked })} />
                  <Checkbox label={<span>Select all on focus by <span className="underline decoration-1 underline-offset-[3px]">k</span>ey</span>} checked={localConfig.selectAllOnFocusByKey ?? false} onChange={e => updateLocalConfig({ selectAllOnFocusByKey: e.target.checked })} />
                  <Checkbox label={<span>Select all on focu<span className="underline decoration-1 underline-offset-[3px]">s</span> by mouse</span>} checked={localConfig.selectAllOnFocusByMouse ?? false} onChange={e => updateLocalConfig({ selectAllOnFocusByMouse: e.target.checked })} />
                  <Checkbox label={<span>Select all on item change</span>} checked={localConfig.selectAllOnItemChange ?? false} onChange={e => updateLocalConfig({ selectAllOnItemChange: e.target.checked })} />
                  <Checkbox label={<span>Select matc<span className="underline decoration-1 underline-offset-[3px]">h</span> on drop down</span>} checked={localConfig.selectMatchOnDropDown ?? false} onChange={e => updateLocalConfig({ selectMatchOnDropDown: e.target.checked })} />
              </div>

              <SectionHeader title="Auto-Complete Path Names" />
              <div className="ml-2 mb-4 space-y-[6px] relative">
                  <div className="flex items-center gap-[42px] absolute right-4 top-2">
                     <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">F</span>ilter:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[200px] outline-none" value={localConfig.autoCompleteFilter} onChange={e => updateLocalConfig({ autoCompleteFilter: e.target.value })}><option>Contains</option><option>Starts with</option><option>Ends with</option><option>Exact match</option></select>
                  </div>
                  <Checkbox label={<span>Address <span className="underline decoration-1 underline-offset-[3px]">B</span>ar</span>} checked={localConfig.addressBar ?? false} onChange={e => updateLocalConfig({ addressBar: e.target.checked })} />
                  <Checkbox label={<span>Find Files Loca<span className="underline decoration-1 underline-offset-[3px]">t</span>ion</span>} checked={localConfig.findFilesLocation ?? false} onChange={e => updateLocalConfig({ findFilesLocation: e.target.checked })} />
              </div>

              <SectionHeader title="Miscellaneous" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Support overlong <span className="underline decoration-1 underline-offset-[3px]">f</span>ilenames</span>} checked={localConfig.supportOverlongFilenames ?? false} onChange={e => updateLocalConfig({ supportOverlongFilenames: e.target.checked })} />
                  <Checkbox label={<span>Convert overlong paths to 8.3 format when opening files</span>} checked={localConfig.convertOverlongPathsTo83FormatWhenOpeningFiles ?? false} onChange={e => updateLocalConfig({ convertOverlongPathsTo83FormatWhenOpeningFiles: e.target.checked })} />
                  <Checkbox label={<span>Support <span className="underline decoration-1 underline-offset-[3px]">v</span>olume labels in paths</span>} checked={localConfig.supportVolumeLabelsInPaths ?? false} onChange={e => updateLocalConfig({ supportVolumeLabelsInPaths: e.target.checked })} />
                  <Checkbox label={<span>Copy paths to the clipboard with a trailing slash</span>} checked={localConfig.copyPathsToTheClipboardWithATrailingSlash ?? false} onChange={e => updateLocalConfig({ copyPathsToTheClipboardWithATrailingSlash: e.target.checked })} />
                  <Checkbox label={<span>Resol<span className="underline decoration-1 underline-offset-[3px]">v</span>e junctions</span>} checked={localConfig.resolveJunctions ?? false} onChange={e => updateLocalConfig({ resolveJunctions: e.target.checked })} />
                  <Checkbox label={<span>Open favorite files <span className="underline decoration-1 underline-offset-[3px]">d</span>irectly</span>} checked={localConfig.openFavoriteFilesDirectly ?? false} onChange={e => updateLocalConfig({ openFavoriteFilesDirectly: e.target.checked })} />
                  <Checkbox label={<span>Paste to selected list folder</span>} checked={localConfig.pasteToSelectedListFolder ?? false} onChange={e => updateLocalConfig({ pasteToSelectedListFolder: e.target.checked })} />
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">m</span>essage when list is empty</span>} checked={localConfig.showMessageWhenListIsEmpty ?? false} onChange={e => updateLocalConfig({ showMessageWhenListIsEmpty: e.target.checked })} />
                  <Checkbox label={<span>Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> Status Bar</span>} checked={localConfig.showStatusBar ?? true} onChange={e => updateLocalConfig({ showStatusBar: e.target.checked })} />
                  <Checkbox label={<span>Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> version information in the Status Bar</span>} checked={localConfig.showVersionInformationInTheStatusBar ?? false} onChange={e => updateLocalConfig({ showVersionInformationInTheStatusBar: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>unday is the first day of the week</span>} checked={localConfig.sundayIsTheFirstDayOfTheWeek ?? false} onChange={e => updateLocalConfig({ sundayIsTheFirstDayOfTheWeek: e.target.checked })} />
                  <Checkbox label={<span>Play a soun<span className="underline decoration-1 underline-offset-[3px]">d</span> on certain events</span>} checked={localConfig.playASoundOnCertainEvents ?? false} onChange={e => updateLocalConfig({ playASoundOnCertainEvents: e.target.checked })} />
                  <Checkbox label={<span>Enable surround selection</span>} checked={localConfig.enableSurroundSelection ?? false} onChange={e => updateLocalConfig({ enableSurroundSelection: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Startup & Exit" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Startup & Exit</h1>
              
              <div className="flex flex-col gap-1 ml-2 mb-4 mt-2">
                 <span className="text-[12px] text-[#e0e0e0]">Permanent start<span className="underline decoration-1 underline-offset-[3px]">u</span>p path:</span>
                 <div className="flex items-center gap-2">
                    <input type="text" className="w-[500px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 outline-none" value={localConfig.permanentStartupPath} onChange={e => updateLocalConfig({ permanentStartupPath: e.target.value })} />
                    <button className="h-6 w-8 bg-[#2a2d2e] border border-[#555] text-white flex items-center justify-center hover:bg-[#3a3d3e]">...</button>
                 </div>
                 <div className="mt-1">
                    <Checkbox label={<span>Expand in <span className="underline decoration-1 underline-offset-[3px]">t</span>ree</span>} checked={localConfig.expandInTree ?? false} onChange={e => updateLocalConfig({ expandInTree: e.target.checked })} />
                 </div>
              </div>

              <div className="grid grid-cols-[140px_200px] gap-2 ml-2 mb-4 mt-4 items-center">
                 <span className="text-[12px] text-[#e0e0e0]">Startup pane:</span>
                 <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-full outline-none" value={localConfig.startupPane} onChange={e => updateLocalConfig({ startupPane: e.target.value })}><option>Last active panel</option><option>Left pane</option><option>Right pane</option><option>Folder tree</option></select>
                 
                 <span className="text-[12px] text-[#e0e0e0]">Startup <span className="underline decoration-1 underline-offset-[3px]">w</span>indow state:</span>
                 <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-full outline-none" value={localConfig.startupWindowState} onChange={e => updateLocalConfig({ startupWindowState: e.target.value })}><option>Normal</option><option>Maximized</option><option>Minimized</option><option>Fullscreen</option></select>
              </div>

              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Open <span className="underline decoration-1 underline-offset-[3px]">c</span>ommand line start path in new tab</span>} checked={localConfig.openCommandLineStartPathInNewTab ?? false} onChange={e => updateLocalConfig({ openCommandLineStartPathInNewTab: e.target.checked })} />
                  <Checkbox label={<span>Allow <span className="underline decoration-1 underline-offset-[3px]">m</span>ultiple instances</span>} checked={localConfig.allowMultipleInstances ?? false} onChange={e => updateLocalConfig({ allowMultipleInstances: e.target.checked })} />
                  <div className="ml-[20px]">
                     <Checkbox label={<span>Open <span className="underline decoration-1 underline-offset-[3px]">n</span>ew instance always</span>} checked={localConfig.openNewInstanceAlways ?? false} onChange={e => updateLocalConfig({ openNewInstanceAlways: e.target.checked })} disabled={!localConfig.allowMultipleInstances} />
                  </div>
                  
                  <Checkbox label={<span>Minimize to tray</span>} checked={localConfig.minimizeToTray ?? false} onChange={e => updateLocalConfig({ minimizeToTray: e.target.checked })} />
                  <Checkbox label={<span>Minimize to tray on <span className="underline decoration-1 underline-offset-[3px]">X</span> close</span>} checked={localConfig.minimizeToTrayOnXClose ?? false} onChange={e => updateLocalConfig({ minimizeToTrayOnXClose: e.target.checked })} />

                  <div className="h-2"></div>
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">s</span>plash screen while loading</span>} checked={localConfig.showSplashScreenWhileLoading ?? false} onChange={e => updateLocalConfig({ showSplashScreenWhileLoading: e.target.checked })} />
                  <Checkbox label={<span>Chec<span className="underline decoration-1 underline-offset-[3px]">k</span> for updates at startup</span>} checked={localConfig.checkForUpdatesAtStartup ?? false} onChange={e => updateLocalConfig({ checkForUpdatesAtStartup: e.target.checked })} />
                  <div className="ml-[20px]">
                     <Checkbox label={<span>Include <span className="underline decoration-1 underline-offset-[3px]">b</span>eta versions</span>} checked={localConfig.includeBetaVersions ?? false} onChange={e => updateLocalConfig({ includeBetaVersions: e.target.checked })} disabled={!localConfig.checkForUpdatesAtStartup} />
                  </div>
                  <Checkbox label={<span>Check for <span className="underline decoration-1 underline-offset-[3px]">l</span>anguage updates at startup</span>} checked={localConfig.checkForLanguageUpdatesAtStartup ?? false} onChange={e => updateLocalConfig({ checkForLanguageUpdatesAtStartup: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>No network <span className="underline decoration-1 underline-offset-[3px]">b</span>rowsing at startup</span>} checked={localConfig.noNetworkBrowsingAtStartup ?? false} onChange={e => updateLocalConfig({ noNetworkBrowsingAtStartup: e.target.checked })} />
                  <Checkbox label={<span>Reconnect mapped network <span className="underline decoration-1 underline-offset-[3px]">d</span>rives at startup</span>} checked={localConfig.reconnectMappedNetworkDrivesAtStartup ?? false} onChange={e => updateLocalConfig({ reconnectMappedNetworkDrivesAtStartup: e.target.checked })} />
                  <Checkbox label={<span>Adjust to OS lig<span className="underline decoration-1 underline-offset-[3px]">h</span>t/dark mode at startup</span>} checked={localConfig.adjustToOsLightDarkModeAtStartup ?? false} onChange={e => updateLocalConfig({ adjustToOsLightDarkModeAtStartup: e.target.checked })} />
              </div>
              
              <SectionHeader title="Save Settings" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>ave settings on exit</span>} checked={localConfig.saveSettingsOnExit ?? false} onChange={e => updateLocalConfig({ saveSettingsOnExit: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">I</span>nclude most-recently-used lists on save</span>} checked={localConfig.includeMostRecentlyUsedListsOnSave ?? false} onChange={e => updateLocalConfig({ includeMostRecentlyUsedListsOnSave: e.target.checked })} />
                  <div className="ml-[24px] mb-2">
                     <ActionBtn label="Apply to..." className="px-6 py-[2px] bg-[#1a1a1a]" />
                  </div>
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">B</span>ackup settings on save</span>} checked={localConfig.backupSettingsOnSave ?? false} onChange={e => updateLocalConfig({ backupSettingsOnSave: e.target.checked })} />
                  <Checkbox label={<span>Save changes to disk immediately</span>} checked={localConfig.saveChangesToDiskImmediately ?? false} onChange={e => updateLocalConfig({ saveChangesToDiskImmediately: e.target.checked })} />
                  <div className="ml-[24px] mb-[20px]">
                     <ActionBtn label="Apply to..." className="px-6 py-[2px] bg-[#1a1a1a]" />
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Keyboard Shortcuts" className="m-0 border-0 p-0 outline-none">
              <KeyboardShortcutsTab localConfig={localConfig} updateLocalConfig={updateLocalConfig} />
            </TabsContent>

            <TabsContent value="Tags" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Tags</h1>
              <p className="text-[12px] text-[#e0e0e0] mb-[22px] mt-1">Tags (Label, Tags, Comment, Extra) can be assigned to individual files and folders through the main interface. In this section here you can configure their behavior and looks.</p>
              
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>how tags in file list</span>} checked={localConfig.showTagsInFileList ?? false} onChange={e => updateLocalConfig({ showTagsInFileList: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">T</span>oggle tags by column click</span>} checked={localConfig.toggleTagsByColumnClick ?? false} onChange={e => updateLocalConfig({ toggleTagsByColumnClick: e.target.checked })} />
                  <div className="flex gap-6 ml-[20px]">
                     <Checkbox label={<span>Labe<span className="underline decoration-1 underline-offset-[3px]">l</span></span>} checked={localConfig.label ?? false} onChange={e => updateLocalConfig({ label: e.target.checked })} disabled={!localConfig.toggleTagsByColumnClick} />
                     <Checkbox label={<span>Tags</span>} checked={localConfig.tags ?? false} onChange={e => updateLocalConfig({ tags: e.target.checked })} disabled={!localConfig.toggleTagsByColumnClick} />
                     <Checkbox label={<span>Comment</span>} checked={localConfig.comment ?? false} onChange={e => updateLocalConfig({ comment: e.target.checked })} disabled={!localConfig.toggleTagsByColumnClick} />
                  </div>
                  <div className="ml-[20px]">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>lso on Full Row Select</span>} checked={localConfig.alsoOnFullRowSelect ?? false} onChange={e => updateLocalConfig({ alsoOnFullRowSelect: e.target.checked })} disabled={!localConfig.toggleTagsByColumnClick} />
                  </div>
                  
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">P</span>opup by tag columns right-click</span>} checked={localConfig.popupByTagColumnsRightClick ?? false} onChange={e => updateLocalConfig({ popupByTagColumnsRightClick: e.target.checked })} />
                  <div className="ml-[20px]">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>pply tagging to all selected items</span>} checked={localConfig.applyTaggingToAllSelectedItems ?? false} onChange={e => updateLocalConfig({ applyTaggingToAllSelectedItems: e.target.checked })} disabled={!localConfig.popupByTagColumnsRightClick} />
                  </div>
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">O</span>n sorting keep tagged items on top</span>} checked={localConfig.onSortingKeepTaggedItemsOnTop ?? false} onChange={e => updateLocalConfig({ onSortingKeepTaggedItemsOnTop: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Copy tags on <span className="underline decoration-1 underline-offset-[3px]">c</span>opy operations</span>} checked={localConfig.copyTagsOnCopyOperations ?? false} onChange={e => updateLocalConfig({ copyTagsOnCopyOperations: e.target.checked })} />
                  <Checkbox label={<span>Copy tags on <span className="underline decoration-1 underline-offset-[3px]">b</span>ackup and sync operations</span>} checked={localConfig.copyTagsOnBackupAndSyncOperations ?? false} onChange={e => updateLocalConfig({ copyTagsOnBackupAndSyncOperations: e.target.checked })} />
                  <Checkbox label={<span>Confirm copying tags</span>} checked={localConfig.confirmCopyingTags ?? false} onChange={e => updateLocalConfig({ confirmCopyingTags: e.target.checked })} />
                  <Checkbox label={<span>Auto-refresh tags</span>} checked={localConfig.autoRefreshTags ?? false} onChange={e => updateLocalConfig({ autoRefreshTags: e.target.checked })} />
              </div>
              
              <SectionHeader title="Label captions and colors" />
              <div className="flex gap-4 ml-2 mb-4">
                 <div className="border border-[#333] bg-[#0c0c0c] w-[220px] h-[160px] p-2 flex flex-col gap-[2px]">
                    {[{n:1, c:'bg-red-500', t:'Red'}, {n:2, c:'bg-orange-500', t:'Orange'}, {n:3, c:'bg-yellow-500 text-black', t:'Yellow'}, {n:4, c:'bg-green-500', t:'Green'}, {n:5, c:'bg-blue-500', t:'Blue'}, {n:6, c:'bg-purple-500', t:'Purple'}, {n:7, c:'bg-cyan-500 text-black', t:'Sky Blue'}].map(l => (
                       <div key={l.n} className="flex text-[12px] items-center gap-2 px-1 hover:bg-[#333]">
                           <span className="text-[#888] w-2">{l.n}</span>
                           <span className={`${l.c} px-2 rounded-[3px] text-white`}>{l.t}</span>
                       </div>
                    ))}
                 </div>
                 <div className="flex flex-col gap-[6px]">
                    <ActionBtn label="New" className="w-[100px]" />
                    <ActionBtn label={<span>Edi<span className="underline decoration-1 underline-offset-[3px]">t</span></span>} className="w-[100px]" />
                    <ActionBtn label="Delete" className="w-[100px]" />
                    <div className="flex-1"></div>
                    <ActionBtn label={<span>Te<span className="underline decoration-1 underline-offset-[3px]">x</span>t Color...</span>} className="w-[120px]" />
                    <ActionBtn label={<span>Bac<span className="underline decoration-1 underline-offset-[3px]">k</span> Color...</span>} className="w-[120px]" />
                 </div>
              </div>
              
              <div className="flex gap-[42px] ml-2 mb-4 mt-[10px]">
                  <span className="text-[12px] text-[#e0e0e0]">Label style:</span>
                  <div className="flex gap-4">
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[200px] outline-none" value={localConfig.labelStyle || "Name column"} onChange={e => updateLocalConfig({labelStyle: e.target.value})}><option>Name column</option><option>Full row</option><option>Icon only</option></select>
                     <Checkbox label="Rounded" checked={localConfig.rounded ?? false} onChange={e => updateLocalConfig({ rounded: e.target.checked })} />
                  </div>
              </div>
              <div className="flex gap-[42px] ml-2 mb-4 mt-[10px]">
                  <span className="text-[12px] text-[#e0e0e0]">Storage:</span>
                  <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[200px] outline-none ml-[6px]" value={localConfig.tagsStorage || "Absolute paths"} onChange={e => updateLocalConfig({tagsStorage: e.target.value})}><option>Absolute paths</option><option>Relative paths</option><option>Database</option></select>
              </div>
              
              <div className="flex items-center gap-4 ml-2 mt-6">
                 <ActionBtn label="Options..." className="w-[100px]" />
                 <span className="text-[12px] text-[#e0e0e0]">Currently 0 items are tagged.</span>
              </div>
            </TabsContent>

            <TabsContent value="Custom Columns" className="m-0 border-0 p-0 outline-none flex flex-col h-full">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Custom Columns</h1>
              <p className="text-[12px] text-[#e0e0e0] mb-[8px] mt-1">Custom column definitions:</p>
              
              <div className="border border-[#555] bg-[#0c0c0c] flex-1 overflow-y-auto mb-4 p-[2px] styled-scrollbar">
                 {["Dimensions, Special Property (png;gif;bmp;webp;ico;cur;{Photo};Ink)", "Aspect Ratio, Special Property (png;gif;bmp;webp;ico;cur;{Photo};Ink)", "Date Taken, Special Property ({Photo})", "Camera Model, Special Property ({Photo})", "F-Stop, Special Property ({Photo})", "Exposure Time, Special Property ({Photo})", "Length, Special Property ({Media})", "Sample Rate, Special Property ({Media})", "Bit Depth, Special Property ({Media})", "Bit Rate, Special Property ({Media})", "Channels, Special Property ({Media})", "Focal Length, Special Property ({Photo})", "ISO Speed, Special Property ({Photo})", "Mixed, Mixed (*.*)", "Version, Special Property (exe;dll)", "MD5, Special Property (*.*)", ...Array(12).fill("(Undefined)")].map((c, i) => (
                    <div key={i} className={`flex text-[12px] items-center gap-2 px-1 py-[2px] hover:bg-[#333] ${i===0 ? 'bg-[#334] text-white' : 'text-[#ccc]'}`}>
                        <span className={`w-4 text-right ${i === 0 ? 'text-[#aaa]' : 'text-[#888]'}`}>{i + 1}</span>
                        <span>{c}</span>
                    </div>
                 ))}
              </div>
              
              <div className="flex justify-between">
                 <ActionBtn label="Reset Columns..." className="w-[150px]" />
                 <ActionBtn label="Edit..." className="w-[100px]" />
              </div>
            </TabsContent>
            
            <TabsContent value="File Info Tips & Hover Box" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">File Info Tips & Hover Box</h1>

              <div className="bndz-settings-section mb-6">
                <div className="bndz-settings-section-header">
                  <h2 className="text-[13px] font-bold text-white">Animated hover tooltips</h2>
                </div>
                <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-300 w-[100px]">Show delay</span>
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      step={50}
                      value={localConfig.hoverTooltipDelayMs ?? 420}
                      onChange={e => updateLocalConfig({ hoverTooltipDelayMs: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      className="w-[72px] h-7 bg-[#111] border border-[#555] rounded px-2 text-[12px] text-white"
                    />
                    <span className="text-[11px] text-gray-500">ms</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-300 w-[100px]">Theme</span>
                    <select
                      value={localConfig.hoverTooltipTheme ?? 'glass'}
                      onChange={e => updateLocalConfig({ hoverTooltipTheme: e.target.value })}
                      className="flex-1 h-7 bg-[#111] border border-[#555] rounded px-2 text-[12px] text-white"
                    >
                      <option value="glass">Glass (default)</option>
                      <option value="minimal">Minimal</option>
                      <option value="accent">Accent glow</option>
                      <option value="mono">Monospace</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3">
                  <Checkbox label="Show full path in tooltip" checked={localConfig.hoverTooltipShowPath !== false} onChange={e => updateLocalConfig({ hoverTooltipShowPath: e.target.checked })} disabled={!localConfig.showFileInfoTips && !localConfig.showTooltips} />
                </div>
                </div>
              </div>

              <div className="bndz-settings-section mb-6">
                <div className="bndz-settings-section-header">
                  <h2 className="text-[13px] font-bold text-white">Notifications</h2>
                </div>
                <div className="p-4">
                <Checkbox label="Show Windows toast notifications (Action Center)" checked={localConfig.useNativeWindowsNotifications !== false} onChange={e => updateLocalConfig({ useNativeWindowsNotifications: e.target.checked })} />
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-[12px] text-gray-300">Folder size toast cooldown</span>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={localConfig.folderSizeToastCooldownSeconds ?? 90}
                    onChange={e => updateLocalConfig({ folderSizeToastCooldownSeconds: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="w-[72px] h-7 bg-[#111] border border-[#555] rounded px-2 text-[12px] text-white"
                  />
                  <span className="text-[11px] text-gray-500">seconds (auto-scan only)</span>
                </div>
                <div className="mt-2">
                  <Checkbox label="Only notify when sizes are freshly calculated (not from cache)" checked={localConfig.folderSizeToastOnlyWhenFetched !== false} onChange={e => updateLocalConfig({ folderSizeToastOnlyWhenFetched: e.target.checked })} />
                </div>
                </div>
              </div>
              
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">f</span>ile info tips</span>} checked={localConfig.showFileInfoTips ?? false} onChange={e => updateLocalConfig({ showFileInfoTips: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <div className="flex gap-4">
                        <Checkbox label={<span>When hovering over the <span className="underline decoration-1 underline-offset-[3px]">i</span>con</span>} checked={localConfig.whenHoveringOverTheIcon ?? false} onChange={e => updateLocalConfig({ whenHoveringOverTheIcon: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                        <Checkbox label={<span>When hovering over the filenam<span className="underline decoration-1 underline-offset-[3px]">e</span></span>} checked={localConfig.whenHoveringOverTheFilename ?? false} onChange={e => updateLocalConfig({ whenHoveringOverTheFilename: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     </div>
                     <Checkbox label={<span>Hold Shift while <span className="underline decoration-1 underline-offset-[3px]">h</span>overing</span>} checked={localConfig.onlyWhileTheShiftKeyIsHeldDown ?? true} onChange={e => updateLocalConfig({ onlyWhileTheShiftKeyIsHeldDown: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     <Checkbox label={<span>In <span className="underline decoration-1 underline-offset-[3px]">t</span>ree as well</span>} checked={localConfig.inTreeAsWell ?? false} onChange={e => updateLocalConfig({ inTreeAsWell: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     <Checkbox label={<span>For executables as well</span>} checked={localConfig.forExecutablesAsWell ?? false} onChange={e => updateLocalConfig({ forExecutablesAsWell: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     <Checkbox label={<span>Show a<span className="underline decoration-1 underline-offset-[3px]">u</span>dio info and tags</span>} checked={localConfig.showAudioInfoAndTags ?? false} onChange={e => updateLocalConfig({ showAudioInfoAndTags: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     
                     <div className="h-2"></div>
                     <Checkbox label={<span>Use standard shell file info tips</span>} checked={localConfig.useStandardShellFileInfoTips ?? false} onChange={e => updateLocalConfig({ useStandardShellFileInfoTips: e.target.checked })} disabled={!localConfig.showFileInfoTips} />
                     <div className="ml-[20px]">
                        <Checkbox label={<span>Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> these fields:</span>} checked={localConfig.showTheseFields ?? false} onChange={e => updateLocalConfig({ showTheseFields: e.target.checked })} disabled={!localConfig.showFileInfoTips || !localConfig.useStandardShellFileInfoTips} />
                        <div className="my-[4px] ml-[20px]">
                           <ActionBtn label="Select Standard Fields..." className="w-[200px]" />
                        </div>
                        <Checkbox label={<span>Extra fields:</span>} checked={localConfig.extraFields ?? false} onChange={e => updateLocalConfig({ extraFields: e.target.checked })} disabled={!localConfig.showFileInfoTips || !localConfig.useStandardShellFileInfoTips} />
                        <div className="my-[4px] ml-[20px]">
                           <ActionBtn label="Select Extra Fields..." className="w-[200px]" />
                        </div>
                     </div>
                  </div>
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Show Ho<span className="underline decoration-1 underline-offset-[3px]">v</span>er Box</span>} checked={localConfig.showHoverBox ?? false} onChange={e => updateLocalConfig({ showHoverBox: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <div className="flex gap-4">
                        <Checkbox label={<span>When h<span className="underline decoration-1 underline-offset-[3px]">o</span>vering over the icon</span>} checked={localConfig.whenHoveringOverTheIcon ?? false} onChange={e => updateLocalConfig({ whenHoveringOverTheIcon: e.target.checked })} disabled={!localConfig.showHoverBox} />
                        <Checkbox label={<span>When hovering over the filenam<span className="underline decoration-1 underline-offset-[3px]">e</span></span>} checked={localConfig.whenHoveringOverTheFilename ?? false} onChange={e => updateLocalConfig({ whenHoveringOverTheFilename: e.target.checked })} disabled={!localConfig.showHoverBox} />
                     </div>
                     <Checkbox label={<span>Hold Shift while <span className="underline decoration-1 underline-offset-[3px]">h</span>overing</span>} checked={localConfig.onlyWhileTheShiftKeyIsHeldDown ?? true} onChange={e => updateLocalConfig({ onlyWhileTheShiftKeyIsHeldDown: e.target.checked })} disabled={!localConfig.showHoverBox} />
                     <div className="flex gap-2 mt-2">
                        <ActionBtn label="Select Item Types..." className="w-[180px]" />
                        <ActionBtn label="Select Context..." className="w-[180px]" />
                        <ActionBtn label="Tips..." className="w-[80px]" />
                     </div>
                  </div>
              </div>

              <SectionHeader title="File Info Tips and Hover Box" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>In <span className="underline decoration-1 underline-offset-[3px]">n</span>etwork locations as well</span>} checked={localConfig.inNetworkLocationsAsWell ?? false} onChange={e => updateLocalConfig({ inNetworkLocationsAsWell: e.target.checked })} />
                 <Checkbox label={<span>For <span className="underline decoration-1 underline-offset-[3px]">j</span>unctions as well</span>} checked={localConfig.forJunctionsAsWell ?? false} onChange={e => updateLocalConfig({ forJunctionsAsWell: e.target.checked })} />
                 <div className="flex flex-col gap-2 pt-2">
                    <div className="flex items-center gap-2">
                       <input type="number" 
                          value={localConfig.initialDelayInMilliseconds} 
                          onChange={(e) => updateLocalConfig({initialDelayInMilliseconds: parseInt(e.target.value) || 0})} 
                          className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                       />
                       <span className="text-[12px] text-[#e0e0e0]">Initial d<span className="underline decoration-1 underline-offset-[3px]">e</span>lay in milliseconds</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <input type="number" 
                          value={localConfig.visibleTimeInMilliseconds} 
                          onChange={(e) => updateLocalConfig({visibleTimeInMilliseconds: parseInt(e.target.value) || 0})} 
                          className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                       />
                       <span className="text-[12px] text-[#e0e0e0]">Visible <span className="underline decoration-1 underline-offset-[3px]">t</span>ime in milliseconds</span>
                    </div>
                 </div>
                 <div className="h-2"></div>
                 <Checkbox label={<span>Show tips for <span className="underline decoration-1 underline-offset-[3px]">c</span>lipped tree and list items</span>} checked={localConfig.showTipsForClippedTreeAndListItems ?? false} onChange={e => updateLocalConfig({ showTipsForClippedTreeAndListItems: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Report & Data" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Report & Data</h1>
              
              <SectionHeader title="Info Panel / Report" />
              <div className="ml-2 mb-6">
                 <div className="flex gap-[42px] mb-4 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[140px]">Classic directory dump:</span>
                     <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                           <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">T</span>able width</span>
                           <input type="number" 
                              value={localConfig.tableWidthCharacters ?? 80} 
                              onChange={(e) => updateLocalConfig({tableWidthCharacters: parseInt(e.target.value) || 80})} 
                              className="w-[50px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                           />
                           <span className="text-[12px] text-[#e0e0e0]">characters (64-256)</span>
                        </div>
                        <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">L</span>ine feed on oversized filenames</span>} checked={localConfig.lineFeedOnOversizedFilenames ?? false} onChange={e => updateLocalConfig({ lineFeedOnOversizedFilenames: e.target.checked })} />
                     </div>
                 </div>
                 
                 <div className="flex gap-[42px] mb-4 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[140px]">CSV field separator:</span>
                     <div className="flex flex-col gap-[6px]">
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({csvFieldSeparator: 'system'})}>
                           <input type="radio" name="csvFieldSeparator" checked={localConfig.csvFieldSeparator === 'system' || !localConfig.csvFieldSeparator} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]">System list s<span className="underline decoration-1 underline-offset-[3px]">e</span>parator:</span>
                           <div className="w-[40px] h-5 border border-[#555] text-white text-[12px] flex items-center justify-center">,</div>
                        </div>
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({csvFieldSeparator: 'tab'})}>
                           <input type="radio" name="csvFieldSeparator" checked={localConfig.csvFieldSeparator === 'tab'} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">T</span>ab</span>
                        </div>
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({csvFieldSeparator: 'other'})}>
                           <input type="radio" name="csvFieldSeparator" checked={localConfig.csvFieldSeparator === 'other'} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]">Other:</span>
                           <input type="text" value={localConfig.csvOtherSeparator ?? ","} onChange={e => updateLocalConfig({csvOtherSeparator: e.target.value})} className="w-[40px] h-5 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none" />
                        </div>
                     </div>
                 </div>

                 <div className="flex gap-[42px] mb-4 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[140px]">Tree structure:</span>
                     <div className="flex flex-col gap-2">
                        <Checkbox label={<span>Include <span className="underline decoration-1 underline-offset-[3px]">f</span>iles</span>} checked={localConfig.includeFiles ?? false} onChange={e => updateLocalConfig({ includeFiles: e.target.checked })} />
                        <Checkbox label={<span>Include basic item <span className="underline decoration-1 underline-offset-[3px]">d</span>ata</span>} checked={localConfig.includeBasicItemData ?? false} onChange={e => updateLocalConfig({ includeBasicItemData: e.target.checked })} />
                     </div>
                 </div>

                 <div className="flex gap-[42px] mb-4 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[140px]">Output file options:</span>
                     <div className="flex flex-col gap-[6px]">
                        <Checkbox label={<span>Default <span className="underline decoration-1 underline-offset-[3px]">n</span>ame to "[Current folder].txt"</span>} checked={localConfig.defaultNameToCurrentFolderTxt ?? false} onChange={e => updateLocalConfig({ defaultNameToCurrentFolderTxt: e.target.checked })} />
                        <Checkbox label={<span>Date/time as filename suffi<span className="underline decoration-1 underline-offset-[3px]">x</span></span>} checked={localConfig.dateTimeAsFilenameSuffix ?? false} onChange={e => updateLocalConfig({ dateTimeAsFilenameSuffix: e.target.checked })} />
                        <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>ppend to existing file</span>} checked={localConfig.appendToExistingFile ?? false} onChange={e => updateLocalConfig({ appendToExistingFile: e.target.checked })} />
                        <div className="flex gap-2 items-center mt-1">
                           <span className="text-[12px] text-[#e0e0e0]">Encoding:</span>
                           <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none" value={localConfig.encoding || "UTF-16 LE BOM"} onChange={e => updateLocalConfig({encoding: e.target.value})}><option>UTF-16 LE BOM</option><option>UTF-8</option><option>ASCII</option><option>ANSI</option></select>
                        </div>
                     </div>
                 </div>
              </div>

              <SectionHeader title="Photo Data" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label="Show photo data in the Hover Box" checked={localConfig.showPhotoDataInTheHoverBox ?? false} onChange={e => updateLocalConfig({ showPhotoDataInTheHoverBox: e.target.checked })} />
                  <Checkbox label="Show photo data in the Large Tiles view" checked={localConfig.showPhotoDataInTheLargeTilesView ?? false} onChange={e => updateLocalConfig({ showPhotoDataInTheLargeTilesView: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="File Operations" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">File Operations</h1>
              
              <SectionHeader title="Transfer engine" />
              <div className="ml-2 mb-4 space-y-[6px]">
                <p className="text-[12px] text-[#b0b0b0] max-w-[620px] leading-relaxed">
                  Choose how copy, move, delete, and rename run. <strong className="text-gray-200">BNDZ</strong> uses the
                  in-app queue with detailed progress, conflict prompts, and action-log undo. <strong className="text-gray-200">Windows</strong> delegates
                  to the shell (Explorer-style progress and shell undo for recycle-bin deletes).
                </p>
                <div className="flex flex-col gap-1 mt-2">
                  <span className="text-[12px] text-[#e0e0e0]">File operation engine:</span>
                  <select
                    className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] w-[min(320px,100%)] outline-none focus:border-[#0078d4]/50"
                    value={localConfig.fileOperationEngine === 'native' ? 'native' : 'bndz'}
                    onChange={e => {
                      const v = e.target.value;
                      updateLocalConfig({
                        fileOperationEngine: v,
                        selectCopyHandler: v === 'native' ? 'Default Windows handler' : 'BNDZ custom handler',
                      });
                    }}
                  >
                    <option value="bndz">BNDZ engine (queued, in-app progress &amp; undo)</option>
                    <option value="native">Windows shell (Explorer transfers)</option>
                  </select>
                </div>
                {localConfig.fileOperationEngine === 'native' && (
                  <div className="mt-2">
                    <Checkbox
                      label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">E</span>xplorer progress dialogs</span>}
                      checked={localConfig.nativeShellShowProgress ?? true}
                      onChange={e => updateLocalConfig({ nativeShellShowProgress: e.target.checked })}
                    />
                    <p className="text-[11px] text-gray-500 mt-1 max-w-[560px]">
                      When off, shell copy/move/delete run silently in the background (no Explorer progress window).
                    </p>
                  </div>
                )}
              </div>

              <SectionHeader title="Background Processing" />
              <div className="ml-2 mb-4">
                 <div className="flex items-center gap-[40px] mb-[6px]">
                   <Checkbox label={<span>Enable <span className="underline decoration-1 underline-offset-[3px]">b</span>ackground processing</span>} checked={localConfig.enableBackgroundProcessing ?? true} onChange={e => updateLocalConfig({ enableBackgroundProcessing: e.target.checked })} />
                 </div>
                 <div className="ml-[20px]">
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">Q</span>ueue file operations</span>} checked={localConfig.queueFileOperations ?? true} onChange={e => updateLocalConfig({ queueFileOperations: e.target.checked })} disabled={!localConfig.enableBackgroundProcessing} />
                 </div>
                 <p className="text-[11px] text-gray-500 mt-2 max-w-[560px]">
                   When queued, concurrent paste and drag-drop operations run one at a time. Disable queue only if you need overlapping shell dialogs (native engine).
                 </p>
              </div>

              <SectionHeader title="Backup Operations" />
              <div className="ml-2 mb-4">
                 <ActionBtn label="Configure..." className="w-[120px]" />
              </div>
              
              <SectionHeader title="Custom Copy Operations" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <div className="mb-[10px]">
                    <ActionBtn label="Configure..." className="w-[120px]" />
                 </div>
                 <Checkbox label={<span>Use Custom Copy</span>} checked={localConfig.useCustomCopy ?? false} onChange={e => updateLocalConfig({ useCustomCopy: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>For all <span className="underline decoration-1 underline-offset-[3px]">c</span>opy operations</span>} checked={localConfig.forAllCopyOperations ?? false} onChange={e => updateLocalConfig({ forAllCopyOperations: e.target.checked })} disabled={!localConfig.useCustomCopy} />
                    <div className="ml-[20px]">
                       <Checkbox label={<span>No progress dialog on <span className="underline decoration-1 underline-offset-[3px]">d</span>uplications</span>} checked={localConfig.noProgressDialogOnDuplications ?? false} onChange={e => updateLocalConfig({ noProgressDialogOnDuplications: e.target.checked })} disabled={!localConfig.forAllCopyOperations || !localConfig.useCustomCopy} />
                    </div>
                    <Checkbox label={<span>For all <span className="underline decoration-1 underline-offset-[3px]">m</span>ove operations</span>} checked={localConfig.forAllMoveOperations ?? false} onChange={e => updateLocalConfig({ forAllMoveOperations: e.target.checked })} disabled={!localConfig.useCustomCopy} />
                    <div className="ml-[20px] space-y-[6px]">
                       <Checkbox label={<span>For cross-volume moves only</span>} checked={localConfig.forCrossVolumeMovesOnly ?? false} onChange={e => updateLocalConfig({ forCrossVolumeMovesOnly: e.target.checked })} disabled={!localConfig.forAllMoveOperations || !localConfig.useCustomCopy} />
                       <Checkbox label={<span>No progress dialog on <span className="underline decoration-1 underline-offset-[3px]">i</span>ntra-volume moves</span>} checked={localConfig.noProgressDialogOnIntraVolumeMoves ?? false} onChange={e => updateLocalConfig({ noProgressDialogOnIntraVolumeMoves: e.target.checked })} disabled={!localConfig.forAllMoveOperations || !localConfig.useCustomCopy} />
                    </div>
                    <Checkbox label={<span>C<span className="underline decoration-1 underline-offset-[3px]">h</span>eck beforehand whether there is enough space</span>} checked={localConfig.checkBeforehandWhetherThereIsEnoughSpace ?? false} onChange={e => updateLocalConfig({ checkBeforehandWhetherThereIsEnoughSpace: e.target.checked })} disabled={!localConfig.useCustomCopy} />
                    <Checkbox label={<span>Default to repeat <span className="underline decoration-1 underline-offset-[3px]">a</span>ction on collisions</span>} checked={localConfig.defaultToRepeatActionOnCollisions ?? false} onChange={e => updateLocalConfig({ defaultToRepeatActionOnCollisions: e.target.checked })} disabled={!localConfig.useCustomCopy} />
                 </div>
              </div>

              <SectionHeader title="External Copy Handlers" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <div className="mb-[10px]">
                    <ActionBtn label="Configure..." className="w-[120px]" />
                 </div>
                 <div className="flex flex-col gap-1 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0]">Select copy <span className="underline decoration-1 underline-offset-[3px]">h</span>andler:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none" value={localConfig.selectCopyHandler || ""} onChange={e => updateLocalConfig({selectCopyHandler: e.target.value})}><option>Default Windows handler</option><option>BNDZ custom handler</option><option>TeraCopy</option></select>
                 </div>
              </div>
              
              <SectionHeader title="Miscellaneous" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Suppress d<span className="underline decoration-1 underline-offset-[3px]">e</span>lete confirmation dialog</span>} checked={localConfig.suppressDeleteConfirmationDialog ?? false} onChange={e => updateLocalConfig({ suppressDeleteConfirmationDialog: e.target.checked })} />
                  <Checkbox label={<span>Preser<span className="underline decoration-1 underline-offset-[3px]">v</span>e permissions on move operation</span>} checked={localConfig.preservePermissionsOnMoveOperation ?? false} onChange={e => updateLocalConfig({ preservePermissionsOnMoveOperation: e.target.checked })} />
                  <Checkbox label={<span>File operation progress dialog m<span className="underline decoration-1 underline-offset-[3px]">o</span>deless</span>} checked={localConfig.fileOperationProgressDialogModeless ?? false} onChange={e => updateLocalConfig({ fileOperationProgressDialogModeless: e.target.checked })} />
                  
                  <div className="flex gap-4 items-center mt-[12px]">
                     <span className="text-[12px] text-[#e0e0e0]">Recreate source folder structure:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none" value={localConfig.recreateSourceFolderStructure || "Ask"} onChange={e => updateLocalConfig({recreateSourceFolderStructure: e.target.value})}><option>Ask</option><option>Never</option><option>Always</option></select>
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Undo & Action Log" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Undo & Action Log</h1>
              
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Log <span className="underline decoration-1 underline-offset-[3px]">a</span>ctions and enable undo/redo</span>} checked={localConfig.logActionsAndEnableUndoRedo ?? true} onChange={e => updateLocalConfig({ logActionsAndEnableUndoRedo: e.target.checked })} />
                  <Checkbox label={<span>Remembe<span className="underline decoration-1 underline-offset-[3px]">r</span> the logged actions between sessions</span>} checked={localConfig.rememberTheLoggedActionsBetweenSessions ?? false} onChange={e => updateLocalConfig({ rememberTheLoggedActionsBetweenSessions: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <Checkbox label={<span>Even on exit wit<span className="underline decoration-1 underline-offset-[3px]">h</span>out saving</span>} checked={localConfig.evenOnExitWithoutSaving ?? false} onChange={e => updateLocalConfig({ evenOnExitWithoutSaving: e.target.checked })} disabled={!localConfig.rememberTheLoggedActionsBetweenSessions} />
                  </div>
              </div>
              
              <div className="ml-2 mb-4 space-y-[6px]">
                 <div className="flex items-center gap-2">
                    <input type="number" 
                       value={localConfig.allowedNumberOfEntriesInTheActionLog ?? 256} 
                       onChange={(e) => updateLocalConfig({allowedNumberOfEntriesInTheActionLog: parseInt(e.target.value) || 256})} 
                       className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                    />
                    <span className="text-[12px] text-[#e0e0e0]">Allowed n<span className="underline decoration-1 underline-offset-[3px]">u</span>mber of entries in the action log (maximum is 256)</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <input type="number" 
                       value={localConfig.allowedNumberOfItemsPerLoggedAction ?? 0} 
                       onChange={(e) => updateLocalConfig({allowedNumberOfItemsPerLoggedAction: parseInt(e.target.value) || 0})} 
                       className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                    />
                    <span className="text-[12px] text-[#e0e0e0]">Allowed <span className="underline decoration-1 underline-offset-[3px]">n</span>umber of items per logged action (0 = unlimited)</span>
                 </div>
              </div>
              
              <div className="ml-2 mb-4 space-y-[10px]">
                 <div className="flex flex-col gap-1 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0]">Date <span className="underline decoration-1 underline-offset-[3px]">f</span>ormat in action labels:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[350px] outline-none" value={localConfig.dateFormatInActionLabels || "Age of action (how long ago)"} onChange={e => updateLocalConfig({dateFormatInActionLabels: e.target.value})}><option>Age of action (how long ago)</option><option>Absolute date/time</option><option>Relative to today</option></select>
                 </div>
                 <div className="flex flex-col gap-1 mt-[10px]">
                     <span className="text-[12px] text-[#e0e0e0]">Prompt before u<span className="underline decoration-1 underline-offset-[3px]">n</span>do/redo:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[350px] outline-none" value={localConfig.promptBeforeUndoRedo || "If action is older than 10 minutes"} onChange={e => updateLocalConfig({promptBeforeUndoRedo: e.target.value})}><option>If action is older than 10 minutes</option><option>Always</option><option>Never</option></select>
                 </div>
              </div>
              
              <div className="ml-2 mb-6 space-y-[6px]">
                  <Checkbox label={<span>Prompt before <span className="underline decoration-1 underline-offset-[3px]">d</span>elete</span>} checked={localConfig.promptBeforeDelete ?? false} onChange={e => updateLocalConfig({ promptBeforeDelete: e.target.checked })} />
                  <Checkbox label={<span>Delete to re<span className="underline decoration-1 underline-offset-[3px]">c</span>ycle bin</span>} checked={localConfig.deleteToRecycleBin ?? false} onChange={e => updateLocalConfig({ deleteToRecycleBin: e.target.checked })} />
              </div>
              
              <SectionHeader title="Toolbar Buttons" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Show last actions in toolbar button m<span className="underline decoration-1 underline-offset-[3px]">e</span>nu</span>} checked={localConfig.showLastActionsInToolbarButtonMenu ?? false} onChange={e => updateLocalConfig({ showLastActionsInToolbarButtonMenu: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[330px] outline-none mt-2 mb-1" value={localConfig.allowOnlySingleStepUndoRedo || "Allow only single step undo/redo"} onChange={e => updateLocalConfig({allowOnlySingleStepUndoRedo: e.target.value})}><option>Allow only single step undo/redo</option><option>Allow multi-step undo/redo</option></select>
                     <Checkbox label={<span>Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> options in menu</span>} checked={localConfig.showOptionsInMenu ?? false} onChange={e => updateLocalConfig({ showOptionsInMenu: e.target.checked })} />
                     <p className="text-[12px] text-[#e0e0e0] mt-[8px]">Cumulative and non-sequential undo/redo should be used with care.</p>
                  </div>
              </div>
              
              <SectionHeader title="Clipboard" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Log clipboard contents and enable restore</span>} checked={localConfig.logClipboardContentsAndEnableRestore ?? false} onChange={e => updateLocalConfig({ logClipboardContentsAndEnableRestore: e.target.checked })} />
              </div>
            </TabsContent>
            
            <TabsContent value="Find Files & Branch View" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Find Files & Branch View</h1>
              
              <SectionHeader title="Find Files" />
              <div className="ml-2 mb-6 space-y-[6px]">
                  <Checkbox label={<span>Enable Omni-Filter EverythingNet <span className="underline decoration-1 underline-offset-[3px]">G</span>lobal Search Prefix (&gt; )</span>} checked={localConfig.enableGlobalSearchPrefix ?? true} onChange={e => updateLocalConfig({ enableGlobalSearchPrefix: e.target.checked })} />
                  <Checkbox label={<span>Use BNDZ indexed search for &gt; global search</span>} checked={localConfig.enableBndzIndexedSearch !== false} onChange={e => updateLocalConfig({ enableBndzIndexedSearch: e.target.checked })} />
                  <Checkbox label={<span>Use Everything search when available</span>} checked={localConfig.enableEverythingSearch !== false} onChange={e => updateLocalConfig({ enableEverythingSearch: e.target.checked })} />
                  <Checkbox label={<span>Search inside file contents (slower)</span>} checked={localConfig.searchFileContent === true} onChange={e => updateLocalConfig({ searchFileContent: e.target.checked })} />
                  <p className="text-[11px] text-gray-500 ml-[20px]">Right-click any folder → <span className="text-gray-400">Index folder for search</span> to add it to the local cache.</p>

                  <SectionHeader title="Search index" />
                  <Checkbox label={<span>Show IDX badges in navigation tree</span>} checked={localConfig.showNavIndexBadges === true} onChange={e => updateLocalConfig({ showNavIndexBadges: e.target.checked })} />
                  <BndzIndexManagerPanel />
                  <div className="ml-[20px]">
                     <div className="flex items-center gap-2 mb-1">
                        <input type="number" 
                           value={localConfig.globalSearchLimit ?? 1000} 
                           onChange={(e) => updateLocalConfig({globalSearchLimit: parseInt(e.target.value) || 1000})} 
                           className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none disabled:opacity-50"
                           disabled={!localConfig.enableGlobalSearchPrefix}
                        />
                        <span className={`text-[12px] ${!localConfig.enableGlobalSearchPrefix ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Global search result li<span className="underline decoration-1 underline-offset-[3px]">m</span>it</span>
                     </div>
                  </div>
                  
                  <Checkbox label={<span>Show relative path in Path column</span>} checked={localConfig.showRelativePathInPathColumn ?? false} onChange={e => updateLocalConfig({ showRelativePathInPathColumn: e.target.checked })} />
                  <Checkbox label={<span>Synchronize tree with search location</span>} checked={localConfig.synchronizeTreeWithSearchLocation ?? false} onChange={e => updateLocalConfig({ synchronizeTreeWithSearchLocation: e.target.checked })} />
                  <Checkbox label={<span>Cache search results</span>} checked={localConfig.cacheSearchResults ?? false} onChange={e => updateLocalConfig({ cacheSearchResults: e.target.checked })} />
                  <div className="ml-[20px]">
                     <div className="flex items-center gap-2 mb-1">
                        <input type="number" 
                           value={localConfig.maximumNumberOfItemsCached ?? 1000} 
                           onChange={(e) => updateLocalConfig({maximumNumberOfItemsCached: parseInt(e.target.value) || 1000})} 
                           className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none disabled:opacity-50"
                           disabled={!localConfig.cacheSearchResults}
                        />
                        <span className={`text-[12px] ${!localConfig.cacheSearchResults ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Maximum number of items cached (0 = cache always)</span>
                     </div>
                  </div>
                  
                  <Checkbox label={<span>Follow junctions</span>} checked={localConfig.followJunctions ?? false} onChange={e => updateLocalConfig({ followJunctions: e.target.checked })} />
                  <Checkbox label={<span>Skip invisible subfolders</span>} checked={localConfig.skipInvisibleSubfolders ?? false} onChange={e => updateLocalConfig({ skipInvisibleSubfolders: e.target.checked })} />
                  
                  <div className="flex gap-[42px] items-center mt-4 mb-4">
                     <span className="text-[12px] text-[#e0e0e0]">Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> search results in:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none ml-[20px]" value={localConfig.showSearchResultsIn || "\"Search results\" tab (locked)"} onChange={e => updateLocalConfig({showSearchResultsIn: e.target.value})}><option>"Search results" tab (locked)</option><option>Current tab</option><option>New tab</option></select>
                  </div>
                  
                  <Checkbox label={<span>Show quick search results in current tab</span>} checked={localConfig.showQuickSearchResultsInCurrentTab ?? false} onChange={e => updateLocalConfig({ showQuickSearchResultsInCurrentTab: e.target.checked })} />
                  <Checkbox label={<span>Show s<span className="underline decoration-1 underline-offset-[3px]">e</span>arch information in list</span>} checked={localConfig.showSearchInformationInList ?? false} onChange={e => updateLocalConfig({ showSearchInformationInList: e.target.checked })} />
                  <Checkbox label={<span>Search results inherit current c<span className="underline decoration-1 underline-offset-[3px]">o</span>lumns</span>} checked={localConfig.searchResultsInheritCurrentColumns ?? false} onChange={e => updateLocalConfig({ searchResultsInheritCurrentColumns: e.target.checked })} />
                  <Checkbox label={<span>Enable e<span className="underline decoration-1 underline-offset-[3px]">x</span>tended pattern matching</span>} checked={localConfig.enableExtendedPatternMatching ?? false} onChange={e => updateLocalConfig({ enableExtendedPatternMatching: e.target.checked })} />
                  <Checkbox label={<span>Enable s<span className="underline decoration-1 underline-offset-[3px]">m</span>art Boolean query parsing</span>} checked={localConfig.enableSmartBooleanQueryParsing ?? false} onChange={e => updateLocalConfig({ enableSmartBooleanQueryParsing: e.target.checked })} />
                  <Checkbox label={<span>Persi<span className="underline decoration-1 underline-offset-[3px]">s</span>t quick search across folders</span>} checked={localConfig.persistQuickSearchAcrossFolders ?? false} onChange={e => updateLocalConfig({ persistQuickSearchAcrossFolders: e.target.checked })} />
              </div>

              <SectionHeader title="Branch View" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Persist across folders</span>} checked={localConfig.persistAcrossFolders ?? false} onChange={e => updateLocalConfig({ persistAcrossFolders: e.target.checked })} />
                  <Checkbox label={<span>Toggle on same query</span>} checked={localConfig.toggleOnSameQuery ?? false} onChange={e => updateLocalConfig({ toggleOnSameQuery: e.target.checked })} />
                  <Checkbox label={<span>Auto-refresh</span>} checked={localConfig.autoRefresh ?? false} onChange={e => updateLocalConfig({ autoRefresh: e.target.checked })} />
                  <Checkbox label={<span>Level-i<span className="underline decoration-1 underline-offset-[3px]">n</span>dent</span>} checked={localConfig.levelIndent ?? false} onChange={e => updateLocalConfig({ levelIndent: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <div className="flex items-center gap-2">
                        <input type="number" 
                           value={localConfig.levelIndentWidthInPixels ?? 12} 
                           onChange={(e) => updateLocalConfig({levelIndentWidthInPixels: parseInt(e.target.value) || 12})} 
                           className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none disabled:opacity-50"
                           disabled={!localConfig.levelIndent}
                        />
                        <span className={`text-[12px] ${!localConfig.levelIndent ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Level-ind<span className="underline decoration-1 underline-offset-[3px]">e</span>nt width in pixels (1 to 64)</span>
                     </div>
                     <Checkbox label={<span>Default to <span className="underline decoration-1 underline-offset-[3px]">t</span>ree-like sort order</span>} checked={localConfig.defaultToTreeLikeSortOrder ?? false} onChange={e => updateLocalConfig({ defaultToTreeLikeSortOrder: e.target.checked })} disabled={!localConfig.levelIndent} />
                  </div>
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">L</span>et folders pass all filters</span>} checked={localConfig.letFoldersPassAllFilters ?? false} onChange={e => updateLocalConfig({ letFoldersPassAllFilters: e.target.checked })} />
                  <Checkbox label={<span>M<span className="underline decoration-1 underline-offset-[3px]">u</span>lti branch view lists top folders</span>} checked={localConfig.multiBranchViewListsTopFolders ?? false} onChange={e => updateLocalConfig({ multiBranchViewListsTopFolders: e.target.checked })} />
                  
                  <div className="flex gap-[42px] items-center mt-4">
                     <span className="text-[12px] text-[#e0e0e0]">Default branch <span className="underline decoration-1 underline-offset-[3px]">v</span>iew type:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none" value={localConfig.defaultBranchViewType || "Files and folders"} onChange={e => updateLocalConfig({defaultBranchViewType: e.target.value})}><option>Files and folders</option><option>Files only</option><option>Folders only</option></select>
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Filters & Type Ahead Find" className="m-0 border-0 p-0 outline-none flex flex-col h-full">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Filters & Type Ahead Find</h1>
              
              <SectionHeader title="Visual Filters" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Persist visual filters <span className="underline decoration-1 underline-offset-[3px]">a</span>cross folders</span>} checked={localConfig.persistVisualFiltersAcrossFolders ?? false} onChange={e => updateLocalConfig({ persistVisualFiltersAcrossFolders: e.target.checked })} />
                  <Checkbox label={<span>Toggle on same filter</span>} checked={localConfig.toggleOnSameFilter ?? false} onChange={e => updateLocalConfig({ toggleOnSameFilter: e.target.checked })} />
                  <Checkbox label={<span>Enable extended pattern matching</span>} checked={localConfig.enableExtendedPatternMatching ?? false} onChange={e => updateLocalConfig({ enableExtendedPatternMatching: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>how filter information in list</span>} checked={localConfig.showFilterInformationInList ?? false} onChange={e => updateLocalConfig({ showFilterInformationInList: e.target.checked })} />
                  <Checkbox label={<span>Show filter infor<span className="underline decoration-1 underline-offset-[3px]">m</span>ation in tab headers</span>} checked={localConfig.showFilterInformationInTabHeaders ?? false} onChange={e => updateLocalConfig({ showFilterInformationInTabHeaders: e.target.checked })} />
              </div>
              
              <SectionHeader title="Live Filter Box" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Highlight ma<span className="underline decoration-1 underline-offset-[3px]">t</span>ches</span>} checked={localConfig.highlightMatches ?? false} onChange={e => updateLocalConfig({ highlightMatches: e.target.checked })} />
                  <Checkbox label={<span>Auto-select first match</span>} checked={localConfig.autoSelectFirstMatch ?? false} onChange={e => updateLocalConfig({ autoSelectFirstMatch: e.target.checked })} />
                  <Checkbox label={<span>Persistent <span className="underline decoration-1 underline-offset-[3px]">l</span>ive filters</span>} checked={localConfig.persistentLiveFilters ?? false} onChange={e => updateLocalConfig({ persistentLiveFilters: e.target.checked })} />
                  <Checkbox label={<span>Enable <span className="underline decoration-1 underline-offset-[3px]">n</span>avigation keys</span>} checked={localConfig.enableNavigationKeys ?? false} onChange={e => updateLocalConfig({ enableNavigationKeys: e.target.checked })} />
                  <Checkbox label={<span>Enable extended pattern matching</span>} checked={localConfig.enableExtendedPatternMatching ?? false} onChange={e => updateLocalConfig({ enableExtendedPatternMatching: e.target.checked })} />
                  <div className="flex items-center gap-2 mt-2">
                     <input type="number" 
                        value={localConfig.delayBeforeFilterIsApplied ?? 250} 
                        onChange={(e) => updateLocalConfig({delayBeforeFilterIsApplied: parseInt(e.target.value) || 250})} 
                        className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                     />
                     <span className="text-[12px] text-[#e0e0e0]">Delay before filter is applic<span className="underline decoration-1 underline-offset-[3px]">e</span>d (in milliseconds)</span>
                  </div>
              </div>

              <SectionHeader title="Visual Filters and Live Filter Box" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Appl<span className="underline decoration-1 underline-offset-[3px]">y</span> to files only</span>} checked={localConfig.applyToFilesOnly ?? false} onChange={e => updateLocalConfig({ applyToFilesOnly: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">M</span>atch case</span>} checked={localConfig.matchCase ?? false} onChange={e => updateLocalConfig({ matchCase: e.target.checked })} />
                  <Checkbox label={<span>Ignore d<span className="underline decoration-1 underline-offset-[3px]">i</span>acritics</span>} checked={localConfig.ignoreDiacritics ?? false} onChange={e => updateLocalConfig({ ignoreDiacritics: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">U</span>se space character for Boolean AND</span>} checked={localConfig.useSpaceCharacterForBooleanAnd ?? false} onChange={e => updateLocalConfig({ useSpaceCharacterForBooleanAnd: e.target.checked })} />
                  <Checkbox label={<span>Multi-column matching</span>} checked={localConfig.multiColumnMatching ?? false} onChange={e => updateLocalConfig({ multiColumnMatching: e.target.checked })} />
              </div>

              <SectionHeader title="Type Ahead Find" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Enable t<span className="underline decoration-1 underline-offset-[3px]">y</span>pe ahead find</span>} checked={localConfig.enableTypeAheadFind ?? false} onChange={e => updateLocalConfig({ enableTypeAheadFind: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[400px] outline-none mt-1 mb-2" value={localConfig.typeAheadFindMatch || "Match at beginning"} onChange={e => updateLocalConfig({typeAheadFindMatch: e.target.value})} disabled={!localConfig.enableTypeAheadFind}><option>Match at beginning</option><option>Match anywhere</option><option>Match exact</option></select>
                     <Checkbox label={<span>Highlight matc<span className="underline decoration-1 underline-offset-[3px]">h</span>es</span>} checked={localConfig.highlightMatches ?? false} onChange={e => updateLocalConfig({ highlightMatches: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span>Ignor<span className="underline decoration-1 underline-offset-[3px]">e</span> diacritics</span>} checked={localConfig.ignoreDiacritics ?? false} onChange={e => updateLocalConfig({ ignoreDiacritics: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span>Allow repeated characters</span>} checked={localConfig.allowRepeatedCharacters ?? false} onChange={e => updateLocalConfig({ allowRepeatedCharacters: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>kip single spaces</span>} checked={localConfig.skipSingleSpaces ?? false} onChange={e => updateLocalConfig({ skipSingleSpaces: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span>Use sorted <span className="underline decoration-1 underline-offset-[3px]">c</span>olumn</span>} checked={localConfig.useSortedColumn ?? false} onChange={e => updateLocalConfig({ useSortedColumn: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">P</span>aste and find</span>} checked={localConfig.pasteAndFind ?? false} onChange={e => updateLocalConfig({ pasteAndFind: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                     <Checkbox label={<span>Redirect typing to Live Filter Bo<span className="underline decoration-1 underline-offset-[3px]">x</span></span>} checked={localConfig.redirectTypingToLiveFilterBox ?? false} onChange={e => updateLocalConfig({ redirectTypingToLiveFilterBox: e.target.checked })} disabled={!localConfig.enableTypeAheadFind} />
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Shell Integration" className="m-0 border-0 p-0 outline-none mt-1">
              <h1 className="text-[22px] font-bold text-white mb-6 tracking-tight">Shell Integration</h1>
              
              <SectionHeader title="Context Menus" />
              <div className="ml-[10px] mb-[24px]">
                 <Checkbox 
                     label={<span>Use <span className="font-bold underline decoration-1 underline-offset-[3px]">N</span>ative OS Context Menu</span>} 
                     checked={localConfig.useNativeOSContextMenu ?? false} 
                     onChange={e => updateLocalConfig({ useNativeOSContextMenu: e.target.checked })} 
                 />
                 <p className="text-[#a0a0a0] text-[11px] ml-6 mt-1">If unchecked, the file manager will attempt to use a custom styled menu override.</p>
              </div>

              <SectionHeader title="Default File Manager" />
              <p className="text-[12px] text-[#e0e0e0] mb-[22px] mt-1 ml-[8px]">Note that changes will take immediate effect and modify the registry of the host system.</p>

              <div className="flex items-center gap-[42px] ml-[24px] mb-8 mt-[10px]">
                 <span className="text-[12px] text-[#e0e0e0]">Scope:</span>
                 <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[355px] outline-none" value={localConfig.selectConfig1 || ""} onChange={e => updateLocalConfig({selectConfig1: e.target.value})}><option>Only for the current user</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
              </div>

              <div className="ml-[8px] mb-8 space-y-[10px] mt-6">
                 <div>
                    <Checkbox label={<span>BNDZ in shell <span className="underline decoration-1 underline-offset-[3px]">c</span>ontext menu</span>} checked={localConfig.inContextMenu ?? localConfig.bndzInShellContextMenu ?? false} onChange={e => handleContextMenuToggle(e.target.checked)} disabled={shellBusy} />
                    <p className="text-[12px] text-[#e0e0e0] mt-[2px] ml-[22px]">Adds the item "BNDZ" to the shell context menu for drives and directories.</p>
                 </div>

                 <div className="ml-[20px] pt-1">
                    <Checkbox label={<span>BNDZ is <span className="underline decoration-1 underline-offset-[3px]">d</span>efault file manager</span>} checked={localConfig.isDefaultFileManager ?? localConfig.bndzIsDefaultFileManager ?? false} onChange={e => handleDefaultFileManagerToggle(e.target.checked)} disabled={shellBusy} />
                    <p className="text-[12px] mt-[2px] ml-[22px] text-[#888]">Double-clicking drives or directories will open them in BNDZ. Unchecking restores Windows Explorer.</p>
                 </div>
                 {shellStatus && (
                   <p className="text-[11px] ml-[22px] mt-2 text-[#99c9f0]">{shellStatus}</p>
                 )}
              </div>

              <SectionHeader title="Drag and Drop" />
              <div className="ml-[8px] mb-8 space-y-[12px] mt-2">
                 <div>
                    <span className="text-[12px] text-[#e0e0e0] block mb-1">Default action on drag and drop to same drive:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none hover:border-[#888]" value={localConfig.selectConfig2 || ""} onChange={e => updateLocalConfig({selectConfig2: e.target.value})}><option>Move (Windows Standard)</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
                 </div>
                 <div className="pt-2">
                    <span className="text-[12px] text-[#e0e0e0] block mb-1">Default action on drag and drop to different drive:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none hover:border-[#888]" value={localConfig.selectConfig3 || ""} onChange={e => updateLocalConfig({selectConfig3: e.target.value})}><option>Copy (Windows Standard)</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
                 </div>
                 <div className="text-white mt-5 pt-3">
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">E</span>xtended compatibility for clipboard and drag and drop</span>} checked={localConfig.extendedCompatibilityForClipboardAndDragAndDrop ?? false} onChange={e => updateLocalConfig({ extendedCompatibilityForClipboardAndDragAndDrop: e.target.checked })} />
                 </div>
              </div>

            </TabsContent>

            <TabsContent value="Preview" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Preview</h1>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Audio/Video preview:</span>
                  <div className="flex flex-col gap-[6px]">
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[350px] outline-none" value={localConfig.audioVideoPreview || "Play once"} onChange={e => updateLocalConfig({audioVideoPreview: e.target.value})}><option>Play once</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
                     <Checkbox label={<span className="font-semibold">Autoplay</span>} checked={localConfig.autoplay ?? false} onChange={e => updateLocalConfig({ autoplay: e.target.checked })} />
                     <div className="flex items-center gap-2">
                        <Checkbox label={<span>Play only the <span className="underline decoration-1 underline-offset-[3px]">f</span>irst seconds:</span>} checked={localConfig.playOnlyTheFirstSeconds ?? false} onChange={e => updateLocalConfig({ playOnlyTheFirstSeconds: e.target.checked })} />
                        <input type="number" 
                           value={localConfig.playOnlyTheFirstSecondsValue ?? 3} 
                           onChange={(e) => updateLocalConfig({playOnlyTheFirstSecondsValue: parseInt(e.target.value) || 3})} 
                           className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none ml-auto"
                           disabled={!localConfig.playOnlyTheFirstSeconds}
                        />
                     </div>
                     <Checkbox label={<span>Keep playing when info panel is hidden</span>} checked={localConfig.keepPlayingWhenInfoPanelIsHidden ?? false} onChange={e => updateLocalConfig({ keepPlayingWhenInfoPanelIsHidden: e.target.checked })} />
                     <Checkbox label={<span>Use nati<span className="underline decoration-1 underline-offset-[3px]">v</span>e handling in the preview pane</span>} checked={localConfig.useNativeHandlingInThePreviewPane ?? false} onChange={e => updateLocalConfig({ useNativeHandlingInThePreviewPane: e.target.checked })} />
                  </div>
              </div>

              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Audio preview:</span>
                  <div className="flex flex-col gap-[6px]">
                     <Checkbox label={<span>Play also when info panel is <span className="underline decoration-1 underline-offset-[3px]">h</span>idden</span>} checked={localConfig.playAlsoWhenInfoPanelIsHidden ?? false} onChange={e => updateLocalConfig({ playAlsoWhenInfoPanelIsHidden: e.target.checked })} />
                     <Checkbox label={<span>Seamless <span className="underline decoration-1 underline-offset-[3px]">w</span>ave looping</span>} checked={localConfig.seamlessWaveLooping ?? false} onChange={e => updateLocalConfig({ seamlessWaveLooping: e.target.checked })} />
                  </div>
              </div>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Video preview:</span>
                  <div className="flex gap-4 items-center">
                     <Checkbox label={<span>Preview as thum<span className="underline decoration-1 underline-offset-[3px]">b</span>nail</span>} checked={localConfig.previewAsThumbnail ?? false} onChange={e => updateLocalConfig({ previewAsThumbnail: e.target.checked })} />
                     <Checkbox label={<span>Skip:</span>} checked={localConfig.skip ?? false} onChange={e => updateLocalConfig({ skip: e.target.checked })} disabled={!localConfig.previewAsThumbnail} />
                     <div className="flex items-center gap-2">
                        <input type="number" 
                           value={localConfig.skipVideoPreviewValue ?? 0} 
                           onChange={(e) => updateLocalConfig({skipVideoPreviewValue: parseInt(e.target.value) || 0})} 
                           className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                           disabled={!localConfig.skipVideoPreview}
                        />
                        <span className={`text-[12px] ${!localConfig.skipVideoPreview ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>ms</span>
                     </div>
                  </div>
              </div>

              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Image/Video preview:</span>
                  <div className="flex flex-col gap-[6px]">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">Z</span>oom to fit</span>} checked={localConfig.zoomToFit ?? false} onChange={e => updateLocalConfig({ zoomToFit: e.target.checked })} />
                     <div className="flex gap-4">
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({imageVideoBorderType: 'no-border'})}>
                           <input type="radio" name="imageVideoBorderType" checked={localConfig.imageVideoBorderType === 'no-border' || !localConfig.imageVideoBorderType} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">N</span>o border</span>
                        </div>
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({imageVideoBorderType: '2d'})}>
                           <input type="radio" name="imageVideoBorderType" checked={localConfig.imageVideoBorderType === '2d'} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]">2<span className="underline decoration-1 underline-offset-[3px]">D</span></span>
                        </div>
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({imageVideoBorderType: '3d'})}>
                           <input type="radio" name="imageVideoBorderType" checked={localConfig.imageVideoBorderType === '3d'} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">3</span>D</span>
                        </div>
                        <div className="flex items-center gap-[6px]" onClick={() => updateLocalConfig({imageVideoBorderType: 'shadow'})}>
                           <input type="radio" name="imageVideoBorderType" checked={localConfig.imageVideoBorderType === 'shadow'} readOnly className="appearance-none w-[12px] h-[12px] rounded-full border border-[#888] checked:border-[3px] checked:border-[#0078D7] checked:bg-white" />
                           <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">S</span>hadow</span>
                        </div>
                     </div>
                  </div>
              </div>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Image preview:</span>
                  <div className="flex flex-col gap-[6px] flex-1">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">H</span>igh quality image resampling</span>} checked={localConfig.highQualityImageResampling ?? false} onChange={e => updateLocalConfig({ highQualityImageResampling: e.target.checked })} />
                     <div className="flex gap-2 items-center">
                        <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">L</span>imit original preview size:</span>} checked={localConfig.limitOriginalPreviewSize ?? false} onChange={e => updateLocalConfig({ limitOriginalPreviewSize: e.target.checked })} />
                        <div className="flex items-center gap-2 ml-auto">
                           <input type="number" 
                              value={localConfig.limitOriginalPreviewSizeValue ?? 1600} 
                              onChange={(e) => updateLocalConfig({limitOriginalPreviewSizeValue: parseInt(e.target.value) || 1600})} 
                              className="w-[80px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                              disabled={!localConfig.limitOriginalPreviewSize}
                           />
                           <span className={`text-[12px] ${!localConfig.limitOriginalPreviewSize ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>px</span>
                        </div>
                     </div>
                     <Checkbox label={<span>Auto-rotate preview</span>} checked={localConfig.autoRotatePreview ?? false} onChange={e => updateLocalConfig({ autoRotatePreview: e.target.checked })} />
                     
                     <div className="flex items-center justify-between mt-2">
                        <span className="text-[12px] text-[#e0e0e0]">Transparency background:</span>
                        <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none" value={localConfig.transparencyBackground || "Grid"} onChange={e => updateLocalConfig({transparencyBackground: e.target.value})}><option>Grid</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
                     </div>
                     <div className="flex flex-col gap-1 mt-1">
                        <span className="text-[12px] text-[#e0e0e0]">Transparency grid colors:</span>
                        <div className="flex gap-4">
                           <div className="flex rounded-sm overflow-hidden border border-[#555] h-6">
                              <button className="bg-[#f0f0f0] text-black text-[12px] px-4 w-[100px]">Color 1</button>
                              <input type="text" className="w-[80px] bg-[#1e1e1e] text-white text-[12px] px-2 outline-none" value={localConfig.Config1 || "FFFFFF"} onChange={e => updateLocalConfig({ Config1: e.target.value })}  />
                           </div>
                           <div className="flex rounded-sm overflow-hidden border border-[#555] h-6">
                              <button className="bg-[#f0f0f0] text-black text-[12px] px-4 w-[100px]">Color 2</button>
                              <input type="text" className="w-[80px] bg-[#1e1e1e] text-white text-[12px] px-2 outline-none" value={localConfig.Config2 || "E8E8E8"} onChange={e => updateLocalConfig({ Config2: e.target.value })}  />
                           </div>
                        </div>
                     </div>
                  </div>
              </div>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Quick file view:</span>
                  <div className="flex flex-col gap-[6px]">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">M</span>odeless dialog</span>} checked={localConfig.modelessDialog ?? false} onChange={e => updateLocalConfig({ modelessDialog: e.target.checked })} />
                  </div>
              </div>

              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Web preview:</span>
                  <div className="flex flex-col gap-[6px]">
                     <Checkbox label={<span>Enable server mappings</span>} checked={localConfig.enableServerMappings ?? false} onChange={e => updateLocalConfig({ enableServerMappings: e.target.checked })} />
                     <div className="flex items-center gap-2 mt-1">
                        <input type="text" className="bg-transparent border border-[#555] text-white text-[12px] px-1 w-[200px] h-6 outline-none" value={localConfig.unwiredConfig1 || ''} onChange={e => updateLocalConfig({ unwiredConfig1: e.target.value })} />
                        <span className="text-[12px] text-[#e0e0e0]">{">>"}</span>
                        <input type="text" className="bg-transparent border border-[#555] text-white text-[12px] px-1 w-[200px] h-6 outline-none" value={localConfig.Config3 || "http://localhost/"} onChange={e => updateLocalConfig({ Config3: e.target.value })}  />
                     </div>
                  </div>
              </div>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Text preview:</span>
                  <div className="flex flex-col gap-[6px] mt-1">
                     <div className="flex items-center gap-[42px]">
                        <span className="text-[12px] text-[#e0e0e0]">Display <span className="underline decoration-1 underline-offset-[3px]">T</span>abs as spaces:</span>
                        <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[60px] outline-none" value={localConfig.displayTabsAsSpaces || "4"} onChange={e => updateLocalConfig({displayTabsAsSpaces: e.target.value})}><option>4</option><option>Option 1</option><option>Option 2</option><option>Option 3</option></select>
                     </div>
                     <Checkbox label={<span>UTF-<span className="underline decoration-1 underline-offset-[3px]">8</span> auto-detection</span>} checked={localConfig.utf8AutoDetection ?? false} onChange={e => updateLocalConfig({ utf8AutoDetection: e.target.checked })} />
                  </div>
              </div>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2 items-center">
                  <span className="text-[12px] text-[#e0e0e0] w-[140px]">Preview delay:</span>
                  <div className="flex items-center gap-2">
                     <input type="number" 
                        value={localConfig.previewDelay ?? 0} 
                        onChange={(e) => updateLocalConfig({previewDelay: parseInt(e.target.value) || 0})} 
                        className="w-[80px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                     />
                     <span className="text-[12px] text-[#e0e0e0]">ms</span>
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Previewed Formats" className="m-0 border-0 p-0 outline-none h-full flex flex-col">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Previewed Formats</h1>
              
              <div className="flex flex-col gap-1 mb-2">
                 <span className="text-[12px] text-[#e0e0e0]">Categories</span>
                 <span className="text-[12px] text-[#e0e0e0]">Select category to add and remove file extensions.</span>
              </div>
              
              <div className="flex gap-4">
                 <div className="border border-[#555] bg-[#0c0c0c] w-[350px] h-[150px] overflow-y-auto p-[2px] styled-scrollbar">
                    {localConfig.previewCategories.map((c, i) => (
                       <div key={i} className={`flex text-[12px] items-center px-1 py-[2px] hover:bg-[#333] ${i===0 ? 'bg-[#0078D7] text-white' : 'text-[#e0e0e0]'}`}>
                           <input type="checkbox" checked={c.c} onChange={(e) => {
                             const newArr = [...localConfig.previewCategories];
                             newArr[i].c = e.target.checked;
                             updateLocalConfig({ previewCategories: newArr });
                           }} className="mr-2" />
                           <span className="w-[180px] truncate">{c.n}</span>
                           <span className="text-[#aaa] truncate flex-1">{c.d}</span>
                       </div>
                    ))}
                 </div>
                 <ActionBtn label="Find..." className="w-[80px]" />
              </div>

              <div className="flex flex-col gap-1 mb-1 mt-6">
                 <span className="text-[12px] text-[#e0e0e0]">Category: Text Files</span>
              </div>
              
              <div className="border border-[#555] bg-[#0c0c0c] flex-1 overflow-y-auto mb-4 p-[2px] styled-scrollbar">
                 {localConfig.previewFormats.map((c, i) => (
                    <div key={i} className={`flex text-[12px] items-center gap-2 px-1 py-[2px] hover:bg-[#333] text-[#e0e0e0]`}>
                        <span className={`w-4 text-right text-[#888]`}>{i + 1}</span>
                        <input type="checkbox" checked={c.c} onChange={(e) => {
                             const newArr = [...localConfig.previewFormats];
                             newArr[i].c = e.target.checked;
                             updateLocalConfig({ previewFormats: newArr });
                           }} />
                        <span>{c.n}</span>
                    </div>
                 ))}
              </div>
              
              <div className="flex justify-end gap-2 mt-auto">
                 <ActionBtn label="Add..." className="w-[100px]" />
                 <ActionBtn label="Edit..." className="w-[100px]" />
                 <ActionBtn label="Remove" className="w-[100px]" />
              </div>
            </TabsContent>

            <TabsContent value="Thumbnails" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Thumbnails</h1>
              
              <div className="flex gap-[42px] mb-4 mt-[10px] ml-2">
                  <span className="text-[12px] text-[#e0e0e0] w-[180px]">Thumbnail widths and heights:</span>
                  <div className="flex flex-col gap-2">
                     {[{n:"Size #1", v1:"64", v2:"64"}, {n:"Size #2", v1:"192", v2:"192"}, {n:"Size #3", v1:"300", v2:"200"}].map((s, i) => (
                        <div key={i} className="flex gap-2 items-center">
                           <span className="text-[12px] text-[#e0e0e0] w-[50px]">{s.n}</span>
                           <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[80px] outline-none"><option>{s.v1}</option><option>NaN</option><option>NaN</option></select>
                           <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[80px] outline-none"><option>{s.v2}</option><option>NaN</option><option>NaN</option></select>
                        </div>
                     ))}
                  </div>
              </div>
              
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>ache thumbnails on disk</span>} checked={localConfig.cacheThumbnailsOnDisk ?? false} onChange={e => updateLocalConfig({ cacheThumbnailsOnDisk: e.target.checked })} />
                  <div className="ml-[20px] space-y-[6px]">
                     <Checkbox label={<span>Include local dis<span className="underline decoration-1 underline-offset-[3px]">k</span>s</span>} checked={localConfig.includeLocalDisks ?? false} onChange={e => updateLocalConfig({ includeLocalDisks: e.target.checked })} disabled={!localConfig.cacheThumbnailsOnDisk} />
                     <Checkbox label={<span>Include remov<span className="underline decoration-1 underline-offset-[3px]">a</span>ble media and network locations</span>} checked={localConfig.includeRemovableMediaAndNetworkLocations ?? false} onChange={e => updateLocalConfig({ includeRemovableMediaAndNetworkLocations: e.target.checked })} disabled={!localConfig.cacheThumbnailsOnDisk} />
                     <Checkbox label={<span>Include searc<span className="underline decoration-1 underline-offset-[3px]">h</span> results</span>} checked={localConfig.includeSearchResults ?? false} onChange={e => updateLocalConfig({ includeSearchResults: e.target.checked })} disabled={!localConfig.cacheThumbnailsOnDisk} />
                     <Checkbox label={<span>Show cached thumbnails only</span>} checked={localConfig.showCachedThumbnailsOnly ?? false} onChange={e => updateLocalConfig({ showCachedThumbnailsOnly: e.target.checked })} disabled={!localConfig.cacheThumbnailsOnDisk} />
                     <div className="flex items-center gap-2 mt-2">
                        <span className="text-[12px] text-[#e0e0e0] w-[80px]">Cache path:</span>
                        <input type="text" className="bg-[#1e1e1e] border border-[#666] text-white text-[12px] px-2 w-[220px] h-6 outline-none" value={localConfig.Config4 || "Thumbnails\\"} onChange={e => updateLocalConfig({ Config4: e.target.value })}  />
                        <ActionBtn label="..." className="w-[30px] h-6 min-h-[24px]" />
                        <ActionBtn label="Clear..." className="w-[60px] h-6 min-h-[24px] ml-auto" />
                     </div>
                     <div className="ml-[90px] mt-1">
                        <Checkbox label={<span>Resolve cache path from c<span className="underline decoration-1 underline-offset-[3px]">u</span>rrent folder</span>} checked={localConfig.resolveCachePathFromCurrentFolder ?? false} onChange={e => updateLocalConfig({ resolveCachePathFromCurrentFolder: e.target.checked })} disabled={!localConfig.cacheThumbnailsOnDisk} />
                     </div>
                  </div>
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Create all thumbnails at <span className="underline decoration-1 underline-offset-[3px]">o</span>nce</span>} checked={localConfig.createAllThumbnailsAtOnce ?? false} onChange={e => updateLocalConfig({ createAllThumbnailsAtOnce: e.target.checked })} />
                  <Checkbox label={<span>Show thumbnails for <span className="underline decoration-1 underline-offset-[3px]">R</span>AW files</span>} checked={localConfig.showThumbnailsForRawFiles ?? false} onChange={e => updateLocalConfig({ showThumbnailsForRawFiles: e.target.checked })} />
                  <Checkbox label={<span>Show thumbnails for <span className="underline decoration-1 underline-offset-[3px]">n</span>on-images</span>} checked={localConfig.showThumbnailsForNonImages ?? false} onChange={e => updateLocalConfig({ showThumbnailsForNonImages: e.target.checked })} />
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">f</span>older thumbnails</span>} checked={localConfig.showFolderThumbnails ?? false} onChange={e => updateLocalConfig({ showFolderThumbnails: e.target.checked })} />
                  <Checkbox label={<span>Show thumbnails in titles <span className="underline decoration-1 underline-offset-[3px]">v</span>iews</span>} checked={localConfig.showThumbnailsInTitlesViews ?? false} onChange={e => updateLocalConfig({ showThumbnailsInTitlesViews: e.target.checked })} />
                  <div className="ml-[20px] flex gap-4 items-center">
                     <div className="flex gap-2 items-center">
                        <input type="number" value={localConfig.Config5 || "64"} onChange={e => updateLocalConfig({ Config5: e.target.value })}  className="w-[50px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none" />
                        <span className="text-[12px] text-[#e0e0e0]">Small size</span>
                     </div>
                     <div className="flex gap-2 items-center">
                        <input type="number" value={localConfig.Config6 || "192"} onChange={e => updateLocalConfig({ Config6: e.target.value })}  className="w-[50px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none" />
                        <span className="text-[12px] text-[#e0e0e0]">Large size</span>
                     </div>
                  </div>
                  
                  <div className="h-1"></div>
                  <Checkbox label="Auto-rotate thumbnails" checked={localConfig.autoRotateThumbnails ?? false} onChange={e => updateLocalConfig({ autoRotateThumbnails: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>lign to bottom</span>} checked={localConfig.alignToBottom ?? false} onChange={e => updateLocalConfig({ alignToBottom: e.target.checked })} />
                  <div className="flex gap-[120px]">
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">Z</span>oom to fill</span>} checked={localConfig.zoomToFill ?? false} onChange={e => updateLocalConfig({ zoomToFill: e.target.checked })} />
                     <Checkbox label={<span>Z<span className="underline decoration-1 underline-offset-[3px]">o</span>om to fit</span>} checked={localConfig.zoomToFit ?? false} onChange={e => updateLocalConfig({ zoomToFit: e.target.checked })} />
                  </div>
                  <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">f</span>ilm strip overlay on video thumbnails</span>} checked={localConfig.showFilmStripOverlayOnVideoThumbnails ?? false} onChange={e => updateLocalConfig({ showFilmStripOverlayOnVideoThumbnails: e.target.checked })} />
                  <Checkbox label={<span>Show file <span className="underline decoration-1 underline-offset-[3px]">i</span>con on thumbnail</span>} checked={localConfig.showFileIconOnThumbnail ?? false} onChange={e => updateLocalConfig({ showFileIconOnThumbnail: e.target.checked })} />
                  <div className="flex gap-[120px]">
                     <Checkbox label={<span>Show <span className="underline decoration-1 underline-offset-[3px]">d</span>imensions of original</span>} checked={localConfig.showDimensionsOfOriginal ?? false} onChange={e => updateLocalConfig({ showDimensionsOfOriginal: e.target.checked })} />
                     <Checkbox label={<span>For vi<span className="underline decoration-1 underline-offset-[3px]">d</span>eos as well</span>} checked={localConfig.forVideosAsWell ?? false} onChange={e => updateLocalConfig({ forVideosAsWell: e.target.checked })} />
                  </div>
                  <div className="flex gap-[120px]">
                     <Checkbox label={<span>Sh<span className="underline decoration-1 underline-offset-[3px]">o</span>w caption</span>} checked={localConfig.showCaption ?? false} onChange={e => updateLocalConfig({ showCaption: e.target.checked })} />
                     <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">O</span>verlay caption</span>} checked={localConfig.overlayCaption ?? false} onChange={e => updateLocalConfig({ overlayCaption: e.target.checked })} />
                  </div>
                  
                  <div className="h-1"></div>
                  <div className="flex items-center gap-[42px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[100px]">Quality:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none" value={localConfig.thumbnailQuality || "High Speed"} onChange={e => updateLocalConfig({thumbnailQuality: e.target.value})}><option>High Speed</option><option>High Quality</option><option>Balanced</option></select>
                  </div>
                  <div className="flex items-center gap-[42px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[100px]">Transparency:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none" value={localConfig.thumbnailTransparency || "Neutral"} onChange={e => updateLocalConfig({thumbnailTransparency: e.target.value})}><option>Neutral</option><option>Checkered</option><option>White</option><option>Black</option></select>
                  </div>
                  <div className="flex items-center gap-[42px]">
                     <span className="text-[12px] text-[#e0e0e0] w-[100px]">Style:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[250px] outline-none" value={localConfig.thumbnailStyle || "Shadow"} onChange={e => updateLocalConfig({thumbnailStyle: e.target.value})}><option>Shadow</option><option>Flat</option><option>Bordered</option><option>3D</option></select>
                  </div>
                  <div className="flex items-center gap-4 ml-[142px]">
                     <span className="text-[12px] text-[#e0e0e0]">Pa<span className="underline decoration-1 underline-offset-[3px]">d</span>ding:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[60px] outline-none" value={localConfig.thumbnailPadding || "4"} onChange={e => updateLocalConfig({thumbnailPadding: e.target.value})}><option>0</option><option>2</option><option>4</option><option>6</option><option>8</option><option>10</option></select>
                     <span className="text-[12px] text-[#e0e0e0] ml-[10px]">Caption lines:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[60px] outline-none" value={localConfig.thumbnailCaptionLines || "2"} onChange={e => updateLocalConfig({thumbnailCaptionLines: e.target.value})}><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-4 ml-[2px]">
                     <Checkbox label={<span className="font-semibold text-[12px]">Use</span>} checked={localConfig.use ?? false} onChange={e => updateLocalConfig({ use: e.target.checked })} />
                     <div className="flex rounded-sm overflow-hidden border border-[#555] h-6 flex-1 ml-4 mr-2">
                        <button className="bg-[#1e1e1e] text-white text-[12px] px-4 flex-1 outline-none text-center h-full hover:bg-[#333]">Thumbnails View Background</button>
                        <input type="text" className="w-[80px] bg-[#1e1e1e] border-l border-[#555] text-white text-[12px] px-2 outline-none text-center h-full" value={localConfig.Config7 || "F9F9F9"} onChange={e => updateLocalConfig({ Config7: e.target.value })}  />
                     </div>
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="Mouse Down Blow Up" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Mouse Down Blow Up</h1>
              <p className="text-[12px] text-[#e0e0e0] mb-[8px] mt-1 ml-[4px]">Mouse down on image preview and thumbnails pops up the image in original size.</p>
              
              <SectionHeader title="General" />
              <div className="ml-2 mb-4">
                 <div className="flex gap-[150px]">
                    <div className="space-y-[6px]">
                       <Checkbox label={<span>Use whole s<span className="underline decoration-1 underline-offset-[3px]">c</span>reen</span>} checked={localConfig.useWholeScreen ?? false} onChange={e => updateLocalConfig({ useWholeScreen: e.target.checked })} />
                       <Checkbox label={<span>Centered</span>} checked={localConfig.centered ?? false} onChange={e => updateLocalConfig({ centered: e.target.checked })} />
                       <Checkbox label={<span>With <span className="underline decoration-1 underline-offset-[3px]">b</span>order</span>} checked={localConfig.withBorder ?? false} onChange={e => updateLocalConfig({ withBorder: e.target.checked })} />
                    </div>
                    <div className="space-y-[6px]">
                       <Checkbox label={<span>S<span className="underline decoration-1 underline-offset-[3px]">h</span>rink to fit</span>} checked={localConfig.shrinkToFit ?? false} onChange={e => updateLocalConfig({ shrinkToFit: e.target.checked })} />
                       <div className="ml-[20px] space-y-[6px]">
                          <Checkbox label={<span>Fit <span className="underline decoration-1 underline-offset-[3px]">w</span>idth only</span>} checked={localConfig.fitWidthOnly ?? false} onChange={e => updateLocalConfig({ fitWidthOnly: e.target.checked })} disabled={!localConfig.shrinkToFit} />
                          <Checkbox label={<span>Allow pannin<span className="underline decoration-1 underline-offset-[3px]">g</span></span>} checked={localConfig.allowPanning ?? false} onChange={e => updateLocalConfig({ allowPanning: e.target.checked })} disabled={!localConfig.shrinkToFit} />
                       </div>
                    </div>
                 </div>
                 
                 <div className="flex gap-[120px] mt-2">
                    <div className="flex flex-col gap-1">
                       <span className="text-[12px] text-[#e0e0e0]">Movement:</span>
                       <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none" value={localConfig.movementBlowUp || "Loupe"} onChange={e => updateLocalConfig({movementBlowUp: e.target.value})}><option>Loupe</option><option>Fullscreen</option><option>Fit to window</option></select>
                    </div>
                    <div className="flex flex-col gap-1 mt-auto">
                       <Checkbox label={<span>Apply zoom:</span>} checked={localConfig.applyZoom ?? false} onChange={e => updateLocalConfig({ applyZoom: e.target.checked })} />
                       <div className="flex items-center gap-2 ml-[20px]">
                          <input type="number" 
                             value={localConfig.applyZoomBlowUpValue ?? 100} 
                             onChange={(e) => updateLocalConfig({applyZoomBlowUpValue: parseInt(e.target.value) || 100})} 
                             className="w-[60px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none"
                             disabled={!localConfig.applyZoomBlowUp}
                          />
                          <span className={`text-[12px] ${!localConfig.applyZoomBlowUp ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>%</span>
                       </div>
                    </div>
                 </div>
              </div>

              <SectionHeader title="Mouse Down on Thumbnails and Icons" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span>On <span className="underline decoration-1 underline-offset-[3px]">l</span>eft mouse down</span>} checked={localConfig.onLeftMouseDown ?? false} onChange={e => updateLocalConfig({ onLeftMouseDown: e.target.checked })} />
                 <Checkbox label={<span>On middle mouse down</span>} checked={localConfig.onMiddleMouseDown ?? false} onChange={e => updateLocalConfig({ onMiddleMouseDown: e.target.checked })} />
                 <Checkbox label={<span>On <span className="underline decoration-1 underline-offset-[3px]">r</span>ight mouse down</span>} checked={localConfig.onRightMouseDown ?? false} onChange={e => updateLocalConfig({ onRightMouseDown: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                    <Checkbox label={<span>St<span className="underline decoration-1 underline-offset-[3px]">a</span>y up</span>} checked={localConfig.stayUp ?? false} onChange={e => updateLocalConfig({ stayUp: e.target.checked })} disabled={!localConfig.onRightMouseDownBlowUp} />
                    <Checkbox label={<span>Fi<span className="underline decoration-1 underline-offset-[3px]">t</span> popup to screen</span>} checked={localConfig.fitPopupToScreen ?? false} onChange={e => updateLocalConfig({ fitPopupToScreen: e.target.checked })} disabled={!localConfig.onRightMouseDownBlowUp} />
                    <div className="ml-[20px]">
                       <Checkbox label={<span>Fit popup w<span className="underline decoration-1 underline-offset-[3px]">i</span>dth only</span>} checked={localConfig.fitPopupWidthOnly ?? false} onChange={e => updateLocalConfig({ fitPopupWidthOnly: e.target.checked })} disabled={!localConfig.fitPopupToScreen || !localConfig.onRightMouseDownBlowUp} />
                    </div>
                 </div>
                 <Checkbox label={<span>Allow dra<span className="underline decoration-1 underline-offset-[3px]">g</span>ging items by the thumbnail</span>} checked={localConfig.allowDraggingItemsByTheThumbnail ?? false} onChange={e => updateLocalConfig({ allowDraggingItemsByTheThumbnail: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">E</span>nable blow ups on file icons as well</span>} checked={localConfig.enableBlowUpsOnFileIconsAsWell ?? false} onChange={e => updateLocalConfig({ enableBlowUpsOnFileIconsAsWell: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span>Remembe<span className="underline decoration-1 underline-offset-[3px]">r</span> relative position</span>} checked={localConfig.rememberRelativePosition ?? false} onChange={e => updateLocalConfig({ rememberRelativePosition: e.target.checked })} disabled={!localConfig.enableBlowUpsOnFileIconsAsWell} />
                 </div>
                 
                 <div className="h-2"></div>
                 <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">u</span>dio preview</span>} checked={localConfig.audioPreview ?? false} onChange={e => updateLocalConfig({ audioPreview: e.target.checked })} />
                 <div className="ml-[20px]">
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">L</span>oop</span>} checked={localConfig.loop ?? false} onChange={e => updateLocalConfig({ loop: e.target.checked })} disabled={!localConfig.audioPreviewBlowUp} />
                 </div>
              </div>

              <SectionHeader title="Mouse Up on Folder Icons" />
              <div className="ml-2 mb-4 space-y-[6px]">
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">F</span>older contents preview</span>} checked={localConfig.folderContentsPreview ?? false} onChange={e => updateLocalConfig({ folderContentsPreview: e.target.checked })} />
                 <div className="ml-[20px]">
                    <div className="flex gap-[120px]">
                       <Checkbox label={<span>In tree</span>} checked={localConfig.inTree ?? false} onChange={e => updateLocalConfig({ inTree: e.target.checked })} disabled={!localConfig.folderContentsPreview} />
                       <Checkbox label={<span>On <span className="underline decoration-1 underline-offset-[3px]">l</span>eft mouse up</span>} checked={localConfig.onLeftMouseUp ?? false} onChange={e => updateLocalConfig({ onLeftMouseUp: e.target.checked })} disabled={!localConfig.folderContentsPreview} />
                    </div>
                    <div className="flex gap-[120px] mt-[6px]">
                       <Checkbox label={<span>In <span className="underline decoration-1 underline-offset-[3px]">l</span>ist</span>} checked={localConfig.inList ?? false} onChange={e => updateLocalConfig({ inList: e.target.checked })} disabled={!localConfig.folderContentsPreview} />
                       <Checkbox label={<span>On righ<span className="underline decoration-1 underline-offset-[3px]">t</span> mouse up</span>} checked={localConfig.onRightMouseUp ?? false} onChange={e => updateLocalConfig({ onRightMouseUp: e.target.checked })} disabled={!localConfig.folderContentsPreview} />
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                       <span className={`text-[12px] ${!localConfig.folderContentsPreview ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Sorted by:</span>
                       <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none disabled:opacity-50" value={localConfig.folderContentsPreviewSortedBy || "Name"} onChange={e => updateLocalConfig({folderContentsPreviewSortedBy: e.target.value})} disabled={!localConfig.folderContentsPreview}><option>Name</option><option>Size</option><option>Date</option><option>Type</option></select>
                    </div>
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="Tabs" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Tabs</h1>
              
              <div className="ml-[4px] mb-4 space-y-[6px]">
                 <div className="flex items-center gap-[42px] mb-[12px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">New tab <span className="underline decoration-1 underline-offset-[3px]">p</span>ath:</span>
                    <div className="flex items-center gap-2 flex-1">
                       <input type="text" className="bg-[#1e1e1e] border border-[#666] text-white text-[12px] px-2 flex-1 h-6 outline-none" value={localConfig.newTabPath || ""} onChange={e => updateLocalConfig({newTabPath: e.target.value})} />
                       <ActionBtn label="..." className="w-[30px] h-6 min-h-[24px]" />
                    </div>
                 </div>
                 <div className="flex items-center gap-[42px] mb-[6px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Open <span className="underline decoration-1 underline-offset-[3px]">n</span>ew tab</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm flex-1 outline-none" value={localConfig.openNewTab || "Next to the current tab"} onChange={e => updateLocalConfig({openNewTab: e.target.value})}><option>Next to the current tab</option><option>At the end</option></select>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">On c<span className="underline decoration-1 underline-offset-[3px]">l</span>osing the current tab</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm flex-1 outline-none" value={localConfig.onClosingTheCurrentTab || "Activate the right tab"} onChange={e => updateLocalConfig({onClosingTheCurrentTab: e.target.value})}><option>Activate the right tab</option><option>Activate the left tab</option><option>Activate the last active tab</option></select>
                 </div>
              </div>
              
              <div className="h-4"></div>
              <div className="ml-[4px] mb-4 space-y-[6px]">
                 <Checkbox label={<span>Cycle tabs in recently <span className="underline decoration-1 underline-offset-[3px]">u</span>sed order</span>} checked={localConfig.cycleTabsInRecentlyUsedOrder ?? false} onChange={e => updateLocalConfig({ cycleTabsInRecentlyUsedOrder: e.target.checked })} />
                 <Checkbox label={<span>R<span className="underline decoration-1 underline-offset-[3px]">e</span>use existing tabs when changing the location</span>} checked={localConfig.reuseExistingTabsWhenChangingTheLocation ?? false} onChange={e => updateLocalConfig({ reuseExistingTabsWhenChangingTheLocation: e.target.checked })} />
                 <div className="flex items-center gap-2 ml-[20px] mb-2 mt-1">
                    <input type="number" 
                       value={localConfig.maximumNumberOfTabs ?? 0} 
                       onChange={(e) => updateLocalConfig({maximumNumberOfTabs: parseInt(e.target.value) || 0})} 
                       className="w-[50px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none"
                    />
                    <span className="text-[12px] text-[#e0e0e0]">Maximum <span className="underline decoration-1 underline-offset-[3px]">n</span>umber of tabs (0 = unlimited)</span>
                 </div>
                 
                 <Checkbox label={<span>Flexible tab <span className="underline decoration-1 underline-offset-[3px]">w</span>idth</span>} checked={localConfig.flexibleTabWidth ?? false} onChange={e => updateLocalConfig({ flexibleTabWidth: e.target.checked })} />
                 <div className="flex items-center gap-2 ml-[20px] mb-2 mt-1">
                    <input type="number" 
                       value={localConfig.minimumTabWidthInPixels ?? 25} 
                       onChange={(e) => updateLocalConfig({minimumTabWidthInPixels: parseInt(e.target.value) || 25})} 
                       className="w-[45px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none disabled:opacity-50"
                       disabled={!localConfig.flexibleTabWidth}
                    />
                    <input type="number" 
                       value={localConfig.maximumTabWidthInPixels ?? 250} 
                       onChange={(e) => updateLocalConfig({maximumTabWidthInPixels: parseInt(e.target.value) || 250})} 
                       className="w-[45px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none disabled:opacity-50"
                       disabled={!localConfig.flexibleTabWidth}
                    />
                    <span className={`text-[12px] ${!localConfig.flexibleTabWidth ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Minimum / Ma<span className="underline decoration-1 underline-offset-[3px]">x</span>imum tab width in pixels</span>
                 </div>
                 
                 <div className="flex items-center gap-[42px] mb-[8px] mt-2">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Tab bar height:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] rounded-sm w-[120px] outline-none" value={localConfig.tabBarHeight ?? 28} onChange={e => updateLocalConfig({ tabBarHeight: parseInt(e.target.value) })}>
                       {[24, 26, 28, 30, 32, 36].map(n => <option key={n} value={n}>{n}px</option>)}
                    </select>
                 </div>
                 <div className="flex items-center gap-[42px] mb-[8px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Tab label size:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] rounded-sm w-[120px] outline-none" value={localConfig.tabFontSize ?? 11} onChange={e => updateLocalConfig({ tabFontSize: parseInt(e.target.value) })}>
                       {[9, 10, 11, 12, 13, 14].map(n => <option key={n} value={n}>{n}px</option>)}
                    </select>
                 </div>
                 <Checkbox label={<span>Sho<span className="underline decoration-1 underline-offset-[3px]">w</span> icons</span>} checked={localConfig.showIcons ?? false} onChange={e => updateLocalConfig({ showIcons: e.target.checked })} />
                 <Checkbox label={<span>Ma<span className="underline decoration-1 underline-offset-[3px]">k</span>e selected tab bold</span>} checked={localConfig.makeSelectedTabBold ?? false} onChange={e => updateLocalConfig({ makeSelectedTabBold: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">P</span>rompt on closing a locked tab</span>} checked={localConfig.promptOnClosingALockedTab ?? false} onChange={e => updateLocalConfig({ promptOnClosingALockedTab: e.target.checked })} />
                 <Checkbox label={<span>Auto-select tabs on dr<span className="underline decoration-1 underline-offset-[3px]">a</span>g-over</span>} checked={localConfig.autoSelectTabsOnDragOver ?? true} onChange={e => updateLocalConfig({ autoSelectTabsOnDragOver: e.target.checked })} />
                 <div className="flex items-center gap-2 ml-[20px]">
                    <div className="flex items-center gap-2">
                       <input type="number" 
                          value={localConfig.delayBeforeADraggedOverTabIsAutoSelected ?? 250} 
                          onChange={(e) => updateLocalConfig({delayBeforeADraggedOverTabIsAutoSelected: parseInt(e.target.value) || 250})} 
                          className="w-[50px] h-6 bg-transparent border border-[#555] text-white text-[12px] px-1 text-center outline-none disabled:opacity-50"
                          disabled={!localConfig.autoSelectTabsOnDragOver}
                       />
                       <span className={`text-[12px] ${!localConfig.autoSelectTabsOnDragOver ? 'text-[#888]' : 'text-[#e0e0e0]'}`}>Delay before a dragged-<span className="underline decoration-1 underline-offset-[3px]">o</span>ver tab is auto-selected (in milliseconds)</span>
                    </div>
                 </div>
                 <div className="ml-[20px]">
                    <Checkbox label={<span>Also auto-select tabs in the <span className="underline decoration-1 underline-offset-[3px]">i</span>nactive pane</span>} checked={localConfig.alsoAutoSelectTabsInTheInactivePane ?? true} onChange={e => updateLocalConfig({ alsoAutoSelectTabsInTheInactivePane: e.target.checked })} disabled={!localConfig.autoSelectTabsOnDragOver} />
                 </div>
                 <Checkbox label={<span>A<span className="underline decoration-1 underline-offset-[3px]">d</span>d tabs via drag and drop on tab bar</span>} checked={localConfig.addTabsViaDragAndDropOnTabBar ?? false} onChange={e => updateLocalConfig({ addTabsViaDragAndDropOnTabBar: e.target.checked })} />
              </div>
              
              <div className="h-2"></div>
              <div className="ml-[4px] mb-6 space-y-[8px]">
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Tab c<span className="underline decoration-1 underline-offset-[3px]">a</span>ptions:</span>
                    <div className="flex items-center gap-2 flex-1">
                       <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[280px] outline-none" value={localConfig.tabCaptions || "Folder only"} onChange={e => updateLocalConfig({tabCaptions: e.target.value})}><option>Folder only</option><option>Full path</option><option>Custom</option></select>
                       <ActionBtn label="Custom..." className="w-[80px]" />
                    </div>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Show X close <span className="underline decoration-1 underline-offset-[3px]">b</span>uttons on tabs:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm flex-1 outline-none" value={localConfig.showXCloseButtonsOnTabs || "Selected tab"} onChange={e => updateLocalConfig({showXCloseButtonsOnTabs: e.target.value})}><option>Selected tab</option><option>All tabs</option><option>None</option></select>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Visual s<span className="underline decoration-1 underline-offset-[3px]">t</span>yle:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm flex-1 outline-none" value={localConfig.visualStyleTabs || "XYplorer Style (Rounded)"} onChange={e => updateLocalConfig({visualStyleTabs: e.target.value})}><option>XYplorer Style (Rounded)</option><option>Square</option><option>Modern</option><option>Classic</option></select>
                 </div>
              </div>

              <div className="ml-[4px] mb-4 space-y-[6px]">
                  <div className="flex gap-[120px] items-center">
                     <Checkbox label={<span>Show 'New Tab' button</span>} checked={localConfig.showNewTabButton ?? false} onChange={e => updateLocalConfig({ showNewTabButton: e.target.checked })} />
                     <div className="flex items-center gap-4">
                        <span className="text-[12px] text-[#e0e0e0] w-[100px]">Buttons <span className="underline decoration-1 underline-offset-[3px]">p</span>osition:</span>
                        <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[150px] outline-none" value={localConfig.buttonsPositionTabs || "Flexible"} onChange={e => updateLocalConfig({buttonsPositionTabs: e.target.value})}><option>Flexible</option><option>Left</option><option>Right</option></select>
                     </div>
                  </div>
                  <Checkbox label={<span>Show 'Tab List' b<span className="underline decoration-1 underline-offset-[3px]">u</span>tton</span>} checked={localConfig.showTabListButton ?? false} onChange={e => updateLocalConfig({ showTabListButton: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Auto-sa<span className="underline decoration-1 underline-offset-[3px]">v</span>e tabsets on switch</span>} checked={localConfig.autoSaveTabsetsOnSwitch ?? false} onChange={e => updateLocalConfig({ autoSaveTabsetsOnSwitch: e.target.checked })} />
                  <Checkbox label={<span>Tabsets can revert after saving settings</span>} checked={localConfig.tabsetsCanRevertAfterSavingSettings ?? false} onChange={e => updateLocalConfig({ tabsetsCanRevertAfterSavingSettings: e.target.checked })} />
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Going <span className="underline decoration-1 underline-offset-[3px]">h</span>ome also restores the list layout</span>} checked={localConfig.goingHomeAlsoRestoresTheListLayout ?? false} onChange={e => updateLocalConfig({ goingHomeAlsoRestoresTheListLayout: e.target.checked })} />
                  <Checkbox label={<span>Remember tree scro<span className="underline decoration-1 underline-offset-[3px]">l</span>l position per tab</span>} checked={localConfig.rememberTreeScrollPositionPerTab ?? false} onChange={e => updateLocalConfig({ rememberTreeScrollPositionPerTab: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Dual Pane" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Dual Pane</h1>
              
              <div className="ml-[4px] mb-4 space-y-[6px]">
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>hade inactive pane</span>} checked={localConfig.shadeInactivePane ?? false} onChange={e => updateLocalConfig({ shadeInactivePane: e.target.checked })} />
                 
                 <div className="flex flex-col gap-1 mt-[16px] mb-2">
                     <span className="text-[12px] text-[#e0e0e0]">Tab <span className="underline decoration-1 underline-offset-[3px]">k</span>ey:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[350px] outline-none" value={localConfig.tabKeyDualPane || "Tab between both panes only"} onChange={e => updateLocalConfig({tabKeyDualPane: e.target.value})}><option>Tab between both panes only</option><option>Cycle through all controls</option></select>
                 </div>

                 <div className="flex flex-col gap-1 mb-[16px]">
                     <span className="text-[12px] text-[#e0e0e0]">Resi<span className="underline decoration-1 underline-offset-[3px]">z</span>ing the window:</span>
                     <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[350px] outline-none" value={localConfig.resizingTheWindowDualPane || "Both panes flexible size"} onChange={e => updateLocalConfig({resizingTheWindowDualPane: e.target.value})}><option>Both panes flexible size</option><option>Keep left pane fixed</option><option>Keep right pane fixed</option></select>
                 </div>
                 
                 <div className="h-1"></div>
                 <Checkbox label={<span>Always keep 1st pane <span className="underline decoration-1 underline-offset-[3px]">v</span>isible</span>} checked={localConfig.alwaysKeep1stPaneVisible ?? false} onChange={e => updateLocalConfig({ alwaysKeep1stPaneVisible: e.target.checked })} />
              </div>
              
              <div className="h-4"></div>
              <SectionHeader title="Sync Select" />
              <div className="ml-[4px] mb-6">
                 <Checkbox label={<span>Honor <span className="underline decoration-1 underline-offset-[3px]">r</span>elative paths</span>} checked={localConfig.honorRelativePaths ?? false} onChange={e => updateLocalConfig({ honorRelativePaths: e.target.checked })} />
              </div>
              
              <SectionHeader title="Sync Browse" />
              <div className="ml-[4px] mb-4 space-y-[6px]">
                 <Checkbox label={<span>Auto-select <span className="underline decoration-1 underline-offset-[3px]">m</span>atching items</span>} checked={localConfig.autoSelectMatchingItems ?? false} onChange={e => updateLocalConfig({ autoSelectMatchingItems: e.target.checked })} />
                 <Checkbox label={<span>Auto-create any missing folders</span>} checked={localConfig.autoCreateAnyMissingFolders ?? false} onChange={e => updateLocalConfig({ autoCreateAnyMissingFolders: e.target.checked })} />
               </div>
            </TabsContent>

            <TabsContent value="Plugin Rack" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Modular Plugin Rack</h1>
              
              <SectionHeader title="Active Bottom Panel Plugins" />
              <div className="ml-[4px] mb-6 space-y-[6px]">
                 {([
                   ['properties', 'Properties'],
                   ['context-menu-manager', 'Context Menus'],
                   ['icon-studio', 'Icon Studio (installs on first use)'],
                   ['batch-rename', 'Batch Rename'],
                   ['find', 'Fast Search'],
                   ['dropstack', 'Drop Stack'],
                   ['filters', 'Visual Filters'],
                   ['metadata', 'Metadata Inspector'],
                   ['icon-studio', 'Icon Studio'],
                 ] as const).map(([id, label]) => {
                   const defaults = ['properties', 'context-menu-manager', 'icon-studio', 'batch-rename', 'find', 'dropstack', 'filters', 'metadata'];
                   const current = localConfig.installedPlugins || defaults;
                   return (
                     <Checkbox key={id} label={<span>Enable <span className="font-bold">{label}</span> Module</span>} checked={current.includes(id)} onChange={e => {
                       updateLocalConfig({ installedPlugins: e.target.checked ? [...new Set([...current, id])] : current.filter((x: string) => x !== id) });
                     }} />
                   );
                 })}
              </div>

              <SectionHeader title="Right Sidebar Preview Engine" />
              <div className="ml-[4px] mb-6 space-y-[6px]">
                 <Checkbox label={<span>Enable Right Sidebar Preview pane</span>} checked={localConfig.rightSidebarEnabled !== false} onChange={e => updateLocalConfig({ rightSidebarEnabled: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px]">
                     <Checkbox label={<span>High-resolution Native Windows thumbnails <span className="text-gray-400 font-mono">(Performant)</span></span>} checked={localConfig.highResNativeWindowsThumbnails !== false} onChange={e => updateLocalConfig({ highResNativeWindowsThumbnails: e.target.checked })} disabled={localConfig.rightSidebarEnabled === false} />
                     <Checkbox label={<span>Enable rich transition animations</span>} checked={localConfig.richTransitionAnimations !== false} onChange={e => updateLocalConfig({ richTransitionAnimations: e.target.checked })} disabled={localConfig.rightSidebarEnabled === false} />
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="Bottom Panel" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-2 leading-tight">Bottom Panel</h1>
              <p className="text-[12px] text-gray-400 mb-6 max-w-[520px]">
                Control the plugin dock at the bottom of the workspace. Drag tabs on the panel itself to reorder them — order is saved automatically.
              </p>

              <SectionHeader title="Visibility &amp; Startup" />
              <div className="ml-[4px] mb-6 space-y-[6px]">
                <Checkbox label={<span>Show bottom panel when BNDZ starts</span>} checked={localConfig.bottomPanelOpen !== false} onChange={e => updateLocalConfig({ bottomPanelOpen: e.target.checked })} />
                <Checkbox label={<span>Remember last active plugin tab</span>} checked={localConfig.bottomPanelRememberTab !== false} onChange={e => updateLocalConfig({ bottomPanelRememberTab: e.target.checked })} />
                <Checkbox label={<span>Show plugin icons on tab labels</span>} checked={localConfig.bottomPanelShowTabIcons !== false} onChange={e => updateLocalConfig({ bottomPanelShowTabIcons: e.target.checked })} />
                <Checkbox label={<span>Unload inactive plugin tabs (saves memory)</span>} checked={localConfig.bottomPanelLazyUnmount !== false} onChange={e => updateLocalConfig({ bottomPanelLazyUnmount: e.target.checked })} />
              </div>

              <SectionHeader title="Default Plugin Tab" />
              <div className="ml-[4px] mb-6 flex items-center gap-3">
                <span className="text-[12px] text-gray-300 w-[140px] shrink-0">Open on launch:</span>
                <select
                  className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[4px] rounded-sm w-[280px] outline-none"
                  value={localConfig.bottomPanelDefaultPlugin || 'properties'}
                  onChange={e => updateLocalConfig({ bottomPanelDefaultPlugin: e.target.value })}
                >
                  {([
                    ['properties', 'System / Properties'],
                    ['context-menu-manager', 'Context Menus'],
                    ['icon-studio', 'Icon Studio'],
                    ['batch-rename', 'Batch Rename'],
                    ['find', 'Fast Search'],
                    ['dropstack', 'Drop Stack'],
                    ['filters', 'Visual Filters'],
                    ['metadata', 'Metadata Inspector'],
                    ['storage-cleanup', 'Storage Cleanup'],
                  ] as const).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>

              <SectionHeader title="Tab Order" />
              <div className="ml-[4px] mb-4">
                <p className="text-[11px] text-gray-500 mb-3">Current order (left → right). Drag tabs in the bottom panel to change.</p>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const defaults = ['properties', 'context-menu-manager', 'icon-studio', 'batch-rename', 'find', 'dropstack', 'filters', 'metadata'];
                    const installed = localConfig.installedPlugins || defaults;
                    const order = (localConfig.bottomPluginTabOrder || []).filter((id: string) => installed.includes(id));
                    const rest = installed.filter((id: string) => !order.includes(id));
                    const labels: Record<string, string> = {
                      properties: 'System',
                      'context-menu-manager': 'Context',
                      'icon-studio': 'Icon Studio',
                      'batch-rename': 'Rename',
                      find: 'Search',
                      dropstack: 'Drop Stack',
                      filters: 'Filters',
                      metadata: 'Metadata',
                    };
                    return [...order, ...rest].map((id: string, i: number) => (
                      <span key={id} className="px-2.5 py-1 rounded-md bg-[#2a2a2a] border border-[#444] text-[11px] text-gray-300 font-medium">
                        <span className="text-gray-500 mr-1.5">{i + 1}.</span>{labels[id] || id}
                      </span>
                    ));
                  })()}
                </div>
                <div className="mt-4">
                  <ActionBtn label="Reset tab order to default" onClick={() => updateLocalConfig({ bottomPluginTabOrder: [] })} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="Rapid access" className="m-0 border-0 p-0 outline-none mt-1">
              <h1 className="text-[22px] font-bold text-white mb-6 tracking-tight">Rapid access</h1>
              <p className="text-[12px] text-[#e0e0e0] leading-relaxed mb-6 w-[580px]">
                Pin folders from the context menu or sidebar. Hidden default locations (Desktop, Documents, etc.) can be restored below.
              </p>
              <SectionHeader title="Defaults" />
              <div className="ml-[10px] mb-6 space-y-3">
                <p className="text-[11px] text-[#888]">
                  {(localConfig.hiddenRapidAccess || []).length > 0
                    ? `${(localConfig.hiddenRapidAccess || []).length} default location(s) hidden.`
                    : 'All default Rapid access locations are visible.'}
                </p>
                <ActionBtn
                  label="Restore hidden defaults"
                  onClick={() => updateLocalConfig({ hiddenRapidAccess: [] })}
                  className={!(localConfig.hiddenRapidAccess || []).length ? 'opacity-50 pointer-events-none' : ''}
                />
              </div>
            </TabsContent>

            <TabsContent value="Features" className="m-0 border-0 p-0 outline-none flex flex-col h-full">
              <h1 className="text-[22px] font-bold text-white mb-6 tracking-tight">Features</h1>
              <p className="text-[12px] text-[#e0e0e0] leading-relaxed mb-10 w-[580px]">
                 Here you can control some of the advanced functionality of XYplorer and disable features which you do not use or wish to see. Disabling a feature will remove the related elements from the GUI and may improve overall resource usage.
              </p>
              
              <div className="ml-[8px] space-y-[6px]">
                 <Checkbox label={<span>File Tagging</span>} checked={localConfig.fileTagging ?? false} onChange={e => updateLocalConfig({ fileTagging: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">U</span>ser-Defined Commands</span>} checked={localConfig.userDefinedCommands ?? false} onChange={e => updateLocalConfig({ userDefinedCommands: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">S</span>cripting</span>} checked={localConfig.scripting ?? false} onChange={e => updateLocalConfig({ scripting: e.target.checked })} />
                 <Checkbox label={<span>Dual <span className="underline decoration-1 underline-offset-[3px]">P</span>ane</span>} checked={localConfig.dualPane ?? false} onChange={e => updateLocalConfig({ dualPane: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">T</span>absets</span>} checked={localConfig.tabsets ?? false} onChange={e => updateLocalConfig({ tabsets: e.target.checked })} />
                 
                 <div className="h-4"></div>
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>atalog</span>} checked={localConfig.catalog ?? false} onChange={e => updateLocalConfig({ catalog: e.target.checked })} />
                 <Checkbox label={<span>Custom <span className="underline decoration-1 underline-offset-[3px]">K</span>eyboard Shortcuts</span>} checked={localConfig.customKeyboardShortcuts ?? false} onChange={e => updateLocalConfig({ customKeyboardShortcuts: e.target.checked })} />
              </div>
            </TabsContent>

            <TabsContent value="Themes" className="m-0 border-0 p-0 outline-none">
              <ThemesTabContent
                activeTheme={localConfig.theme}
                onSelectTheme={(updates) => {
                  updateLocalConfig(updates);
                  applySettingsRuntime({ ...localConfig, ...updates });
                }}
              />
            </TabsContent>

            <TabsContent value="Appearance" className="m-0 border-0 p-0 outline-none">
              <AppearanceTabContent localConfig={localConfig} updateLocalConfig={updateLocalConfig} />
            </TabsContent>

            <TabsContent value="Colors" className="m-0 border-0 p-0 outline-none">
              <ColorsTabContent localConfig={localConfig} updateLocalConfig={updateLocalConfig} />
            </TabsContent>

            <TabsContent value="Highlights & Dark Mode" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Highlights & Dark Mode</h1>
              
              <div className="space-y-[8px] mb-8">
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Grid st<span className="underline decoration-1 underline-offset-[3px]">y</span>le:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none" value={localConfig.selectConfig5 || ""} onChange={e => updateLocalConfig({selectConfig5: e.target.value})}><option>Zebra Stripes: Alternate Rows (1)</option><option>Zebra Stripes: Alternate Rows (2)</option><option>Solid Color</option></select>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">B<span className="underline decoration-1 underline-offset-[3px]">o</span>rders:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none" value={localConfig.selectConfig6 || ""} onChange={e => updateLocalConfig({selectConfig6: e.target.value})}><option>No border</option><option>Solid border</option><option>Dashed border</option></select>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Se<span className="underline decoration-1 underline-offset-[3px]">l</span>ections:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none" value={localConfig.selectConfig7 || ""} onChange={e => updateLocalConfig({selectConfig7: e.target.value})}><option>BNDZ Style (Rounded)</option><option>Windows Native</option><option>Flat</option></select>
                 </div>
                 <div className="flex items-center gap-[42px]">
                    <span className="text-[12px] text-[#e0e0e0] w-[140px]">Focu<span className="underline decoration-1 underline-offset-[3px]">s</span> rectangle:</span>
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-2 py-[2px] rounded-sm w-[360px] outline-none" value={localConfig.selectConfig8 || ""} onChange={e => updateLocalConfig({selectConfig8: e.target.value})}><option>Solid</option><option>Gradient</option><option>Transparent</option></select>
                 </div>
              </div>

              <p className="text-[11px] text-[#888] mb-6 p-3 border border-[#333] rounded bg-[#151515]">
                Selection, tree tracing, and pin colors are configured in the <strong className="text-[#ccc]">Colors</strong> tab using the color picker.
              </p>

              <span className="text-[12px] text-[#e0e0e0] mb-[4px] block">Tree path tracing:</span>
              <div className="ml-[65px] mb-6 space-y-[6px]">
                 <Checkbox label={<span>Match color with <span className="underline decoration-1 underline-offset-[3px]">b</span>readcrumb bar</span>} checked={localConfig.matchColorWithBreadcrumbBar ?? false} onChange={e => updateLocalConfig({ matchColorWithBreadcrumbBar: e.target.checked })} />
                 <Checkbox label={<span>Mark i<span className="underline decoration-1 underline-offset-[3px]">n</span>termediate nodes</span>} checked={localConfig.markIntermediateNodes ?? false} onChange={e => updateLocalConfig({ markIntermediateNodes: e.target.checked })} />
                 <div className="flex items-center gap-2 mt-1">
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig9 || ""} onChange={e => updateLocalConfig({selectConfig9: e.target.value})}><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                    <span className="text-[12px] text-[#e0e0e0]">Width of trace in pixels</span>
                 </div>
              </div>

              <span className="text-[12px] text-[#e0e0e0] mb-[4px] block"><span className="underline decoration-1 underline-offset-[3px]">R</span>ecent location pins:</span>
              <div className="ml-[65px] mb-6 space-y-[6px]">
                 <Checkbox label={<span>Match color with <span className="underline decoration-1 underline-offset-[3px]">t</span>ree path tracing</span>} checked={localConfig.matchColorWithTreePathTracing ?? false} onChange={e => updateLocalConfig({ matchColorWithTreePathTracing: e.target.checked })} />
                 <div className="flex items-center gap-2 mt-1">
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig10 || ""} onChange={e => updateLocalConfig({selectConfig10: e.target.value})}><option>12</option><option>24</option><option>48</option><option>96</option><option>Unlimited</option></select>
                    <span className="text-[12px] text-[#e0e0e0]">Maximum number of pin<span className="underline decoration-1 underline-offset-[3px]">s</span></span>
                 </div>
              </div>

              <div className="flex items-start gap-4 mb-6">
                 <div className="mt-1"><Checkbox label="Use custom selection colors" checked={localConfig.use ?? false} onChange={e => updateLocalConfig({ use: e.target.checked })} /></div>
              </div>
              
              <div className="flex mt-8 mb-4">
                 <span className="text-[12px] text-[#e0e0e0] w-[140px]">Dark mode:</span>
                 <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-2">
                       <button className="bg-[#2B579A] text-white px-5 py-[5px] text-[14px]">ABC</button>
                       <button className="bg-[#1A1A1A] text-white border border-[#444] px-5 py-[5px] text-[14px]">ABC</button>
                    </div>
                    <div className="flex flex-col gap-2">
                       <div className="flex items-center gap-2">
                          <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig11 || ""} onChange={e => updateLocalConfig({selectConfig11: e.target.value})}><option>20</option><option>40</option><option>60</option><option>80</option><option>100</option></select>
                          <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">L</span>evel of darkness (0 is darkest)</span>
                       </div>
                       <div className="flex items-center gap-2">
                          <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig12 || ""} onChange={e => updateLocalConfig({selectConfig12: e.target.value})}><option>15</option><option>30</option><option>45</option><option>60</option><option>75</option></select>
                          <span className="text-[12px] text-[#e0e0e0]">Te<span className="underline decoration-1 underline-offset-[3px]">x</span>t contrast</span>
                       </div>
                       <div className="flex items-center gap-2">
                          <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig13 || ""} onChange={e => updateLocalConfig({selectConfig13: e.target.value})}><option>0</option><option>25</option><option>50</option><option>75</option><option>100</option></select>
                          <span className="text-[12px] text-[#e0e0e0]">Color <span className="underline decoration-1 underline-offset-[3px]">t</span>int (0 is neutral)</span>
                       </div>
                       <div className="mt-1"><Checkbox label="Adaptive colors" checked={localConfig.adaptiveColors ?? false} onChange={e => updateLocalConfig({ adaptiveColors: e.target.checked })} /></div>
                    </div>
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="Styles" className="m-0 border-0 p-0 outline-none">
              <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Styles</h1>
              <div className="space-y-[6px] mb-8">
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>pply list styles globally</span>} checked={localConfig.applyListStylesGlobally ?? false} onChange={e => updateLocalConfig({ applyListStylesGlobally: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">R</span>emember list settings per tab</span>} checked={localConfig.rememberListSettingsPerTab ?? false} onChange={e => updateLocalConfig({ rememberListSettingsPerTab: e.target.checked })} />
                 <div className="ml-[20px] mb-4">
                    <ActionBtn label="Apply to..." className="px-6 py-[2px] bg-[#1a1a1a]" />
                 </div>
                 
                 <Checkbox label={<span>Mirror tree bo<span className="underline decoration-1 underline-offset-[3px]">x</span> color in list</span>} checked={localConfig.mirrorTreeBoxColorInList ?? false} onChange={e => updateLocalConfig({ mirrorTreeBoxColorInList: e.target.checked })} />
                 <Checkbox label={<span>Semi-<span className="underline decoration-1 underline-offset-[3px]">t</span>ransparent grid color</span>} checked={localConfig.semiTransparentGridColor ?? false} onChange={e => updateLocalConfig({ semiTransparentGridColor: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">U</span>nderline selected ro<span className="underline decoration-1 underline-offset-[3px]">w</span>s</span>} checked={localConfig.underlineSelectedRows ?? false} onChange={e => updateLocalConfig({ underlineSelectedRows: e.target.checked })} />
                 <Checkbox label={<span>Sticky c<span className="underline decoration-1 underline-offset-[3px]">h</span>eckbox selection</span>} checked={localConfig.stickyCheckboxSelection ?? false} onChange={e => updateLocalConfig({ stickyCheckboxSelection: e.target.checked })} />
                 <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">T</span>ranslucent selection b<span className="underline decoration-1 underline-offset-[3px]">o</span>x</span>} checked={localConfig.translucentSelectionBox ?? false} onChange={e => updateLocalConfig({ translucentSelectionBox: e.target.checked })} />
              </div>
              
              <div className="flex items-center gap-[42px] mb-8">
                 <div className="flex items-center gap-2">
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig14 || ""} onChange={e => updateLocalConfig({selectConfig14: e.target.value})}><option>2</option><option>4</option><option>6</option><option>8</option><option>10</option></select>
                    <span className="text-[12px] text-[#e0e0e0]">Line sp<span className="underline decoration-1 underline-offset-[3px]">a</span>cing</span>
                 </div>
                 <div className="flex items-center gap-2">
                    <select className="bg-[#1e1e1e] border border-[#666] text-[#e0e0e0] text-[12px] px-1 py-[1px] w-[50px]" value={localConfig.selectConfig15 || ""} onChange={e => updateLocalConfig({selectConfig15: e.target.value})}><option>6</option><option>12</option><option>18</option><option>24</option><option>30</option></select>
                    <span className="text-[12px] text-[#e0e0e0]">Overall sp<span className="underline decoration-1 underline-offset-[3px]">a</span>cing</span>
                 </div>
              </div>
              
              <div className="flex items-center gap-2 mb-6 ml-[18px]">
                  <input type="text" className="w-[50px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig2 || ''} onChange={e => updateLocalConfig({ unwiredConfig2: e.target.value })} />
                  <span className="text-[12px] text-[#e0e0e0]">Show Age maximum hours (0 = unlimited)</span>
              </div>
              
              <SectionHeader title="Clipboard Markers" />
              <div className="ml-2 mb-6 space-y-[6px]">
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">D</span>immed icons</span>} checked={localConfig.dimmedIcons ?? false} onChange={e => updateLocalConfig({ dimmedIcons: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">C</span>olored lines</span>} checked={localConfig.coloredLines ?? false} onChange={e => updateLocalConfig({ coloredLines: e.target.checked })} />
              </div>
              
              <SectionHeader title="Columns" />
              <div className="ml-2 mb-4 space-y-[6px]">
                  <Checkbox label={<span>Lig<span className="underline decoration-1 underline-offset-[3px]">h</span>ter te<span className="underline decoration-1 underline-offset-[3px]">x</span>t in details columns</span>} checked={localConfig.lighterTextInDetailsColumns ?? false} onChange={e => updateLocalConfig({ lighterTextInDetailsColumns: e.target.checked })} />
                  <Checkbox label={<span>Vertical grid lines in details vi<span className="underline decoration-1 underline-offset-[3px]">e</span>w</span>} checked={localConfig.verticalGridLinesInDetailsView ?? false} onChange={e => updateLocalConfig({ verticalGridLinesInDetailsView: e.target.checked })} />
                  <Checkbox label={<span>T<span className="underline decoration-1 underline-offset-[3px]">r</span>uncate filenames in the middle</span>} checked={localConfig.truncateFilenamesInTheMiddle ?? false} onChange={e => updateLocalConfig({ truncateFilenamesInTheMiddle: e.target.checked })} />
                  <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">A</span>utofit the width of the Name column</span>} checked={localConfig.autofitTheWidthOfTheNameColumn ?? false} onChange={e => updateLocalConfig({ autofitTheWidthOfTheNameColumn: e.target.checked })} />
                  
                  <div className="ml-[20px] flex items-center gap-2">
                     <input type="text"  className="w-[45px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig3 || "175"} onChange={e => updateLocalConfig({ unwiredConfig3: e.target.value })} />
                     <input type="text"  className="w-[45px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig4 || "0"} onChange={e => updateLocalConfig({ unwiredConfig4: e.target.value })} />
                     <span className="text-[12px] text-[#e0e0e0]">Minimum / Maximum Name column w<span className="underline decoration-1 underline-offset-[3px]">i</span>dth</span>
                  </div>
                  
                  <div className="h-2"></div>
                  <Checkbox label={<span>Always autosize the Si<span className="underline decoration-1 underline-offset-[3px]">z</span>e column</span>} checked={localConfig.alwaysAutosizeTheSizeColumn ?? false} onChange={e => updateLocalConfig({ alwaysAutosizeTheSizeColumn: e.target.checked })} />
                  <Checkbox label={<span>On autosize disregard the column <span className="underline decoration-1 underline-offset-[3px]">h</span>eaders</span>} checked={localConfig.onAutosizeDisregardTheColumnHeaders ?? false} onChange={e => updateLocalConfig({ onAutosizeDisregardTheColumnHeaders: e.target.checked })} />
                  
                  <div className="flex items-center gap-2 mt-1">
                     <input type="text"  className="w-[45px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig5 || "1000"} onChange={e => updateLocalConfig({ unwiredConfig5: e.target.value })} />
                     <span className="text-[12px] text-[#e0e0e0]">Autosize columns m<span className="underline decoration-1 underline-offset-[3px]">a</span>ximum width (0 = unlimited)</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                     <input type="text"  className="w-[45px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig6 || "200"} onChange={e => updateLocalConfig({ unwiredConfig6: e.target.value })} />
                     <span className="text-[12px] text-[#e0e0e0]">Autosize Name column mi<span className="underline decoration-1 underline-offset-[3px]">n</span>imum width (0 = unlimited)</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 mb-[12px]">
                     <input type="text"  className="w-[45px] h-[22px] bg-transparent border border-[#555] text-white text-[12px] px-1 text-right outline-none" value={localConfig.unwiredConfig7 || "0"} onChange={e => updateLocalConfig({ unwiredConfig7: e.target.value })} />
                     <span className="text-[12px] text-[#e0e0e0]">Autosize Name column right margin (0 = none)</span>
                  </div>
                  
                  <Checkbox label={<span>Use empty cell defaults</span>} checked={localConfig.useEmptyCellDefaults ?? false} onChange={e => updateLocalConfig({ useEmptyCellDefaults: e.target.checked })} />
                  <div className="ml-[20px] mt-1">
                     <ActionBtn label="Configure..." className="px-6 py-[2px] bg-[#1a1a1a]" />
                  </div>
              </div>
            </TabsContent>
            
            <TabsContent value="Color Filters" className="m-0 border-0 p-0 outline-none flex flex-col h-full">
              <h1 className="text-[20px] font-bold text-white mb-2 leading-tight">Color Filters</h1>
              <p className="text-[12px] text-[#e0e0e0] mb-[20px]">Color-code files and folders by name, attributes, size, date, age, or properties.</p>
              
              <div className="mb-4">
                 <Checkbox label={<span>Enable c<span className="underline decoration-1 underline-offset-[3px]">o</span>lor filters</span>} checked={localConfig.enableColorFilters ?? false} onChange={e => updateLocalConfig({ enableColorFilters: e.target.checked })} />
                 <div className="ml-[20px] space-y-[6px] mt-1">
                    <Checkbox label={<span>Apply color filters to the <span className="underline decoration-1 underline-offset-[3px]">L</span>ist</span>} checked={localConfig.applyColorFiltersToTheList ?? false} onChange={e => updateLocalConfig({ applyColorFiltersToTheList: e.target.checked })} />
                    <Checkbox label={<span>Apply color filters to the <span className="underline decoration-1 underline-offset-[3px]">T</span>ree</span>} checked={localConfig.applyColorFiltersToTheTree ?? false} onChange={e => updateLocalConfig({ applyColorFiltersToTheTree: e.target.checked })} />
                    <Checkbox label={<span><span className="underline decoration-1 underline-offset-[3px]">I</span>gnore diacritics</span>} checked={localConfig.ignoreDiacritics ?? false} onChange={e => updateLocalConfig({ ignoreDiacritics: e.target.checked })} />
                    <Checkbox label={<span>Apply text colors to the <span className="underline decoration-1 underline-offset-[3px]">N</span>ame column only</span>} checked={localConfig.applyTextColorsToTheNameColumnOnly ?? false} onChange={e => updateLocalConfig({ applyTextColorsToTheNameColumnOnly: e.target.checked })} />
                    <Checkbox label={<span>Draw background colors as r<span className="underline decoration-1 underline-offset-[3px]">o</span>unded rectangles</span>} checked={localConfig.drawBackgroundColorsAsRoundedRectangles ?? false} onChange={e => updateLocalConfig({ drawBackgroundColorsAsRoundedRectangles: e.target.checked })} />
                    <Checkbox label={<span>Draw background colors in distin<span className="underline decoration-1 underline-offset-[3px]">c</span>tive shapes</span>} checked={localConfig.drawBackgroundColorsInDistinctiveShapes ?? false} onChange={e => updateLocalConfig({ drawBackgroundColorsInDistinctiveShapes: e.target.checked })} />
                    <Checkbox label={<span>Draw background colors as wide as the c<span className="underline decoration-1 underline-offset-[3px]">o</span>lumn</span>} checked={localConfig.drawBackgroundColorsAsWideAsTheColumn ?? false} onChange={e => updateLocalConfig({ drawBackgroundColorsAsWideAsTheColumn: e.target.checked })} />
                 </div>
              </div>
              
              <div className="flex gap-4 flex-1 overflow-hidden min-h-[300px]">
                  <div className="flex-1 border border-[#444] bg-[#111] overflow-y-auto w-full p-2 text-[13px] font-mono leading-tight space-y-[2px]">
                    {localConfig.colorFilters.map((row, i) => (
                       <div key={row.i} className="flex gap-2 items-center">
                          <span className="w-[18px] text-right text-gray-500">{row.i}</span>
                          <input type="checkbox" checked={row.c} onChange={(e) => {
                             const newArr = [...localConfig.colorFilters];
                             newArr[i].c = e.target.checked;
                             updateLocalConfig({ colorFilters: newArr });
                           }} className="accent-[#555] w-[13px] h-[13px]" />
                          <span className={`${row.style}`}>{row.t}</span>
                       </div>
                    ))}
                 </div>
                 <div className="w-[100px] flex flex-col gap-2 relative">
                    <ActionBtn label="New" className="w-full text-center py-[4px]" />
                    <ActionBtn label="Edit" className="w-full text-center py-[4px]" />
                    <ActionBtn label="Delete" className="w-full text-center py-[4px]" />
                    <div className="h-4"></div>
                    <ActionBtn label="Advanced Rules..." className="w-full text-center py-[4px] bg-[#094771]/35 text-[#7eb8e8] border-[#0078d4]/40 hover:bg-[#094771]/55" onClick={() => setShowConditionalFormattingDialog(true)} />
                    <div className="h-4"></div>
                    <ActionBtn label="Up" className="w-full text-center py-[4px]" />
                    <ActionBtn label="Down" className="w-full text-center py-[4px]" />
                    
                    <div className="absolute bottom-0 left-0 w-full space-y-2">
                       <span className="text-[12px] text-white">Define colors:</span>
                       <div className="flex gap-1 w-full">
                          <ActionBtn label="Text..." className="flex-1 py-[4px]" />
                          <ActionBtn label="Clear" className="px-2 py-[4px]" />
                       </div>
                       <div className="flex gap-1 w-full">
                          <ActionBtn label="Back..." className="flex-1 py-[4px]" />
                          <ActionBtn label="Clear" className="px-2 py-[4px]" />
                       </div>
                    </div>
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="Fonts" className="m-0 border-0 p-0 outline-none">
              <FontsTabContent localConfig={localConfig} updateLocalConfig={updateLocalConfig} />
            </TabsContent>

            <TabsContent value="Templates" className="m-0 border-0 p-0 outline-none flex flex-col h-full">
               <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">Templates</h1>
               
               <div className="max-w-[550px] space-y-[24px]">
                  <DevOnly>
                  <div>
                     <span className="text-[12px] font-bold text-white mb-[8px] block">Filename Affixes</span>
                     <div className="flex gap-2 items-center mb-1">
                        <input type="text"  className="w-[200px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[2px] outline-none" value={localConfig.unwiredConfig8 || "-01"} onChange={e => updateLocalConfig({ unwiredConfig8: e.target.value })} />
                        <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">I</span>ncremental affix (e.g. -01, (b), _000, or Copy of *-01)</span>
                     </div>
                     <div className="flex gap-2 items-center">
                        <input type="text" value={localConfig.unwiredConfig9 ?? "*-<date yyyymmdd>"} onChange={e => updateLocalConfig({ unwiredConfig9: e.target.value })} className="w-[200px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[2px] outline-none" />
                        <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">D</span>ate affix (e.g. *-&lt;date yyyymmdd&gt;)</span>
                     </div>
                  </div>
                  
                  <div>
                     <span className="text-[12px] font-bold text-white mb-[8px] block">Dropped Messages</span>
                     <input type="text" value={localConfig.unwiredConfig10 ?? "<from>_<to>_<subject>_<date yyyy-mm-dd_hh-nn-ss>"} onChange={e => updateLocalConfig({ unwiredConfig10: e.target.value })} className="w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[4px] outline-none mb-1 font-mono" />
                     <p className="text-[12px] text-[#e0e0e0] mb-[8px]">Filename templa<span className="underline decoration-1 underline-offset-[3px]">t</span>e, e.g. &lt;from&gt;_&lt;to&gt;_&lt;subject&gt;?_&lt;date&gt;.</p>
                     
                     <div className="flex gap-2 items-center mb-1 mt-3">
                        <input type="text" className="w-[45px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[2px] outline-none" value={localConfig.unwiredConfig11 || ''} onChange={e => updateLocalConfig({ unwiredConfig11: e.target.value })} />
                        <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">C</span>haracter to replace invalid characters in dropped messages</span>
                     </div>
                     <div className="flex gap-2 items-center mb-2">
                        <input type="text"  className="w-[45px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[2px] outline-none" value={localConfig.unwiredConfig12 || "0"} onChange={e => updateLocalConfig({ unwiredConfig12: e.target.value })} />
                        <span className="text-[12px] text-[#e0e0e0]"><span className="underline decoration-1 underline-offset-[3px]">M</span>aximum length of generated filenames (0 = unlimited)</span>
                     </div>
                     <Checkbox label={<span>Auto-in<span className="underline decoration-1 underline-offset-[3px]">c</span>rement filenames on collision</span>} checked={localConfig.autoIncrementFilenamesOnCollision ?? false} onChange={e => updateLocalConfig({ autoIncrementFilenamesOnCollision: e.target.checked })} />
                  </div>
                  
                  <div>
                     <span className="text-[12px] font-bold text-white mb-[8px] block">Title Bar</span>
                     <input type="text" value={localConfig.unwiredConfig13 ?? "<path> - <app> <ver>"} onChange={e => updateLocalConfig({ unwiredConfig13: e.target.value })} className="w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[4px] outline-none mb-1 font-mono" />
                     <p className="text-[12px] text-[#e0e0e0] mb-[4px]">Ti<span className="underline decoration-1 underline-offset-[3px]">t</span>le bar template, e.g. &lt;path&gt; - &lt;app&gt; @ &lt;ini&gt; - &lt;ver&gt;. &lt;app&gt; is mandatory.</p>
                  </div>
                  
                  <div>
                     <span className="text-[12px] font-bold text-white mb-[8px] block">Status Bar</span>
                     <input type="text" value={localConfig.unwiredConfig14 ?? "<s:dimension> <s:duration>"} onChange={e => updateLocalConfig({ unwiredConfig14: e.target.value })} className="w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[4px] outline-none mb-[6px] font-mono" />
                     <Checkbox label={<span>Use status <span className="underline decoration-1 underline-offset-[3px]">b</span>ar template</span>} checked={localConfig.useStatusBarTemplate ?? false} onChange={e => updateLocalConfig({ useStatusBarTemplate: e.target.checked })} />
                  </div>
                  
                  <div>
                     <span className="text-[12px] font-bold text-white mb-[8px] block">Command Line Interpreter</span>
                     <Checkbox label={<span>Use custom <span className="underline decoration-1 underline-offset-[3px]">c</span>ommand line interpreter (else default to cmd.exe):</span>} checked={localConfig.useCustomCommandLineInterpreterElseDefaultToCmdExe ?? false} onChange={e => updateLocalConfig({ useCustomCommandLineInterpreterElseDefaultToCmdExe: e.target.checked })} />
                     <div className="ml-[20px] mt-[6px] space-y-[4px]">
                        <span className="text-[12px] text-[#e0e0e0] block">E<span className="underline decoration-1 underline-offset-[3px]">x</span>ecutable:</span>
                        <input type="text" className="w-[450px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[4px] outline-none mb-1" value={localConfig.unwiredConfig15 || ''} onChange={e => updateLocalConfig({ unwiredConfig15: e.target.value })} />
                        <span className="text-[12px] text-[#e0e0e0] block mt-1">Ar<span className="underline decoration-1 underline-offset-[3px]">g</span>uments:</span>
                        <input type="text" className="w-[450px] bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-[4px] outline-none mb-1" value={localConfig.unwiredConfig16 || ''} onChange={e => updateLocalConfig({ unwiredConfig16: e.target.value })} />
                     </div>
                     <p className="text-[12px] text-[#e0e0e0] ml-[20px] mt-1">Use &lt;command&gt; as placeholder for address bar input (!-escape).</p>
                  </div>
                  </DevOnly>
               </div>
            </TabsContent>

            <TabsContent value="Icon Configurator" className="m-0 border-0 p-0 outline-none h-full">
                <IconConfiguratorTab />
            </TabsContent>

            <TabsContent value="Context Menu" className="m-0 border-0 p-0 outline-none h-full">
                <ContextMenuConfiguratorTab />
            </TabsContent>

            {categories.flatMap(c => c.items).filter(item => !["Tree and List", "Sort and Rename", "Refresh, Icons, History", "Menus, Mouse, Usability", "Custom Event Actions", "Safety Belts, Network", "Controls & More", "Startup & Exit", "File Operations", "Shell Integration", "Features", "Colors", "Highlights & Dark Mode", "Styles", "Color Filters", "Fonts", "Templates", "Icon Configurator", "Context Menu", "Tags", "Custom Columns", "File Info Tips & Hover Box", "Report & Data", "Undo & Action Log", "Find Files & Branch View", "Filters & Type Ahead Find", "Preview", "Previewed Formats", "Thumbnails", "Mouse Down Blow Up", "Tabs", "Dual Pane"].includes(item)).map(item => (
               <TabsContent key={item} value={item} className="m-0 border-0 p-0 outline-none">
                  <h1 className="text-[20px] font-bold text-white mb-6 leading-tight">{item}</h1>
                  <p className="text-[#a0a0a0] text-[13px]">Configuration options for this section are disabled in the current preview.</p>
               </TabsContent>
            ))}
         </div>
      </Tabs>

      {/* Footer */}
      <div className="bg-[#1a1a1a] border-t border-[#333] px-3 py-[10px] flex justify-between shrink-0">
         <div className="flex gap-2">
           <ActionBtn label="Help" className="px-5 py-[4px]" onClick={() => setShowJumpDialog(true)} />
           <ActionBtn label="Jump to Setting..." className="px-5 py-[4px]" onClick={() => setShowJumpDialog(true)} />
         </div>
         <div className="flex gap-3 pr-[4px]">
           <ActionBtn
             label={applyFeedback === 'applied' ? 'Applied ✓' : 'Apply'}
             className={`px-[22px] py-[3px] transition-all duration-300 flex items-center gap-1.5 ${
               applyFeedback === 'applied'
                 ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.45)]'
                 : hasChanges
                   ? 'bg-[#007acc] border-[#007acc] text-white hover:bg-[#006bb3] shadow-[0_0_10px_rgba(0,122,204,0.35)]'
                   : 'bg-[#333] border-[#666] text-gray-500'
             }`}
             onClick={applyChanges}
             disabled={!hasChanges && applyFeedback !== 'applied'}
           />
           <ActionBtn label="OK" className="px-[22px] py-[3px] hover:bg-[#444] bg-[#333] border-[#666]" onClick={okChanges} />
           <ActionBtn label="Cancel" className="px-[22px] py-[3px] bg-[#333] border-[#666]" onClick={onClose} />
         </div>
      </div>

      <ConditionalFormattingDialog open={showConditionalFormattingDialog} onOpenChange={setShowConditionalFormattingDialog} />

      <NativeDialogShell
        open={showJumpDialog}
        title="Jump to Setting"
        subtitle="Search tabs and common options"
        variant="sheet"
        size="sm"
        zIndexClass="z-[100]"
        onClose={() => { setShowJumpDialog(false); setJumpQuery(''); }}
        showCloseButton
        footerButtons={[{ label: 'Cancel', onClick: () => { setShowJumpDialog(false); setJumpQuery(''); } }]}
        bodyClassName="!py-3"
      >
        <input
          autoFocus
          value={jumpQuery}
          onChange={e => setJumpQuery(e.target.value)}
          className="bndz-native-input w-full mb-3"
          placeholder="e.g. tooltip, theme, dual pane..."
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setShowJumpDialog(false); setJumpQuery(''); }
            if (e.key === 'Enter' && jumpResults[0]) {
              setActiveTab(jumpResults[0].tab);
              setShowJumpDialog(false);
              setJumpQuery('');
            }
          }}
        />
        <div className="max-h-[220px] overflow-y-auto bndz-scrollbar space-y-1">
          {jumpQuery.trim() && jumpResults.length === 0 && (
            <div className="text-[11px] bndz-native-dialog-muted px-2 py-3 text-center">No matching settings</div>
          )}
          {jumpResults.map(hit => (
            <button
              key={`${hit.tab}::${hit.label}`}
              type="button"
              className="bndz-command-palette-item w-full text-left px-3 py-2"
              onClick={() => {
                setActiveTab(hit.tab);
                setShowJumpDialog(false);
                setJumpQuery('');
              }}
            >
              <div className="text-[12px]">{hit.label}</div>
              <div className="text-[10px] bndz-native-dialog-muted">{hit.tab}</div>
            </button>
          ))}
        </div>
      </NativeDialogShell>
    </BndzWindowFrame>
  )
}
