import React, { useState, useMemo, useEffect, useRef, Suspense, lazy } from 'react';
import { flushSync } from 'react-dom';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { normalizeDirEntries } from '../lib/normalizeDirEntry';
import { createInitialFileSystem, getDirContents, getEntityByPath, updateFileSystem } from '../data/initialFS';
import { VirtualDirectory, FSEntity, DriveInfo, ShortcutInfo } from '../types';
import { useModal } from './ModalProvider';
import { useClipboard } from '../data/ClipboardContext';
import { MenubarSubmenu } from './MenubarSubmenu';
import { MenubarPortalMenu } from './MenubarPortalMenu';
import QuickActionsBar, { buildDefaultQuickActions } from './QuickActionsBar';
import FileTransferQueuePanel from './FileTransferQueuePanel';
import FolderSizeSyncChip from './FolderSizeSyncChip';
import { SizeBar, type SizeBarStyle } from './SizeBar';
import IndexProgressChip from './IndexProgressChip';
import DriveCard from './DriveCard';
import {
  setMarqueeActive, isMarqueeActive, beginDragSession, trackDragPointer,
  clearDragSession, markPointerDown, hasMetDragThreshold, isDragSessionReady,
} from '../lib/dragController';
import { resolveDropOperation } from '../lib/dropOperation';
import { isCopyDragModifier } from '../lib/listDragModifiers';
import { isListSelectCellTarget, isListMarqueeSurface } from '../lib/listRowHitTargets';
import ListDragGhost, { type ListDragGhostState } from './ListDragGhost';
import {
  hitTestBreadcrumbAtPoint,
  hitTestListFolderAtPoint,
  hitTestNavTreeAtPoint,
  hitTestNewTabZoneAtPoint,
  hitTestTabAtPoint,
  beginFileDragSession,
  endFileDragSession,
  getFileDragSession,
  resolveFileDropDestination,
  isInternalFileDragChromeAtPoint,
  DEFAULT_TAB_HOVER_DELAY_MS,
} from '../lib/fileDragSession';
import { IPC, RenameOperation } from '../lib/ipcBridge';
import ClampedFixedMenu from './ClampedFixedMenu';
import { executeUndoWithTimeout, executeRedoWithTimeout } from '../lib/undoRedo';
import CommandPalette, { buildDefaultPaletteActions } from './CommandPalette';
import { NativeDialogShell } from './native/NativeDialogShell';
import type { TabState } from './tabTypes';
import { runAddressQuickScript } from '../lib/addressQuickScripts';
import { createFindingTab, findingTabLabel, isFindingTab } from '../lib/findingTab';
import { mergeUserCommands, userCommandsToPalette } from '../lib/userCommands';
import { recordNavVisit, buildMiniTreeFromVisits } from '../lib/navigationHistory';
import { buildPathSuggestions } from '../lib/addressAutocomplete';
import { summarizeSelection, formatSelectionSummaryLine } from '../lib/selectionSummary';
import { highlightNameMatch } from '../lib/liveFilterHighlight';
import { renderStatusBarTemplate } from '../lib/statusBarTemplate';
import { renderTitleBarTemplate } from '../lib/titleBarTemplate';
import { createRafPointerThrottler } from '../lib/pointerDragGhost';
import { dropSideFromPointer, computeReorderInsertIndex } from '../lib/reorderOnDrop';
import { filterByName } from '../lib/fuzzyFilter';
import MiniTreePanel from './MiniTreePanel';
import AddressAutocompleteDropdown from './AddressAutocompleteDropdown';
import WindowControls from './WindowControls';
import ContextMenuView from './ContextMenuView';
import { filterSupplementalNativeItems, type ContextMenuSurface } from '../lib/contextMenuActions';
import { TabContextMenu } from './TabContextMenu';
import { prefetchIconsForEntities, prefetchShellIconPaths } from '../lib/nativeIconService';
import { getLocationEntityFromPath, getLocationIconPath } from '../lib/virtualLocations';
import BottomPluginPanel from './BottomPluginPanel';
import { LeftSidebar } from './LeftSidebar';
import { ThumbnailIcon } from './ThumbnailIcon';
import { ShellNativeIcon } from './ShellNativeIcon';
import ToolbarConfigurator, { resolveToolbarItem } from './ToolbarConfigurator';
import { createEntityTooltipHandlers } from '../lib/entityTooltip';
import {
  advanceSlowDoubleClickRename,
  clearSlowDoubleClickTimer,
} from '../lib/slowDoubleClickRename';
import { shouldSuppressNativeEntityTitle } from '../lib/tooltipSettings';
import CustomColumnCell from './CustomColumnCell';
import { parseCustomColumnListId, resolveCustomColumns, setCustomColumnEnabled } from '../lib/customColumns';
import { hideFloatingTooltip, getFloatingTooltip, isShiftKeyHeld, subscribeShiftKey, getHoverPending, subscribeFloatingTooltip } from '../lib/floatingTooltip';
import { registerEscapeLayer } from '../lib/globalEscape';
import FloatingTooltipHost from './FloatingTooltipHost';
import LicenseBanner from './LicenseBanner';
import TrialExpiredGate from './TrialExpiredGate';

const AboutDialog = lazy(() => import('./AboutDialog'));
const RegisterDialog = lazy(() => import('./RegisterDialog'));
const HelpTopicsDialog = lazy(() => import('./HelpTopicsDialog'));
const ConfigurationDialog = lazy(() => import('./ConfigurationDialog'));
const PluginStoreDialog = lazy(() => import('./PluginStoreDialog').then(m => ({ default: m.PluginStoreDialog })));
const TagManagerDialog = lazy(() => import('./TagManagerDialog').then(m => ({ default: m.TagManagerDialog })));
const SmartToolsDialog = lazy(() => import('./SmartToolsDialog'));
const TagAssignmentMode = lazy(() => import('../spacedrive/port/TagAssignmentMode'));
import { toLocalStreamUrl } from '../lib/iconLibraryUtils';
import { formatFolderSizeLabel } from '../lib/folderSizeDisplay';
import { VirtualizedFileList } from './VirtualizedFileList';
import MillerColumnsView from './MillerColumnsView';
import BranchViewStrip from './BranchViewStrip';
import { flattenGroupedList, isGroupHeaderRow, LIST_GROUP_BY_OPTIONS, type ListGroupBy } from '../lib/listGrouping';
import { cloudBadgeForPath, cloudSidebarStatusLabel, type CloudProvider } from '../lib/cloudStatus';
import { VirtualizedNavTree } from './VirtualizedNavTree';
import TutorialOverlay from './TutorialOverlay';
import DestinationPickerModal from './DestinationPickerModal';
import QuitConfirmDialog from './QuitConfirmDialog';
import RightPreviewPanel from './RightPreviewPanel';
import SearchToolbar, { type SearchScope, type SearchKindFilter } from '../spacedrive/port/SearchToolbar';
import FolderSizeTreemap from './views/FolderSizeTreemap';
import FolderSizeListView from './views/FolderSizeListView';
import SizeView from '../spacedrive/port/SizeView';
import FindingTabToolbar from './FindingTabToolbar';
import BndzMediaView from './views/BndzMediaView';
import BndzHubView from './views/BndzHubView';
import BndzRecentsView from './views/BndzRecentsView';
import BndzQuickPreview from './preview/BndzQuickPreview';
import ListFilterChips, { matchesListKindFilter, matchesTagFilter, type ListKindFilter } from './views/ListFilterChips';
import TagBadge from './TagBadge';
import { resolveTagKey, tagStorageKey, entityHasTag, tagChipId } from '../lib/tagUtils';
import { gridTileMetrics, listTileMetrics } from '../lib/viewModeMetrics';
import { useContextMenuDismissOnLeave } from '../hooks/useContextMenuDismissOnLeave';
import { isBndzVirtualPath, parseBndzVirtualView, bndzVirtualPath, bndzVirtualLabel, BNDZ_VIEWS_ROOT } from '../lib/bndzVirtualViews';
import { buildGlobalSearchArgs, normalizeSearchResults, type IndexedSearchScope } from '../lib/globalSearchCall';
import { mapFindingEngine } from '../lib/indexedRoots';
import { setPathCacheEntry, removePathCacheKeys } from '../lib/pathCacheLru';
import type { BottomPluginLaunchContext } from './BottomPluginPanel';
import {
  getVisibleListColumns,
  getColumnStyle,
  formatAttributesLabel,
  formatFsDateTime,
  resolveListColumnOrder,
  reorderListColumns,
  resolveListColumnVisibility,
  LIST_COLUMN_DEFS,
  type ListColumnId,
  type SortColumnId,
} from '../lib/listColumns';
import { computeAutosizedColumnWidths, parseColumnAutosizeLimits } from '../lib/columnAutosize';
import RapidAccessPopup from './RapidAccessPopup';
import ClipboardMarkBadge from './ClipboardMarkBadge';
import {
  describeClipboardState,
  getClipboardMarkForEntity,
  resolveEntityWindowsPath,
} from '../lib/clipboardVisual';
import { findEntityInCache, joinPanePath, joinPanePathForFs, toWindowsPath, normalizePanePath, watcherDirToPanePath, RECYCLE_BIN_PATH, isRecycleBinPath } from '../lib/pathUtils';
import { buildRapidAccessDefaults, mergeRapidAccessItems, dedupePinnedFavorites } from '../lib/rapidAccessDefaults';
import { hasBndzFileDrag, readBndzFileDragData } from '../lib/bndzDrag';
import { toPanePath, SHELL_CLSID, KNOWN_FOLDER_SHELL, shellIconIsDirectory } from '../lib/shellPaths';
import { applySettingsRuntime } from '../lib/settingsRuntime';
import { pushToast, dismissToast, type ToastKind } from './ToastHost';
import { getPaneTabLabel } from '../lib/paneLabels';
import { tabAccentStyle } from '../lib/tabColors';
import { formatAddressBarPath, formatDriveLetter, getBreadcrumbSegments, parseUserPathToPane } from '../lib/displayPath';
import { isVirtualCatalogPath } from '../lib/virtualPaths';
import { listCatalogs } from '../lib/catalog';
import { dispatchCustomEvent } from '../lib/customEventActions';
import { dispatchMouseItemBinding, resolveMouseBindingKey } from '../lib/mouseBindings';
import { applyNavTreeOrder, mergeNavTreeOrder, type NavTreeBuildNode } from '../lib/navTreeOrder';
import { resolveShellPropertiesPath } from '../lib/shellPaths';
import { runMenubarAction } from '../lib/menubarUtils';
import {
  evaluateColorFilter,
  filterListEntities,
  sortEntities,
  wrapListIndex,
  getDisplayName,
  getRenameInitialValue,
  resolveRenameTargetName,
  applyRenameInputSelection,
  buildSettingsRuntime,
  resolveSortColumn,
  resolveSortDirection,
} from '../lib/settingsRuntime';
import { buildFileOpsRuntime } from '../lib/settingsWiring';
import { resolvePaneTab } from '../lib/paneTabGuards';
import { matchesShortcut, matchesTypeAhead } from '../lib/keyboardShortcuts';
import { useBndzPanelMotion } from '../hooks/useBndzPanelMotion';
import { useBndzTabMotion } from '../hooks/useBndzTabMotion';
import { useLatest } from '../hooks/useLatest';
import { useAppConfig, VisualFilter, type AppConfig } from '../data/configContext';
import { usePluginRegistry } from '../data/PluginRegistryContext';
import { motion, AnimatePresence } from 'framer-motion';

import { applyVisualFilters } from '../lib/visualFilterEngine';
import { ResizablePanel, ResizablePanelGroup, ResizableHandle, usePanelRef, useGroupRef } from "./ui/resizable";
import {
  getInnerDefaultLayout,
  getOuterDefaultLayout,
  DEFAULT_INNER_LAYOUT,
  DEFAULT_OUTER_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  MAX_PREVIEW_SIZE,
  MIN_PREVIEW_SIZE,
  MIN_SIDEBAR_SIZE,
  MAX_SIDEBAR_SIZE,
  normalizeOuterLayout,
  panelPct,
} from '../lib/workspaceLayout';
import { buildShellExecuteOptions } from '../lib/shellExecuteRuntime';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';

const BNDZ_APP_ICON = '/bndz-light.png';

const ToolbarButton = ({ iconId, launcherIcon, onClick, className = '', title, disabled }: {
  iconId?: string;
  launcherIcon?: string;
  onClick?: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
}) => {
  return (
    <button
      type="button"
      title={title}
      aria-label={title || undefined}
      disabled={disabled}
      style={{ touchAction: 'manipulation' }}
      className={`p-[4px] hover:bg-[#333] active:bg-[#444] rounded mx-[1px] flex items-center justify-center transition-none disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent ${className}`}
      onClick={onClick}
    >
        {launcherIcon ? (
          <img src={launcherIcon} alt="" className="w-5 h-5 object-contain" draggable={false} />
        ) : iconId ? (
          <Icons8Icon id={iconId} size={16} className="drop-shadow-sm" />
        ) : null}
    </button>
  );
};

function formatSize(bytes: number | null | undefined) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((n / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function nativeContextSignature(items: any[] | undefined): string {
  return filterSupplementalNativeItems(items)
    .map((item: any) => String(item.id || item.verb || item.label || ''))
    .join('|');
}

interface PaneState {
  id: string;
  tabs: TabState[];
  activeTabIndex: number;
  sortColumn?: SortColumnId;
  sortDirection?: 'asc' | 'desc';
  filterRegex?: string;
}

const Spinner = () => (
  <div className="flex justify-center items-center w-full h-full p-4 relative min-w-[50px] min-h-[50px]">
    <div className="w-[40px] h-[40px] border-[3.5px] border-[#333] rounded-full absolute" />
    <div className="w-[40px] h-[40px] border-[3.5px] border-transparent border-t-[#22c55e] border-r-[#22c55e] rounded-full animate-[spin_1s_cubic-bezier(0.5,0,0.5,1)_infinite] absolute" />
    <div className="w-[40px] h-[40px] border-[3.5px] border-transparent border-b-[#22c55e] border-l-[#22c55e] rounded-full animate-[spin_1.5s_cubic-bezier(0.5,0,0.5,1)_infinite_reverse] absolute opacity-70" />
  </div>
);

function InlineRenameInput({
  value,
  entity,
  config,
  onChange,
  onCommit,
  onCancel,
  showNameLength,
  serialRename,
  onSerialNavigate,
}: {
  value: string;
  entity: any;
  config: AppConfig;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  showNameLength?: boolean;
  serialRename?: boolean;
  onSerialNavigate?: (direction: 'prev' | 'next') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input) applyRenameInputSelection(input, entity, config);
  }, [entity?.id, entity?.name, entity?.extension, config.hideExtensionsFromRenameEditBox, config.hideShortcutExtensions, config.excludeFileExtensionFromInitialSelection, config.preselectName]);

  return (
    <div className="flex flex-col gap-0.5 w-[90%]">
    <input
      ref={inputRef}
      type="text"
      className="bg-[#111] text-white border border-[#007acc] px-1 outline-none w-full"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        onCommit();
      }}
      onKeyDown={e => {
        if (serialRename && e.key === 'ArrowDown') {
          e.preventDefault();
          onSerialNavigate?.('next');
          return;
        }
        if (serialRename && e.key === 'ArrowUp') {
          e.preventDefault();
          onSerialNavigate?.('prev');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelledRef.current = true;
          onCancel();
        }
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
    {showNameLength && (
      <span className="text-[9px] text-gray-500 tabular-nums">{value.length} characters</span>
    )}
    </div>
  );
}

export default function BNDZUI() {
  const { showModal, confirm } = useModal();
  const { clipboard, clipboardHistory, setClipboardState, executePaste, restorePreviousClipboard } = useClipboard();
  const { config, updateConfig } = useAppConfig();
  const keyboardMap = useMemo(() => buildSettingsRuntime(config).keyboard, [config]);
  const fileOpsRt = useMemo(() => buildFileOpsRuntime(config), [config]);
  const settingsRt = useMemo(() => buildSettingsRuntime(config), [config]);
  const { ensurePluginInstalled } = usePluginRegistry();

  // Real undo/redo availability for the main toolbar — previously always-enabled regardless
  // of whether there was anything to undo/redo.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const lastActionUtcRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      if (!IPC.isNative) return;
      IPC.getActionLog().then(r => {
        setCanUndo(!!r.canUndo);
        setCanRedo(!!r.canRedo);
        lastActionUtcRef.current = (r as { lastActionUtc?: string }).lastActionUtc;
      });
      unsub = IPC.onActionLogChanged(state => {
        setCanUndo(state.canUndo);
        setCanRedo(state.canRedo);
        lastActionUtcRef.current = state.lastActionUtc;
      });
    });
    return () => unsub?.();
  }, []);

  const [quitDialogOpen, setQuitDialogOpen] = useState(false);
  const [quitCloseSource, setQuitCloseSource] = useState<'x' | 'tray' | 'menu' | string>('x');

  const setToastMessage = React.useCallback((
    message: string,
    kind: ToastKind = 'success',
    title?: string,
    opts?: { native?: boolean },
  ) => {
    const resolvedTitle = title ?? (kind === 'error' ? 'Something went wrong' : kind === 'warning' ? 'Notice' : kind === 'info' ? 'Info' : 'Done');
    const useNative = opts?.native ?? (config.useNativeWindowsNotifications !== false && kind !== 'info' && kind !== 'progress');
    pushToast({ message, kind, title: resolvedTitle, native: useNative });
    if (useNative && kind !== 'progress') {
      import('../lib/ipcBridge').then(({ IPC }) => {
        IPC.showNativeNotification(resolvedTitle, message);
      });
    }
  }, [config.useNativeWindowsNotifications]);

  const [isSaveTabsetOpen, setIsSaveTabsetOpen] = useState(false);
  const [tabsetNameInput, setTabsetNameInput] = useState('');
  const [isLoadTabsetOpen, setIsLoadTabsetOpen] = useState(false);
  const [marquee, setMarquee] = useState<{
    activePane: string;
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    additive: boolean;
    baseSelection: string[];
  } | null>(null);

  const marqueePointInList = (listEl: HTMLElement, clientX: number, clientY: number) => {
    const rect = listEl.getBoundingClientRect();
    return {
      x: clientX - rect.left + listEl.scrollLeft,
      y: clientY - rect.top + listEl.scrollTop,
    };
  };

  type MarqueeSelectMeta = { rowHeight: number; items: Array<{ id: string; rowIndex: number }> };

  const marqueeOpsRef = useRef({
    setSelectedItems: (_ids: string[] | ((prev: string[]) => string[]), _paneId: string) => {},
    scheduleSelectionChrome: (_ids: string[], _immediate: boolean) => {},
    scheduleQuickActionsBar: (_show: boolean, _immediate?: boolean) => {},
  });

  const beginMarqueeGesture = React.useCallback((
    paneId: string,
    listEl: HTMLElement,
    clientX: number,
    clientY: number,
    additive: boolean,
    baseSelection: string[],
    selectMeta?: MarqueeSelectMeta,
    capturePointerId?: number,
  ) => {
    const pt = marqueePointInList(listEl, clientX, clientY);
    const marqueeState = {
      activePane: paneId,
      startX: pt.x,
      startY: pt.y,
      currX: pt.x,
      currY: pt.y,
      additive,
      baseSelection,
    };
    setMarquee(marqueeState);
    setMarqueeActive(true);
    (window as any)._marqueeDragOccurred = false;
    if (capturePointerId != null) {
      try { listEl.setPointerCapture(capturePointerId); } catch { /* ignore */ }
    }

    const applyMarqueeSelection = (state: typeof marqueeState) => {
      const mLeft = Math.min(state.startX, state.currX);
      const mTop = Math.min(state.startY, state.currY);
      const mRight = Math.max(state.startX, state.currX);
      const mBottom = Math.max(state.startY, state.currY);
      const selected: string[] = [];
      if (selectMeta?.items?.length) {
        const rh = selectMeta.rowHeight;
        for (const { id, rowIndex } of selectMeta.items) {
          const rowTop = rowIndex * rh;
          const rowBottom = rowTop + rh;
          if (rowBottom >= mTop && rowTop <= mBottom) selected.push(id);
        }
      } else {
        const listRect = listEl.getBoundingClientRect();
        const screenLeft = listRect.left + mLeft - listEl.scrollLeft;
        const screenTop = listRect.top + mTop - listEl.scrollTop;
        const screenRight = listRect.left + mRight - listEl.scrollLeft;
        const screenBottom = listRect.top + mBottom - listEl.scrollTop;
        listEl.querySelectorAll('.fs-item-wrapper').forEach(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.right >= screenLeft && r.left <= screenRight && r.bottom >= screenTop && r.top <= screenBottom) {
            const id = el.getAttribute('data-id');
            if (id) selected.push(id);
          }
        });
      }
      const finalSelected = state.additive
        ? [...new Set([...state.baseSelection, ...selected])]
        : selected;
      const ops = marqueeOpsRef.current;
      ops.setSelectedItems(finalSelected, state.activePane);
      ops.scheduleSelectionChrome(finalSelected, true);
      ops.scheduleQuickActionsBar(finalSelected.length > 0, true);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - clientX) > 3 || Math.abs(ev.clientY - clientY) > 3) {
        (window as any)._marqueeDragOccurred = true;
      }
      const p = marqueePointInList(listEl, ev.clientX, ev.clientY);
      const next = { ...marqueeState, currX: p.x, currY: p.y };
      marqueeState.currX = p.x;
      marqueeState.currY = p.y;
      setMarquee(next);
      applyMarqueeSelection(next);
      const edge = 48;
      const rect = listEl.getBoundingClientRect();
      if (ev.clientY > rect.bottom - edge) listEl.scrollTop += 12;
      else if (ev.clientY < rect.top + edge) listEl.scrollTop -= 12;
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (capturePointerId != null) {
        try { listEl.releasePointerCapture(capturePointerId); } catch { /* ignore */ }
      }
      const moved = Math.abs(marqueeState.currX - marqueeState.startX) > 3
        || Math.abs(marqueeState.currY - marqueeState.startY) > 3;
      if (moved) applyMarqueeSelection(marqueeState);
      setMarquee(null);
      setMarqueeActive(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [networkNodes, setNetworkNodes] = useState<any[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [indexedSearchScope, setIndexedSearchScope] = useState<SearchScope>('library');
  const [globalSearchKindFilter, setGlobalSearchKindFilter] = useState<SearchKindFilter>('all');
  const [listKindFilter, setListKindFilter] = useState<ListKindFilter>('all');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [smartViewsExpanded, setSmartViewsExpanded] = useState(true);
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [quickPreviewIndex, setQuickPreviewIndex] = useState(0);
  const [fileSystem, setFileSystem] = useState<VirtualDirectory>(() => createInitialFileSystem());
  const [isSyncMode, setIsSyncMode] = useState(false);
  const [syncResults, setSyncResults] = useState<{ [path: string]: { id: string, statusA?: string, statusB?: string, status?: string } }>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [folderSizeMap, setFolderSizeMap] = useState<Record<string, number>>({});
  const [indexedRoots, setIndexedRoots] = useState<string[]>([]);
  const [indexProgress, setIndexProgress] = useState<{
    currentPath: string; filesIndexed: number; done: boolean; root?: string; error?: string;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [virtualViewErrors, setVirtualViewErrors] = useState<Record<string, string>>({});
  const [pathLoadErrors, setPathLoadErrors] = useState<Record<string, string>>({});
  const [lastLoadDurationMs, setLastLoadDurationMs] = useState<number | null>(null);
  const [folderSizeSync, setFolderSizeSync] = useState<{
    active: boolean; current: number; total: number; path: string; percent: number;
  } | null>(null);
  const folderSizeScanGen = useRef(0);
  const findingSearchGenRef = useRef<Record<string, number>>({});
  const folderSizeToastCooldownRef = useRef(0);
  const folderSizeSessionScannedRef = useRef(0);

  useEffect(() => {
    let unsubDrives: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getSystemDrives().then(setDrives);
      IPC.getCloudProviders().then(setCloudProviders);
      IPC.getSystemShortcuts().then(setShortcuts);
      IPC.getNetworkLocations().then(setNetworkNodes);
      IPC.getTagsConfig().then(setAvailableTags);
      unsubDrives = IPC.onDrivesChanged((newDrives) => {
          setDrives(newDrives);
      });
    });
    return () => { if (unsubDrives) unsubDrives(); };
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onFolderSizeProgress(prog => {
        setFolderSizeSync({
          active: (prog.percent ?? 0) < 100,
          current: prog.current ?? 0,
          total: prog.total ?? 0,
          path: prog.path ?? '',
          percent: prog.percent ?? 0,
        });
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const cancelFolderSizeSync = React.useCallback(() => {
    folderSizeScanGen.current++;
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.cancelFolderSizeScan();
      setFolderSizeSync(prev => prev ? { ...prev, active: false } : null);
      pushToast({ kind: 'info', title: 'Sync stopped', message: 'Folder size sync cancelled.' });
    });
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onCloseRequest(({ source } = {}) => {
        if (source === 'x' && config.minimizeToTrayOnXClose) {
          IPC.windowCloseResolve('tray');
          return;
        }
        setQuitCloseSource(source || 'x');
        setQuitDialogOpen(true);
      });
    });
    return () => { if (unsub) unsub(); };
  }, [config.minimizeToTrayOnXClose]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/", "/workspace"]));
  const [isSmartToolsOpen, setIsSmartToolsOpen] = useState(false);
  const [smartToolsTab, setSmartToolsTab] = useState<'assistant' | 'organize' | 'duplicates' | 'agent'>('assistant');
  const [smartToolsPrompt, setSmartToolsPrompt] = useState<string | undefined>();
  const [isPreviewPanelOpen, setIsPreviewPanelOpen] = useState(config.previewPanelOpen !== false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(config.bottomPanelOpen !== false);
  const bottomPanelRef = usePanelRef();
  const previewPanelRef = usePanelRef();
  const previewPanelInnerRef = useRef<HTMLDivElement>(null);
  const dualPaneSecondRef = useRef<HTMLDivElement>(null);
  const innerGroupRef = useGroupRef();

  const outerDefaultLayout = useMemo(
    () => getOuterDefaultLayout(config.workspaceLayoutOuter),
    [config.workspaceLayoutOuter]
  );
  const innerDefaultLayout = useMemo(
    () => getInnerDefaultLayout(config.workspaceLayoutInner),
    [config.workspaceLayoutInner]
  );

  useEffect(() => {
    applySettingsRuntime(config);
  }, [config.theme, config.applyColors, config.accent, config.bgMain,
    config.appearanceChromePalette, config.appearanceSurfaceStyle, config.appearanceSelectionStyle]);

  useEffect(() => {
    applySettingsRuntime(config);
  }, [
    config.fontSize, config.uiFontFamily, config.uiFontWeight, config.uiFontFamilyMono,
    config.treeFontFamily, config.listFontFamily, config.previewFontFamily,
    config.bottomFontFamily, config.statusFontFamily, config.chromeFontFamily,
    config.treeFontSize, config.listFontSize, config.previewFontSize,
    config.bottomFontSize, config.statusFontSize, config.chromeFontSize,
    config.rowHeight,
  ]);

  /** One-time upgrade for panel defaults + sidebar cloud section */
  useEffect(() => {
    const patches: Record<string, unknown> = {};
    if ((config.workspaceLayoutVersion ?? 0) < WORKSPACE_LAYOUT_VERSION) {
      patches.workspaceLayoutVersion = WORKSPACE_LAYOUT_VERSION;
      patches.workspaceLayoutOuter = { ...DEFAULT_OUTER_LAYOUT };
      patches.workspaceLayoutInner = { ...DEFAULT_INNER_LAYOUT };
    }
    if ((config.sidebarOrderVersion ?? 0) < 1) {
      patches.sidebarOrderVersion = 1;
    }
    if ((config.tooltipBehaviorVersion ?? 0) < 1) {
      patches.tooltipBehaviorVersion = 1;
      patches.onlyWhileTheShiftKeyIsHeldDown = true;
    }
    if (Object.keys(patches).length) updateConfig(patches);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    setIsPreviewPanelOpen(config.previewPanelOpen !== false);
    setIsBottomPanelOpen(config.bottomPanelOpen !== false);
  }, [config.previewPanelOpen, config.bottomPanelOpen]);

  const togglePreviewPanel = () => {
    const next = !isPreviewPanelOpen;
    setIsPreviewPanelOpen(next);
    updateConfig({ previewPanelOpen: next });
  };

  const toggleBottomPanel = () => {
    const next = !isBottomPanelOpen;
    setIsBottomPanelOpen(next);
    updateConfig({ bottomPanelOpen: next });
  };

  const uiRuntime = useMemo(() => buildSettingsRuntime(config).ui, [config]);
  const effectivePreviewOpen = uiRuntime.previewPanel && isPreviewPanelOpen && config.rightSidebarEnabled !== false;
  const effectiveBottomOpen = uiRuntime.bottomPanel && isBottomPanelOpen;

  const outerLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const innerLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveOuterLayout = (layout: Record<string, number>) => {
    const previewVal = effectivePreviewOpen
      ? (layout.preview ?? outerDefaultLayout.preview)
      : (config.workspaceLayoutOuter?.preview ?? outerDefaultLayout.preview);
    const sidebarVal = uiRuntime.treePanel
      ? (layout.sidebar ?? outerDefaultLayout.sidebar)
      : (config.workspaceLayoutOuter?.sidebar ?? outerDefaultLayout.sidebar);
    const nextOuter = normalizeOuterLayout({
      sidebar: sidebarVal,
      workspace: layout.workspace ?? outerDefaultLayout.workspace,
      preview: previewVal,
    });
    if (outerLayoutSaveTimerRef.current) clearTimeout(outerLayoutSaveTimerRef.current);
    outerLayoutSaveTimerRef.current = setTimeout(() => {
      updateConfig({ workspaceLayoutOuter: nextOuter });
      outerLayoutSaveTimerRef.current = null;
    }, 200);
  };

  const saveInnerLayout = (layout: Record<string, number>) => {
    const bottom = effectiveBottomOpen
      ? (layout.bottom ?? innerDefaultLayout.bottom)
      : (config.workspaceLayoutInner?.bottom ?? innerDefaultLayout.bottom);
    const nextInner = {
      main: layout.main ?? innerDefaultLayout.main,
      bottom,
    };
    if (innerLayoutSaveTimerRef.current) clearTimeout(innerLayoutSaveTimerRef.current);
    innerLayoutSaveTimerRef.current = setTimeout(() => {
      updateConfig({ workspaceLayoutInner: nextInner });
      innerLayoutSaveTimerRef.current = null;
    }, 200);
  };

  useEffect(() => {
    const ui = buildSettingsRuntime(config).ui;
    if (!ui.previewPanel && isPreviewPanelOpen) setIsPreviewPanelOpen(false);
    if (!ui.bottomPanel && isBottomPanelOpen) setIsBottomPanelOpen(false);
  }, [config.previewPanelEnabled, config.bottomPanelEnabled, isPreviewPanelOpen, isBottomPanelOpen]);

  useEffect(() => {
    if (!config.checkForUpdatesAtStartup) return;
    const manifestUrl = String(config.updateCheckUrl || '').trim();
    if (!manifestUrl) return;
    void import('../lib/ipcBridge').then(({ IPC }) => {
      if (!IPC.isNative) return;
      void IPC.checkForUpdates(manifestUrl).then(result => {
        if (result?.updateAvailable) {
          window.dispatchEvent(new CustomEvent('bndz-native-alert', {
            detail: {
              title: 'Update available',
              message: result.latestVersion
                ? `BNDZ ${result.latestVersion} is available. Open Help → About to download.`
                : 'A newer version of BNDZ is available.',
            },
          }));
        }
      }).catch(() => {});
    });
  }, [config.checkForUpdatesAtStartup, config.updateCheckUrl]);

  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (effectiveBottomOpen) panel.expand();
    else panel.collapse();
  }, [effectiveBottomOpen, bottomPanelRef]);

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (effectivePreviewOpen) panel.expand();
    else panel.collapse();
  }, [effectivePreviewOpen, previewPanelRef]);

  const [isToolbarConfigOpen, setIsToolbarConfigOpen] = useState(false);
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<string | undefined>(undefined);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [licenseEpoch, setLicenseEpoch] = useState(0);
  const [showHelpTopics, setShowHelpTopics] = useState(false);
  const [, setUiHintTick] = useState(0);
  useEffect(() => {
    const u1 = subscribeShiftKey(() => setUiHintTick(t => t + 1));
    const u2 = subscribeFloatingTooltip(() => setUiHintTick(t => t + 1));
    return () => { u1(); u2(); };
  }, []);
  const [isPluginStoreOpen, setIsPluginStoreOpen] = useState(false);
  const [bottomPluginTab, setBottomPluginTab] = useState<string | null>(null);
  const [bottomPluginLaunch, setBottomPluginLaunch] = useState<BottomPluginLaunchContext | null>(null);
  const [activeBottomPluginLabel, setActiveBottomPluginLabel] = useState<string | null>(null);
  const contextMenuBlockRef = React.useRef(false);
  const contextMenuRequestRef = React.useRef(0);
  const contextMenuRootRef = React.useRef<HTMLDivElement>(null);
  const [treeRefreshNonce, setTreeRefreshNonce] = useState(0);
  const menubarRef = React.useRef<HTMLDivElement>(null);
  const menubarAnchors = React.useRef<Record<string, HTMLDivElement | null>>({});
  const menubarAnchorCallbacks = React.useRef<Record<string, (el: HTMLDivElement | null) => void>>({});
  const bindMenuAnchor = React.useCallback((id: string) => {
    if (!menubarAnchorCallbacks.current[id]) {
      menubarAnchorCallbacks.current[id] = (el: HTMLDivElement | null) => {
        menubarAnchors.current[id] = el;
      };
    }
    return menubarAnchorCallbacks.current[id];
  }, []);
  const suppressNavClickUntilRef = React.useRef(0);
  const typeAheadPrefixRef = useRef('');
  const typeAheadAtRef = useRef(0);

  const openBottomPlugin = React.useCallback((pluginId: string, launch?: BottomPluginLaunchContext) => {
    ensurePluginInstalled?.(pluginId);
    setIsBottomPanelOpen(true);
    setBottomPluginTab(pluginId);
    if (launch) setBottomPluginLaunch(launch);
  }, [ensurePluginInstalled]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [rapidAccessPopupOpen, setRapidAccessPopupOpen] = useState(false);
  const [tagAssignmentActive, setTagAssignmentActive] = useState(false);
  const [inlineRename, setInlineRename] = useState<{ path: string, entityId: string, currentName: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ path: string; entityId: string; entity: any; value: string } | null>(null);
  const [lastClickData, setLastClickData] = useState<{ id: string, time: number } | null>(null);
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionChromeReady, setSelectionChromeReady] = useState<Set<string>>(() => new Set());
  const selectionChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSelectionChrome = (ids: string[], immediate: boolean) => {
    if (selectionChromeTimerRef.current) {
      clearTimeout(selectionChromeTimerRef.current);
      selectionChromeTimerRef.current = null;
    }
    if (immediate || ids.length === 0) {
      setSelectionChromeReady(new Set(ids));
      return;
    }
    selectionChromeTimerRef.current = setTimeout(() => {
      setSelectionChromeReady(new Set(ids));
      selectionChromeTimerRef.current = null;
    }, 200);
  };
  const beginInlineRename = React.useCallback((path: string, entityId: string, entity: any) => {
    const initial = getRenameInitialValue(entity, config);
    if (config.useDialogToRenameSingleItems) {
      setRenameDialog({ path, entityId, entity, value: initial });
      return;
    }
    setInlineRename({ path, entityId, currentName: initial });
  }, [config]);
  const [showQuickActionsBar, setShowQuickActionsBar] = useState(false);
  const quickActionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleQuickActionsBar = (show: boolean, immediate = false) => {
    if (config.showQuickActionsBar !== true) {
      setShowQuickActionsBar(false);
      return;
    }
    if (quickActionsTimerRef.current) {
      clearTimeout(quickActionsTimerRef.current);
      quickActionsTimerRef.current = null;
    }
    if (!show) {
      setShowQuickActionsBar(false);
      return;
    }
    if (immediate) {
      setShowQuickActionsBar(true);
      return;
    }
    quickActionsTimerRef.current = setTimeout(() => {
      setShowQuickActionsBar(true);
      quickActionsTimerRef.current = null;
    }, 280);
  };
  marqueeOpsRef.current.scheduleSelectionChrome = scheduleSelectionChrome;
  marqueeOpsRef.current.scheduleQuickActionsBar = scheduleQuickActionsBar;
  const internalDragRef = useRef(false);
  const dropModifierRef = useRef({ copy: false });
  const xferMetaRef = useRef(new Map<string, { op: 'copy' | 'move' | 'delete'; label: string }>());
  const [listDragOperation, setListDragOperation] = useState<'copy' | 'move' | null>(null);
  const [listDragGhost, setListDragGhost] = useState<ListDragGhostState | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [editingAddressBarPaneId, setEditingAddressBarPaneId] = useState<string | null>(null);
  const [addressBarInput, setAddressBarInput] = useState<string>('');
  const [addressSuggestIndex, setAddressSuggestIndex] = useState(0);
  const [catalogNameMap, setCatalogNameMap] = useState<Record<string, string>>({});
  const navHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const refreshCatalogMap = () => {
      listCatalogs().then(cats => {
        if (!active) return;
        const map: Record<string, string> = {};
        for (const c of cats) map[c.id] = c.name;
        setCatalogNameMap(map);
      });
    };
    refreshCatalogMap();
    window.addEventListener('bndz-catalog-changed', refreshCatalogMap);
    return () => {
      active = false;
      window.removeEventListener('bndz-catalog-changed', refreshCatalogMap);
    };
  }, []);

  useEffect(() => {
    if (!isTagManagerOpen) {
       import('../lib/ipcBridge').then(({ IPC }) => {
           IPC.getTagsConfig().then(setAvailableTags);
       });
    }
  }, [isTagManagerOpen]);
  
  // Dual Pane Architecture state
  const [isDualPane, setIsDualPane] = useState(false);
  // pathContentsCache stores backend-fetched directory contents keyed by path
  const [pathContentsCache, setPathContentsCache] = useState<Record<string, any[]>>({});
  const cachePathContents = React.useCallback((path: string, data: any[]) => {
    setPathContentsCache(prev => setPathCacheEntry(prev, path, data));
  }, []);
  // loadingPaths tracks which paths are currently being fetched so we show a spinner
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  const [panes, setPanes] = useState<PaneState[]>([
     { 
       id: 'pane1', 
       tabs: [{ id: 't1', path: '/', history: ['/'], historyIndex: 0, selectedItems: [], viewMode: undefined }],
       activeTabIndex: 0,
       sortColumn: 'name',
       sortDirection: 'asc'
     }
  ]);
  const panesRef = useRef(panes);
  panesRef.current = panes;


  const { scheduleTabEnter, animateTabClose } = useBndzTabMotion(panes);

  useBndzPanelMotion({
    effectivePreviewOpen,
    isDualPane,
    previewPanelInnerRef,
    dualPaneSecondRef,
  });

  // Fetch directory contents from the backend whenever the active pane path changes.
  // Core fix: We track a separate `fetchedPaths` ref so navigation always triggers a fresh
  // fetch if the path hasn't been loaded in THIS session. The cache is only used to avoid
  // duplicate in-flight requests for the SAME navigation event.
  const activePanePathsKey = useMemo(
    () => panes.map(p => `${p.id}:${normalizePanePath(p.tabs[p.activeTabIndex]?.path || '')}`).join('|'),
    [panes],
  );
  const dirFetchInFlightRef = useRef<Set<string>>(new Set());
  const pathContentsCacheRef = useRef(pathContentsCache);
  pathContentsCacheRef.current = pathContentsCache;

  useEffect(() => {
    setListKindFilter('all');
    setActiveTagFilter(null);
  }, [activePanePathsKey]);

  useEffect(() => {
    const onOpenSmartTools = (ev: Event) => {
      const detail = (ev as CustomEvent<{ prompt?: string; tab?: 'agent' | 'assistant' | 'organize' | 'duplicates' | 'tasks' | 'memories' }>).detail;
      if (detail?.tab) {
        const t = detail.tab;
        setSmartToolsTab(t === 'agent' || t === 'tasks' || t === 'memories' ? 'assistant' : t === 'duplicates' ? 'duplicates' : t === 'organize' ? 'organize' : 'assistant');
      }
      if (detail?.prompt) setSmartToolsPrompt(detail.prompt);
      setIsSmartToolsOpen(true);
    };
    window.addEventListener('bndz-open-smart-tools', onOpenSmartTools);
    return () => window.removeEventListener('bndz-open-smart-tools', onOpenSmartTools);
  }, []);

  useEffect(() => {
    const onOpenTagAssignment = () => setTagAssignmentActive(true);
    window.addEventListener('bndz-open-tag-assignment', onOpenTagAssignment);
    return () => window.removeEventListener('bndz-open-tag-assignment', onOpenTagAssignment);
  }, []);

  useEffect(() => {
    import('../lib/ipcBridge').then(({ IPC }) => {
      panes.forEach(pane => {
        const tab = pane.tabs[pane.activeTabIndex];
        const path = normalizePanePath(tab?.path || '');
        if (!path) return;
        if (pathContentsCacheRef.current[path] !== undefined) return;
        if (dirFetchInFlightRef.current.has(path)) return;

        if (isVirtualCatalogPath(path)) {
          dirFetchInFlightRef.current.add(path);
          setLoadingPaths(prev => new Set(prev).add(path));
          IPC.getCatalogContents(path).then(data => {
            const normalized = normalizeDirEntries(data);
            setPathContentsCache(prev => setPathCacheEntry(prev, path, normalized));
          }).catch(() => {
            setPathContentsCache(prev => setPathCacheEntry(prev, path, []));
          }).finally(() => {
            dirFetchInFlightRef.current.delete(path);
            setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
          });
          return;
        }

        if (isBndzVirtualPath(path)) {
          const view = parseBndzVirtualView(path);
          if (view) {
            dirFetchInFlightRef.current.add(path);
            setLoadingPaths(prev => new Set(prev).add(path));
            IPC.getVirtualViewContents(view, config.globalSearchLimit || 500).then(items => {
              setVirtualViewErrors(prev => { const next = { ...prev }; delete next[path]; return next; });
              setPathContentsCache(prev => setPathCacheEntry(prev, path, normalizeDirEntries(items || [])));
            }).catch((err: unknown) => {
              setVirtualViewErrors(prev => ({ ...prev, [path]: err instanceof Error ? err.message : 'Failed to load smart view.' }));
              setPathContentsCache(prev => setPathCacheEntry(prev, path, []));
            }).finally(() => {
              dirFetchInFlightRef.current.delete(path);
              setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
            });
            return;
          }
        }

        dirFetchInFlightRef.current.add(path);
        setLoadingPaths(prev => new Set(prev).add(path));

        IPC.getDirContents(path).then(data => {
          const normalized = normalizeDirEntries(data);
          setPathContentsCache(prev => setPathCacheEntry(prev, path, normalized));
          setPathLoadErrors(prev => { const next = { ...prev }; delete next[path]; return next; });
          void prefetchIconsForEntities(normalized, path);
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Could not load folder contents.';
          setPathLoadErrors(prev => ({ ...prev, [path]: message }));
          setPathContentsCache(prev => setPathCacheEntry(prev, path, prev[path] !== undefined ? prev[path] : []));
        }).finally(() => {
          dirFetchInFlightRef.current.delete(path);
          setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
        });
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanePathsKey]);

  const refetchPath = React.useCallback(async (rawPath: string) => {
    const path = normalizePanePath(rawPath);
    if (!path) return;
    const { IPC } = await import('../lib/ipcBridge');
    const loadStarted = performance.now();
    setLoadingPaths(prev => new Set(prev).add(path));
    try {
      let data: any[];
      if (isVirtualCatalogPath(path)) {
        data = await IPC.getCatalogContents(path);
      } else if (isBndzVirtualPath(path)) {
        const view = parseBndzVirtualView(path);
        data = view ? await IPC.getVirtualViewContents(view, config.globalSearchLimit || 500) : [];
        setVirtualViewErrors(prev => { const next = { ...prev }; delete next[path]; return next; });
      } else {
        data = await IPC.getDirContents(path);
      }
      const normalized = normalizeDirEntries(data);
      cachePathContents(path, normalized);
      setPathLoadErrors(prev => { const next = { ...prev }; delete next[path]; return next; });
      setLastLoadDurationMs(Math.round(performance.now() - loadStarted));
    } catch (err: unknown) {
      if (isBndzVirtualPath(path)) {
        setVirtualViewErrors(prev => ({
          ...prev,
          [path]: err instanceof Error ? err.message : 'Failed to load smart view.',
        }));
      } else if (!isVirtualCatalogPath(path)) {
        setPathLoadErrors(prev => ({
          ...prev,
          [path]: err instanceof Error ? err.message : 'Failed to load folder.',
        }));
      }
      cachePathContents(path, []);
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [cachePathContents, config.globalSearchLimit]);

  const commitRenameForEntity = React.useCallback(async (
    entity: any,
    panePath: string,
    editedValue: string,
  ) => {
    let targetName = resolveRenameTargetName(entity, editedValue, config);
    if (settingsRt.rename.autoReplaceInvalidChars) {
      targetName = targetName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    }
    if (!targetName) {
      setToastMessage('Name cannot be empty.', 'warning');
      return false;
    }
    if (/[<>:"/\\|?*\x00-\x1F]/.test(targetName)) {
      setToastMessage('Name contains characters Windows does not allow.', 'warning');
      return false;
    }
    if (targetName === entity.name) return true;

    const sourcePath = entity.path ? normalizePanePath(entity.path) : joinPanePath(panePath, entity);
    let targetPath: string;
    if (settingsRt.rename.allowMoveOnRename && /[\\/]/.test(editedValue.trim())) {
      targetPath = toWindowsPath(editedValue.trim());
    } else {
      const targetDir = sourcePath.replace(/[/\\][^/\\]+$/, '');
      targetPath = targetDir ? `${targetDir}/${targetName}` : joinPanePath(panePath, { name: targetName });
    }

    const displayTarget = targetPath.split(/[/\\]/).pop() || targetName;
    const renameLabel = `Rename: ${entity.name} → ${displayTarget}`;
    const { IPC } = await import('../lib/ipcBridge');
    await IPC.executeFsOperation(
      `rename-${Date.now()}`,
      'move',
      toWindowsPath(sourcePath),
      toWindowsPath(targetPath),
      false,
      renameLabel,
    );
    if (settingsRt.rename.resortAfterRename) void refetchPath(panePath);
    return true;
  }, [config, settingsRt.rename, refetchPath]);

  const prefetchPathQuiet = React.useCallback(async (rawPath: string) => {
    const path = normalizePanePath(rawPath);
    if (!path || pathContentsCacheRef.current[path] !== undefined) return;
    if (dirFetchInFlightRef.current.has(path)) return;
    if (isVirtualCatalogPath(path) || isBndzVirtualPath(path)) return;
    dirFetchInFlightRef.current.add(path);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const data = await IPC.getDirContents(path);
      cachePathContents(path, normalizeDirEntries(data));
    } catch {
      /* hover prefetch is best-effort */
    } finally {
      dirFetchInFlightRef.current.delete(path);
    }
  }, [cachePathContents]);

  const refreshFindingTab = React.useCallback(async (
    paneId: string,
    tabId: string,
    query: string,
    root: string,
    tabOpts?: Pick<TabState, 'findingScope' | 'findingUseRegex' | 'findingSearchContent' | 'findingBooleanMode'>,
  ) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setPanes(prev => prev.map(p => p.id !== paneId ? p : {
        ...p,
        tabs: p.tabs.map(t => t.id === tabId ? {
          ...t, findingLoading: false, findingResults: [], findingEngine: null, findingError: 'Enter a search query.',
        } : t),
      }));
      return;
    }

    const gen = (findingSearchGenRef.current[tabId] ?? 0) + 1;
    findingSearchGenRef.current[tabId] = gen;

    const { IPC } = await import('../lib/ipcBridge');
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      return {
        ...p,
        tabs: p.tabs.map(t => t.id === tabId ? { ...t, findingLoading: true, findingError: undefined } : t),
      };
    }));
    try {
      const scope = (tabOpts?.findingScope ?? (
        !root || root === '/C:' || root === '/' ? 'library' : 'folder'
      )) as IndexedSearchScope;
      const args = buildGlobalSearchArgs(config, trimmed, scope, root || '/', {
        useRegex: tabOpts?.findingUseRegex,
        searchContent: tabOpts?.findingSearchContent,
        booleanMode: tabOpts?.findingBooleanMode,
      });
      const { items, engine } = await IPC.performGlobalSearch(
        args.query, args.limit, args.useRegex, args.rootPath || root,
        args.useEverything, args.searchContent, args.opts,
      );
      if (findingSearchGenRef.current[tabId] !== gen) return;

      const normalizedItems = normalizeSearchResults(items);
      setPanes(prev => prev.map(p => {
        if (p.id !== paneId) return p;
        return {
          ...p,
          tabs: p.tabs.map(t => t.id === tabId ? {
            ...t,
            findingLoading: false,
            findingResults: normalizedItems || [],
            findingEngine: mapFindingEngine(engine),
            findingError: undefined,
          } : t),
        };
      }));
    } catch (err: unknown) {
      if (findingSearchGenRef.current[tabId] !== gen) return;
      const message = err instanceof Error ? err.message : 'Search failed.';
      setPanes(prev => prev.map(p => {
        if (p.id !== paneId) return p;
        return {
          ...p,
          tabs: p.tabs.map(t => t.id === tabId ? {
            ...t, findingLoading: false, findingResults: [], findingEngine: null, findingError: message,
          } : t),
        };
      }));
    }
  }, [config]);

  const refreshIndexedRoots = React.useCallback(async () => {
    if (!IPC.isNative) return;
    try {
      const status = await IPC.getIndexStatus();
      setIndexedRoots((status.locations || []).map(loc => loc.path));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshIndexedRoots();
    if (!IPC.isNative) return;
    return IPC.onIndexProgress(p => {
      if (p.done) {
        if (p.error) {
          setIndexProgress({ ...p });
          window.setTimeout(() => setIndexProgress(null), 5000);
        } else {
          setIndexProgress(null);
          void refreshIndexedRoots();
        }
      } else {
        setIndexProgress(p);
      }
    });
  }, [refreshIndexedRoots]);

  useEffect(() => {
    if (!IPC.isNative) return;
    IPC.getAppVersion().then(v => { if (v) setAppVersion(v); }).catch(() => {});
  }, []);

  useEffect(() => {
    const onRootsChanged = () => { void refreshIndexedRoots(); };
    window.addEventListener('bndz-index-roots-changed', onRootsChanged);
    return () => window.removeEventListener('bndz-index-roots-changed', onRootsChanged);
  }, [refreshIndexedRoots]);

  const refreshFindingTabRef = useLatest(refreshFindingTab);

  const invalidatePath = React.useCallback((rawPath: string) => {
    const path = normalizePanePath(rawPath);
    setPathContentsCache(prev => removePathCacheKeys(prev, [path]));
    void refetchPath(path);
  }, [refetchPath]);

  const refreshPathsForPanes = React.useCallback(() => {
    panes.forEach(p => {
      const tab = p.tabs[p.activeTabIndex];
      if (tab?.path && tab.path !== '/' && tab.path !== '/this-pc') {
        invalidatePath(tab.path);
      }
    });
  }, [panes, invalidatePath]);

  // Return cached backend data only - never fall back to virtual FS for native paths
  const safeGetDirContents = (fs: any, path: string) => {
    const norm = normalizePanePath(path);
    if (norm === '/' || norm === '/this-pc') return null;
    if (pathContentsCache[norm] !== undefined) return pathContentsCache[norm];
    return null;
  };


  const [activePaneId, setActivePaneId] = useState('pane1');
  const activePaneIdRef = useRef(activePaneId);
  activePaneIdRef.current = activePaneId;
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const selectionAnchorRef = useRef<{ paneId: string; itemId: string } | null>(null);
  const listGestureRef = useRef<{
    paneId: string;
    pointerId: number;
    startX: number;
    startY: number;
    entityId: string;
    wasSelected: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    moved: boolean;
    mode: 'pending' | 'marquee' | 'drag';
    copyDrag: boolean;
    dragSelection: string[];
    listEl: HTMLElement;
  } | null>(null);
  const listGestureClickRef = useRef<((e: React.MouseEvent, id: string) => void) | null>(null);
  const [columnDrag, setColumnDrag] = useState<{ sourceId: ListColumnId; overId: ListColumnId | null; overSide: 'before' | 'after' } | null>(null);
  const columnResizeActiveRef = useRef(false);
  const columnHeaderPressRef = useRef<{ colId: ListColumnId; x: number; y: number; moved: boolean } | null>(null);
  const [columnPicker, setColumnPicker] = useState<{ x: number; y: number } | null>(null);
  const [renamingFavoritePath, setRenamingFavoritePath] = useState<string | null>(null);
  const [favoriteDrag, setFavoriteDrag] = useState<{ sourcePath: string; overPath: string | null } | null>(null);
  const [breadcrumbDropTarget, setBreadcrumbDropTarget] = useState<string | null>(null);
  const [navTreeFileDropTarget, setNavTreeFileDropTarget] = useState<string | null>(null);
  const nativeOleDragRef = useRef(false);
  const suppressRowClickRef = useRef(false);

  // File Operations State
  const [conflict, setConflict] = useState<{ opId: string, fileName: string, srcPath: string, destPath: string } | null>(null);

  // Omni-Filter State
  const [filterText, setFilterText] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<any[] | null>(null);
  const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false);
  const [globalSearchEngine, setGlobalSearchEngine] = useState<'everything' | 'indexed' | null>(null);
  const omniFilterRef = useRef<HTMLInputElement>(null);
  const paneScrollSyncRef = useRef(false);
  const tabsetAutosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredTabsetRef = useRef(false);
  const dualPaneInitRef = useRef(false);
  const startColumnResize = (colId: ListColumnId, startX: number, headerEl: HTMLElement) => {
    columnResizeActiveRef.current = true;
    const startWidth = headerEl.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(56, Math.min(520, startWidth + (ev.clientX - startX)));
      updateConfig({
        listColumnWidths: { ...(config.listColumnWidths || {}), [colId]: Math.round(next) },
      });
    };
    const onUp = () => {
      columnResizeActiveRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const runUndoRedo = React.useCallback(async (redo = false) => {
    const fileOps = buildFileOpsRuntime(config);
    if (!fileOps.logActions) {
      pushToast({ kind: 'warning', title: redo ? 'Redo' : 'Undo', message: 'Enable action log in Settings → Undo & Action Log.' });
      return;
    }
    if (fileOps.useNativeEngine && !(redo ? canRedo : canUndo)) {
      pushToast({
        kind: 'warning',
        title: redo ? 'Redo' : 'Undo',
        message: 'The Windows shell engine does not log new actions. Switch to the BNDZ engine in Settings → File Operations to record undoable operations.',
      });
      return;
    }
    const needsPrompt =
      fileOps.promptUndoRedo === 'always'
      || (fileOps.promptUndoRedo === 'if_old' && lastActionUtcRef.current
        && (Date.now() - Date.parse(lastActionUtcRef.current)) > 10 * 60 * 1000);
    if (needsPrompt) {
      const approved = await confirm({
        title: redo ? 'Redo last action?' : 'Undo last action?',
        message: redo ? 'Re-apply the last undone file operation.' : 'Reverse the last file operation.',
        type: 'warning',
        confirmLabel: redo ? 'Redo' : 'Undo',
      });
      if (!approved) return;
    }
    const toastId = `undo-${Date.now()}`;
    pushToast({ id: toastId, kind: 'progress', title: redo ? 'Redoing…' : 'Undoing…', message: 'Please wait', sticky: true });
    try {
      const r = redo ? await executeRedoWithTimeout() : await executeUndoWithTimeout();
      dismissToast(toastId);
      if (r.ok) {
        refreshPathsForPanes();
        const pane = panes.find(p => p.id === activePaneId);
        const tab = pane?.tabs[pane.activeTabIndex ?? 0];
        if (tab?.path) await refetchPath(tab.path);
      }
      pushToast({ kind: r.ok ? 'success' : 'warning', title: r.ok ? (redo ? 'Redo' : 'Undo') : 'Failed', message: r.message });
    } catch (err: any) {
      dismissToast(toastId);
      pushToast({ kind: 'error', title: redo ? 'Redo failed' : 'Undo failed', message: err?.message || 'Operation timed out or was interrupted.' });
    }
  }, [activePaneId, panes, refetchPath, refreshPathsForPanes, config, confirm, canRedo, canUndo]);

  // Trigger Global Search
  useEffect(() => {
     if (config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ')) {
         const query = filterText.trimStart().substring(2).trim();
         if (query.length > 0) {
             setIsGlobalSearchLoading(true);
             const timer = setTimeout(() => {
                 const activePane = panes.find(p => p.id === activePaneId) || panes[0];
                 const tabPath = activePane?.tabs[activePane.activeTabIndex]?.path || '';
                 const args = buildGlobalSearchArgs(config, query, indexedSearchScope, tabPath);

                 import('../lib/ipcBridge').then(({ IPC }) =>
                   IPC.performGlobalSearch(
                     args.query, args.limit, args.useRegex, args.rootPath,
                     args.useEverything, args.searchContent, args.opts,
                   ).then(({ items, engine }) => {
                     setGlobalSearchResults(normalizeSearchResults(items));
                     setGlobalSearchEngine(engine === 'everything' || engine === 'indexed+everything' ? 'everything' : 'indexed');
                     setIsGlobalSearchLoading(false);
                   }).catch(() => {
                     setGlobalSearchResults([]);
                     setGlobalSearchEngine(null);
                     setIsGlobalSearchLoading(false);
                   }),
                 );
             }, 300);
             return () => clearTimeout(timer);
         } else {
             setGlobalSearchResults(null);
             setIsGlobalSearchLoading(false);
         }
     } else {
         setGlobalSearchResults(null);
         setGlobalSearchEngine(null);
         setIsGlobalSearchLoading(false);
     }
  }, [filterText, config.enableGlobalSearchPrefix, config.enableEverythingSearch, config.enableBndzIndexedSearch, config.enableSmartBooleanQueryParsing, config.searchFileContent, config.globalSearchLimit, panes, activePaneId, indexedSearchScope]);

  // Restore last tabset on startup (XYplorer tabsets++)
  useEffect(() => {
    if (restoredTabsetRef.current) return;
    if (config.restoreLastTabsetOnStartup === false || !config.lastActiveTabsetId) return;
    const ts = (config.savedTabsets || []).find(t => t.id === config.lastActiveTabsetId);
    if (ts?.panes?.length) {
      restoredTabsetRef.current = true;
      const restored = (ts.panes as PaneState[]).map(pane => ({
        ...pane,
        tabs: pane.tabs.map(tab => ({
          ...tab,
          viewMode: tab.viewMode === 'details' ? undefined : tab.viewMode,
        })),
      }));
      setPanes(restored);
      setIsDualPane(restored.length > 1);
    }
  }, [config.restoreLastTabsetOnStartup, config.lastActiveTabsetId, config.savedTabsets]);

  // Restore dual pane when no tabset was loaded but user had it open last session
  useEffect(() => {
    if (dualPaneInitRef.current || restoredTabsetRef.current) return;
    if (config.restoreLastTabsetOnStartup !== false && config.lastActiveTabsetId) return;
    dualPaneInitRef.current = true;
    if (!config.dualPaneOpen || isDualPane || panes.length > 1) return;
    setPanes([
      panes[0],
      {
        id: `pane-${Date.now()}`,
        tabs: [{ id: `t-${Date.now()}`, path: '/workspace', history: ['/workspace'], historyIndex: 0, selectedItems: [], viewMode: undefined }],
        activeTabIndex: 0,
        sortColumn: 'name',
        sortDirection: 'asc',
      },
    ]);
    setIsDualPane(true);
  }, [config.dualPaneOpen, config.restoreLastTabsetOnStartup, config.lastActiveTabsetId, config.defaultViewMode, isDualPane, panes]);

  // Auto-save tabset on workspace changes
  useEffect(() => {
    if (config.autoSaveTabsetsOnSwitch === false) return;
    if (tabsetAutosaveRef.current) clearTimeout(tabsetAutosaveRef.current);
    tabsetAutosaveRef.current = setTimeout(() => {
      const autosave = { id: '__autosave__', name: '(Auto-save)', panes: JSON.parse(JSON.stringify(panes)) };
      const rest = (config.savedTabsets || []).filter(t => t.id !== '__autosave__');
      updateConfig({ savedTabsets: [...rest, autosave], lastActiveTabsetId: '__autosave__' });
    }, 900);
    return () => { if (tabsetAutosaveRef.current) clearTimeout(tabsetAutosaveRef.current); };
  }, [panes, isDualPane, config.autoSaveTabsetsOnSwitch]);

  // Focus trap for F2 rename shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (!isInput && matchesShortcut(e, keyboardMap.commandPalette)) {
         e.preventDefault();
         setIsCommandPaletteOpen(prev => !prev);
      }
      if (!isInput && keyboardMap.search && matchesShortcut(e, keyboardMap.search)) {
         e.preventDefault();
         omniFilterRef.current?.focus();
      }
      // Quick Look overlay (Space) — Spacedrive QuickPreview pattern, BNDZ-native
      if (!isInput && e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
         const activePane = panes.find(p => p.id === activePaneId);
         const tab = activePane?.tabs[activePane.activeTabIndex];
         if (tab && (tab.selectedItems.length > 0 || focusedItemId)) {
            e.preventDefault();
            setQuickPreviewIndex(quickPreviewStartIndex);
            setQuickPreviewOpen(true);
         }
      }
      // FilePilot inspector toggle (rebindable, default Ctrl+I)
      if (!isInput && matchesShortcut(e, keyboardMap.inspector)) {
         e.preventDefault();
         setIsPreviewPanelOpen(prev => {
           const next = !prev;
           updateConfig({ previewPanelOpen: next });
           return next;
         });
      }
      if (!isInput && matchesShortcut(e, keyboardMap.refresh)) {
         e.preventDefault();
         const pane = panes.find(p => p.id === activePaneId);
         const tab = pane?.tabs[pane.activeTabIndex];
         if (tab && isFindingTab(tab) && tab.findingQuery) {
           void refreshFindingTabRef.current(activePaneId, tab.id, tab.findingQuery, tab.findingRoot || tab.path, tab);
         } else if (tab?.path) {
           void refetchPath(tab.path);
         }
         setToastMessage('Refreshed.');
      }
      if (!isInput && matchesShortcut(e, keyboardMap.undo)) {
         e.preventDefault();
         void runUndoRedo(false);
      }
      if (!isInput && (matchesShortcut(e, keyboardMap.redo) || matchesShortcut(e, 'Ctrl+Shift+Z'))) {
         e.preventDefault();
         void runUndoRedo(true);
      }

      // Cut / Copy intercept (rebindable)
      const isCutShortcut = matchesShortcut(e, keyboardMap.cut);
      if (!isInput && (matchesShortcut(e, keyboardMap.copy) || isCutShortcut)) {
          const activePane = panes.find(p => p.id === activePaneId);
          const tab = resolvePaneTab(activePane);
          if (tab && tab.selectedItems.length > 0) {
                 const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
                 const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id)).map((x: any) => ({
                    id: x.id,
                    name: x.name,
                    path: x.path || undefined, // Support visual search results
                    type: x.type
                 }));
                 if (selectedEntities.length > 0) {
                     setClipboardState(
                       selectedEntities.map((ent: any) => joinPanePath(tab.path, ent)),
                       isCutShortcut ? 'cut' : 'copy'
                     );
                 }
              }
      }

      if (!isInput && matchesShortcut(e, keyboardMap.paste)) {
          const activePane = panes.find(p => p.id === activePaneId);
          const tab = resolvePaneTab(activePane);
          if (tab) executePaste(tab.path);
      }

      // Open focused/selected directory in the opposite pane (rebindable, default Alt+P)
      if (!isInput && matchesShortcut(e, keyboardMap.openInNewPane)) {
          const activePane = panes.find(p => p.id === activePaneId);
          const tab = activePane?.tabs[activePane.activeTabIndex];
          if (tab) {
              const targetId = focusedItemId || tab.selectedItems[0];
              const entity = (safeGetDirContents(fileSystem, tab.path) || []).find((x: any) => x.id === targetId);
              if (entity && entity.type === 'directory') {
                  e.preventDefault();
                  openFolderInOppositePane(joinPanePath(tab.path, entity), activePaneId);
              }
          }
      }

      // Smart Tools agent (Ctrl+Shift+A)
      if (!isInput && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSmartToolsTab('assistant');
        setIsSmartToolsOpen(true);
      }

      // Inline rename — list item or pinned Rapid access favorite label
      if (!isInput && matchesShortcut(e, keyboardMap.rename) && !isToolbarConfigOpen && !isSmartToolsOpen) {
         const activePane = panes.find(p => p.id === activePaneId);
         const tab = activePane?.tabs[activePane?.activeTabIndex ?? 0];
         if (tab?.path) {
           const normPath = normalizePanePath(tab.path);
           const pinned = (config.pinnedFavorites || []).find(
             (p: any) => normalizePanePath(p.path) === normPath,
           );
           if (pinned) {
             e.preventDefault();
             setRenamingFavoritePath(normPath);
             return;
           }
         }
         if (focusedItemId && activePane) {
           e.preventDefault();
           const tab = resolvePaneTab(activePane);
           if (!tab) return;
           const entity = safeGetDirContents(fileSystem, tab.path)?.find((x: any) => x.id === focusedItemId);
           if (entity) {
             beginInlineRename(tab.path, focusedItemId, entity);
           }
         }
      }

      // Alt+Enter — properties (Explorer standard)
      if (!isInput && e.altKey && e.key === 'Enter') {
         e.preventDefault();
         const activePane = panes.find(p => p.id === activePaneId);
         const tab = activePane?.tabs[activePane.activeTabIndex];
         if (tab && tab.selectedItems.length > 0) {
           const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
           const paths = tab.selectedItems.map(id => {
             const ent = dirContents.find((x: any) => x.id === id);
             return ent ? toWindowsPath(joinPanePath(tab.path, ent)) : null;
           }).filter(Boolean) as string[];
           if (paths.length) {
             import('../lib/ipcBridge').then(({ IPC }) =>
               IPC.executeContextMenuVerb(paths.length === 1 ? paths[0] : paths, 'properties'),
             );
           }
         }
      }

      // Ctrl+Shift+N — new folder
      if (!isInput && matchesShortcut(e, keyboardMap.newFolder)) {
         e.preventDefault();
         const activePane = panes.find(p => p.id === activePaneId);
         const tab = activePane?.tabs[activePane.activeTabIndex];
         if (tab?.path) {
           import('../lib/ipcBridge').then(({ IPC }) =>
             IPC.executeFsOperation(`new-folder-${Date.now()}`, 'create-dir', joinPanePathForFs(tab.path, 'New folder'), '', false, 'New folder'),
           );
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedItemId, panes, activePaneId, fileSystem, isToolbarConfigOpen, isSmartToolsOpen, setClipboardState, executePaste, keyboardMap, config, config.pinnedFavorites, refetchPath, beginInlineRename]);

  // Context Menu State
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, entityId: string | null, path: string, entityName: string | null, entityExtension?: string | null, isDirectory: boolean, surface?: ContextMenuSurface, nativeContextItems?: any[], selectedPaths?: string[] } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; paneId: string; tabIndex: number } | null>(null);

  useContextMenuDismissOnLeave(!!contextMenu, () => setContextMenu(null));
  useContextMenuDismissOnLeave(!!tabContextMenu, () => setTabContextMenu(null));

  const handleContextMenuRequest = (
    e: React.MouseEvent,
    targetPath: string,
    entityId: string | null,
    isDirectory: boolean,
    entityName: string | null,
    selectedPaths?: string[],
    surface?: ContextMenuSurface,
    entityExtension?: string | null,
  ) => {
      e.preventDefault();
      e.stopPropagation();
      const requestId = ++contextMenuRequestRef.current;
      setLastClickData(null);
      setInlineRename(null);
      contextMenuBlockRef.current = true;
      suppressNavClickUntilRef.current = Date.now() + 500;
      setTimeout(() => { contextMenuBlockRef.current = false; }, 500);

      const menuItemPath = entityId && entityName
          ? (selectedPaths?.length ? selectedPaths[0] : joinPanePath(targetPath, { name: entityName }))
          : targetPath;
      const winPath = toWindowsPath(menuItemPath);

      setContextMenu({
          x: e.clientX,
          y: e.clientY,
          entityId,
          path: targetPath,
          entityName,
          entityExtension,
          isDirectory,
          surface,
          nativeContextItems: [],
          selectedPaths
      });

      void import('../lib/nativeContextMenuCache').then(({ getCachedNativeContextMenu, setCachedNativeContextMenu }) => {
        if (requestId !== contextMenuRequestRef.current) return;
        const cachedNative = getCachedNativeContextMenu(winPath) as any[] | null;
        if (cachedNative?.length) {
          setContextMenu(prev => (requestId === contextMenuRequestRef.current && prev)
            ? { ...prev, nativeContextItems: cachedNative }
            : prev);
        }
      });

      const shellRt = settingsRt.shell;
      const needNative = !shellRt.useCustomContextMenu || shellRt.enableSubmenus;
      if (!needNative) return;

      const runFetch = () => {
        void (async () => {
          try {
            const { IPC } = await import('../lib/ipcBridge');
            const { setCachedNativeContextMenu } = await import('../lib/nativeContextMenuCache');
            const nativeItems = await IPC.fetchNativeContextMenuItems(winPath);
            if (requestId !== contextMenuRequestRef.current) return;
            if (nativeItems?.length) setCachedNativeContextMenu(winPath, nativeItems);
            setContextMenu(prev => (requestId === contextMenuRequestRef.current && prev)
              && nativeContextSignature(prev.nativeContextItems) !== nativeContextSignature(nativeItems)
              ? { ...prev, nativeContextItems: nativeItems }
              : prev);
          } catch (err) {
            console.error("Failed to fetch native context menu items", err);
          }
        })();
      };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(runFetch, { timeout: 400 });
      } else {
        setTimeout(runFetch, 0);
      }
  };

  const guardedSetCurrentPath = (p: string) => {
      if (Date.now() < suppressNavClickUntilRef.current) return;
      setCurrentPath(p);
  };
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const dragTargetIdRef = useRef<string | null>(null);
  const setDragTargetHighlight = (id: string | null) => {
    if (dragTargetIdRef.current === id) return;
    dragTargetIdRef.current = id;
    setDragTargetId(id);
  };
  const handleDeleteRequest = (items: any[], path: string, isFromTree: boolean = false, options?: { permanent?: boolean }) => {
    if (items.length === 0) return;
    const rt = buildSettingsRuntime(config);
    const bypassRecycle = options?.permanent ? true : rt.shell.bypassRecycle;

    if (isFromTree && config.disallowDeleteByKeyInFolderTree) return;

    const executeDelete = () => {
      const normPath = normalizePanePath(path);
      const winPaths = items.map(entity =>
        toWindowsPath(entity.path || joinPanePath(path, { name: entity.name })),
      );
      const label = items.length === 1 ? items[0].name : `${items.length} items`;
      const opId = `delete-${Date.now()}`;
      const deletedIds = new Set(items.map(i => i.id).filter(Boolean));
      const deletedNames = new Set(items.map(i => i.name));

      setPanes(prev => prev.map(p => ({
        ...p,
        tabs: p.tabs.map((t, i) => i !== p.activeTabIndex ? t : {
          ...t,
          selectedItems: t.selectedItems.filter(id => !deletedIds.has(id)),
        }),
      })));
      setPathContentsCache(prev => {
        const existing = prev[normPath];
        if (!existing) return prev;
        return setPathCacheEntry(prev, normPath, existing.filter((e: any) => !deletedNames.has(e.name)));
      });

      xferMetaRef.current.set(opId, { op: 'delete', label });
      pushToast({
        id: `xfer-${opId}`,
        kind: 'progress',
        title: 'Deleting…',
        message: label,
        sticky: true,
      });
      IPC.executeFsOperation(opId, 'delete', winPaths, '', bypassRecycle, label, 'high');
    };

    const names = items.map(x => x.name).slice(0, 5).join('\n• ');
    const confirmMsg = items.length === 1
      ? `${options?.permanent ? 'Permanently remove' : 'Delete'} "${items[0].name}"?${bypassRecycle ? '\n\n(Bypassing Recycle Bin)' : '\n\nItems will be moved to the Recycle Bin.'}`
      : `${options?.permanent ? 'Permanently delete' : 'Delete'} ${items.length} items?${bypassRecycle ? '\n\n(Bypassing Recycle Bin)' : '\n\nItems will be moved to the Recycle Bin.'}\n\n• ${names}${items.length > 5 ? '\n• ...' : ''}`;

    // Skip confirmation when suppressed in File Operations or explicitly disabled in Shell settings
    if (config.suppressDeleteConfirmationDialog || config.confirmDeleteOperations === false) {
      executeDelete();
      return;
    }

    showModal({
      type: 'destructive',
      title: items.length === 1 ? 'Delete Item' : `Delete ${items.length} Items`,
      message: confirmMsg,
      neverShowAgain: {
        label: "Don't ask again",
        onConfirm: () => updateConfig({ confirmDeleteOperations: false }),
      },
      actions: [
        { label: items.length === 1 ? 'Delete' : `Delete ${items.length} Items`, style: 'destructive', action: executeDelete },
        { label: 'Cancel', style: 'secondary', action: () => {} }
      ]
    });
  };

  const handleDeletePaths = (paths: string[]) => {
    if (!paths.length) return;
    if (isRecycleBinPath(currentPath)) {
      void (async () => {
        const { IPC } = await import('../lib/ipcBridge');
        const result = await IPC.purgeRecycleItems(paths);
        if (result.purged > 0) {
          setToastMessage(
            result.failed > 0
              ? `Permanently deleted ${result.purged} item(s); ${result.failed} could not be deleted.`
              : `Permanently deleted ${result.purged} item(s).`,
            result.failed > 0 ? 'warning' : 'success',
          );
        } else {
          setToastMessage('Could not permanently delete the selected item(s).', 'warning', 'Delete failed');
        }
        void refetchPath(currentPath);
      })();
      return;
    }
    const items = paths.map(p => ({ name: p.split(/[/\\]/).pop() || p, path: p }));
    handleDeleteRequest(items, paths[0].substring(0, Math.max(paths[0].lastIndexOf('/'), paths[0].lastIndexOf('\\'))) || currentPath);
  };

  const handleEmptyRecycleBin = () => {
    showModal({
      type: 'destructive',
      title: 'Empty Recycle Bin',
      message: 'Permanently delete all items in the Recycle Bin?\n\nThis cannot be undone.',
      actions: [
        {
          label: 'Empty Recycle Bin',
          style: 'destructive',
          action: () => {
            import('../lib/ipcBridge').then(({ IPC }) => {
              IPC.emptyRecycleBin().then(result => {
                if (result?.success) {
                  setToastMessage('Recycle Bin emptied.');
                  refreshWorkspace();
                } else {
                  setToastMessage('Could not empty Recycle Bin.');
                }
              });
            });
          },
        },
        { label: 'Cancel', style: 'secondary', action: () => {} },
      ],
    });
  };

  const refreshWorkspace = () => {
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getSystemDrives().then(setDrives);
      IPC.getCloudProviders().then(setCloudProviders);
      refreshPathsForPanes();
      IPC.refreshWorkspace().catch(() => {});
    });
  };

  useEffect(() => {
    if (config.showTopMenubar === false) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const key = e.key.toLowerCase();
      const map: Record<string, string> = {
        f: 'File', e: 'Edit', v: 'View', g: 'Go', t: 'Tools',
        a: 'Favorites', u: 'User', s: 'Scripting', p: 'Panes', b: 'Tabsets',
        w: 'Window', h: 'Help',
      };
      const menuId = map[key];
      if (!menuId) return;
      e.preventDefault();
      setOpenMenuId(menuId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config.showTopMenubar]);

  useEffect(() => {
    const handleDismiss = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-bndz-context-menu], [data-bndz-submenu-flyout], [data-bndz-tab-context-menu], [data-bndz-menubar-menu]')) return;
      if (menubarRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
      setTabContextMenu(null);
      setOpenMenuId(null);
      setColumnPicker(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setTabContextMenu(null);
        setOpenMenuId(null);
        setColumnPicker(null);
      }
    };
    document.addEventListener('click', handleDismiss);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', handleDismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const activePaneIndex = panes.findIndex(p => p.id === activePaneId);
  const activePane = panes[activePaneIndex] || panes[0];
  const activeTab: TabState = activePane?.tabs[activePane.activeTabIndex] ?? {
    id: 'fallback', path: '/', history: ['/'], historyIndex: 0, selectedItems: [],
  };
  const currentPath = activeTab.path;

  const miniTreeNodes = useMemo(
    () => buildMiniTreeFromVisits(config.navigationHistory || []),
    [config.navigationHistory],
  );

  const addressSuggestions = useMemo(() => {
    if (!editingAddressBarPaneId) return [];
    const pathCandidates = (shortcuts || [])
      .filter((s): s is { name?: string; path: string } => !!s.path)
      .map(s => ({ path: s.path, label: s.name }));
    return buildPathSuggestions(addressBarInput, {
      visits: config.navigationHistory,
      favorites: config.pinnedFavorites,
      pathCandidates,
    });
  }, [editingAddressBarPaneId, addressBarInput, config.navigationHistory, config.pinnedFavorites, shortcuts]);

  const selectionSummaryLine = useMemo(() => {
    if (!activeTab.selectedItems?.length) return '';
    const items = pathContentsCache[currentPath] || [];
    const selected = items.filter((x: any) => activeTab.selectedItems.includes(x.id));
    if (!selected.length) return '';
    return formatSelectionSummaryLine(summarizeSelection(selected), formatSize);
  }, [activeTab.selectedItems, currentPath, pathContentsCache]);

  useEffect(() => {
    const template = config.unwiredConfig13;
    if (template) {
      document.title = renderTitleBarTemplate(String(template), {
        path: activeTab.path,
        app: 'BNDZ',
        ver: appVersion,
        selection: selectionSummaryLine,
      }) || 'BNDZ';
    } else {
      document.title = 'BNDZ';
    }
  }, [config.unwiredConfig13, activeTab.path, appVersion, selectionSummaryLine]);

  const statusBarFreeLabel = useMemo(() => {
    const totalCap = drives.reduce((s, d) => s + (d.totalSpace || 0), 0);
    const totalFree = drives.reduce((s, d) => s + (d.freeSpace || 0), 0);
    const pctFree = totalCap > 0 ? Math.round((totalFree / totalCap) * 100) : 0;
    return `${formatSize(totalFree)} free (${pctFree}%)`;
  }, [drives]);

  const statusBarClipboardLabel = useMemo(() => describeClipboardState(clipboard) || '', [clipboard]);

  const listIconSz = config.listIconSize ?? 16;
  const gridIconSz = config.gridIconSize ?? 48;
  const gridMetrics = useMemo(() => gridTileMetrics(gridIconSz), [gridIconSz]);
  const listMetrics = useMemo(() => listTileMetrics(listIconSz), [listIconSz]);

  // Auto-select first item when entering a folder (settings: autoSelectFirstItem)
  useEffect(() => {
    if (!settingsRt.list.autoSelectFirst) return;
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const items = pathContentsCache[currentPath];
    if (!items?.length) return;
    setFocusedItemId(prev => prev ?? items[0].id);
  }, [currentPath, pathContentsCache, config.autoSelectFirstItem]);

  const scanCurrentFolderSizes = React.useCallback((
    forceRescan = false,
    opts?: { batchOffset?: number; manual?: boolean },
  ) => {
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const items = pathContentsCache[currentPath];
    if (!items?.length) return;

    const FOLDER_SIZE_BATCH = 30;
    const batchOffset = opts?.batchOffset ?? 0;
    const allDirs = items
      .filter((e: any) => e.type === 'directory' || e.type === 'folder')
      .map((e: any) => toWindowsPath(joinPanePath(currentPath, e)));
    const dirs = allDirs.slice(batchOffset, batchOffset + FOLDER_SIZE_BATCH);

    if (!allDirs.length) {
      if (batchOffset === 0) setToastMessage('No folders to scan in the current directory.', 'info');
      return;
    }
    if (!dirs.length) return;

    if (batchOffset === 0) folderSizeSessionScannedRef.current = 0;

    const gen = ++folderSizeScanGen.current;
    setFolderSizeSync({
      active: true,
      current: Math.min(batchOffset, allDirs.length),
      total: allDirs.length,
      path: '',
      percent: allDirs.length ? Math.round((batchOffset / allDirs.length) * 100) : 0,
    });

    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.scanFolderSizes(dirs, forceRescan).then(result => {
        if (folderSizeScanGen.current !== gen) return;
        const next: Record<string, number> = {};
        for (const [p, size] of Object.entries(result.sizes || {})) {
          if (typeof size === 'number' && size >= 0) next[p.toLowerCase()] = size;
        }
        setFolderSizeMap(prev => ({ ...prev, ...next }));
        folderSizeSessionScannedRef.current += result.scannedCount ?? 0;

        const hasMore = !result.cancelled && batchOffset + FOLDER_SIZE_BATCH < allDirs.length;
        if (hasMore) {
          scanCurrentFolderSizes(forceRescan, { batchOffset: batchOffset + FOLDER_SIZE_BATCH, manual: opts?.manual });
          return;
        }

        setFolderSizeSync(prev => prev ? {
          ...prev,
          active: false,
          current: allDirs.length,
          total: allDirs.length,
          percent: result.cancelled ? prev.percent : 100,
        } : null);

        if (!result.cancelled) {
          const scanned = folderSizeSessionScannedRef.current;
          const onlyFetched = config.folderSizeToastOnlyWhenFetched !== false;
          if (scanned > 0 || !onlyFetched) {
            const cooldownMs = (config.folderSizeToastCooldownSeconds ?? 90) * 1000;
            const now = Date.now();
            const manual = !!opts?.manual;
            const allowToast = manual || (scanned > 0 && now - folderSizeToastCooldownRef.current >= cooldownMs);
            if (allowToast && (!onlyFetched || scanned > 0)) {
              folderSizeToastCooldownRef.current = now;
              const label = scanned > 0
                ? `${scanned} folder${scanned === 1 ? '' : 's'} calculated`
                : `${Object.keys(next).length} folder size${Object.keys(next).length === 1 ? '' : 's'} from cache`;
              setToastMessage(label, 'success', 'Folder sizes', { native: scanned > 0 });
            }
          }
        }
      }).catch(() => setFolderSizeSync(null));
    });
  }, [currentPath, pathContentsCache, config.folderSizeToastCooldownSeconds, config.folderSizeToastOnlyWhenFetched, setToastMessage]);

  const currentDirItems = pathContentsCache[currentPath];

  useEffect(() => {
    if (config.showCachedFolderSizesOnly) return;
    if (config.autoSyncFolderSizes === false && !config.alwaysShowFolderSizes) return;
    if (!currentDirItems?.length) return;
    const timer = window.setTimeout(() => scanCurrentFolderSizes(false), 400);
    return () => clearTimeout(timer);
  }, [currentPath, currentDirItems, config.alwaysShowFolderSizes, config.autoSyncFolderSizes, config.showCachedFolderSizesOnly, scanCurrentFolderSizes]);

  useEffect(() => {
    if (!config.cacheFolderSizes) return;
    if (config.alwaysShowFolderSizes && !config.showCachedFolderSizesOnly) return;
    if (!currentDirItems?.length) return;
    const timer = window.setTimeout(() => scanCurrentFolderSizes(false), 800);
    return () => clearTimeout(timer);
  }, [currentPath, currentDirItems, config.cacheFolderSizes, config.alwaysShowFolderSizes, config.showCachedFolderSizesOnly, scanCurrentFolderSizes]);

  // --- External File System Watcher ---
  useEffect(() => {
    let unsubscribe: () => void;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsubscribe = IPC.onFsEvents((events) => {
        const rt = buildSettingsRuntime(config);
        const shouldRefresh = rt.operations.autoRefresh !== false && rt.operations.fsNotifications !== false;
        if (shouldRefresh) {
          const touched = new Set<string>();
          for (const ev of events) {
            const panePath = watcherDirToPanePath(ev.dir || '');
            if (panePath) touched.add(panePath);
          }
          touched.forEach(p => invalidatePath(p));
        }
        setFileSystem(prevFs => {
          let newFs = prevFs;
          for (const ev of events) {
            const vPath = ev.dir.replace(/\\/g, '/');
            newFs = updateFileSystem(newFs, vPath, (dir) => {
              if (ev.type === 'Created' && !dir.children[ev.name]) {
                const isFile = ev.name.includes('.');
                dir.children[ev.name] = {
                  id: `${vPath}/${ev.name}`,
                  name: ev.name,
                  type: isFile ? 'file' : 'directory',
                  size: isFile ? 1024 : 0,
                  modified: new Date().toISOString(),
                  tags: [],
                  ...(isFile ? { extension: ev.name.split('.').pop() } : { children: {} })
                } as any;
              } else if (ev.type === 'Deleted') {
                delete dir.children[ev.name];
              } else if (ev.type === 'Renamed' && ev.oldName) {
                const node = dir.children[ev.oldName];
                if (node) {
                  dir.children[ev.name] = { ...node, name: ev.name };
                  delete dir.children[ev.oldName];
                }
              }
            });
          }
          return newFs;
        });
      });
    });
    return () => unsubscribe && unsubscribe();
  }, [config, panes]);

  // Monitor paths when panes change to fire native FileSystemWatcher
  useEffect(() => {
    import('../lib/ipcBridge').then(({ IPC }) => {
       panes.forEach(p => {
          p.tabs.forEach(t => {
            const path = normalizePanePath(t.path);
            if (path && path !== '/' && path !== '/this-pc') {
               IPC.watchDirectory(path);
            }
          });
       });
    });
  }, [panes]);

  const refreshPathsRef = React.useRef(refreshPathsForPanes);
  refreshPathsRef.current = refreshPathsForPanes;

  // Operations Progress and Conflict Listeners
  useEffect(() => {
    let unsubProp: () => void;
    let unsubConf: () => void;
    let unsubElev: () => void;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsubProp = IPC.onProgress((progressDetails) => {
        const pct = progressDetails.percentage ?? 0;
        const opId = progressDetails.operationId as string;
        if (!opId || opId.startsWith('folder-size') || opId.startsWith('index-')) return;

        // A backend error must never be reported as a success toast just because it also
        // happened to carry percentage=100/0 — check explicitly before any pct-based branch.
        if (progressDetails.error) {
          dismissToast(`xfer-${opId}`);
          xferMetaRef.current.delete(opId);
          const failVerb = opId.startsWith('archive-') ? 'Compression failed'
            : opId.startsWith('extract-') ? 'Extraction failed'
            : 'Operation failed';
          pushToast({ kind: 'error', title: failVerb, message: String(progressDetails.error) });
          return;
        }

        const meta = xferMetaRef.current.get(opId);
        const fileName = (progressDetails.currentFile || '').split(/[/\\]/).pop() || meta?.label || 'items';
        const isArchiveOp = opId.startsWith('archive-');
        const isExtractOp = opId.startsWith('extract-');
        const verb = isArchiveOp ? 'Compressing' : isExtractOp ? 'Extracting'
          : meta?.op === 'delete' ? 'Deleting'
          : meta?.op === 'move' ? 'Moving' : meta?.op === 'copy' ? 'Copying' : 'Transferring';
        const doneVerb = isArchiveOp ? 'Archive created' : isExtractOp ? 'Extraction complete'
          : meta?.op === 'delete' ? 'Deleted'
          : meta?.op === 'move' ? 'Move complete' : meta?.op === 'copy' ? 'Copy complete' : 'Transfer complete';
        if (pct > 0 && pct < 100) {
          pushToast({
            id: `xfer-${opId}`,
            kind: 'progress',
            title: `${verb}…`,
            message: meta?.label || fileName,
            progress: pct,
            sticky: true,
          });
        }
        if (pct >= 100) {
           dismissToast(`xfer-${opId}`);
           xferMetaRef.current.delete(opId);
           pushToast({ kind: 'success', title: doneVerb, message: meta?.label || fileName });
           refreshPathsRef.current();
        }
      });
      unsubConf = IPC.onConflictContent((conflictDetails) => {
        if (config.autoIncrementFilenamesOnCollision) {
          void IPC.resolveConflict(
            conflictDetails.operationId,
            conflictDetails.fileName,
            'keepboth',
            true,
          );
          return;
        }
         showModal({
           type: 'conflict',
           title: 'File already exists',
           message: '',
           actions: [],
           conflict: {
             opId: conflictDetails.operationId,
             fileName: conflictDetails.fileName,
             sourcePath: conflictDetails.sourcePath,
             destPath: conflictDetails.destPath,
           },
           onConflictResolve: (resolution, applyToAll) => {
             void IPC.resolveConflict(
               conflictDetails.operationId,
               conflictDetails.fileName,
               resolution,
               applyToAll,
             );
           },
         });
      });
      unsubElev = IPC.onElevationRequired((payload) => {
        void (async () => {
          const { promptElevationIfNeeded } = await import('../lib/nativeDialog');
          await promptElevationIfNeeded(
            { success: false, needsElevation: true, message: payload.message },
            { title: payload.title, message: payload.message },
          );
        })();
      });
    });
    return () => {
       unsubProp && unsubProp();
       unsubConf && unsubConf();
       unsubElev && unsubElev();
    };
  }, [showModal, confirm, config.autoIncrementFilenamesOnCollision]);

  // --- Tree State Helpers ---
  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const buildFSTree = (node: FSEntity, path: string): any => {
    if (node.type !== "directory") return null;
    const isExpanded = expandedPaths.has(path);
    const childrenItems = Object.keys(node.children)
      .map(k => buildFSTree(node.children[k], `${path}/${k}`))
      .filter(Boolean);

    return {
      label: node.name,
      icon: 'folder_open_ui',
      iconColor: "#38bdf8",
      selected: currentPath === path,
      expanded: isExpanded,
      onClick: () => { setCurrentPath(path); },
      onToggle: () => toggleExpand(path),
      childrenItems
    };
  };

  // Resolve the actual Windows username for building correct quick-access paths
  const windowsUsername = useMemo(() => {
    // shortcuts come from C# which reads Environment.UserName - pick from any shortcut path
    const ds = shortcuts.find(s => s.path?.includes('\\') || s.path?.includes('/'));
    if (ds) {
      const parts = (ds.path || '').replace(/\\/g, '/').split('/');
      const usersIdx = parts.findIndex((p: string) => p.toLowerCase() === 'users');
      if (usersIdx >= 0 && parts[usersIdx + 1]) return parts[usersIdx + 1];
    }
    return 'Public'; // safe fallback
  }, [shortcuts]);

  const [thisPcExpanded, setThisPcExpanded] = useState(true);
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [linuxExpanded, setLinuxExpanded] = useState(false);
  const [librariesExpanded, setLibrariesExpanded] = useState(true);
  const [destinationPicker, setDestinationPicker] = useState<{ mode: 'copy' | 'move'; sources: string[] } | null>(null);
  const [draggedTab, setDraggedTab] = useState<{ paneId: string; index: number } | null>(null);
  const [tabDropIndicator, setTabDropIndicator] = useState<{ paneId: string; index: number; side: 'before' | 'after' } | null>(null);
  const [tabFileDropTarget, setTabFileDropTarget] = useState<{ paneId: string; tabIndex: number } | null>(null);
  const [newTabDropPaneId, setNewTabDropPaneId] = useState<string | null>(null);
  const tabFileDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabFileDragHoverRef = useRef<{ paneId: string; tabIndex: number } | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  const homeShortcut = shortcuts.find(s => s.name === 'Home');
  const galleryShortcut = shortcuts.find(s => s.name === 'Gallery');
  const homeTreePath = useMemo(() => {
    const p = homeShortcut?.path;
    if (p && !String(p).toLowerCase().includes('workspace')) return toPanePath(p);
    if (windowsUsername && windowsUsername !== 'Public') {
      return toPanePath(`C:/Users/${windowsUsername}`);
    }
    return '/shell:Profile';
  }, [homeShortcut, windowsUsername]);

  const libraryFolderItems = useMemo(() => {
    const order = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];
    const seen = new Set<string>();
    const items: { label: string; path: string; iconPath?: string; isDynamic: boolean; useShellIcon: boolean; icon: string; iconColor: string }[] = [];

    const add = (name: string, rawPath: string) => {
      const p = toPanePath(rawPath);
      if (seen.has(p)) return;
      seen.add(p);
      items.push({
        label: name,
        path: p,
        iconPath: KNOWN_FOLDER_SHELL[name],
        isDynamic: true,
        useShellIcon: true,
        icon: 'folder_open_ui',
        iconColor: '#38bdf8',
      });
    };

    for (const name of order) {
      const s = shortcuts.find(sc => sc.name === name);
      add(name, s?.path || `C:/Users/${windowsUsername}/${name}`);
    }
    if (galleryShortcut?.path) add('Gallery', galleryShortcut.path);
    return items;
  }, [shortcuts, windowsUsername, galleryShortcut]);

  const cloudDriveItems = useMemo(() => (
    [...cloudProviders]
      .sort((a, b) => {
        const aOd = a.name.toLowerCase().includes('onedrive');
        const bOd = b.name.toLowerCase().includes('onedrive');
        if (aOd && !bOd) return -1;
        if (bOd && !aOd) return 1;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map((p: CloudProvider) => ({
        label: p.name,
        path: toPanePath(p.path),
        isDynamic: true,
        useShellIcon: true,
        icon: 'cloud_ui',
        iconColor: p.syncStatus === 'online-only' ? '#fbbf24' : '#0078d4',
        syncStatus: p.syncStatus,
      }))
  ), [cloudProviders]);

  const wslRootNode = useMemo(
    () => networkNodes.find((n: { kind?: string; name?: string }) =>
      n.kind === 'wsl-root' || n.name === 'Linux (WSL)' || n.name === 'WSL (legacy)'),
    [networkNodes],
  );
  const wslDistroNodes = useMemo(
    () => networkNodes.filter((n: { kind?: string }) => n.kind === 'wsl-distro'),
    [networkNodes],
  );
  const networkOnlyNodes = useMemo(
    () => networkNodes.filter((n: { kind?: string; name?: string }) => {
      if (!config.detectPortableDevices && (n.kind === 'portable-device' || n.kind === 'portable-root')) return false;
      return n.kind !== 'network' && n.kind !== 'wsl-root' && n.kind !== 'wsl-distro' && n.kind !== 'wsl-legacy'
      && n.name !== 'Linux (WSL)' && n.name !== 'WSL (legacy)';
    }),
    [networkNodes, config.detectPortableDevices],
  );

  const wslLinuxPath = wslRootNode ? toPanePath(wslRootNode.path) : '//wsl.localhost/';

  const rapidAccessItems = useMemo(() => {
    const defaults = buildRapidAccessDefaults(
      windowsUsername,
      shortcuts,
      galleryShortcut?.path,
      config.hiddenRapidAccess || [],
      KNOWN_FOLDER_SHELL,
    );
    const pins = dedupePinnedFavorites(config.pinnedFavorites || []).map((p: any) => ({
      name: p.label || p.name,
      path: normalizePanePath(p.path),
      iconPath: p.iconPath,
      isDefault: false,
    }));
    return mergeRapidAccessItems(pins, defaults);
  }, [config.pinnedFavorites, config.hiddenRapidAccess, shortcuts, windowsUsername, galleryShortcut]);

  useEffect(() => {
    if (wslDistroNodes.length > 0) setLinuxExpanded(true);
  }, [wslDistroNodes.length]);

  const treeData = useMemo(() => {
    const raw: NavTreeBuildNode[] = [
      {
        treeKey: 'home',
        draggable: true,
        label: 'Home',
        path: homeTreePath,
        iconPath: KNOWN_FOLDER_SHELL.Home,
        icon: 'go_home',
        iconColor: '#6db4e6',
        isDynamic: true,
        useShellIcon: true,
        onClick: () => guardedSetCurrentPath(homeTreePath),
      },
      {
        treeKey: 'libraries',
        draggable: true,
        label: 'Libraries',
        path: '/shell:Libraries',
        iconPath: SHELL_CLSID.libraries,
        icon: 'folder_open_ui',
        iconColor: '#38bdf8',
        useShellIcon: true,
        onClick: () => setCurrentPath('/shell:Libraries'),
        expanded: librariesExpanded,
        onToggle: () => setLibrariesExpanded(!librariesExpanded),
        childrenItems: libraryFolderItems,
      },
      {
        treeKey: 'smart-views',
        draggable: true,
        label: 'Smart views',
        path: BNDZ_VIEWS_ROOT,
        icon: 'sparkles_ui',
        iconColor: '#0078d4',
        expanded: smartViewsExpanded,
        onClick: () => setCurrentPath(bndzVirtualPath('recent')),
        onToggle: () => setSmartViewsExpanded(!smartViewsExpanded),
        childrenItems: (['recent', 'media', 'large'] as const).map(view => ({
          label: bndzVirtualLabel(view),
          path: bndzVirtualPath(view),
          icon: view === 'recent' ? 'clock_ui' : view === 'media' ? 'film_ui' : 'hard_drive_ui',
          iconColor: '#0078d4',
        })),
      },
      {
        treeKey: 'this-pc',
        draggable: true,
        label: 'This PC',
        path: '/',
        iconPath: SHELL_CLSID.thisPc,
        icon: 'monitor_ui',
        iconColor: '#6db4e6',
        useShellIcon: true,
        expanded: thisPcExpanded,
        selected: currentPath === '/',
        onClick: () => setCurrentPath('/'),
        onToggle: () => setThisPcExpanded(!thisPcExpanded),
        childrenItems: drives.map(d => ({
          label: `${d.label || 'Local Disk'} (${d.name.replace(/^\//, '')})`,
          icon: 'hard_drive_ui',
          iconColor: d.name.includes('C:') ? '#6db4e6' : '#aaa',
          path: toPanePath(d.name),
          isDynamic: true,
          useShellIcon: true,
        })),
      },
      {
        treeKey: 'linux',
        draggable: true,
        label: 'Linux',
        path: wslLinuxPath,
        iconPath: wslLinuxPath,
        icon: 'server_ui',
        iconColor: '#34d399',
        isDynamic: true,
        useShellIcon: true,
        expanded: linuxExpanded,
        onClick: () => guardedSetCurrentPath(wslLinuxPath),
        onToggle: () => setLinuxExpanded(!linuxExpanded),
        childrenItems: wslDistroNodes.map((n: { name: string; path?: string }) => ({
          label: n.name,
          path: toPanePath(n.path),
          isDynamic: true,
          useShellIcon: true,
          icon: 'server_ui',
          iconColor: '#34d399',
        })),
      },
      {
        treeKey: 'network',
        draggable: true,
        label: 'Network',
        icon: 'go_network',
        iconColor: '#6db4e6',
        path: '//',
        iconPath: SHELL_CLSID.network,
        useShellIcon: true,
        isDynamic: true,
        expanded: networkExpanded,
        onClick: () => guardedSetCurrentPath('//'),
        onToggle: () => setNetworkExpanded(!networkExpanded),
        childrenItems: networkOnlyNodes.map((n: { name: string; path?: string }) => ({
          label: n.name,
          path: toPanePath(n.path || '//'),
          isDynamic: true,
          useShellIcon: true,
          icon: 'go_network',
          iconColor: '#0078d4',
        })),
      },
      {
        treeKey: 'recycle-bin',
        draggable: true,
        label: 'Recycle Bin',
        path: RECYCLE_BIN_PATH,
        iconPath: SHELL_CLSID.recycleBin,
        icon: 'trash_ui',
        iconColor: '#c084fc',
        useShellIcon: true,
        leaf: true,
        selected: isRecycleBinPath(currentPath),
        onClick: () => guardedSetCurrentPath(RECYCLE_BIN_PATH),
      },
    ];
    const keys = raw.map(n => n.treeKey).filter(Boolean) as string[];
    const order = mergeNavTreeOrder(config.navTreeOrder, keys);
    return applyNavTreeOrder(raw, order);
  }, [
    drives, currentPath, thisPcExpanded, libraryFolderItems,
    networkOnlyNodes, networkExpanded, homeTreePath, wslLinuxPath,
    wslRootNode, wslDistroNodes,
    linuxExpanded, librariesExpanded, smartViewsExpanded, config.navTreeOrder,
  ]);

  useEffect(() => {
    const items: Array<{ path: string; iconPath?: string }> = [];
    const walk = (nodes: typeof treeData) => {
      for (const n of nodes) {
        if (n.useShellIcon !== false && (n.iconPath || n.path)) {
          items.push({ path: n.path || '', iconPath: n.iconPath });
        }
        if (n.childrenItems?.length) {
          for (const c of n.childrenItems) {
            if (c.useShellIcon !== false && (c.iconPath || c.path)) {
              items.push({ path: c.path || '', iconPath: c.iconPath });
            }
          }
        }
      }
    };
    walk(treeData);
    if (items.length) void prefetchShellIconPaths(items);
  }, [treeData]);

  // --- Multi-pane Orchestration Logic ---
  const toggleDualPane = () => {
    if (config.dualPaneFeature === false) {
      setToastMessage('Dual pane is disabled in settings.');
      return;
    }
    if (isDualPane) {
       setPanes([activePane]);
       setIsDualPane(false);
       updateConfig({ dualPaneOpen: false });
    } else {
       setPanes([panes[0], { 
         id: `pane-${Date.now()}`, 
         tabs: [{ id: `t-${Date.now()}`, path: '/workspace', history: ['/workspace'], historyIndex: 0, selectedItems: [], viewMode: undefined }],
         activeTabIndex: 0,
         sortColumn: 'name',
         sortDirection: 'asc'
       }]);
       setIsDualPane(true);
       updateConfig({ dualPaneOpen: true });
    }
  };

  const openFolderInOppositePane = (folderPath: string, sourcePaneId: string) => {
    const norm = normalizePanePath(folderPath);
    const applyToOther = () => {
      setPanes(prev => {
        const other = prev.find(p => p.id !== sourcePaneId) ?? prev[1];
        if (!other) return prev;
        setActivePaneId(other.id);
        return prev.map(p => p.id === other.id ? {
          ...p,
          tabs: p.tabs.map((t, i) => i === p.activeTabIndex ? { ...t, path: norm, selectedItems: [] } : t),
        } : p);
      });
      setToastMessage('Opened in opposite pane.');
    };
    if (!isDualPane) {
      toggleDualPane();
      setTimeout(applyToOther, 0);
      return;
    }
    applyToOther();
  };

  const toggleViewLock = (paneId: string) => {
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const tabs = [...p.tabs];
      const tab = tabs[p.activeTabIndex];
      if (tab.viewLocked) {
        tabs[p.activeTabIndex] = { ...tab, viewLocked: false, lockedView: undefined };
        setToastMessage('View unlocked.');
      } else {
        tabs[p.activeTabIndex] = {
          ...tab,
          viewLocked: true,
          lockedView: {
            sortColumn: p.sortColumn,
            sortDirection: p.sortDirection,
            filterRegex: p.filterRegex,
            liveFilter: filterText,
            viewMode: tab.viewMode,
          },
        };
        setToastMessage('View locked — sort, filter, and columns frozen.');
      }
      return { ...p, tabs };
    }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (isInput) return;
      if (matchesShortcut(e, keyboardMap.dualPane)) {
        e.preventDefault();
        toggleDualPane();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardMap.dualPane, toggleDualPane]);

  const swapPanes = () => {
    if (!isDualPane || panes.length < 2) {
      setToastMessage('Enable dual pane first.');
      return;
    }
    setPanes([panes[1], panes[0]]);
    setActivePaneId(prev => (prev === panes[0].id ? panes[1].id : panes[0].id));
    setToastMessage('Panes swapped.');
  };

  const syncPanesToSamePath = () => {
    if (!isDualPane || panes.length < 2) {
      setToastMessage('Enable dual pane first.');
      return;
    }
    const srcPath = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.path;
    if (!srcPath) return;
    const other = panes.find(p => p.id !== activePaneId);
    if (other) setCurrentPath(srcPath, other.id);
    setToastMessage('Panes synced to same folder.');
  };

  const handlePaneScroll = (paneId: string, e: React.UIEvent<HTMLDivElement>) => {
    if (!isDualPane || config.syncDualPaneScroll === false) return;
    if (paneScrollSyncRef.current) return;
    paneScrollSyncRef.current = true;
    const top = e.currentTarget.scrollTop;
    document.querySelectorAll('.bndz-file-list-scroll').forEach(el => {
      if (el.getAttribute('data-pane-id') !== paneId) {
        (el as HTMLElement).scrollTop = top;
      }
    });
    requestAnimationFrame(() => { paneScrollSyncRef.current = false; });
  };

  const runAddressQuickScriptHandler = (raw: string, paneId: string) => {
    const pane = panes.find(p => p.id === paneId);
    const tabPath = pane?.tabs[pane.activeTabIndex]?.path || currentPath;
    runAddressQuickScript(raw, {
      paneId,
      tabPath,
      refresh: () => { void refetchPath(tabPath); },
      toggleDualPane,
      openInspector: () => { setIsPreviewPanelOpen(true); updateConfig({ previewPanelOpen: true }); },
      openFindPlugin: () => openBottomPlugin('find'),
      openBatchRename: () => openBottomPlugin('batch-rename'),
      syncPanes: syncPanesToSamePath,
      saveTabset: () => { setIsSaveTabsetOpen(true); setTabsetNameInput(''); },
      focusFilter: () => omniFilterRef.current?.focus(),
      openSettings: () => { setConfigInitialTab(undefined); setIsConfigDialogOpen(true); },
      newFindingTab: (q) => addFindingTab(paneId, q),
      navigate: (path) => setCurrentPath(path, paneId),
      setFilter: setFilterText,
      toast: setToastMessage,
    });
  };

  const getSelectedEntityPaths = (): string[] => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return [];
    const tab = pane.tabs[pane.activeTabIndex];
    const dir = pathContentsCache[tab.path] || getDirContents(fileSystem, tab.path || '') || [];
    return tab.selectedItems
      .map(id => dir.find((x: any) => x.id === id))
      .filter(Boolean)
      .map((ent: any) => {
        if (ent.path) return normalizePanePath(ent.path);
        return joinPanePath(tab.path, ent);
      });
  };

  const copyOrMoveToTarget = async (mode: 'copy' | 'move', targetDir?: string, sourcesOverride?: string[]) => {
    const sources = sourcesOverride?.length ? sourcesOverride : getSelectedEntityPaths();
    if (!sources.length) {
      setToastMessage('Select items first.');
      return;
    }
    let dest = targetDir;
    if (!dest) {
      setDestinationPicker({ mode, sources });
      return;
    }
    const rt = buildSettingsRuntime(config);
    if (rt.shell.confirmMove) {
      const label = sources.length === 1
        ? (sources[0].split(/[/\\]/).pop() || 'item')
        : `${sources.length} items`;
      const verb = mode === 'copy' ? 'Copy' : 'Move';
      const approved = await confirm({
        title: `${verb} ${sources.length === 1 ? 'Item' : 'Items'}`,
        message: `${verb} ${label} to ${dest}?`,
        type: 'warning',
        confirmLabel: verb,
      });
      if (!approved) return;
    }
    const { IPC } = await import('../lib/ipcBridge');
    const opId = `${mode}-${Date.now()}`;
    const label = sources.length === 1
      ? (sources[0].split(/[/\\]/).pop() || 'item')
      : `${sources.length} items`;
    xferMetaRef.current.set(opId, { op: mode, label });
    pushToast({
      id: `xfer-${opId}`,
      kind: 'progress',
      title: mode === 'copy' ? 'Copying…' : 'Moving…',
      message: label,
      sticky: true,
    });
    const winSources = sources.map(s => toWindowsPath(s));
    const winDest = toWindowsPath(dest).replace(/\\$/, '');
    void IPC.executeFsOperation(opId, mode, winSources, winDest, false, label, 'high').then(res => {
      if (!res?.background) refreshWorkspace();
    });
  };

  const executeInternalDrop = (
    op: 'copy' | 'move',
    sourcePaths: string[],
    destWin: string,
    sourcePath?: string,
  ) => {
    const opId = `drop-int-${Date.now()}`;
    const label = sourcePaths.length === 1
      ? (sourcePaths[0].split(/[/\\]/).pop() || 'item')
      : `${sourcePaths.length} items`;
    xferMetaRef.current.set(opId, { op, label });
    pushToast({
      id: `xfer-${opId}`,
      kind: 'progress',
      title: op === 'copy' ? 'Copying…' : 'Moving…',
      message: label,
      sticky: true,
    });
    IPC.executeFsOperation(opId, op, sourcePaths.map(toWindowsPath), destWin, false, label, 'high');
    if (!IPC.isNative && op === 'move' && sourcePath) {
      let newFs = fileSystem;
      for (const sp of sourcePaths) {
        const name = sp.split(/[/\\]/).pop() || '';
        newFs = updateFileSystem(newFs, sourcePath, (dir) => {
          const key = Object.keys(dir.children).find(k => dir.children[k].name === name);
          if (key) delete dir.children[key];
        });
      }
      setFileSystem(newFs);
    }
  };

  const toggleFavoriteFolder = () => {
    const path = normalizePanePath(currentTab.path);
    if (!path || path === '/') {
      setToastMessage('Navigate to a folder to pin to Rapid access.');
      return;
    }
    const pinned = config.pinnedFavorites || [];
    const exists = pinned.some((p: any) => normalizePanePath(p.path) === path);
    if (exists) {
      updateConfig({ pinnedFavorites: dedupePinnedFavorites(pinned.filter((p: any) => normalizePanePath(p.path) !== path)) });
      setToastMessage('Removed from Rapid access.');
    } else {
      const name = path.split('/').filter(Boolean).pop() || 'Folder';
      updateConfig({ pinnedFavorites: dedupePinnedFavorites([...pinned, { name, path, icon: 'folder' }]) });
      setToastMessage('Pinned to Rapid access.');
    }
  };

  const closeMenu = () => setOpenMenuId(null);
  const menuAct = (fn: () => void) => runMenubarAction(() => { fn(); closeMenu(); });

  const applyTagToSelection = async (tag: { id?: string; name?: string; label?: string; color?: string }) => {
    const tagKey = tagStorageKey(tag);
    if (!tagKey) return;
    let paths = getSelectedEntityPaths().map(p => toWindowsPath(p));
    if (!paths.length && focusedItemId) {
      const ent = findEntityInCache(pathContentsCache, focusedItemId);
      if (ent) paths = [toWindowsPath(joinPanePath(currentPath, ent))];
    }
    if (!paths.length) {
      setToastMessage('No items selected to tag.');
      closeMenu();
      return;
    }
    const { IPC } = await import('../lib/ipcBridge');

    // Fetch every sidecar once, in parallel — previously this fetched each path's
    // sidecar twice (once to compute allHaveTag, once to apply) and did both
    // sequentially, so tagging N items cost 2N+N sequential IPC round-trips.
    const sidecars = await Promise.all(paths.map(p => IPC.getTagSidecar(p)));
    const allHaveTag = sidecars.every(side => entityHasTag(side?.tags, tagKey));

    const items = paths.map((p, i) => {
      const side = sidecars[i];
      const current: string[] = Array.isArray(side?.tags) ? [...side.tags] : [];
      let next: string[];
      if (allHaveTag) {
        next = current.filter(t => !entityHasTag([t], tagKey));
      } else if (!entityHasTag(current, tagKey)) {
        next = [...current, tagKey];
      } else {
        next = current;
      }
      return { path: p, label: side?.label, comment: side?.comment, tags: next };
    });
    await IPC.setTagMetaBatchItems(items);

    const newCache = { ...pathContentsCache };
    const tabItems = [...(newCache[currentPath] || [])];
    const selectedIds = new Set(activeTab.selectedItems);
    const pathSet = new Set(paths.map(p => p.toLowerCase()));
    tabItems.forEach((item: any) => {
      const itemPath = toWindowsPath(joinPanePath(currentPath, item)).toLowerCase();
      if (selectedIds.has(item.id) || pathSet.has(itemPath) || pathSet.has(item.id?.toLowerCase?.())) {
        const current: string[] = Array.isArray(item.tags) ? [...item.tags] : [];
        if (allHaveTag) {
          item.tags = current.filter(t => !entityHasTag([t], tagKey));
        } else if (!entityHasTag(current, tagKey)) {
          item.tags = [...current, tagKey];
        }
      }
    });
    newCache[currentPath] = tabItems;
    setPathContentsCache(newCache);
    setToastMessage(allHaveTag
      ? `Removed "${tag.label || tagKey}" from ${paths.length} item(s). Click again to re-apply.`
      : `Tagged ${paths.length} item(s) as "${tag.label || tagKey}". Click again to remove.`);
    closeMenu();
  };

  const selectAllInActivePane = () => {
    const ap = panes.find(p => p.id === activePaneId);
    if (!ap) return;
    const tab = ap.tabs[ap.activeTabIndex];
    const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
    setSelectedItems(dirContents.map((x: any) => x.id), activePaneId);
    scheduleSelectionChrome(dirContents.map((x: any) => x.id), true);
    scheduleQuickActionsBar(dirContents.length > 0, true);
  };

  const invertSelectionInActivePane = () => {
    const ap = panes.find(p => p.id === activePaneId);
    if (!ap) return;
    const tab = ap.tabs[ap.activeTabIndex];
    const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
    const currentSelected = new Set(tab.selectedItems);
    const newSelected = dirContents.filter((x: any) => !currentSelected.has(x.id)).map((x: any) => x.id);
    setSelectedItems(newSelected, activePaneId);
    scheduleSelectionChrome(newSelected, true);
    scheduleQuickActionsBar(newSelected.length > 0, true);
  };

  const removeAllTagsFromSelection = async () => {
    let paths = getSelectedEntityPaths().map(p => toWindowsPath(p));
    if (!paths.length && focusedItemId) {
      const ent = findEntityInCache(pathContentsCache, focusedItemId);
      if (ent) paths = [toWindowsPath(joinPanePath(currentPath, ent))];
    }
    if (!paths.length) {
      setToastMessage('No items selected to untag.');
      closeMenu();
      return;
    }
    const { IPC } = await import('../lib/ipcBridge');
    const sidecars = await Promise.all(paths.map(p => IPC.getTagSidecar(p)));
    await IPC.setTagMetaBatchItems(paths.map((p, i) => {
      const side = sidecars[i];
      return { path: p, label: side?.label, comment: side?.comment, tags: [] };
    }));
    const newCache = { ...pathContentsCache };
    const tabItems = [...(newCache[currentPath] || [])];
    const selectedIds = new Set(activeTab.selectedItems);
    const pathSet = new Set(paths.map(p => p.toLowerCase()));
    tabItems.forEach((item: any) => {
      const itemPath = toWindowsPath(joinPanePath(currentPath, item)).toLowerCase();
      if (selectedIds.has(item.id) || pathSet.has(itemPath)) {
        item.tags = [];
      }
    });
    newCache[currentPath] = tabItems;
    setPathContentsCache(newCache);
    setToastMessage(`Removed all tags from ${paths.length} item(s).`);
    closeMenu();
  };

  const addTab = (paneId: string, path: string) => {
    const tabId = `t-${Date.now()}`;
    scheduleTabEnter(tabId);
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
        const newTab: TabState = { id: tabId, path, history: [path], historyIndex: 0, selectedItems: [], viewMode: undefined };
        return { ...p, tabs: [...p.tabs, newTab], activeTabIndex: p.tabs.length };
      }
      return p;
    }));
  };

  const addFindingTab = (paneId: string, query: string, root?: string) => {
    const q = query.trim();
    if (!q) return;
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const rootPath = root || p.tabs[p.activeTabIndex]?.path || '/';
      const newTab = createFindingTab(q, rootPath, config);
      void refreshFindingTab(paneId, newTab.id, q, rootPath, newTab);
      return { ...p, tabs: [...p.tabs, newTab], activeTabIndex: p.tabs.length };
    }));
  };

  useEffect(() => {
    const onNewFinding = (e: Event) => {
      const q = String((e as CustomEvent).detail?.query || '').trim();
      if (q) addFindingTab(activePaneId, q);
    };
    window.addEventListener('bndz-new-finding-tab', onNewFinding);
    return () => window.removeEventListener('bndz-new-finding-tab', onNewFinding);
  }, [activePaneId]);

  const reorderTab = (paneId: string, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const tabs = [...p.tabs];
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      let activeTabIndex = p.activeTabIndex;
      if (activeTabIndex === fromIdx) activeTabIndex = toIdx;
      else if (fromIdx < activeTabIndex && toIdx >= activeTabIndex) activeTabIndex -= 1;
      else if (fromIdx > activeTabIndex && toIdx <= activeTabIndex) activeTabIndex += 1;
      return { ...p, tabs, activeTabIndex };
    }));
  };

  const closeTabAt = async (paneId: string, tabIndex: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const pane = panes.find(p => p.id === paneId);
    const tab = pane?.tabs[tabIndex];
    if (!pane || !tab || pane.tabs.length <= 1) return;
    if (tab.locked) {
      if (config.promptOnClosingALockedTab) {
        const approved = await confirm({
          title: 'Close Locked Tab',
          message: `"${getPaneTabLabel(tab.path)}" is locked. Close anyway?`,
          type: 'warning',
          confirmLabel: 'Close tab',
        });
        if (!approved) return;
      } else {
        return;
      }
    }

    const commitClose = () => {
      setPanes(prev => prev.map(p => {
        if (p.id !== paneId) return p;
        if (p.tabs.length <= 1) return p;
        const newTabs = p.tabs.filter((_, i) => i !== tabIndex);
        let newActive = p.activeTabIndex;
        if (p.activeTabIndex === tabIndex) newActive = Math.min(tabIndex, newTabs.length - 1);
        else if (p.activeTabIndex > tabIndex) newActive = p.activeTabIndex - 1;
        return { ...p, tabs: newTabs, activeTabIndex: newActive };
      }));
      setTabContextMenu(null);
    };

    animateTabClose(tab.id, commitClose);
  };

  const closeOtherTabs = async (paneId: string, keepIndex: number) => {
    const pane = panes.find(p => p.id === paneId);
    if (!pane) return;
    const kept = pane.tabs[keepIndex];
    if (!kept) return;
    const lockedOthers = pane.tabs.filter((t, i) => i !== keepIndex && t.locked);
    if (lockedOthers.length > 0 && config.promptOnClosingALockedTab) {
      const approved = await confirm({
        title: 'Close Locked Tabs',
        message: `Close ${lockedOthers.length} locked tab(s) as well?`,
        type: 'warning',
        confirmLabel: 'Close all',
      });
      if (!approved) {
        setPanes(prev => prev.map(p => (
          p.id !== paneId ? p : { ...p, tabs: [kept, ...lockedOthers], activeTabIndex: 0 }
        )));
        setTabContextMenu(null);
        return;
      }
    }
    setPanes(prev => prev.map(p => (
      p.id !== paneId ? p : { ...p, tabs: [kept], activeTabIndex: 0 }
    )));
    setTabContextMenu(null);
  };

  const closeTabsToRight = async (paneId: string, fromIndex: number) => {
    const pane = panes.find(p => p.id === paneId);
    if (!pane) return;
    const closing = pane.tabs.slice(fromIndex + 1);
    if (!closing.length) return;
    const keep = pane.tabs.slice(0, fromIndex + 1);
    const lockedClosing = closing.filter(t => t.locked);
    if (lockedClosing.length > 0 && config.promptOnClosingALockedTab) {
      const approved = await confirm({
        title: 'Close Locked Tabs',
        message: `Close ${lockedClosing.length} locked tab(s) to the right as well?`,
        type: 'warning',
        confirmLabel: 'Close tabs',
      });
      if (!approved) {
        setPanes(prev => prev.map(p => (
          p.id !== paneId
            ? p
            : {
              ...p,
              tabs: [...keep, ...lockedClosing],
              activeTabIndex: Math.min(p.activeTabIndex, keep.length + lockedClosing.length - 1),
            }
        )));
        setTabContextMenu(null);
        return;
      }
    }
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const newActive = p.activeTabIndex > fromIndex ? fromIndex : p.activeTabIndex;
      return { ...p, tabs: keep, activeTabIndex: newActive };
    }));
    setTabContextMenu(null);
  };

  const closeAllTabs = async (paneId: string) => {
    const pane = panes.find(p => p.id === paneId);
    if (!pane) return;
    const locked = pane.tabs.filter(t => t.locked);
    if (locked.length === pane.tabs.length) return;
    if (locked.length > 0 && config.promptOnClosingALockedTab) {
      const approved = await confirm({
        title: 'Close Tabs',
        message: `Keep ${locked.length} locked tab(s) and close the rest?`,
        type: 'warning',
        confirmLabel: 'Close others',
      });
      if (!approved) return;
      setPanes(prev => prev.map(p => (
        p.id !== paneId ? p : { ...p, tabs: locked, activeTabIndex: 0 }
      )));
      setTabContextMenu(null);
      return;
    }
    const fallback = pane.tabs[pane.activeTabIndex] || pane.tabs[0];
    setPanes(prev => prev.map(p => (
      p.id !== paneId ? p : { ...p, tabs: [{ ...fallback, locked: false }], activeTabIndex: 0 }
    )));
    setTabContextMenu(null);
  };

  const toggleTabLock = (paneId: string, tabIndex: number) => {
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const tabs = [...p.tabs];
      const tab = tabs[tabIndex];
      if (!tab) return p;
      tabs[tabIndex] = { ...tab, locked: !tab.locked };
      return { ...p, tabs };
    }));
    setTabContextMenu(null);
  };

  const duplicateTab = (paneId: string, tabIndex: number) => {
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const src = p.tabs[tabIndex];
      if (!src) return p;
      const newTab: TabState = {
        id: `t-${Date.now()}`,
        path: src.path,
        history: [...src.history],
        historyIndex: src.historyIndex,
        selectedItems: [],
        viewMode: src.viewMode,
        color: src.color,
      };
      const tabs = [...p.tabs];
      tabs.splice(tabIndex + 1, 0, newTab);
      return { ...p, tabs, activeTabIndex: tabIndex + 1 };
    }));
    setTabContextMenu(null);
  };

  const setTabColor = (paneId: string, tabIndex: number, color: string) => {
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const tabs = [...p.tabs];
      tabs[tabIndex] = { ...tabs[tabIndex], color: color || undefined };
      return { ...p, tabs };
    }));
    setTabContextMenu(null);
  };

  const setActiveTab = (paneId: string, tabIndex: number) => {
    setActivePaneId(paneId);
    setPanes(prev => prev.map(p => p.id === paneId ? { ...p, activeTabIndex: tabIndex } : p));
  };

  const clearTabFileDragTimer = () => {
    if (tabFileDragTimerRef.current) {
      clearTimeout(tabFileDragTimerRef.current);
      tabFileDragTimerRef.current = null;
    }
  };

  /** Pointer-drag: switch tab immediately so the target list is live under the cursor. */
  const activateTabForFileDragImmediate = React.useCallback((paneId: string, tabIndex: number) => {
    const sourcePaneId = getFileDragSession()?.sourcePaneId ?? activePaneIdRef.current;
    const activeId = activePaneIdRef.current;
    if (
      !config.alsoAutoSelectTabsInTheInactivePane
      && paneId !== sourcePaneId
      && paneId !== activeId
    ) return;
    const targetPane = panesRef.current.find(p => p.id === paneId);
    if (targetPane?.tabs[tabIndex]?.locked) return;
    const prev = tabFileDragHoverRef.current;
    if (prev?.paneId === paneId && prev?.tabIndex === tabIndex) return;
    clearTabFileDragTimer();
    tabFileDragHoverRef.current = { paneId, tabIndex };
    flushSync(() => {
      setTabFileDropTarget({ paneId, tabIndex });
      setActivePaneId(paneId);
      setPanes(prevPanes => prevPanes.map(p => p.id === paneId ? { ...p, activeTabIndex: tabIndex } : p));
    });
    const targetPath = targetPane?.tabs[tabIndex]?.path;
    if (targetPath) {
      const norm = normalizePanePath(targetPath);
      if (pathContentsCacheRef.current[norm] === undefined) {
        void refetchPath(norm);
      }
    }
  }, [config.alsoAutoSelectTabsInTheInactivePane, refetchPath]);

  /** HTML5 drag-over tabs: delayed switch (Explorer-style). */
  const scheduleTabSwitchOnFileDrag = (paneId: string, tabIndex: number) => {
    if (!config.autoSelectTabsOnDragOver) return;
    const sourcePaneId = getFileDragSession()?.sourcePaneId ?? activePaneIdRef.current;
    const activeId = activePaneIdRef.current;
    if (
      !config.alsoAutoSelectTabsInTheInactivePane
      && paneId !== sourcePaneId
      && paneId !== activeId
    ) return;
    const targetPane = panesRef.current.find(p => p.id === paneId);
    if (targetPane?.tabs[tabIndex]?.locked) return;
    const prev = tabFileDragHoverRef.current;
    if (prev?.paneId === paneId && prev?.tabIndex === tabIndex) return;
    clearTabFileDragTimer();
    tabFileDragHoverRef.current = { paneId, tabIndex };
    setTabFileDropTarget({ paneId, tabIndex });
    const delay = config.delayBeforeADraggedOverTabIsAutoSelected ?? DEFAULT_TAB_HOVER_DELAY_MS;
    const applySwitch = () => {
      tabFileDragTimerRef.current = null;
      setActivePaneId(paneId);
      setPanes(prevPanes => prevPanes.map(p => p.id === paneId ? { ...p, activeTabIndex: tabIndex } : p));
    };
    if (delay <= 0) {
      applySwitch();
      return;
    }
    tabFileDragTimerRef.current = setTimeout(applySwitch, delay);
  };

  useEffect(() => () => clearTabFileDragTimer(), []);

  const setCurrentPath = (path: string, paneId: string = activePaneId, updateHistory: boolean = true) => {
    const norm = normalizePanePath(path);
    const bndzView = parseBndzVirtualView(norm);
    const linkedViewMode: TabState['viewMode'] | undefined =
      bndzView === 'recent' ? 'recents' :
      bndzView === 'media' ? 'media' :
      bndzView === 'large' ? 'size' :
      undefined;
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
        const newTabs = [...p.tabs];
        const tab = newTabs[p.activeTabIndex];
        let newHistory = tab.history;
        let newHistoryIndex = tab.historyIndex;
        if (updateHistory && tab.path !== norm) {
            newHistory = newHistory.slice(0, newHistoryIndex + 1);
            newHistory.push(norm);
            newHistoryIndex = newHistory.length - 1;
        }
        newTabs[p.activeTabIndex] = {
          ...tab,
          path: norm,
          history: newHistory,
          historyIndex: newHistoryIndex,
          selectedItems: [],
          viewMode: linkedViewMode ?? (bndzView ? undefined : tab.viewMode),
        };
        return {
          ...p,
          tabs: newTabs,
          ...(bndzView === 'large' ? { sortColumn: 'size' as const, sortDirection: 'desc' as const } : {}),
        };
      }
      return p;
    }));
    if (updateHistory && norm) {
      if (navHistoryTimerRef.current) clearTimeout(navHistoryTimerRef.current);
      navHistoryTimerRef.current = setTimeout(() => {
        updateConfig({ navigationHistory: recordNavVisit(config.navigationHistory, norm) });
      }, 500);
      if (norm !== '/' && !norm.startsWith('/vf/') && !norm.startsWith('/shell:') && !norm.includes('>')) {
        const prev = (config.recentFiles as string[] | undefined) || [];
        const next = [norm, ...prev.filter(p => p !== norm)].slice(0, 15);
        if (next[0] !== prev[0] || next.length !== prev.length) {
          updateConfig({ recentFiles: next });
        }
      }
    }
  };

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setCurrentPath(path);
    };
    const onOpenPlugin = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.id) {
        openBottomPlugin(d.id, {
          paths: d.paths,
          currentPath: d.currentPath,
          wizardMode: d.wizardMode,
          findQuery: d.query ?? d.findQuery,
        });
      }
    };
    window.addEventListener('bndz-navigate', onNavigate);
    window.addEventListener('bndz-open-bottom-plugin', onOpenPlugin);
    const onOpenTagManager = () => setIsTagManagerOpen(true);
    window.addEventListener('bndz-open-tag-manager', onOpenTagManager);
    return () => {
      window.removeEventListener('bndz-navigate', onNavigate);
      window.removeEventListener('bndz-open-bottom-plugin', onOpenPlugin);
      window.removeEventListener('bndz-open-tag-manager', onOpenTagManager);
    };
  }, [activePaneId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onOpenPath(path => {
        if (path) setCurrentPath(normalizePanePath(path));
      });
    });
    return () => { if (unsub) unsub(); };
  }, [activePaneId]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onStartupAction(action => {
        if (action === 'dual-pane') toggleDualPane();
        else if (action.startsWith('find:')) {
          const q = action.slice(5);
          setFilterText(`> ${q}`);
          openBottomPlugin('find');
        } else if (action.startsWith('catalog:')) {
          setCurrentPath(`/vf/${action.slice(8)}`);
        }
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const goBack = (paneId: string = activePaneId) => {
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         if (tab.historyIndex > 0) {
             const newHistoryIndex = tab.historyIndex - 1;
             const path = tab.history[newHistoryIndex];
             newTabs[p.activeTabIndex] = { ...tab, path, historyIndex: newHistoryIndex, selectedItems: [] };
         }
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };

  const goForward = (paneId: string = activePaneId) => {
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         if (tab.historyIndex < tab.history.length - 1) {
             const newHistoryIndex = tab.historyIndex + 1;
             const path = tab.history[newHistoryIndex];
             newTabs[p.activeTabIndex] = { ...tab, path, historyIndex: newHistoryIndex, selectedItems: [] };
         }
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };

  /** Global Escape — dismiss stuck overlays in priority order */
  useEffect(() => {
    const layers = [
      registerEscapeLayer({
        id: 'folder-size-sync',
        priority: 960,
        isActive: () => !!folderSizeSync?.active,
        dismiss: () => cancelFolderSizeSync(),
      }),
      registerEscapeLayer({
        id: 'context-menu',
        priority: 900,
        isActive: () => !!contextMenu,
        dismiss: () => setContextMenu(null),
      }),
      registerEscapeLayer({
        id: 'tab-context-menu',
        priority: 890,
        isActive: () => !!tabContextMenu,
        dismiss: () => setTabContextMenu(null),
      }),
      registerEscapeLayer({
        id: 'destination-picker',
        priority: 850,
        isActive: () => !!destinationPicker,
        dismiss: () => setDestinationPicker(null),
      }),
      registerEscapeLayer({
        id: 'config-dialog',
        priority: 820,
        isActive: () => isConfigDialogOpen,
        dismiss: () => setIsConfigDialogOpen(false),
      }),
      registerEscapeLayer({
        id: 'plugin-store',
        priority: 810,
        isActive: () => isPluginStoreOpen,
        dismiss: () => setIsPluginStoreOpen(false),
      }),
      registerEscapeLayer({
        id: 'command-palette',
        priority: 800,
        isActive: () => isCommandPaletteOpen,
        dismiss: () => setIsCommandPaletteOpen(false),
      }),
      registerEscapeLayer({
        id: 'tag-manager',
        priority: 790,
        isActive: () => isTagManagerOpen,
        dismiss: () => setIsTagManagerOpen(false),
      }),
      registerEscapeLayer({
        id: 'smart-tools',
        priority: 780,
        isActive: () => isSmartToolsOpen,
        dismiss: () => setIsSmartToolsOpen(false),
      }),
      registerEscapeLayer({
        id: 'toolbar-config',
        priority: 770,
        isActive: () => isToolbarConfigOpen,
        dismiss: () => setIsToolbarConfigOpen(false),
      }),
      registerEscapeLayer({
        id: 'about-dialog',
        priority: 760,
        isActive: () => showAboutDialog,
        dismiss: () => setShowAboutDialog(false),
      }),
      registerEscapeLayer({
        id: 'register-dialog',
        priority: 755,
        isActive: () => showRegisterDialog,
        dismiss: () => setShowRegisterDialog(false),
      }),
      registerEscapeLayer({
        id: 'help-topics',
        priority: 750,
        isActive: () => showHelpTopics,
        dismiss: () => setShowHelpTopics(false),
      }),
      registerEscapeLayer({
        id: 'save-tabset',
        priority: 740,
        isActive: () => isSaveTabsetOpen,
        dismiss: () => setIsSaveTabsetOpen(false),
      }),
      registerEscapeLayer({
        id: 'tutorial',
        priority: 720,
        isActive: () => showTutorial,
        dismiss: () => setShowTutorial(false),
      }),
      registerEscapeLayer({
        id: 'menubar',
        priority: 700,
        isActive: () => !!openMenuId,
        dismiss: closeMenu,
      }),
      registerEscapeLayer({
        id: 'inline-rename',
        priority: 600,
        isActive: () => !!inlineRename,
        dismiss: () => setInlineRename(null),
      }),
      registerEscapeLayer({
        id: 'omni-filter',
        priority: 500,
        isActive: () => filterText.length > 0 || document.activeElement === omniFilterRef.current,
        dismiss: () => {
          setFilterText('');
          omniFilterRef.current?.blur();
        },
      }),
      registerEscapeLayer({
        id: 'floating-tooltip',
        priority: 400,
        isActive: () => !!getFloatingTooltip(),
        dismiss: () => hideFloatingTooltip(),
      }),
      registerEscapeLayer({
        id: 'nav-back',
        priority: 100,
        isActive: () => {
          const pane = panes.find(p => p.id === activePaneId);
          if (!pane) return false;
          const tab = pane.tabs[pane.activeTabIndex];
          return (tab?.historyIndex ?? 0) > 0;
        },
        dismiss: () => goBack(activePaneId),
      }),
    ];
    return () => layers.forEach(u => u());
  }, [
    contextMenu, tabContextMenu, destinationPicker, isConfigDialogOpen, isPluginStoreOpen,
    isCommandPaletteOpen, isTagManagerOpen, isSmartToolsOpen, isToolbarConfigOpen,
    showAboutDialog, showRegisterDialog, showHelpTopics, isSaveTabsetOpen, showTutorial, openMenuId,
    inlineRename, filterText, activePaneId, panes, goBack, folderSizeSync, cancelFolderSizeSync,
  ]);

  const setSelectedItems = (items: string[] | ((prev: string[]) => string[]), paneId: string = activePaneId) => {
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         const newSelected = typeof items === 'function' ? items(tab.selectedItems) : items;
         newTabs[p.activeTabIndex] = { ...tab, selectedItems: newSelected };
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };
  marqueeOpsRef.current.setSelectedItems = setSelectedItems;

  useEffect(() => {
    const onSelectPaths = (e: Event) => {
      const paths: string[] = (e as CustomEvent).detail?.paths || [];
      if (!paths.length) return;
      const winPaths = new Set(paths.map(p => toWindowsPath(p).toLowerCase()));
      const items = pathContentsCacheRef.current[currentPath] || [];
      const ids = items.filter((x: any) => {
        const full = toWindowsPath(x.path || joinPanePath(currentPath, x)).toLowerCase();
        return winPaths.has(full);
      }).map((x: any) => x.id);
      if (ids.length) {
        setSelectedItems(ids, activePaneId);
        setToastMessage(`Selected ${ids.length} duplicate(s) in the current folder.`, 'success', 'Selection');
      } else {
        setToastMessage('No matching items in the current folder view.', 'info', 'Selection');
      }
    };
    window.addEventListener('bndz-select-paths', onSelectPaths);
    return () => window.removeEventListener('bndz-select-paths', onSelectPaths);
  }, [activePaneId, currentPath, setToastMessage]);

  useEffect(() => {
    const pinned = config.pinnedFavorites || [];
    const deduped = dedupePinnedFavorites(pinned);
    if (deduped.length !== pinned.length) {
      updateConfig({ pinnedFavorites: deduped });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startFolderCompare = async () => {
      // Create pane 2 if it doesn't exist
      if (panes.length < 2) {
          setPanes(prev => {
              const newPane = { 
                  id: `pane${Date.now()}`,
                  tabs: [{ id: `t${Date.now()}`, path: '/', history: ['/'], historyIndex: 0, selectedItems: [], viewMode: undefined }],
                  activeTabIndex: 0,
                  sortColumn: 'name' as const,
                  sortDirection: 'asc' as const
              };
              return [...prev, newPane];
          });
          setIsDualPane(true);
          // Wait for render
          setTimeout(() => executeCompare(), 300);
      } else {
          setIsDualPane(true);
          executeCompare();
      }
  };

  const executeCompare = async () => {
      const { IPC } = await import('../lib/ipcBridge');
      setIsSyncMode(true);
      setIsSyncing(true);
      
      // Get current panes
      setPanes(currentPanes => {
          if (currentPanes.length >= 2) {
             const pathA = resolvePaneTab(currentPanes[0])?.path;
             const pathB = resolvePaneTab(currentPanes[1])?.path;
             if (!pathA || !pathB) {
                 setIsSyncing(false);
                 return currentPanes;
             }
             IPC.compareDirectories(pathA, pathB, config.syncUseHashing || false).then(res => {
                 const map: any = {};
                 (res || []).forEach((item: any) => {
                     map[item.id] = item;
                 });
                 setSyncResults(map);
                 setIsSyncing(false);
             }).catch(() => {
                 setIsSyncing(false);
                 pushToast({ kind: 'error', title: 'Compare failed', message: 'Could not compare the selected folders.' });
             });
          }
          return currentPanes;
      });
  };

  const executeFolderSync = async (mode: 'mirror' | 'updateTarget') => {
      if (panes.length < 2) {
          pushToast({ kind: 'warning', title: 'Sync', message: 'Open two panes with folders to sync.' });
          return;
      }
      const pathA = toWindowsPath(panes[0].tabs[panes[0].activeTabIndex].path);
      const pathB = toWindowsPath(panes[1].tabs[panes[1].activeTabIndex].path);
      setIsSyncing(true);
      try {
          const { IPC } = await import('../lib/ipcBridge');
          const res = await IPC.syncFolders(pathA, pathB, 'dual-pane-sync', 'copy', mode === 'mirror');
          if (res.ok) {
              pushToast({
                  kind: 'success',
                  title: mode === 'mirror' ? 'Mirror sync complete' : 'Update sync complete',
                  message: `Synchronized to ${pathB}`,
              });
              refreshActiveList();
              await executeCompare();
          } else {
              pushToast({ kind: 'error', title: 'Sync failed', message: res.error || 'Could not sync folders.' });
          }
      } catch {
          pushToast({ kind: 'error', title: 'Sync failed', message: 'Could not sync folders.' });
      } finally {
          setIsSyncing(false);
      }
  };

  const refreshNavigationTree = () => {
    setTreeRefreshNonce(n => n + 1);
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.getSystemDrives().then(setDrives);
      IPC.getCloudProviders().then(setCloudProviders);
    });
  };

  const refreshActiveList = () => {
    const pane = panes.find(p => p.id === activePaneId);
    const tabPath = pane?.tabs[pane.activeTabIndex]?.path;
    if (tabPath) void refetchPath(tabPath);
    refreshPathsForPanes();
  };

  // View-mode buttons are explicit toggles. `undefined` = the neutral default
  // (no button lit) and renders using the configured default layout. Clicking a
  // button lights it; clicking the lit button returns to the unlit default.
  const setViewMode = (mode: 'details' | 'grid' | 'list' | 'columns' | 'size' | 'recents' | 'media', paneId: string = activePaneId) => {
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         const nextMode = tab.viewMode === mode ? undefined : mode;
         newTabs[p.activeTabIndex] = { ...tab, viewMode: nextMode };
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };

  const toggleSort = (paneId: string, column: SortColumnId) => {
    const pane = panes.find(p => p.id === paneId);
    const tab = pane?.tabs[pane.activeTabIndex];
    if (tab?.viewLocked) {
      setToastMessage('View is locked. Unlock to change sort.');
      return;
    }
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const effectiveCol = p.sortColumn ?? resolveSortColumn(config, p);
      const effectiveDir = resolveSortDirection(effectiveCol, p.sortDirection, config);
      if (effectiveCol === column) {
        return { ...p, sortColumn: column, sortDirection: effectiveDir === 'asc' ? 'desc' : 'asc' };
      }
      return { ...p, sortColumn: column, sortDirection: 'asc' };
    }));
  };

  const getSortedContentsForActivePane = React.useCallback(() => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return [] as any[];
    const tab = pane.tabs[pane.activeTabIndex];
    const panePath = tab.path;
    const normPanePath = normalizePanePath(panePath);
    const isThisPc = normPanePath === '/' || normPanePath === '/this-pc';
    let contents: any[] = isThisPc
      ? drives.map(d => ({
          id: `drive-${d.name.replace(/^\/+/, '/')}`,
          name: formatDriveLetter(d.name),
          label: d.label,
          type: 'directory',
          path: d.name,
          driveInfo: d,
        }))
      : (pathContentsCache[panePath] || []);

    const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
    if (isGlobal) {
      contents = globalSearchResults || [];
    } else if (filterText.trim() !== '') {
      contents = filterByName(contents, filterText);
    }

    if (pane.filterRegex?.trim()) {
      try {
        const regex = new RegExp(pane.filterRegex, 'i');
        contents = contents.filter((item: any) => regex.test(item.name));
      } catch {
        contents = contents.filter((item: any) => item.name.toLowerCase().includes(pane.filterRegex!.toLowerCase()));
      }
    }


    return sortEntities(filterListEntities(contents, config), config, {
      sortColumn: pane.sortColumn,
      sortDirection: pane.sortDirection,
    });
  }, [panes, activePaneId, pathContentsCache, drives, config, filterText, globalSearchResults]);

  const goUp = (paneId: string = activePaneId) => {
    const p = panes.find(x => x.id === paneId);
    const tab = resolvePaneTab(p);
    if (!tab) return;
    const cPath = tab.path;
    const norm = normalizePanePath(cPath);
    if (norm === '/vf' || norm.startsWith('/vf/')) {
      if (norm === '/vf') return;
      setCurrentPath('/vf', paneId);
      return;
    }
    if (isBndzVirtualPath(norm)) {
      if (norm === BNDZ_VIEWS_ROOT) setCurrentPath('/', paneId);
      else setCurrentPath(BNDZ_VIEWS_ROOT, paneId);
      setSelectedItems([], paneId);
      return;
    }
    if (cPath === "/" || cPath === "") {
      return;
    } else if (cPath.lastIndexOf("/") <= 0) {
      setCurrentPath("/", paneId);
    } else {
      setCurrentPath(cPath.substring(0, cPath.lastIndexOf("/")), paneId);
    }
    setSelectedItems([], paneId);
  };

  const buildCeaHandlers = React.useCallback((paneId: string, tabIndex?: number) => ({
    goUp: () => goUp(paneId),
    newTab: () => {
      const p = panes.find(x => x.id === paneId);
      addTab(paneId, p?.tabs[p?.activeTabIndex ?? 0]?.path || '/');
    },
    closeTab: () => { if (tabIndex != null) closeTabAt(paneId, tabIndex); },
    openOppositePane: (path: string) => openFolderInOppositePane(path, paneId),
    openBackgroundTab: (path: string) => addTab(paneId, path),
    refresh: () => {
      const p = panes.find(x => x.id === paneId);
      void refetchPath(p?.tabs[p?.activeTabIndex ?? 0]?.path || '/');
    },
    openFavorites: () => setRapidAccessPopupOpen(true),
    openEditMenu: () => setOpenMenuId('Edit'),
    openSmallTabMenu: (x: number, y: number) => setTabContextMenu({ x, y, paneId, tabIndex: tabIndex ?? 0 }),
    autosizeColumns: () => {
      const items = getSortedContentsForActivePane();
      const cols = getVisibleListColumns(config);
      const widths = computeAutosizedColumnWidths(items, cols, {
        disregardHeaders: !!config.onAutosizeDisregardTheColumnHeaders,
        alwaysAutosizeSize: !!config.alwaysAutosizeTheSizeColumn,
        limits: parseColumnAutosizeLimits(config),
      });
      if (Object.keys(widths).length > 0) {
        updateConfig({ listColumnWidths: { ...(config.listColumnWidths || {}), ...widths } });
      }
    },
    runScript: (shell: string, script: string) => {
      void IPC.runUserScript(shell, script).then(res => setToastMessage(res.output.slice(0, 200) || (res.ok ? 'Script OK' : 'Script failed')));
    },
    toast: setToastMessage,
  }), [panes, addTab, closeTabAt, goUp, openFolderInOppositePane, refetchPath, setToastMessage, getSortedContentsForActivePane, config, updateConfig]);

  // Keyboard state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (e.key === '/') {
          if (document.activeElement !== omniFilterRef.current && !isInput) {
              e.preventDefault();
              omniFilterRef.current?.focus();
              return;
          }
      }
      
      if (e.key === 'Escape') {
          if (document.activeElement === omniFilterRef.current) {
              e.preventDefault();
              omniFilterRef.current?.blur();
              setFilterText('');
              return;
          }
      }

      if (e.altKey && e.key === 'ArrowLeft') {
         e.preventDefault();
         goBack(activePaneId);
      } else if (e.altKey && e.key === 'ArrowRight') {
         e.preventDefault();
         goForward(activePaneId);
      } else if ((e.altKey && e.key === 'ArrowUp') || (e.key === 'Backspace' && !isInput)) {
         e.preventDefault();
         goUp(activePaneId);
      }

      // Ignore other keys if user is typing in another input (like Smart Tools)
      if (isInput && document.activeElement !== omniFilterRef.current) return;

      // Allow typing in OmniFilter to proceed normally, but handle specific keys like Down/Up/Enter
      if (document.activeElement === omniFilterRef.current && !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
          return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (isDualPane) {
           const nextIdx = (activePaneIndex + 1) % panes.length;
           setActivePaneId(panes[nextIdx].id);
        }
      } else if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addTab(activePaneId, activeTab.path);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const items = getSortedContentsForActivePane();
        setSelectedItems(items.map((x: any) => x.id), activePaneId);
        if (items[0]) selectionAnchorRef.current = { paneId: activePaneId, itemId: items[0].id };
        scheduleQuickActionsBar(true, true);
        return;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
        let paneContents = activeTab.path === '/' || activeTab.path === '/D:' ? [] : getDirContents(fileSystem, activeTab.path) || [];
        
        if (isGlobal) {
            paneContents = globalSearchResults || [];
        } else if (filterText.trim() !== '') {
            paneContents = filterByName(paneContents, filterText) as any;
        }

        if (paneContents.length === 0) return;

        const pageSize = Math.max(10, Math.floor((document.querySelector('[data-list-body]')?.clientHeight || 400) / 24));
        let idx = paneContents.findIndex((c: any) => c.id === focusedItemId || (activeTab.selectedItems.length > 0 && c.id === activeTab.selectedItems[0]));
        const baseIdx = idx === -1 ? 0 : idx;

        if (e.key === 'Home') idx = 0;
        else if (e.key === 'End') idx = paneContents.length - 1;
        else if (e.key === 'PageDown') idx = Math.min(baseIdx + pageSize, paneContents.length - 1);
        else if (e.key === 'PageUp') idx = Math.max(baseIdx - pageSize, 0);
        else {
          idx = wrapListIndex(baseIdx, e.key === 'ArrowDown' ? 1 : -1, paneContents.length, config);
        }

        const nextItem = paneContents[idx] as any;
        if (nextItem) {
           setFocusedItemId(nextItem.id);
           if (e.shiftKey) {
             const anchor = selectionAnchorRef.current?.paneId === activePaneId
               ? selectionAnchorRef.current.itemId
               : (focusedItemId || activeTab.selectedItems[0] || nextItem.id);
             const anchorIdx = paneContents.findIndex((c: any) => c.id === anchor);
             const lo = Math.min(anchorIdx >= 0 ? anchorIdx : idx, idx);
             const hi = Math.max(anchorIdx >= 0 ? anchorIdx : idx, idx);
             const rangeIds = paneContents.slice(lo, hi + 1).map((c: any) => c.id);
             setSelectedItems(rangeIds, activePaneId);
             scheduleSelectionChrome(rangeIds, true);
             scheduleQuickActionsBar(true, true);
           } else {
             selectionAnchorRef.current = { paneId: activePaneId, itemId: nextItem.id };
             setSelectedItems([nextItem.id], activePaneId);
             scheduleSelectionChrome([nextItem.id], true);
             scheduleQuickActionsBar(true, true);
           }
           const el = document.getElementById(`fs-item-${nextItem.id}`);
           if (el) el.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeTab.selectedItems.length > 0) {
           const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
           let paneContents = activeTab.path === '/' || activeTab.path === '/D:' ? [] : safeGetDirContents(fileSystem, activeTab.path) || [];
           if (isGlobal) {
               paneContents = globalSearchResults || [];
           } else if (filterText.trim() !== '') {
               paneContents = filterByName(paneContents, filterText) as any;
           }
           const selectedItem = paneContents?.find((c: any) => c.id === activeTab.selectedItems[0]) as any;
           if (selectedItem?.type === 'directory') {
               const newPath = selectedItem.path || `${activeTab.path}/${selectedItem.name}`;
               setCurrentPath(newPath, activePaneId);
               setFilterText(''); // Clear filter when opening directory
               omniFilterRef.current?.blur();
           } else if (selectedItem) {
               const target = isGlobal && selectedItem.path
                 ? selectedItem.path
                 : joinPanePath(activeTab.path, selectedItem);
               IPC.executeContextMenuVerb(toWindowsPath(target), 'open');
           }
        }
      }
      
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && /^[a-z0-9]$/i.test(e.key)) {
        const searchRt = settingsRt.search;
        if (searchRt.typeAhead === false) return;
        const now = Date.now();
        const key = e.key.toLowerCase();
        const withinWindow = now - typeAheadAtRef.current <= 1000;
        const repeatCycle = withinWindow
          && typeAheadPrefixRef.current.length === 1
          && typeAheadPrefixRef.current === key;

        if (!repeatCycle) {
          if (!withinWindow) typeAheadPrefixRef.current = '';
          typeAheadPrefixRef.current += key;
        }
        typeAheadAtRef.current = now;
        e.preventDefault();
        const prefix = typeAheadPrefixRef.current;
        const sorted = getSortedContentsForActivePane();
        const matchMode = searchRt.typeAheadMatch || 'Match at beginning';
        const matches = sorted.filter((item: any) =>
          matchesTypeAhead(
            getDisplayName(item, config),
            prefix,
            matchMode,
            searchRt.ignoreDiacritics,
          ),
        );
        if (!matches.length) {
          if (!withinWindow) typeAheadPrefixRef.current = '';
          return;
        }

        let match = matches[0];
        if (repeatCycle && matches.length > 1) {
          const focusIdx = matches.findIndex((item: any) => item.id === focusedItemId);
          const nextIdx = focusIdx >= 0 ? (focusIdx + 1) % matches.length : 0;
          match = matches[nextIdx];
        } else if (!repeatCycle && matches.length > 1 && focusedItemId) {
          const focusIdx = matches.findIndex((item: any) => item.id === focusedItemId);
          if (focusIdx >= 0 && prefix.length > 1) {
            match = matches[focusIdx] ?? matches[0];
          }
        }

        if (match) {
          setFocusedItemId(match.id);
          setSelectedItems([match.id], activePaneId);
          selectionAnchorRef.current = { paneId: activePaneId, itemId: match.id };
          scheduleSelectionChrome([match.id], true);
          scheduleQuickActionsBar(true, true);
          const el = document.getElementById(`fs-item-${match.id}`);
          if (el) el.scrollIntoView({ block: 'nearest' });
        }
        return;
      }

      if (matchesShortcut(e, keyboardMap.delete)) {
         const activePane = panes.find(p => p.id === activePaneId);
         if (activePane) {
             const tab = activePane.tabs[activePane.activeTabIndex];
             if (tab.selectedItems.length > 0) {
                 const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
                 const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                 if (selectedEntities.length > 0) {
                     handleDeleteRequest(selectedEntities, tab.path, focusedItemId === 'TREE', { permanent: e.shiftKey });
                 }
             }
         }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panes, activePaneId, isDualPane, activePaneIndex, activeTab, fileSystem, focusedItemId, filterText, config, settingsRt, getSortedContentsForActivePane, setClipboardState, executePaste]);

  // Bridge Handler for AI renaming modification
  const handleApplyRename = (operations: RenameOperation[]) => {
     let newFs = fileSystem;
     newFs = updateFileSystem(newFs, activeTab.path, (dir) => {
        for (const op of operations) {
            const fileKey = Object.keys(dir.children).find(k => dir.children[k].name === op.originalName);
            if (fileKey) {
                const node = dir.children[fileKey] as any;
                dir.children[op.newName] = { ...node, name: op.newName, modified: new Date().toISOString() };
                if (node.type === "file") {
                   const parts = op.newName.split('.');
                   (dir.children[op.newName] as any).extension = parts.length > 1 ? parts.pop()! : '';
                }
                delete dir.children[fileKey];
            }
        }
     });
     setFileSystem(newFs);
     setSelectedItems([]); 
  };

    // Retrieves active selected objects for AI manipulation context
    const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
    const rootDriveEntities = drives.map(d => {
        const normalizedName = d.name.replace(/^\/+/, '/');
        return {
            id: `drive-${normalizedName}`,
            name: normalizedName,
            type: "directory",
            path: normalizedName,
            size: d.totalSpace,
            modified: '1970-01-01T00:00:00.000Z',
            created: '1970-01-01T00:00:00.000Z',
            tags: [],
            typeDescription: `${d.label} Drive (${d.format})`,
            driveInfo: d
        };
    });

    let activeContents = currentPath === '/' || currentPath === '/this-pc' ? rootDriveEntities : safeGetDirContents(fileSystem, currentPath);
    if (isGlobal) activeContents = globalSearchResults || [];
    
    const activeFilesMap = activeContents?.filter(c => activeTab.selectedItems.includes(c.id)) || [];

  const paletteActions = useMemo(() => {
    const base = buildDefaultPaletteActions({
      onOpenSettings: () => setIsConfigDialogOpen(true),
      onToggleDualPane: toggleDualPane,
      onOpenBatchRename: () => openBottomPlugin('batch-rename'),
      onOpenFind: () => openBottomPlugin('find'),
      onOpenIconStudio: () => openBottomPlugin('icon-studio'),
      onTogglePreview: togglePreviewPanel,
      onOpenMetadata: () => openBottomPlugin('metadata'),
      onSaveTabset: () => { setIsSaveTabsetOpen(true); setTabsetNameInput(''); },
      onFocusFilter: () => omniFilterRef.current?.focus(),
      onRefresh: () => {
        const pane = panes.find(p => p.id === activePaneId);
        const path = pane?.tabs[pane.activeTabIndex]?.path || currentPath;
        void refetchPath(path);
        setToastMessage('Folder refreshed.');
      },
      onToggleSyncScroll: () => {
        const enabled = config.syncDualPaneScroll !== false;
        const next = !enabled;
        updateConfig({ syncDualPaneScroll: next });
        setToastMessage(next ? 'Dual pane sync scroll enabled.' : 'Dual pane sync scroll disabled.');
      },
      onNewFindingTab: () => {
        const q = filterText.trim() || prompt('Finding tab search query:') || '';
        if (q) addFindingTab(activePaneId, q);
      },
    });
    const scriptHandlers = {
      paneId: activePaneId,
      tabPath: currentPath,
      refresh: () => { void refetchPath(currentPath); },
      toggleDualPane,
      openInspector: () => { setIsPreviewPanelOpen(true); updateConfig({ previewPanelOpen: true }); },
      openFindPlugin: () => openBottomPlugin('find'),
      openBatchRename: () => openBottomPlugin('batch-rename'),
      syncPanes: syncPanesToSamePath,
      saveTabset: () => { setIsSaveTabsetOpen(true); setTabsetNameInput(''); },
      focusFilter: () => omniFilterRef.current?.focus(),
      openSettings: () => { setConfigInitialTab(undefined); setIsConfigDialogOpen(true); },
      newFindingTab: (q: string) => addFindingTab(activePaneId, q),
      navigate: (p: string) => setCurrentPath(p, activePaneId),
      setFilter: setFilterText,
      toast: setToastMessage,
    };
    const udc = config.userDefinedCommands !== false
      ? userCommandsToPalette(mergeUserCommands(config.customUserCommands), scriptHandlers)
      : [];
    return [...base, ...udc];
  }, [panes, activePaneId, currentPath, config.syncDualPaneScroll, config.userDefinedCommands, filterText]);

  // --- Subcomponents ---
  const renderPane = (pane: PaneState, index: number) => {
    const isActive = pane.id === activePaneId;
    const currentTab = resolvePaneTab(pane);
    if (!currentTab) {
      return (
        <div key={pane.id} className="flex-1 flex items-center justify-center text-gray-500 text-sm min-h-0">
          No active tab
        </div>
      );
    }
    const isNeutralDefault = currentTab.viewMode === undefined;
    const computedViewMode = currentTab.viewMode || 'details';
    const compactRowHeight = settingsRt.ui.rowHeight;
    const detailsRowHeight = isNeutralDefault ? compactRowHeight : 28;
    const detailsIconSize = isNeutralDefault ? 14 : listIconSz;
    const detailsIconColClass = isNeutralDefault ? 'w-5' : 'w-6';
    const panePath = currentTab.path;
    const isFindingTabActive = isFindingTab(currentTab);
    const isGlobal = isFindingTabActive || (isActive && config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> '));
    
    const normPanePath = normalizePanePath(panePath);
    const isThisPc = normPanePath === '/' || normPanePath === '/this-pc';
    let contents = isThisPc ? rootDriveEntities : safeGetDirContents(fileSystem, panePath);
    if (!isThisPc && pathContentsCache[normPanePath]?.length) {
      contents = pathContentsCache[normPanePath];
    }
    let isPaneLoading = !isThisPc
      && loadingPaths.has(normPanePath)
      && pathContentsCache[normPanePath] === undefined;

    if (isPaneLoading) contents = null; // show spinner only when no cached data yet

    if (isFindingTabActive) {
        if (currentTab.findingLoading) {
            contents = [];
        } else {
            contents = currentTab.findingResults || [];
        }
    } else if (isGlobal) {
        if (isGlobalSearchLoading) {
            // Render loading indicator
            contents = [];
        } else if (globalSearchResults) {
            contents = globalSearchResults.filter((item: any) => {
              if (globalSearchKindFilter === 'all') return true;
              if (globalSearchKindFilter === 'folders') return item.type === 'directory' || item.isDirectory === true;
              if (globalSearchKindFilter === 'files') return item.type !== 'directory';
              if (globalSearchKindFilter === 'media') {
                const ext = String(item.name || '').split('.').pop()?.toLowerCase() || '';
                return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext);
              }
              return true;
            });
        } else {
            contents = [];
        }
    } else if (contents && isActive && filterText.trim() !== '') {
        contents = filterByName(contents, filterText);
    }

    if (contents && !isGlobal && !isFindingTabActive) {
      if (listKindFilter !== 'all') {
        contents = contents.filter((item: any) => matchesListKindFilter(item, listKindFilter));
      }
      if (activeTagFilter) {
        contents = contents.filter((item: any) => matchesTagFilter(item, activeTagFilter));
      }
    }

    if (contents && pane.filterRegex && pane.filterRegex.trim() !== '') {
        try {
            // Allow string search as well as regex
            const regex = new RegExp(pane.filterRegex, 'i');
            contents = contents.filter(item => regex.test(item.name));
        } catch (e) {
            // fallback to plain string match if invalid regex
            contents = contents.filter(item => item.name.toLowerCase().includes(pane.filterRegex!.toLowerCase()));
        }
    }

    if (contents) {
        contents = sortEntities(filterListEntities(contents, config), config, {
            sortColumn: pane.sortColumn,
            sortDirection: pane.sortDirection,
        });
    }

    const listGroupBy = (config.listGroupBy as ListGroupBy) || 'none';
    const listRows = contents && computedViewMode === 'details' && listGroupBy !== 'none'
      ? flattenGroupedList(contents, listGroupBy)
      : (contents || []);

    const mouseRt = settingsRt.mouse;

    const buildEntityPath = (ent: any) => {
      if (ent?.path && (isGlobal || isBndzVirtualPath(panePath) || filterText.trimStart().startsWith('> '))) {
        return toPanePath(ent.path);
      }
      if (ent?.isShellItem && ent.path) {
        return toPanePath(ent.path);
      }
      if (ent.type === 'directory') {
        let newPath = isGlobal && ent.path ? ent.path :
          panePath === '/' ? (ent.name.startsWith('/') ? ent.name : `/${ent.name}`) :
          `${panePath}/${ent.name}`;
        if (newPath.startsWith('///')) newPath = '/' + newPath.substring(3);
        else if (newPath.startsWith('//') && !newPath.includes('.')) newPath = '/' + newPath.substring(2);
        return newPath;
      }
      return isGlobal && ent.path ? ent.path : joinPanePath(panePath, ent);
    };

    const openEntity = (entity: any) => {
      if (entity.type === 'directory') {
        setCurrentPath(buildEntityPath(entity), pane.id);
        if (isGlobal) {
          setFilterText('');
          omniFilterRef.current?.blur();
        }
      } else {
        import('../lib/ipcBridge').then(({ IPC }) => {
          IPC.executeContextMenuVerb(toWindowsPath(buildEntityPath(entity)), 'open');
        });
      }
    };

    const mouseItemHandlers = {
      openEntity,
      openOppositePane: (path: string) => openFolderInOppositePane(path, pane.id),
      openBackgroundTab: (path: string) => addTab(pane.id, path),
      showProperties: () => openBottomPlugin('properties'),
      toggleSelect: (entityId: string) => {
        setSelectedItems(prev => prev.includes(entityId) ? prev.filter(x => x !== entityId) : [...prev, entityId], pane.id);
      },
      buildPath: (ent: any) => ent?.type === 'directory' ? buildEntityPath(ent) : null,
    };

    const handleEntityClicked = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setActivePaneId(pane.id);

      const entity = contents?.find((x: any) => x.id === id)
        || safeGetDirContents(fileSystem, panePath)?.find((x: any) => x.id === id);

      const bindingKey = resolveMouseBindingKey(0, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
      if (entity && bindingKey) {
        const handled = dispatchMouseItemBinding(
          config, bindingKey, entity, mouseItemHandlers, buildCeaHandlers(pane.id),
        );
        if (handled) return;
      }

      const wasAlreadySelected = currentTab.selectedItems.length === 1 && currentTab.selectedItems[0] === id;

      setFocusedItemId(id);
      if (e.ctrlKey || e.metaKey) {
        const next = currentTab.selectedItems.includes(id)
          ? currentTab.selectedItems.filter(x => x !== id)
          : [...currentTab.selectedItems, id];
        setSelectedItems(next, pane.id);
        scheduleSelectionChrome(next, true);
        scheduleQuickActionsBar(next.length > 0, true);
        selectionAnchorRef.current = { paneId: pane.id, itemId: id };
        setLastClickData(null);
      } else if (e.shiftKey) {
        const visibleItems = (listRows || []).filter((item: any) => !isGroupHeaderRow(item));
        const anchor = selectionAnchorRef.current?.paneId === pane.id
          ? selectionAnchorRef.current.itemId
          : (focusedItemId || currentTab.selectedItems[0] || id);
        const anchorIndex = visibleItems.findIndex((item: any) => item.id === anchor);
        const targetIndex = visibleItems.findIndex((item: any) => item.id === id);
        const next = anchorIndex >= 0 && targetIndex >= 0
          ? visibleItems
              .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
              .map((item: any) => item.id)
          : [id];
        setSelectedItems(next, pane.id);
        scheduleSelectionChrome(next, true);
        scheduleQuickActionsBar(true, true);
        setLastClickData(null);
      } else {
        setSelectedItems([id], pane.id);
        scheduleSelectionChrome([id], true);
        scheduleQuickActionsBar(true, false);
        selectionAnchorRef.current = { paneId: pane.id, itemId: id };

        if (mouseRt.singleClickOpen && entity?.type === 'directory') {
          openEntity(entity);
          return;
        }

        const now = Date.now();
        if (wasAlreadySelected) {
          advanceSlowDoubleClickRename({
            key: id,
            wasAlreadyActive: true,
            lastClick: lastClickData ? { key: lastClickData.id, time: lastClickData.time } : null,
            now,
            timerRef: renameTimerRef,
            onRename: () => {
              if (entity) beginInlineRename(panePath, id, entity);
            },
          });
          setLastClickData({ id, time: now });
          if (renameTimerRef.current) return;
        } else {
          clearSlowDoubleClickTimer(renameTimerRef);
          setLastClickData({ id, time: now });
        }
      }
    };
    listGestureClickRef.current = handleEntityClicked;

    /** Right-click selection only — never open/navigate (avoids dual-pane surprise opens). */
    const selectEntityForContextMenu = (entityId: string) => {
      setActivePaneId(pane.id);
      setFocusedItemId(entityId);
      const isPart = currentTab.selectedItems.includes(entityId);
      if (!isPart) {
        setSelectedItems([entityId], pane.id);
        scheduleSelectionChrome([entityId], true);
        scheduleQuickActionsBar(true, true);
      }
      setLastClickData(null);
      setInlineRename(null);
    };

    const handleEntityDoubleClicked = (entity: any) => {
      clearSlowDoubleClickTimer(renameTimerRef);
      setActivePaneId(pane.id);
      setFocusedItemId(entity.id);
      scheduleSelectionChrome([entity.id], true);
      scheduleQuickActionsBar(false);
      setLastClickData(null);
      setInlineRename(null);
      if (mouseRt.doubleClickOpen) openEntity(entity);
    };

    const handleEntityMiddleClick = (e: React.MouseEvent, entity: any) => {
      // auxclick fires for BOTH middle (1) and right (2) buttons; only act on middle.
      // Right-click must fall through to the context-menu handler, never open a pane.
      if (e.button !== 1) return;
      e.preventDefault();
      if (entity.type !== 'directory') return;
      const newPath = buildEntityPath(entity);
      const bindingKey = resolveMouseBindingKey(e.button, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
      if (bindingKey) {
        const handled = dispatchMouseItemBinding(
          config, bindingKey, entity, mouseItemHandlers, buildCeaHandlers(pane.id),
        );
        if (handled) return;
      }
      const handled = dispatchCustomEvent(config, 'middle-click-folder', buildCeaHandlers(pane.id), { path: newPath });
      if (!handled) openFolderInOppositePane(newPath, pane.id);
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isActive && isDualPane) setActivePaneId(pane.id);
      const copy = e.ctrlKey || e.altKey;
      dropModifierRef.current.copy = copy;
      e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
    };

    const visibleListColumns = getVisibleListColumns(config, { isGlobalSearch: isGlobal });

    let maxFolderSizeInDir = 0;
    const dirItemsForSize = pathContentsCache[normPanePath] || contents || [];
    for (const ent of dirItemsForSize) {
      if (ent.type !== 'directory') continue;
      const key = toWindowsPath(joinPanePath(normPanePath, ent)).toLowerCase();
      const sz = folderSizeMap[key];
      if (typeof sz === 'number' && sz > maxFolderSizeInDir) maxFolderSizeInDir = sz;
    }

    const renderDetailColumn = (
      colId: ListColumnId,
      entity: any,
      opts: {
        isDir: boolean;
        displayName: React.ReactNode;
        renameInput: React.ReactNode;
        filterResult: VisualFilter | null;
        filterColor?: string;
        entityTags: string[];
        panePath: string;
      },
    ) => {
      const { isDir, displayName, renameInput, filterResult, filterColor, entityTags, panePath } = opts;
      const textStyle = filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {};
      const mutedColClass = settingsRt.list.lighterDetailColumns ? 'bndz-detail-col-muted' : '';
      const customColId = parseCustomColumnListId(colId);
      if (customColId) {
        const colDef = resolveCustomColumns(config).find(c => c.id === customColId);
        if (!colDef) return null;
        return (
          <CustomColumnCell
            key={colId}
            colId={colId}
            entity={entity}
            panePath={panePath}
            propertyKey={colDef.propertyKey}
            pattern={colDef.pattern}
          />
        );
      }
      switch (colId) {
        case 'name':
          return (
            <div key={colId} className="bndz-list-select-cell px-2 whitespace-nowrap overflow-hidden text-ellipsis shadow-none focus:outline-none flex items-center gap-1.5" style={textStyle}>
              {settingsRt.list.showTags && entityTags.length > 0 && (
                <span className="flex items-center gap-0.5 shrink-0">
                  {entityTags.slice(0, 3).map(t => (
                    <TagBadge key={t} tagKey={t} catalog={availableTags} compact />
                  ))}
                </span>
              )}
              {renameInput || displayName}
            </div>
          );
        case 'type':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 bndz-list-col-muted whitespace-nowrap overflow-hidden text-ellipsis text-gray-400 ${mutedColClass}`}>
              {entity.typeDescription || (isDir ? 'File Folder' : `${(entity as any).extension || ''} File`)}
            </div>
          );
        case 'size': {
          const folderKey = toWindowsPath(joinPanePath(panePath, entity)).toLowerCase();
          const folderBytes = isDir ? folderSizeMap[folderKey] : undefined;
          const sizeLabel = isDir ? formatFolderSizeLabel(
            folderBytes,
            {
              alwaysShowFolderSizes: config.alwaysShowFolderSizes,
              cacheFolderSizes: config.cacheFolderSizes,
              showCachedFolderSizesOnly: config.showCachedFolderSizesOnly,
            },
            formatSize,
          ) : formatSize((entity as any).size);
          const barPct = isDir && maxFolderSizeInDir > 0 && folderBytes
            ? Math.max(4, Math.round((folderBytes / maxFolderSizeInDir) * 100))
            : 0;
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-right text-gray-400 flex justify-end items-center gap-2 ${mutedColClass}`}>
              {barPct > 0 && (
                <SizeBar
                  percent={barPct}
                  isDir={isDir}
                  style={(config.folderSizeBarStyle || 'bar') as SizeBarStyle}
                  className="hidden sm:inline-flex"
                />
              )}
              {sizeLabel}
              {filterResult?.badgeColor && (
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: filterResult.badgeColor }} title={filterResult.name} />
              )}
            </div>
          );
        }
        case 'modified':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`}>
              {formatFsDateTime(entity.modified)}
            </div>
          );
        case 'created':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`}>
              {formatFsDateTime((entity as any).created)}
            </div>
          );
        case 'attributes':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-500 font-mono text-[10px] tracking-wider whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`} title={(entity.attributes || []).join(', ')}>
              {formatAttributesLabel(entity.attributes)}
            </div>
          );
        case 'tags':
          return (
            <div key={colId} className="bndz-list-select-cell px-2 flex gap-1 h-full items-center flex-wrap">
              {entityTags.map(t => (
                <TagBadge key={t} tagKey={t} catalog={availableTags} />
              ))}
            </div>
          );
        case 'label':
          return (
            <div key={colId} className="px-2 text-violet-300/90 whitespace-nowrap overflow-hidden text-ellipsis text-[11px]" title={(entity as any).label || ''}>
              {(entity as any).label || ''}
            </div>
          );
        case 'comment':
          return (
            <div key={colId} className="px-2 text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] italic" title={(entity as any).comment || ''}>
              {(entity as any).comment || ''}
            </div>
          );
        case 'path':
          return (
            <div key={colId} className="bndz-list-select-cell px-2 text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis font-mono text-[10px]" title={entity.path || joinPanePath(panePath, entity)}>
              {(entity.path || joinPanePath(panePath, entity)).replace(/^\//, '')}
            </div>
          );
        default:
          return null;
      }
    };

    const buildDragPaths = (anchorEntityId: string, selectionOverride?: string[]): string[] => {
      const anchorEntity = contents?.find((c: any) => c.id === anchorEntityId);
      if (!anchorEntity) return [];
      const selection = selectionOverride ?? currentTab.selectedItems;
      let paths: string[];
      if (selection.includes(anchorEntityId) && selection.length > 0) {
        paths = selection.map((sid: string) => {
          const se = contents?.find((c: any) => c.id === sid);
          if (!se) return null;
          return isGlobal && se.path ? se.path : joinPanePath(panePath, se);
        }).filter(Boolean) as string[];
      } else {
        paths = [joinPanePath(panePath, anchorEntity)];
      }
      return paths.map(p => toWindowsPath(p));
    };

    const handleDrop = (e: React.DragEvent, dropTargetIdOverride?: string | null, destPanePathOverride?: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragTargetHighlight(null);
      setActivePaneId(pane.id);
      if (isBndzVirtualPath(panePath)) {
        setToastMessage('Smart views are read-only. Open a folder to move or copy files.');
        return;
      }
      try {
        let destPath = destPanePathOverride ?? panePath;
        if (dropTargetIdOverride) {
          const targetEntity = contents?.find(c => c.id === dropTargetIdOverride);
          if (targetEntity?.type === 'directory') {
            destPath = joinPanePath(destPath, targetEntity);
          }
        }
        const destWin = toWindowsPath(destPath);
        const dataStr = e.dataTransfer.getData('application/bndz-file');
        let payloadCopy = false;
        if (dataStr) {
          try { payloadCopy = !!JSON.parse(dataStr).copy; } catch { /* ignore */ }
        }
        const op = (payloadCopy || dropModifierRef.current.copy || e.ctrlKey || e.altKey) ? 'copy' : 'move';
        const shellRt = settingsRt.shell;

        const runDrop = async (sourcePaths: string[], sourcePath?: string) => {
          if (shellRt.confirmDrag) {
            const label = sourcePaths.length === 1
              ? (sourcePaths[0].split(/[/\\]/).pop() || 'item')
              : `${sourcePaths.length} items`;
            const verb = op === 'copy' ? 'Copy' : 'Move';
            const approved = await confirm({
              title: `${verb} ${sourcePaths.length === 1 ? 'Item' : 'Items'}`,
              message: `${verb} ${label} to ${destPath}?`,
              type: 'warning',
              confirmLabel: verb,
            });
            if (!approved) return;
          }
          executeInternalDrop(op, sourcePaths, destWin, sourcePath);
        };

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const filePaths = Array.from(e.dataTransfer.files).map(f => (f as any).path).filter(Boolean);
          if (filePaths.length > 0) {
            runDrop(filePaths);
            return;
          }
        }

        const plain = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('Text');
        if (plain?.trim()) {
          const lines = plain.split(/\r?\n/).map(line => {
            let s = line.trim();
            if (/^file:\/\//i.test(s)) {
              try {
                s = decodeURIComponent(s.replace(/^file:\/\//i, '')).replace(/\//g, '\\');
              } catch {
                s = s.replace(/^file:\/\//i, '').replace(/\//g, '\\');
              }
            }
            return s;
          }).filter(Boolean);
          if (lines.length > 0) {
            runDrop(lines);
            return;
          }
        }

        if (!dataStr) return;
        const data = JSON.parse(dataStr);
        const sourcePaths: string[] = (data.paths || []).map((p: string) => toWindowsPath(p)).filter(Boolean);
        if (!sourcePaths.length) return;

        const destNorm = toWindowsPath(destPath).toLowerCase();
        const sameLocation = sourcePaths.every(sp => {
          const parent = sp.replace(/[/\\][^/\\]+$/, '');
          return parent.toLowerCase() === destNorm;
        });
        if (sameLocation && op !== 'copy') return;

        runDrop(sourcePaths, data.sourcePath);
      } catch (err) {
         console.error(err);
      }
    };

    return (
      <div 
        key={pane.id}
        data-pane-id={pane.id}
        className={`flex-1 flex flex-col min-w-0 ${config.applyColors ? '' : 'bg-[#1c1c1c]'} ${isActive && isDualPane ? 'shadow-[inset_0_0_0_1px_rgba(59,130,246,0.6)] z-10' : ''} relative`}
        style={config.applyColors ? { backgroundColor: 'var(--list-bg)', color: 'var(--list-text)' } : {}}
        onClick={() => { setActivePaneId(pane.id); }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {config.shadeInactivePane !== false && !isActive && isDualPane && (
           <div className="absolute inset-0 bg-black/15 z-[5] pointer-events-none"></div>
        )}
        {config.branchViewStrip !== false && !isGlobal && !isFindingTabActive && computedViewMode !== 'columns' && contents && (
          <BranchViewStrip
            panePath={panePath}
            contents={contents}
            config={config}
            branchType={typeof config.defaultBranchViewType === 'string' ? config.defaultBranchViewType : undefined}
            onNavigate={(p) => setCurrentPath(p, pane.id)}
          />
        )}
        {isFindingTabActive && (
          <FindingTabToolbar
            tab={currentTab}
            config={config}
            loading={!!currentTab.findingLoading}
            indexedRoots={indexedRoots}
            onChange={(patch) => {
              const merged = { ...currentTab, ...patch };
              setPanes(prev => prev.map(p => p.id !== pane.id ? p : {
                ...p,
                tabs: p.tabs.map(t => t.id !== currentTab.id ? t : merged),
              }));
              const affectsSearch = ['findingScope', 'findingUseRegex', 'findingSearchContent', 'findingBooleanMode', 'findingQuery'].some(k => k in patch);
              if (affectsSearch && merged.findingQuery) {
                void refreshFindingTab(
                  pane.id, currentTab.id, merged.findingQuery,
                  merged.findingRoot || merged.path, merged,
                );
              }
            }}
            onRefresh={() => {
              if (currentTab.findingQuery) {
                void refreshFindingTab(
                  pane.id, currentTab.id, currentTab.findingQuery,
                  currentTab.findingRoot || currentTab.path, currentTab,
                );
              }
            }}
          />
        )}
        {/* Tab Strip */}
        <div className="bndz-chrome-tabstrip flex pt-1 px-1 shrink-0 overflow-x-auto border-b border-[#333] items-end scrollbar-hidden" style={{ minHeight: config.tabBarHeight || 28, background: 'var(--bndz-surface-chrome)' }}>
           {pane.tabs.map((tab, idx) => {
             const isTabActive = idx === pane.activeTabIndex;
             const name = isFindingTab(tab) ? findingTabLabel(tab) : getPaneTabLabel(tab.path);
             const isTabDragging = draggedTab?.paneId === pane.id && draggedTab.index === idx;
             const isTabFileDropHover = tabFileDropTarget?.paneId === pane.id && tabFileDropTarget.tabIndex === idx;
             const tabDropBefore = tabDropIndicator?.paneId === pane.id && tabDropIndicator.index === idx && tabDropIndicator.side === 'before';
             const tabDropAfter = tabDropIndicator?.paneId === pane.id && tabDropIndicator.index === idx && tabDropIndicator.side === 'after';
             return (
               <div 
                 key={tab.id}
                 data-tab-id={tab.id}
                 data-tab-index={idx}
                 draggable={!tab.locked}
                 className={`relative bndz-tab-item flex items-center px-3 py-[4px] ml-[2px] rounded-t z-10 -mb-[1px] cursor-pointer group border-t border-l border-r transition-all duration-200 ease-out ${config.flexibleTabWidth ? 'max-w-[180px]' : 'max-w-[200px]'} ${isTabActive ? 'bndz-tab-active border-[#333]' : 'border-transparent hover:border-[#333]'} ${config.makeSelectedTabBold && isTabActive ? 'font-bold' : 'font-semibold'} ${isTabDragging ? 'opacity-50' : ''} ${isTabFileDropHover ? 'ring-2 ring-[#0078d4]/70 bg-[#094771]/30' : ''} ${tab.locked ? 'ring-1 ring-inset ring-amber-500/50 bg-[#1a1810]' : ''} ${tabDropBefore ? 'bndz-tab-drop-before' : ''} ${tabDropAfter ? 'bndz-tab-drop-after' : ''}`}
                 onDragStart={(e) => {
                   if (tab.locked) { e.preventDefault(); return; }
                   e.stopPropagation();
                   setDraggedTab({ paneId: pane.id, index: idx });
                   setTabDropIndicator(null);
                   e.dataTransfer.effectAllowed = 'move';
                 }}
                 onDragOver={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   const hasFileDrag = hasBndzFileDrag(e) || (e.dataTransfer.files?.length ?? 0) > 0;
                   if (hasFileDrag) {
                     const copy = e.ctrlKey || e.altKey;
                     dropModifierRef.current.copy = copy;
                     e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
                     setTabFileDropTarget({ paneId: pane.id, tabIndex: idx });
                     setTabDropIndicator(null);
                     scheduleTabSwitchOnFileDrag(pane.id, idx);
                     return;
                   }
                   if (!draggedTab || draggedTab.paneId !== pane.id || draggedTab.index === idx) return;
                   const rect = e.currentTarget.getBoundingClientRect();
                   const side = dropSideFromPointer(e.clientX, e.clientY, rect, 'x');
                   setTabDropIndicator(prev =>
                     prev?.paneId === pane.id && prev.index === idx && prev.side === side
                       ? prev
                       : { paneId: pane.id, index: idx, side },
                   );
                 }}
                 onDragLeave={(e) => {
                   if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                     if (tabFileDropTarget?.paneId === pane.id && tabFileDropTarget.tabIndex === idx) {
                       setTabFileDropTarget(null);
                     }
                     if (tabDropIndicator?.paneId === pane.id && tabDropIndicator.index === idx) {
                       setTabDropIndicator(null);
                     }
                     if (tabFileDragHoverRef.current?.paneId === pane.id && tabFileDragHoverRef.current?.tabIndex === idx) {
                       tabFileDragHoverRef.current = null;
                       clearTabFileDragTimer();
                     }
                   }
                 }}
                 onDrop={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   clearTabFileDragTimer();
                   setTabFileDropTarget(null);
                   tabFileDragHoverRef.current = null;
                   const hasFileDrag = hasBndzFileDrag(e) || (e.dataTransfer.files?.length ?? 0) > 0;
                   if (hasFileDrag) {
                     const targetTab = pane.tabs[idx];
                     setActiveTab(pane.id, idx);
                     handleDrop(e, null, targetTab.path);
                     setTabDropIndicator(null);
                     return;
                   }
                   if (draggedTab && draggedTab.paneId === pane.id && tabDropIndicator?.paneId === pane.id) {
                     const insertIdx = computeReorderInsertIndex(
                       draggedTab.index,
                       tabDropIndicator.index,
                       tabDropIndicator.side === 'after',
                     );
                     reorderTab(pane.id, draggedTab.index, insertIdx);
                   }
                   setDraggedTab(null);
                   setTabDropIndicator(null);
                 }}
                 onDragEnd={() => { setDraggedTab(null); setTabDropIndicator(null); }}
                 onClick={(e) => { e.stopPropagation(); setActiveTab(pane.id, idx); }}
                 onAuxClick={(e) => {
                   if (e.button !== 1) return;
                   e.preventDefault();
                   e.stopPropagation();
                   dispatchCustomEvent(config, 'middle-click-tab', buildCeaHandlers(pane.id, idx));
                 }}
                 onContextMenu={(e) => {
                   e.preventDefault();
                   e.stopPropagation();
                   setTabContextMenu({ x: e.clientX, y: e.clientY, paneId: pane.id, tabIndex: idx });
                 }}
                 style={{
                   ...(config.applyColors ? {
                    backgroundColor: isTabActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
                    color: isTabActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)'
                 } : {
                    backgroundColor: isTabActive ? 'var(--bndz-surface-raised)' : 'var(--bndz-surface-chrome)',
                    color: isTabActive ? '#6db4e6' : '#6b7280'
                 }),
                   ...tabAccentStyle(tab.color, isTabActive),
                 }}
               >
                 {config.showIconsTabs !== false && (
                    <span className="mr-1.5 shrink-0">
                      <ShellNativeIcon
                        path={tab.path}
                        isDir={tab.path !== '/' && !tab.path.match(/^\/[A-Za-z]:$/)}
                        size={12}
                        eager
                      />
                    </span>
                 )}
                 {tab.locked && <Icons8Icon id="lock_ui" size={10} className="mr-1 shrink-0" title="Locked" />}
                 <span className="truncate" style={{ fontSize: config.tabFontSize || 11 }}>{name}</span>
                 {config.showXCloseButtonsOnTabs !== "None" && pane.tabs.length > 1 && (config.showXCloseButtonsOnTabs === "All tabs" || isTabActive) && (
                    <span className="ml-2 opacity-70 hover:opacity-100 cursor-pointer" onClick={(e) => closeTabAt(pane.id, idx, e)}><CloseGlyph size={12} /></span>
                 )}
               </div>
             );
           })}
           {config.showNewTabButton !== false && (
             <div 
               className={`ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-pointer text-gray-400 font-bold transition-colors ${newTabDropPaneId === pane.id ? 'ring-1 ring-inset ring-[#0078d4]/60 bg-[#333]' : ''}`}
               data-new-tab-zone={pane.id}
               title="New tab · Drop a folder here to open it in a new tab"
               onClick={(e) => { e.stopPropagation(); addTab(pane.id, currentTab.path); }}
               onDragOver={e => {
                 const hasFileDrag = hasBndzFileDrag(e) || (e.dataTransfer.files?.length ?? 0) > 0;
                 if (hasFileDrag) {
                   e.preventDefault();
                   e.stopPropagation();
                   e.dataTransfer.dropEffect = 'move';
                   setNewTabDropPaneId(pane.id);
                 }
               }}
               onDragLeave={() => { if (newTabDropPaneId === pane.id) setNewTabDropPaneId(null); }}
               onDrop={e => {
                 e.preventDefault();
                 e.stopPropagation();
                 setNewTabDropPaneId(null);
                 const bndzPayload = readBndzFileDragData(e);
                 if (bndzPayload?.paths?.length) {
                   const folderPath = bndzPayload.paths.find(p => !p.match(/\.[^/\\]+$/)) || bndzPayload.paths[0];
                   const panePathNorm = folderPath.replace(/\\/g, '/');
                   addTab(pane.id, panePathNorm.startsWith('/') ? panePathNorm : `/${panePathNorm}`);
                   return;
                 }
                 if (e.dataTransfer.files?.length) {
                   const filePaths = Array.from(e.dataTransfer.files).map((f: any) => f.path).filter(Boolean);
                   if (filePaths.length) {
                     const folderPath = filePaths[0].replace(/[/\\][^/\\]+$/, '').replace(/\\/g, '/');
                     addTab(pane.id, folderPath.startsWith('/') ? folderPath : `/${folderPath}`);
                   }
                 }
               }}
             >
               <span className="text-[14px] leading-tight">+</span>
             </div>
           )}
           {config.showTabListButton && (
             <div 
               className="ml-1 px-2 py-[2px] hover:bg-[#333] rounded-t flex items-center justify-center cursor-pointer text-gray-400"
             >
               <Icons8Icon id="layers_ui" size={12} />
             </div>
           )}
        </div>
        
        {/* Breadcrumb Row */}
        <div className={`flex ${config.applyColors ? '' : 'bg-[#1a1a1a]'} border-b border-[#333] items-center px-1 py-[2px] shrink-0 ${isDualPane && !isActive ? 'opacity-90' : ''}`}
             style={config.applyColors ? { backgroundColor: 'var(--breadcrumb-bg)', color: 'var(--breadcrumb-text)' } : {}}>
            <ToolbarButton launcherIcon={launcherIconUrl('nav_back')} className={`w-5 ${currentTab.historyIndex > 0 ? '' : 'opacity-30'}`} onClick={() => goBack(pane.id)} />
            <ToolbarButton launcherIcon={launcherIconUrl('nav_forward')} className={`w-5 ${currentTab.historyIndex < currentTab.history.length - 1 ? '' : 'opacity-30'}`} onClick={() => goForward(pane.id)} />
            <ToolbarButton launcherIcon={launcherIconUrl('nav_up')} className="w-5" onClick={() => goUp(pane.id)} />
            <div 
              className="flex items-center text-[12px] px-1 overflow-x-hidden whitespace-nowrap mask-image-rtl flex-1 cursor-text relative"
              onClick={() => {
                 if (!isGlobal) {
                     if (isDualPane && pane.id !== activePaneId) setActivePaneId(pane.id);
                     setEditingAddressBarPaneId(pane.id);
                     setAddressBarInput(formatAddressBarPath(currentTab.path));
                     setAddressSuggestIndex(0);
                 }
              }}
            >
              {editingAddressBarPaneId === pane.id && !isGlobal ? (
                 <>
                 <input 
                    type="text" 
                    autoFocus 
                    className="flex-1 bg-transparent border-none outline-none text-white w-full" 
                    value={addressBarInput} 
                    onChange={e => { setAddressBarInput(e.target.value); setAddressSuggestIndex(0); }} 
                    onBlur={() => { setTimeout(() => setEditingAddressBarPaneId(null), 150); }}
                    onKeyDown={async e => {
                        if (addressSuggestions.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setAddressSuggestIndex(i => Math.min(i + 1, addressSuggestions.length - 1));
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setAddressSuggestIndex(i => Math.max(i - 1, 0));
                            return;
                          }
                          if (e.key === 'Tab' && addressSuggestions[addressSuggestIndex]) {
                            e.preventDefault();
                            setAddressBarInput(formatAddressBarPath(addressSuggestions[addressSuggestIndex].path));
                            return;
                          }
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const raw = addressBarInput.trim();
                            // XYplorer quick scripts: ::command
                            if (raw.startsWith('::')) {
                              runAddressQuickScriptHandler(raw, pane.id);
                              setEditingAddressBarPaneId(null);
                              return;
                            }
                            const parsedPath = parseUserPathToPane(raw);
                            if (parsedPath && isVirtualCatalogPath(parsedPath)) {
                              setCurrentPath(parsedPath, pane.id);
                              setEditingAddressBarPaneId(null);
                              return;
                            }
                            // XYplorer-style: path ? filter pattern
                            if (raw.includes('?')) {
                              const [pathPart, filterPart] = raw.split('?').map(s => s.trim());
                              const pathFromPart = parseUserPathToPane(pathPart || '') || currentTab.path;
                              let newPath = pathFromPart.replace(/\\/g, '/');
                              if (!newPath.startsWith('/')) newPath = '/' + newPath;
                              import('../lib/ipcBridge').then(async ({ IPC }) => {
                                const exists = await IPC.checkPathExists(newPath);
                                if (exists) {
                                  setCurrentPath(newPath, pane.id);
                                  if (filterPart) setFilterText(filterPart);
                                  setEditingAddressBarPaneId(null);
                                } else {
                                  setEditingAddressBarPaneId(null);
                                }
                              });
                              return;
                            }
                            const newPath = parsedPath;
                            if (!newPath) {
                              setEditingAddressBarPaneId(null);
                              return;
                            }
                            import('../lib/ipcBridge').then(async ({ IPC }) => {
                                const exists = await IPC.checkPathExists(newPath);
                                if (exists) {
                                  setCurrentPath(newPath, pane.id);
                                  setEditingAddressBarPaneId(null);
                                } else {
                                  setEditingAddressBarPaneId(null);
                                }
                            });
                        }
                        if (e.key === 'Escape') setEditingAddressBarPaneId(null);
                    }}
                 />
                 <AddressAutocompleteDropdown
                   suggestions={addressSuggestions}
                   selectedIndex={addressSuggestIndex}
                   onSelect={path => {
                     setCurrentPath(path, pane.id);
                     setEditingAddressBarPaneId(null);
                   }}
                   onHover={setAddressSuggestIndex}
                 />
                 </>
              ) : isGlobal ? (
                 <React.Fragment>
                    <span className="text-gray-500 mx-1 shrink-0">Global Search &gt;</span>
                    <span className="hover:underline cursor-pointer font-semibold shrink-0 text-yellow-400">
                       {filterText.trimStart().substring(2).trim()}
                    </span>
                 </React.Fragment>
              ) : getBreadcrumbSegments(currentTab.path, catalogNameMap).map((seg, idx) => (
                  <React.Fragment key={seg.path}>
                    {idx > 0 && <span className="text-gray-500 mx-1 shrink-0">&gt;</span>}
                    <span
                      className={`hover:underline cursor-pointer font-semibold shrink-0 rounded-[var(--bndz-radius-sm)] transition-colors ${breadcrumbDropTarget === seg.path ? 'bg-[#0078d4]/20 ring-1 ring-[#0078d4]/60 px-1 -mx-1' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.ctrlKey || e.metaKey) { addTab(pane.id, seg.path); return; }
                        if (isDualPane && pane.id !== activePaneId) setActivePaneId(pane.id);
                        setCurrentPath(seg.path, pane.id);
                      }}
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        e.stopPropagation();
                        addTab(pane.id, seg.path);
                      }}
                      onDragOver={(e) => {
                        const isFileDrag = hasBndzFileDrag(e) || e.dataTransfer.types.includes('Files');
                        if (!isFileDrag) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = (e.ctrlKey || e.altKey) ? 'copy' : 'move';
                        if (breadcrumbDropTarget !== seg.path) setBreadcrumbDropTarget(seg.path);
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        if (breadcrumbDropTarget === seg.path) setBreadcrumbDropTarget(null);
                      }}
                      onDrop={(e) => {
                        setBreadcrumbDropTarget(null);
                        const isFileDrag = hasBndzFileDrag(e) || (e.dataTransfer.files?.length ?? 0) > 0;
                        if (!isFileDrag) return;
                        e.preventDefault();
                        e.stopPropagation();
                        handleDrop(e, null, seg.path);
                      }}
                      title="Click to navigate · Ctrl+click or middle-click to open in a new tab · Drop files here to move/copy"
                      data-breadcrumb-path={seg.path}
                    >
                      {seg.label}
                    </span>
                  </React.Fragment>
                ))}
            </div>
            <ToolbarButton
              launcherIcon={launcherIconUrl('lock_ui')}
              className={`w-5 bndz-view-mode-btn ${currentTab.viewLocked ? 'bndz-view-lock-btn--active text-amber-400' : 'opacity-50'}`}
              title={currentTab.viewLocked ? 'Unlock view (sort/filter frozen)' : 'Lock view'}
              onClick={() => toggleViewLock(pane.id)}
            />
            <div className="flex bg-[#222] border border-[#444] rounded-[var(--bndz-radius-sm)] items-center p-[2px] text-[11px] shrink-0 mx-2 gap-[2px]">
                 <button onClick={() => setViewMode('details', pane.id)} className={`bndz-view-mode-btn bndz-view-mode-btn--details w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'details' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Details View (click again for default)">
                     <img src={launcherIconUrl('view_details')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onClick={() => setViewMode('grid', pane.id)} className={`bndz-view-mode-btn bndz-view-mode-btn--grid w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'grid' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Grid View (click again for default)">
                     <img src={launcherIconUrl('view_grid')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onClick={() => setViewMode('list', pane.id)} className={`bndz-view-mode-btn bndz-view-mode-btn--list w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'list' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="List View (click again for default)">
                     <img src={launcherIconUrl('view_list')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onClick={() => setViewMode('columns', pane.id)} className={`bndz-view-mode-btn bndz-view-mode-btn--columns w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'columns' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Columns View (click again for default)">
                     <img src={launcherIconUrl('view_columns')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onClick={() => setViewMode('size', pane.id)} className={`bndz-view-mode-btn bndz-view-mode-btn--size w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'size' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Size map">
                     <img src={launcherIconUrl('folder_size_sync')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
            </div>
            {/* Fixed-width slot keeps the filter box from shifting when the view changes */}
            <div className="w-[124px] shrink-0 mx-1 flex items-center">
              {computedViewMode === 'details' && (
                <select
                  value={listGroupBy}
                  onChange={e => updateConfig({ listGroupBy: e.target.value as ListGroupBy })}
                  className="bg-[#222] border border-[#444] rounded-[var(--bndz-radius-sm)] text-[10px] px-1.5 py-0.5 w-full text-gray-300"
                  title="Group by"
                >
                  {LIST_GROUP_BY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>Group: {o.label}</option>
                  ))}
                </select>
              )}
              {(computedViewMode === 'grid' || computedViewMode === 'list') && (
                <input
                  type="range"
                  min={12}
                  max={72}
                  value={computedViewMode === 'grid' ? gridIconSz : listIconSz}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (computedViewMode === 'grid') updateConfig({ gridIconSize: v });
                    else updateConfig({ listIconSize: v });
                  }}
                  className="w-full h-1 accent-[#0078d4]"
                  title="Icon size"
                />
              )}
            </div>
            <div className="flex bg-[#222] border border-[#444] rounded items-center px-2 py-0.5 mx-2 text-[11px] shrink-0 w-[140px] focus-within:w-[200px] focus-within:border-[#0078d4] transition-all duration-200">
               <Icons8Icon id="search" size={12} className="mr-1.5 opacity-60" />
               <input
                   type="text"
                   placeholder="Regex Filter..."
                   className="bg-transparent border-none outline-none text-gray-200 flex-1 placeholder:text-gray-600"
                   value={pane.filterRegex || ''}
                   onChange={(e) => {
                       if (currentTab.viewLocked) {
                         setToastMessage('View is locked. Unlock to change filter.');
                         return;
                       }
                       const newPanes = [...panes];
                       const p = newPanes.find(x => x.id === pane.id);
                       if (p) p.filterRegex = e.target.value;
                       setPanes(newPanes);
                   }}
               />
            </div>
        </div>

        {/* Grid Header */}
        {(computedViewMode === 'details') && settingsRt.list.showSortHeaders && (
        <div
           className={`fs-list-header flex text-[#9ca3af] text-[11px] py-1.5 shrink-0 px-1 select-none ${!settingsRt.list.verticalGridLines ? '[&>div]:border-r-0' : ''}`}
           onContextMenu={e => { e.preventDefault(); setColumnPicker({ x: e.clientX, y: e.clientY }); }}
        >
           <div className={`${detailsIconColClass} border-r border-[#333]`}></div>
           {getVisibleListColumns(config, { isGlobalSearch: isGlobal }).map(col => (
             <div
               key={col.id}
               className={`group/col ${col.widthClass || 'shrink-0'} relative pl-1 pr-0 border-r border-[#333] flex items-center gap-0.5 ${col.sortable ? 'cursor-pointer hover:bg-[#2a2a2a]' : ''} ${col.align === 'right' ? 'text-right' : ''} ${columnDrag?.sourceId === col.id ? 'opacity-40' : ''} ${columnDrag?.overId === col.id ? (columnDrag.overSide === 'before' ? 'bndz-col-drop-before' : 'bndz-col-drop-after') : ''}`}
               style={getColumnStyle(col)}
               onMouseDown={col.sortable ? (e) => {
                 if ((e.target as HTMLElement).closest('.bndz-col-resize-handle, .bndz-col-reorder-grip')) return;
                 columnHeaderPressRef.current = { colId: col.id, x: e.clientX, y: e.clientY, moved: false };
               } : undefined}
               onMouseMove={col.sortable ? (e) => {
                 const press = columnHeaderPressRef.current;
                 if (!press || press.colId !== col.id) return;
                 if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) press.moved = true;
               } : undefined}
               onClick={col.sortable ? () => {
                 if (columnResizeActiveRef.current) return;
                 const press = columnHeaderPressRef.current;
                 columnHeaderPressRef.current = null;
                 if (press?.moved || columnDrag) return;
                 toggleSort(pane.id, col.id as SortColumnId);
               } : undefined}
               onDragOver={e => {
                 if (!columnDrag) return;
                 e.preventDefault();
                 const rect = e.currentTarget.getBoundingClientRect();
                 const overSide = dropSideFromPointer(e.clientX, e.clientY, rect, 'x');
                 setColumnDrag(prev => (prev && prev.overId === col.id && prev.overSide === overSide) ? prev : { ...prev!, overId: col.id, overSide });
               }}
               onDrop={e => {
                 e.preventDefault();
                 if (!columnDrag || columnDrag.sourceId === col.id) { setColumnDrag(null); return; }
                 const currentOrder = resolveListColumnOrder(config);
                 const nextOrder = reorderListColumns(currentOrder, columnDrag.sourceId, col.id, columnDrag.overSide === 'after');
                 updateConfig({ listColumnOrder: nextOrder });
                 setColumnDrag(null);
               }}
             >
               <div
                 draggable
                 className="bndz-col-reorder-grip shrink-0 opacity-25 group-hover/col:opacity-55 hover:!opacity-90 cursor-grab active:cursor-grabbing p-0.5 -ml-0.5 rounded"
                 title="Drag to reorder column"
                 onMouseDown={e => e.stopPropagation()}
                 onDragStart={e => {
                   e.stopPropagation();
                   e.dataTransfer.effectAllowed = 'move';
                   e.dataTransfer.setData('text/plain', col.id);
                   setColumnDrag({ sourceId: col.id, overId: null, overSide: 'before' });
                 }}
                 onDragEnd={() => setColumnDrag(null)}
               >
                 <DragHandleGlyph size={10} />
               </div>
               <span className={`flex-1 min-w-0 truncate ${col.align === 'right' ? 'text-right' : ''}`}>{col.label}</span>
               {col.sortable && (() => {
                 const effectiveCol = pane.sortColumn ?? resolveSortColumn(config, pane);
                 const effectiveDir = resolveSortDirection(effectiveCol, pane.sortDirection, config);
                 return effectiveCol === col.id ? (
                   <span className="text-[10px] ml-0.5 shrink-0">{effectiveDir === 'asc' ? '▲' : '▼'}</span>
                 ) : null;
               })()}
               <div
                 draggable={false}
                 className="bndz-col-resize-handle absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-[#0078d4]/30 active:bg-[#0078d4]/45 z-10 touch-none"
                 onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startColumnResize(col.id, e.clientX, e.currentTarget.parentElement as HTMLElement); }}
               />
             </div>
           ))}
        </div>
        )}

        {isGlobal && config.enableBndzIndexedSearch !== false && (
          <SearchToolbar
            scope={indexedSearchScope}
            onScopeChange={setIndexedSearchScope}
            onClear={() => setFilterText('')}
            showFilters
            kindFilter={globalSearchKindFilter}
            onKindFilterChange={setGlobalSearchKindFilter}
          />
        )}

        {!isGlobal && !isFindingTabActive && (
          <ListFilterChips
            value={listKindFilter}
            onChange={setListKindFilter}
          />
        )}

        {/* List Items */}
        <div 
           data-pane-id={pane.id}
           data-list-body
           className={`flex-1 overflow-y-auto p-1 focus:outline-none relative bndz-scrollbar bndz-file-list-scroll bndz-gpu-layer ${marquee && marquee.activePane === pane.id ? 'cursor-crosshair' : 'cursor-default'}`}
           style={config.applyColors ? { color: 'var(--list-text)' } : { color: '#fff' }}
           onScroll={e => handlePaneScroll(pane.id, e)}
           onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); handleDragOver(e); }}
           onDrop={(e) => handleDrop(e)}
           onContextMenu={(e) => {
             if ((e.target as HTMLElement).closest('.fs-item-wrapper')) return;
             void handleContextMenuRequest(e, panePath, null, true, null, undefined, 'list-background');
           }}
           onClick={(e) => {
              if (e.defaultPrevented) return;
              if ((window as any)._marqueeDragOccurred) {
                  (window as any)._marqueeDragOccurred = false;
                  return;
              }
              setSelectedItems([], pane.id);
              selectionAnchorRef.current = null;
              scheduleSelectionChrome([], true);
              scheduleQuickActionsBar(false);
              setLastClickData(null);
              setInlineRename(null);
           }}
           onPointerDownCapture={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest('input, textarea, button, select, a')) return;

              const listEl = e.currentTarget as HTMLElement;
              const ctrlKey = e.ctrlKey || e.metaKey;
              const shiftKey = e.shiftKey;
              (window as any)._marqueeDragOccurred = false;

              const buildSelectMeta = (): MarqueeSelectMeta | undefined =>
                computedViewMode === 'details' && (listRows?.length ?? 0) >= 80
                  ? {
                      rowHeight: detailsRowHeight,
                      items: (listRows || []).flatMap((item: any, rowIndex: number) =>
                        isGroupHeaderRow(item) ? [] : [{ id: item.id, rowIndex }],
                      ),
                    }
                  : undefined;

              const rowEl = (e.target as HTMLElement).closest('.fs-item-wrapper') as HTMLElement | null;
              const onSelectCell = isListSelectCellTarget(e.target);

              if (!rowEl) {
                beginMarqueeGesture(
                  pane.id, listEl, e.clientX, e.clientY,
                  ctrlKey || shiftKey, (ctrlKey || shiftKey) ? [...currentTab.selectedItems] : [],
                  buildSelectMeta(),
                  e.pointerId,
                );
                return;
              }

              if (!onSelectCell) {
                e.preventDefault();
                e.stopPropagation();
                suppressRowClickRef.current = true;
                beginMarqueeGesture(
                  pane.id, listEl, e.clientX, e.clientY,
                  ctrlKey || shiftKey, (ctrlKey || shiftKey) ? [...currentTab.selectedItems] : [],
                  buildSelectMeta(),
                  e.pointerId,
                );
                return;
              }

              // Select cell → row select / drag / double-click
              const entityId = rowEl.getAttribute('data-id');
              if (!entityId) return;
              const wasSelected = currentTab.selectedItems.includes(entityId);
              const startX = e.clientX;
              const startY = e.clientY;
              const capturePointerId = e.pointerId;
              const altKey = e.altKey;

              listGestureRef.current = {
                paneId: pane.id,
                pointerId: capturePointerId,
                startX, startY,
                entityId,
                wasSelected,
                ctrlKey,
                shiftKey,
                altKey,
                moved: false,
                mode: 'pending',
                copyDrag: false,
                dragSelection: wasSelected ? [...currentTab.selectedItems] : [entityId],
                listEl,
              };

              beginDragSession(capturePointerId, startX, startY);
              let oleDragStarted = false;
              let keyModBound = false;

              const syncDragModifiers = (e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
                const copy = isCopyDragModifier(e);
                if (listGestureRef.current?.mode === 'drag') {
                  listGestureRef.current.copyDrag = copy;
                }
                dropModifierRef.current.copy = copy;
                if (listGestureRef.current?.mode === 'drag') {
                  setListDragOperation(copy ? 'copy' : 'move');
                }
              };

              const onKeyMod = (e: KeyboardEvent) => syncDragModifiers(e);

              const bindKeyModifiers = () => {
                if (keyModBound) return;
                keyModBound = true;
                window.addEventListener('keydown', onKeyMod);
                window.addEventListener('keyup', onKeyMod);
              };

              const unbindKeyModifiers = () => {
                if (!keyModBound) return;
                keyModBound = false;
                window.removeEventListener('keydown', onKeyMod);
                window.removeEventListener('keyup', onKeyMod);
              };

              const resolveDropTarget = (clientX: number, clientY: number, targetContents: any[] | null | undefined) => {
                const dropEnt = hitTestListFolderAtPoint(clientX, clientY, targetContents ?? undefined);
                if (dropEnt) {
                  setDragTargetHighlight(dropEnt.id);
                  return dropEnt;
                }
                setDragTargetHighlight(null);
                return null;
              };

              const contentsForPanePath = (tabPath: string) =>
                pathContentsCacheRef.current[normalizePanePath(tabPath)]
                ?? safeGetDirContents(fileSystem, tabPath);

              const resolveTabHoverAtPoint = (clientX: number, clientY: number) => {
                const newTabPaneId = hitTestNewTabZoneAtPoint(clientX, clientY);
                if (newTabPaneId) {
                  setNewTabDropPaneId(newTabPaneId);
                  setTabFileDropTarget(null);
                  return;
                }
                setNewTabDropPaneId(null);
                const tabHit = hitTestTabAtPoint(clientX, clientY);
                if (!tabHit?.tabId) {
                  setTabFileDropTarget(null);
                  return;
                }
                for (const p of panesRef.current) {
                  const idx = p.tabs.findIndex(t => t.id === tabHit.tabId);
                  if (idx >= 0) {
                    activateTabForFileDragImmediate(p.id, idx);
                    break;
                  }
                }
              };

              const resolveBreadcrumbHoverAtPoint = (clientX: number, clientY: number): string | null => {
                const path = hitTestBreadcrumbAtPoint(clientX, clientY);
                setBreadcrumbDropTarget(path);
                return path;
              };

              let ghostThrottler: ((x: number, y: number) => void) | null = null;

              const updateListDragGhost = (ev: PointerEvent) => {
                const g = listGestureRef.current;
                if (!g || g.mode !== 'drag') return;
                const anchorEnt = contents?.find((c: any) => c.id === entityId);
                setListDragGhost({
                  x: ev.clientX,
                  y: ev.clientY,
                  label: anchorEnt?.name || 'Item',
                  count: g.dragSelection.length,
                  copy: g.copyDrag,
                  isDirectory: anchorEnt?.type === 'directory',
                  previewPath: buildDragPaths(entityId, g.dragSelection)[0]
                    ? toWindowsPath(buildDragPaths(entityId, g.dragSelection)[0])
                    : undefined,
                });
              };

              const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== capturePointerId) return;
                if (!listGestureRef.current) return;
                trackDragPointer(ev.clientX, ev.clientY);
                const dx = Math.abs(ev.clientX - startX);
                const dy = Math.abs(ev.clientY - startY);
                const copyHeld = isCopyDragModifier(ev);

                if (listGestureRef.current.mode === 'pending') {
                  if (!hasMetDragThreshold() || !isDragSessionReady()) return;

                  suppressRowClickRef.current = true;
                  (window as any)._marqueeDragOccurred = true;

                  const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
                  if (isListMarqueeSurface(hitEl) || shiftKey) {
                    listGestureRef.current = null;
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    clearDragSession();
                    beginMarqueeGesture(
                      pane.id, listEl, startX, startY,
                      ctrlKey || shiftKey,
                      (ctrlKey || shiftKey) ? [...currentTab.selectedItems] : [],
                      buildSelectMeta(),
                      capturePointerId,
                    );
                    return;
                  }

                  if (mouseRt.disallowDragFromList) {
                    clearDragSession();
                    return;
                  }

                  const copyDrag = copyHeld;
                  let dragSelection = listGestureRef.current.dragSelection;
                  if (!wasSelected) {
                    dragSelection = [entityId];
                    listGestureRef.current.dragSelection = dragSelection;
                    const ops = marqueeOpsRef.current;
                    ops.setSelectedItems(dragSelection, pane.id);
                    ops.scheduleSelectionChrome(dragSelection, true);
                    ops.scheduleQuickActionsBar(true, true);
                    setFocusedItemId(entityId);
                    selectionAnchorRef.current = { paneId: pane.id, itemId: entityId };
                  }

                  listGestureRef.current.mode = 'drag';
                  listGestureRef.current.copyDrag = copyDrag;
                  dropModifierRef.current.copy = copyDrag;
                  internalDragRef.current = true;
                  setListDragOperation(copyDrag ? 'copy' : 'move');
                  const anchorEnt = contents?.find((c: any) => c.id === entityId);
                  const dragPaths = buildDragPaths(entityId, dragSelection);
                  beginFileDragSession({
                    paths: dragPaths,
                    op: copyDrag ? 'copy' : 'move',
                    sourcePaneId: pane.id,
                    sourceTabPath: panePath,
                  });
                  setListDragGhost({
                    x: ev.clientX,
                    y: ev.clientY,
                    label: anchorEnt?.name || 'Item',
                    count: dragSelection.length,
                    copy: copyDrag,
                    isDirectory: anchorEnt?.type === 'directory',
                    previewPath: dragPaths[0] ? toWindowsPath(dragPaths[0]) : undefined,
                  });
                  ghostThrottler = createRafPointerThrottler((x, y) => {
                    updateListDragGhost({ clientX: x, clientY: y } as PointerEvent);
                  });
                  bindKeyModifiers();
                  try { listEl.setPointerCapture(capturePointerId); } catch { /* ignore */ }
                }

                if (listGestureRef.current.mode === 'drag') {
                  syncDragModifiers(ev);
                  const navTreeHover = hitTestNavTreeAtPoint(ev.clientX, ev.clientY);
                  setNavTreeFileDropTarget(navTreeHover);
                  const breadcrumbHover = navTreeHover
                    ? (setBreadcrumbDropTarget(null), null)
                    : resolveBreadcrumbHoverAtPoint(ev.clientX, ev.clientY);
                  resolveTabHoverAtPoint(ev.clientX, ev.clientY);
                  if (!navTreeHover && !breadcrumbHover) {
                    const hover = tabFileDragHoverRef.current;
                    const hoverPath = hover
                      ? panesRef.current.find(p => p.id === hover.paneId)?.tabs[hover.tabIndex]?.path
                      : null;
                    resolveDropTarget(ev.clientX, ev.clientY, hoverPath ? contentsForPanePath(hoverPath) : contents);
                  } else setDragTargetHighlight(null);
                  ghostThrottler?.(ev.clientX, ev.clientY);

                  if (!oleDragStarted && getFileDragSession()) {
                    const overInternalChrome = isInternalFileDragChromeAtPoint(ev.clientX, ev.clientY);
                    if (!overInternalChrome) {
                      const dragPaths = buildDragPaths(entityId, listGestureRef.current.dragSelection);
                      if (dragPaths.length) {
                        oleDragStarted = true;
                        nativeOleDragRef.current = true;
                        internalDragRef.current = false;
                        setListDragOperation(null);
                        setListDragGhost(null);
                        unbindKeyModifiers();
                        listGestureRef.current = null;
                        window.removeEventListener('pointermove', onMove);
                        IPC.startDrag(dragPaths);
                      }
                    }
                  }
                }
              };

              const onUp = (ev: PointerEvent) => {
                if (ev.pointerId !== capturePointerId) return;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                unbindKeyModifiers();
                try { listEl.releasePointerCapture(capturePointerId); } catch { /* ignore */ }

                const gesture = listGestureRef.current;

                if (gesture?.mode === 'drag' && !oleDragStarted) {
                  const newTabZone = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-new-tab-zone]');
                  if (newTabZone) {
                    const targetPaneId = newTabZone.getAttribute('data-new-tab-zone');
                    const dragPaths = buildDragPaths(entityId, gesture.dragSelection);
                    const draggedDirs = gesture.dragSelection
                      .map(id => contents?.find((c: any) => c.id === id))
                      .filter((ent: any) => ent?.type === 'directory');
                    const openPath = draggedDirs.length > 0
                      ? joinPanePath(panePath, draggedDirs[0])
                      : (panesRef.current.find(p => p.id === targetPaneId)?.tabs[panesRef.current.find(p => p.id === targetPaneId)!.activeTabIndex]?.path ?? panePath);
                    if (targetPaneId) addTab(targetPaneId, openPath);
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    setListDragOperation(null);
                    setListDragGhost(null);
                    clearTabFileDragTimer();
                    setTabFileDropTarget(null);
                    setNewTabDropPaneId(null);
                    setBreadcrumbDropTarget(null);
                    setNavTreeFileDropTarget(null);
                    listGestureRef.current = null;
                    return;
                  }
                  const navTreeTarget = hitTestNavTreeAtPoint(ev.clientX, ev.clientY);
                  const breadcrumbTarget = navTreeTarget ? null : resolveBreadcrumbHoverAtPoint(ev.clientX, ev.clientY);
                  const hover = tabFileDragHoverRef.current;
                  if (hover) {
                    clearTabFileDragTimer();
                    flushSync(() => {
                      setActivePaneId(hover.paneId);
                      setPanes(prevPanes => prevPanes.map(p =>
                        p.id === hover.paneId ? { ...p, activeTabIndex: hover.tabIndex } : p,
                      ));
                    });
                  }
                  const dropResolution = resolveFileDropDestination(
                    ev.clientX,
                    ev.clientY,
                    hover,
                    panesRef.current,
                    pane.id,
                    panePath,
                    contentsForPanePath,
                    breadcrumbTarget,
                    navTreeTarget,
                  );
                  if (hover || dropResolution.paneId !== pane.id || dropResolution.tabIndex !== (panesRef.current.find(p => p.id === pane.id)?.activeTabIndex ?? 0)) {
                    flushSync(() => {
                      setActivePaneId(dropResolution.paneId);
                      setPanes(prevPanes => prevPanes.map(p =>
                        p.id === dropResolution.paneId ? { ...p, activeTabIndex: dropResolution.tabIndex } : p,
                      ));
                    });
                  }
                  const targetContents = contentsForPanePath(dropResolution.tabPath);
                  let dropEnt = dropResolution.folderEnt;
                  if (!dropEnt && !breadcrumbTarget && !navTreeTarget) {
                    dropEnt = hitTestListFolderAtPoint(ev.clientX, ev.clientY, targetContents ?? undefined);
                  }
                  const dragPaths = buildDragPaths(entityId, gesture.dragSelection);
                  if (dragPaths.length) {
                    const destPath = navTreeTarget || breadcrumbTarget
                      || (dropEnt?.name ? joinPanePath(dropResolution.tabPath, dropEnt as { name: string; path?: string; id?: string }) : dropResolution.tabPath);
                    const op = resolveDropOperation({
                      payloadCopy: gesture.copyDrag,
                      dropModifierCopy: dropModifierRef.current.copy,
                      ctrlKey: ev.ctrlKey || ev.metaKey,
                      altKey: ev.altKey,
                    });
                    const destWin = toWindowsPath(destPath);
                    const sameLocation = dragPaths.every(sp => {
                      const parent = sp.replace(/[/\\][^/\\]+$/, '');
                      return parent.toLowerCase() === destWin.toLowerCase();
                    });
                    if (!sameLocation || op === 'copy') {
                      executeInternalDrop(op, dragPaths, destWin, panePath);
                    }
                  }
                  setDragTargetHighlight(null);
                  suppressRowClickRef.current = true;
                  internalDragRef.current = false;
                  setListDragOperation(null);
                  setListDragGhost(null);
                  clearTabFileDragTimer();
                } else if (gesture?.mode === 'pending' && !hasMetDragThreshold() && !oleDragStarted) {
                  clearDragSession();
                  suppressRowClickRef.current = true;
                  handleEntityClicked({
                    ctrlKey: gesture.ctrlKey,
                    metaKey: gesture.ctrlKey,
                    shiftKey: gesture.shiftKey,
                    altKey: gesture.altKey,
                    stopPropagation: () => {},
                    preventDefault: () => {},
                  } as React.MouseEvent, gesture.entityId);
                } else if (gesture?.mode === 'pending') {
                  if (!hasMetDragThreshold()) clearDragSession();
                }

                listGestureRef.current = null;
                if (!oleDragStarted) nativeOleDragRef.current = false;
                setListDragOperation(null);
                setListDragGhost(null);
                setBreadcrumbDropTarget(null);
                setNavTreeFileDropTarget(null);
                setTabFileDropTarget(null);
                setNewTabDropPaneId(null);
                clearTabFileDragTimer();
                endFileDragSession();
              };

              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
           }}
        >
          {pathLoadErrors[normPanePath] && !isPaneLoading && (
            <div className="mx-3 mt-2 mb-1 flex items-center gap-2 rounded border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-200">
              <Icons8Icon id="warning" size={14} className="shrink-0 text-rose-300" />
              <span className="flex-1 min-w-0 truncate" title={pathLoadErrors[normPanePath]}>
                {pathLoadErrors[normPanePath]}
              </span>
              <button
                type="button"
                className="shrink-0 px-2 py-0.5 border border-rose-500/40 rounded text-[10px] hover:bg-rose-500/10"
                onClick={() => void refetchPath(normPanePath)}
              >
                Retry
              </button>
            </div>
          )}
          {isPaneLoading && (
             <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500 min-h-[200px]">
               <Icons8Icon id="loading" size={24} spin />
               <span className="text-[11px]">Loading {panePath.split('/').pop() || panePath}...</span>
             </div>
          )}
          {!isPaneLoading && isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading)) && (
             <div className="flex flex-col items-center justify-center h-full gap-3 text-amber-400/80 min-h-[200px]">
               <Icons8Icon id="loading" size={22} spin />
               <span className="text-[11px]">Searching{globalSearchEngine === 'indexed' ? ' local cache' : config.enableEverythingSearch !== false ? ' with Everything' : ''}…</span>
             </div>
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && normPanePath === BNDZ_VIEWS_ROOT && (
            <BndzHubView
              onNavigate={p => setCurrentPath(p, pane.id)}
              onRefresh={() => void refetchPath(BNDZ_VIEWS_ROOT)}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'columns' && normPanePath !== BNDZ_VIEWS_ROOT && (
            <MillerColumnsView
              rootPath={isThisPc ? '/' : panePath}
              selectedPath={panePath}
              pathContentsCache={pathContentsCache}
              config={config}
              onNavigate={(p) => setCurrentPath(p, pane.id)}
              onOpen={(entity, colPath) => openEntity({ ...entity, path: joinPanePath(colPath, entity as any) })}
              onPrefetchPath={(p) => void prefetchPathQuiet(p)}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'size' && normPanePath !== BNDZ_VIEWS_ROOT && (
            (() => {
              const sizeItems = (contents || []).map((ent: any) => {
                const p = buildEntityPath(ent);
                const folderKey = ent.type === 'directory' ? toWindowsPath(p).toLowerCase() : '';
                return {
                  name: ent.name,
                  type: ent.type,
                  size: ent.type === 'directory' ? (folderSizeMap[folderKey] ?? ent.size ?? 4096) : (ent.size || 0),
                  path: p,
                };
              });
              const onScanSizes = () => scanCurrentFolderSizes(true, { manual: true });
              const viz = config.folderSizeVisualization === 'bubbles'
                ? 'bubbles'
                : config.folderSizeVisualization === 'treemap'
                  ? 'treemap'
                  : 'list';
              if (viz === 'bubbles') {
                return <SizeView items={sizeItems} onNavigate={p => setCurrentPath(p, pane.id)} onScanFolderSizes={onScanSizes} />;
              }
              if (viz === 'treemap') {
                return <FolderSizeTreemap items={sizeItems} onNavigate={p => setCurrentPath(p, pane.id)} onScanFolderSizes={onScanSizes} />;
              }
              return (
                <FolderSizeListView
                  items={sizeItems}
                  onNavigate={p => setCurrentPath(p, pane.id)}
                  onOpen={p => import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(p, 'open'))}
                  onScanFolderSizes={onScanSizes}
                />
              );
            })()
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'media' && (
            <BndzMediaView
              items={contents || []}
              fetchError={virtualViewErrors[normPanePath]}
              selectedIds={currentTab.selectedItems}
              buildPath={buildEntityPath}
              onItemClick={(e, entity) => handleEntityClicked(e, entity.id)}
              onItemDoubleClick={openEntity}
              onContextMenu={(e, entity) => {
                void handleContextMenuRequest(
                  e, buildEntityPath(entity), entity.id,
                  entity.type === 'directory', entity.name, undefined, 'list-item',
                );
              }}
              onIndexBuilt={() => void refetchPath(normPanePath)}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'recents' && (
            <BndzRecentsView
              items={contents || []}
              fetchError={virtualViewErrors[normPanePath]}
              selectedIds={currentTab.selectedItems}
              buildPath={buildEntityPath}
              onItemClick={(e, entity) => handleEntityClicked(e, entity.id)}
              onItemDoubleClick={openEntity}
              onContextMenu={(e, entity) => {
                void handleContextMenuRequest(
                  e, buildEntityPath(entity), entity.id,
                  entity.type === 'directory', entity.name, undefined, 'list-item',
                );
              }}
              onIndexBuilt={() => void refetchPath(normPanePath)}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode !== 'columns' && computedViewMode !== 'size' && computedViewMode !== 'media' && computedViewMode !== 'recents' && normPanePath !== BNDZ_VIEWS_ROOT && (
            <VirtualizedFileList
              items={listRows || []}
              enabled={computedViewMode === 'details' || computedViewMode === 'grid'}
              mode={computedViewMode === 'grid' ? 'grid' : 'list'}
              rowHeight={
                computedViewMode === 'grid' ? gridMetrics.rowHeight :
                computedViewMode === 'list' ? listMetrics.rowHeight :
                detailsRowHeight
              }
              gridMinItemWidth={gridMetrics.minWidth}
              gridRowHeight={gridMetrics.rowHeight}
              gap={computedViewMode === 'grid' ? gridMetrics.gap : listMetrics.gap}
              className={
                computedViewMode === 'grid' ? "w-full" :
                computedViewMode === 'list' ? "flex flex-wrap" :
                "flex flex-col w-full"
              }
              emptyState={
                <div className="flex flex-col items-center justify-center h-full min-h-[160px] text-gray-500 gap-2 px-4 text-center">
                  <Icons8Icon id="folder_open_ui" size={28} className="opacity-40" />
                  <span className="text-[11px]">
                    {isFindingTabActive && currentTab.findingError ? currentTab.findingError
                      : isFindingTabActive ? `No results for "${currentTab.findingQuery}".`
                      : isGlobal ? 'No global search results.'
                      : 'This folder is empty.'}
                  </span>
                </div>
              }
              renderItem={(entity, rowIndex) => {
                if (isGroupHeaderRow(entity)) {
                  return (
                    <div
                      className="sticky top-0 z-10 flex items-center gap-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#99c9f0] bg-[#252526] border-y border-[#454545]"
                    >
                      <span>{entity.label}</span>
                      <span className="text-gray-500 font-normal normal-case">({entity.count})</span>
                    </div>
                  );
                }
                const entityTags: string[] = Array.isArray((entity as any).tags) ? (entity as any).tags : [];
                const listRt = settingsRt.list;
                const isSelected = currentTab.selectedItems.includes(entity.id);
                const showSelectionChrome = isSelected && listRt.showSelectionHighlight;

                const isDir = entity.type === "directory";
                const isDrive = !!(entity as any).driveInfo;
                const drive = (entity as any).driveInfo;
                const entityWinPath = resolveEntityWindowsPath(panePath, entity);
                const clipboardMark = getClipboardMarkForEntity(entityWinPath, clipboard);
                const iconDimClass = [
                  clipboardMark && listRt.dimmedIcons ? 'bndz-icon-dimmed' : '',
                  showSelectionChrome && listRt.dimSelectedIcons ? 'bndz-icon-dimmed' : '',
                  (entity.attributes || []).includes('hidden') && listRt.ghostHiddenIcons ? 'bndz-icon-ghosted' : '',
                ].filter(Boolean).join(' ');
                let filterResult = applyVisualFilters(entity, config.visualFilters);
                const colorFilterResult = evaluateColorFilter(entity, config.colorFilters, config);
                let filterColor = filterResult?.hexColor; 
                let syncOpacity = false;

                if (isSyncMode && syncResults) {
                     const sRes = syncResults[entity.id] || Object.values(syncResults).find((s: any) => s.path?.endsWith(entity.name));
                     if (sRes) {
                         const isPaneA = panes[0].id === pane.id;
                         const status = isPaneA ? sRes.statusA : sRes.statusB;
                         if (status === 'Identical') {
                             syncOpacity = true;
                         } else if (status === 'Unique') {
                             filterColor = '#22c55e'; // Green
                         } else if (status === 'Newer') {
                             filterColor = '#3b82f6'; // Blue
                         } else if (status === 'Conflict' || status === 'Missing') {
                             filterColor = status === 'Conflict' ? '#eab308' : '#ef4444'; // Yellow or Red
                         }
                     }
                }
                
                const displayName = getDisplayName(entity, config, panePath);
                const cloudBadge = cloudBadgeForPath(toWindowsPath(joinPanePath(panePath, entity)), cloudProviders);
                    
                const commitInlineRename = () => {
                  if (!inlineRename || inlineRename.entityId !== entity.id || inlineRename.path !== panePath) return;
                  void commitRenameForEntity(entity, panePath, inlineRename.currentName).then(ok => {
                    if (ok) setInlineRename(null);
                  });
                };

                const handleSerialRenameNavigate = (direction: 'prev' | 'next') => {
                  if (!inlineRename || inlineRename.entityId !== entity.id) return;
                  const pane = panes.find(p => p.id === activePaneId);
                  const tab = pane?.tabs[pane.activeTabIndex];
                  const ids = tab?.selectedItems?.length ? tab.selectedItems : [entity.id];
                  const idx = ids.indexOf(entity.id);
                  const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
                  if (nextIdx < 0 || nextIdx >= ids.length) return;
                  void commitRenameForEntity(entity, panePath, inlineRename.currentName).then(() => {
                    const nextEntity = contents?.find(c => c.id === ids[nextIdx]);
                    if (!nextEntity) return;
                    setInlineRename({
                      path: panePath,
                      entityId: ids[nextIdx],
                      currentName: getRenameInitialValue(nextEntity, config),
                    });
                  });
                };

                const renameInput = inlineRename?.entityId === entity.id && inlineRename?.path === panePath ? (
                    <InlineRenameInput
                       value={inlineRename.currentName}
                       entity={entity}
                       config={config}
                       showNameLength={settingsRt.rename.showNameLength}
                       serialRename={settingsRt.rename.serialRename}
                       onSerialNavigate={handleSerialRenameNavigate}
                       onChange={value => setInlineRename({ ...inlineRename, currentName: value })}
                       onCommit={commitInlineRename}
                       onCancel={() => setInlineRename(null)}
                    />
                ) : null;

                const highlightFilter = isActive ? (filterText || pane.filterRegex || '') : '';
                const displayLabel = renameInput
                  ? renameInput
                  : (highlightFilter ? highlightNameMatch(displayName, highlightFilter) : displayName);

                const tipHandlers = createEntityTooltipHandlers(
                  entity,
                  panePath,
                  config,
                  folderSizeMap,
                  formatSize,
                  { context: 'list', disabled: inlineRename?.entityId === entity.id },
                );
                const suppressNativeTitle = shouldSuppressNativeEntityTitle(config);

                const zebraAlt = listRt.zebraRows && !showSelectionChrome && rowIndex % 2 === 1;
                const isGridLike = computedViewMode === 'grid' || computedViewMode === 'list';

                const rowNode = (
                  <div 
                    id={`fs-item-${entity.id}`}
                    data-id={entity.id}
                    className={`fs-item-wrapper ${isGridLike ? 'fs-grid-item' : 'fs-list-item'} ${computedViewMode === 'grid' ? `flex flex-col items-center justify-center p-2 rounded w-full ${isDrive ? 'min-h-[128px] h-auto' : 'h-[100px]'}` : computedViewMode === 'list' ? `flex items-center text-[12px] py-1 px-2 ${isDrive ? 'w-[280px]' : 'w-[220px]'} rounded` : `flex items-center text-[12px] ${isDrive ? "mb-1 p-1" : isNeutralDefault ? "py-[1px]" : "py-[3px]"}`} border border-transparent cursor-default
                      ${showSelectionChrome ? `fs-item-selected ${listRt.underlineSelected ? 'underline decoration-[#007acc]' : ''}` : mouseRt.highlightHovered ? 'hover:bg-[#2a2d2e]' : ''}
                      ${focusedItemId === entity.id && !showSelectionChrome ? "ring-1 ring-inset ring-white/30" : ""}
                      ${dragTargetId === entity.id && isDir ? "ring-2 ring-inset ring-[#0078d4] bg-[#094771]/30" : ""}
                      ${clipboardMark === 'copy' ? 'fs-item-clipboard-copy' : clipboardMark === 'cut' ? 'fs-item-clipboard-cut' : ''}
                      ${config.coloredLines && clipboardMark ? 'fs-item-clipboard-colored-line' : ''}
                      ${colorFilterResult?.className || ''}
                      ${config.coloredLines && colorFilterResult && !clipboardMark ? 'border-l-2 border-l-[#0078d4]/50' : ''}
                      ${syncOpacity ? "opacity-50" : ""}`}
                    style={{
                        ...(showSelectionChrome && config.listSelectionHighlightColor
                          ? { backgroundColor: config.listSelectionHighlightColor }
                          : config.applyColors && showSelectionChrome ? { backgroundColor: 'var(--list-selected-bg)' } : {}),
                        ...(zebraAlt && !showSelectionChrome && !filterResult?.rowTint && !filterColor && !colorFilterResult?.inlineStyle
                          ? (config.applyColors ? { backgroundColor: 'var(--list-alt-bg)' } : { backgroundColor: '#1e1e1e' })
                          : {}),
                        ...(filterResult?.rowTint && !showSelectionChrome ? { backgroundColor: filterResult.rowTint } : filterColor && !showSelectionChrome ? { backgroundColor: `${filterColor}1A` } : {}),
                        ...(!showSelectionChrome && colorFilterResult?.inlineStyle ? colorFilterResult.inlineStyle : {})
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      // Gesture (drag session + pointer tracking) is managed in onPointerDownCapture.
                      // No eager selection here — onClick → handleEntityClicked handles all selection.
                    }}
                    onClick={(e) => {
                      if (suppressRowClickRef.current) {
                        suppressRowClickRef.current = false;
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      if ((window as any)._marqueeDragOccurred) {
                        (window as any)._marqueeDragOccurred = false;
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      markPointerDown();
                      handleEntityClicked(e, entity.id);
                    }}
                    onDoubleClick={() => { clearDragSession(); handleEntityDoubleClicked(entity); }}
                    onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); handleEntityMiddleClick(e, entity); }}
                    onMouseEnter={(e) => {
                      tipHandlers.onMouseEnter?.(e);
                      if (isDir) void prefetchPathQuiet(buildEntityPath(entity));
                      if (listGestureRef.current || isMarqueeActive()) return;
                      if (mouseRt.hoverSelect && !inlineRename) {
                        setFocusedItemId(entity.id);
                        setSelectedItems([entity.id], pane.id);
                        scheduleSelectionChrome([entity.id], true);
                        scheduleQuickActionsBar(true, true);
                      }
                    }}
                    onMouseMove={tipHandlers.onMouseMove}
                    onMouseLeave={tipHandlers.onMouseLeave}
                    onDragEnter={(e) => { e.preventDefault(); if (isDir) setDragTargetHighlight(entity.id); }}
                    onDragLeave={(e) => { e.preventDefault(); if (dragTargetId === entity.id) setDragTargetHighlight(null); }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      dropModifierRef.current.copy = e.ctrlKey || e.altKey;
                      if (isDir) {
                        e.dataTransfer.dropEffect = dropModifierRef.current.copy ? 'copy' : 'move';
                      }
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragTargetHighlight(null); if (isDir) { handleDrop(e, entity.id); } else { handleDrop(e); } }}
                    onContextMenu={(e) => {
                       e.preventDefault();
                       e.stopPropagation();
                       contextMenuBlockRef.current = true;
                       suppressNavClickUntilRef.current = Date.now() + 800;
                       const isPart = currentTab.selectedItems.includes(entity.id);
                       if (!isPart) {
                           selectEntityForContextMenu(entity.id);
                       } else {
                           setActivePaneId(pane.id);
                       }
                       let selectedIds = isPart ? currentTab.selectedItems : [entity.id];
                       let contextPaths = selectedIds.map(sid => {
                           const se = contents.find(c => c.id === sid);
                           if (!se) return toWindowsPath(sid);
                           return joinPanePath(panePath, se);
                       }).filter(Boolean) as string[];
                       if (!contextPaths.length) {
                         contextPaths = [joinPanePath(panePath, entity)];
                       }

                       handleContextMenuRequest(e, panePath, entity.id, isDir, entity.name, contextPaths, 'list-item', entity.extension || null);
                    }}
                    draggable={false}
                    onDragStart={(e) => {
                      // List drags are handled via pointer capture (marquee vs move/copy drag).
                      e.preventDefault();
                    }}
                    onDrag={(e) => {
                      dropModifierRef.current.copy = e.ctrlKey || e.altKey;
                      if (e.dataTransfer) e.dataTransfer.dropEffect = dropModifierRef.current.copy ? 'copy' : 'move';
                    }}
                    onDragEnd={() => {
                      internalDragRef.current = false;
                      setDragTargetHighlight(null);
                      clearDragSession();
                    }}
                  >
                     {isDrive && drive ? (
                        computedViewMode === 'grid' ? (
                          <DriveCard drive={{ ...drive, path: entity.path || drive.name }} layout="grid" selected={showSelectionChrome} />
                        ) : computedViewMode === 'list' ? (
                          <DriveCard drive={{ ...drive, path: entity.path || drive.name }} layout="list" selected={showSelectionChrome} />
                        ) : (
                        <>
                           <div className={`${detailsIconColClass} bndz-list-select-cell flex justify-center shrink-0`}>
                              <ShellNativeIcon path={entity.path || drive.name} isDir={false} size={detailsIconSize} eager />
                           </div>
                           <DriveCard drive={{ ...drive, path: entity.path || drive.name }} layout="details" selected={showSelectionChrome} />
                        </>
                        )
                     ) : (
                        <>
                           {computedViewMode === 'grid' ? (
                             <>
                               <div className="bndz-list-select-cell flex-1 flex flex-col items-center justify-center min-h-[48px] relative w-full">
                                  <div className={`bndz-clipboard-icon-slot flex-1 flex items-center justify-center min-h-[48px] relative w-full ${iconDimClass}`}>
                                  <ThumbnailIcon entity={entity} isDir={isDir} path={joinPanePath(panePath, entity)} size={gridMetrics.icon} />
                                  {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
                                  {filterResult?.badgeColor && (
                                      <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full ring-1 ring-black" style={{ backgroundColor: filterResult.badgeColor }} title={filterResult.name} />
                                  )}
                                  {listRt.showTags && entityTags.length > 0 && (
                                    <span className="absolute bottom-0 left-0 flex gap-0.5 flex-wrap p-0.5">
                                      {entityTags.slice(0, 3).map(t => (
                                        <TagBadge key={t} tagKey={t} catalog={availableTags} compact />
                                      ))}
                                    </span>
                                  )}
                                  </div>
                                  <div className="text-center line-clamp-2 w-full break-words text-[11px] leading-tight" title={suppressNativeTitle ? undefined : entity.name} style={filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {}}>
                                    {displayLabel}
                                  </div>
                               </div>
                             </>
                           ) : computedViewMode === 'list' ? (
                             <>
                             <div className="bndz-list-select-cell flex items-center min-w-0 flex-1">
                               <div className={`bndz-clipboard-icon-slot flex justify-center shrink-0 ${iconDimClass}`} style={{ width: listMetrics.iconSlot }}>
                                  <ThumbnailIcon entity={entity} isDir={isDir} path={joinPanePath(panePath, entity)} size={listMetrics.icon} />
                                  {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
                               </div>
                               <div className="flex-1 px-2 whitespace-nowrap overflow-hidden text-ellipsis shadow-none focus:outline-none" style={filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {}}>
                                  {displayLabel}
                               </div>
                             </div>
                               {listRt.showTags && entityTags.length > 0 && (
                                 <span className="flex items-center gap-0.5 shrink-0 mr-1">
                                   {entityTags.slice(0, 3).map(t => (
                                     <TagBadge key={t} tagKey={t} catalog={availableTags} compact />
                                   ))}
                                 </span>
                               )}
                               {cloudBadge && (
                                 <span className={`text-[10px] mr-1 shrink-0 ${cloudBadge.tone === 'amber' ? 'text-amber-400' : cloudBadge.tone === 'emerald' ? 'text-emerald-400' : 'text-[#7eb8e8]'}`} title={cloudBadge.title}>{cloudBadge.label}</span>
                               )}
                               {filterResult?.badgeColor && (
                                   <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: filterResult.badgeColor }} title={filterResult.name} />
                               )}
                             </>
                           ) : (
                             <>
                               {listRt.showSelectionCheckboxes && (
                                 <div className="w-5 flex justify-center shrink-0" onMouseDown={e => e.stopPropagation()}>
                                   <input
                                     type="checkbox"
                                     checked={isSelected}
                                     onChange={() => {
                                       const next = isSelected
                                         ? currentTab.selectedItems.filter(id => id !== entity.id)
                                         : [...currentTab.selectedItems, entity.id];
                                       setSelectedItems(next, pane.id);
                                       scheduleSelectionChrome(next, true);
                                       scheduleQuickActionsBar(next.length > 0, true);
                                       setFocusedItemId(entity.id);
                                     }}
                                     className="accent-[#0078d4] cursor-pointer"
                                   />
                                 </div>
                               )}
                               <div className={`${detailsIconColClass} bndz-list-select-cell bndz-clipboard-icon-slot flex justify-center shrink-0 ${iconDimClass}`}>
                                  <ThumbnailIcon entity={entity} isDir={isDir} path={joinPanePath(panePath, entity)} size={detailsIconSize} />
                                  {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
                               </div>
                               <div className="flex-1 flex items-center min-w-0 bndz-list-columns">
                                 {visibleListColumns.map((col, colIdx) => (
                                   <React.Fragment key={col.id}>
                                     {colIdx > 0 && (
                                       <div className="bndz-list-col-gutter shrink-0 self-stretch min-h-[20px]" aria-hidden />
                                     )}
                                     <div className={`${col.widthClass || 'shrink-0'} shrink-0`} style={getColumnStyle(col)}>
                                       {renderDetailColumn(col.id, entity, {
                                         isDir, displayName: displayLabel, renameInput, filterResult, filterColor, entityTags, panePath,
                                       })}
                                     </div>
                                   </React.Fragment>
                                 ))}
                                 <div className="bndz-list-marquee-trail" aria-hidden />
                               </div>
                               {cloudBadge && (
                                 <span className={`text-[10px] px-1 shrink-0 ${cloudBadge.tone === 'amber' ? 'text-amber-400' : 'text-[#7eb8e8]/80'}`} title={cloudBadge.title}>{cloudBadge.label}</span>
                               )}
                             </>
                           )}
                        </>
                     )}
                  </div>
                );

                return <React.Fragment key={entity.id}>{rowNode}</React.Fragment>;
              }}
            />
          )}
          {marquee && marquee.activePane === pane.id && (
             <div 
                className="absolute bg-[#094771]/35 border border-[#0078d4] z-50 pointer-events-none"
                style={{
                    left: Math.min(marquee.startX, marquee.currX),
                    top: Math.min(marquee.startY, marquee.currY),
                    width: Math.abs(marquee.startX - marquee.currX),
                    height: Math.abs(marquee.startY - marquee.currY)
                }}
             />
          )}
         </div>
      </div>
    );
  };

  const currentPane = panes.find(p => p.id === activePaneId) || panes[0];
  const currentTab = resolvePaneTab(currentPane) ?? {
    id: 'fallback', path: '/', history: ['/'], historyIndex: 0, selectedItems: [],
  };
  const getResolvedEntity = (id: string | null) => {
      if (!id) return null;
      const cached = findEntityInCache(pathContentsCache, id);
      if (cached) return cached;
      let ent = getEntityByPath(fileSystem, id);
      if (ent) return ent;
      for (const pane of panes) {
         for (const tab of pane.tabs) {
             const found = (tab as any).items?.find((i: any) => i.id === id || (tab.path + '/' + i.name) === id);
             if (found) return found;
         }
      }
      if (id.startsWith('drive-')) {
          const suffix = id.slice(6);
          const drivePath = normalizePanePath(suffix.startsWith('/') ? suffix : `/${suffix}`);
          return { id, name: formatDriveLetter(drivePath), type: 'directory', path: drivePath, driveInfo: drives.find(d => normalizePanePath(d.name) === drivePath) };
      }
      if (id.includes('/') || id.includes('\\') || /^[A-Za-z]:/.test(id)) {
          return {
              id,
              name: id.split(/[/\\]/).pop() || id,
              type: id.includes('.') ? 'file' : 'directory',
              path: normalizePanePath(id.replace(/\\/g, '/')),
          };
      }
      return null;
  };
  const focusedEntity = getResolvedEntity(focusedItemId);
  const focusedFullPath = focusedEntity
      ? joinPanePath(currentTab.path, focusedEntity)
      : null;

  const previewEntity = useMemo(() => {
    if (currentTab.selectedItems.length > 0) {
      const ent = getResolvedEntity(currentTab.selectedItems[0]);
      if (ent) return ent;
    }
    if (focusedEntity) return focusedEntity;
    return getLocationEntityFromPath(currentTab.path);
  }, [currentTab.selectedItems, currentTab.path, focusedEntity, pathContentsCache]);

  const previewPath = useMemo(() => {
    if (currentTab.selectedItems.length > 0) {
      const ent = getResolvedEntity(currentTab.selectedItems[0]);
      if (ent) {
        if ((ent as any).path) return toPanePath((ent as any).path);
        return joinPanePath(currentTab.path, ent);
      }
    }
    if (focusedFullPath) return focusedFullPath;
    return currentTab.path;
  }, [currentTab.selectedItems, currentTab.path, focusedFullPath, pathContentsCache]);

  const quickPreviewItems = useMemo(() => {
    if (!activeContents) return [];
    const toItem = (ent: any) => {
      const p = ent.path ? toPanePath(ent.path) : joinPanePath(currentTab.path, ent);
      return { entity: ent, path: p };
    };
    // With 2+ items explicitly selected, Quick Look browses just that selection.
    // With 0 or 1 selected (the common case — Space on a single file), browse the
    // whole folder like macOS Quick Look / Explorer preview do, so arrow keys can
    // page through every file in the folder, not just the one item you started on.
    if (currentTab.selectedItems.length > 1) {
      return currentTab.selectedItems
        .map(id => activeContents.find((c: any) => c.id === id))
        .filter(Boolean)
        .map(toItem);
    }
    const anchorId = currentTab.selectedItems[0] || focusedItemId;
    if (!anchorId) return [];
    return activeContents.map(toItem);
  }, [currentTab.selectedItems, focusedItemId, activeContents, currentTab.path]);

  const quickPreviewStartIndex = useMemo(() => {
    if (currentTab.selectedItems.length > 1) return 0;
    const anchorId = currentTab.selectedItems[0] || focusedItemId;
    if (!anchorId || !activeContents) return 0;
    const idx = activeContents.findIndex((c: any) => c.id === anchorId);
    return idx >= 0 ? idx : 0;
  }, [currentTab.selectedItems, focusedItemId, activeContents]);

  const bottomSelectionTargets = useMemo(() => {
    const paths: string[] = [];
    const types: string[] = [];
    for (const id of currentTab.selectedItems || []) {
      const ent = getResolvedEntity(id);
      let path: string;
      if (ent?.path) path = toWindowsPath(ent.path);
      else if (/^[A-Za-z]:/.test(id) || id.startsWith('//') || id.startsWith('\\\\') || id.startsWith('/')) path = toWindowsPath(id);
      else if (ent) path = toWindowsPath(joinPanePath(currentTab.path, ent));
      else path = toWindowsPath(id);
      paths.push(path);
      types.push(
        ent?.type === 'directory' ? 'folder'
        : ent?.type === 'file' ? 'file'
        : (/\.lnk$/i.test(path) ? 'shortcut' : 'folder'),
      );
    }
    return { paths, types };
  }, [currentTab.selectedItems, currentTab.path, pathContentsCache, fileSystem, panes]);

  const customStyles = config.applyColors ? {
    '--tree-bg': config.colorConfig2,
    '--tree-text': config.colorConfig1,
    '--tab-active-bg': config.colorConfig7,
    '--tab-active-text': config.colorConfig6,
    '--tab-inactive-bg': config.colorConfig9,
    '--tab-inactive-text': config.colorConfig8,
    '--list-bg': config.colorConfig11,
    '--list-text': config.colorConfig10,
    '--list-selected-bg': config.colorConfig14,
    '--breadcrumb-bg': config.colorConfig23,
    '--breadcrumb-text': config.colorConfig22,
  } as React.CSSProperties : {};

  const uiRadius = config.uiCornerRadius === 'sharp' ? '0px' : config.uiCornerRadius === 'round' ? '12px' : '6px';

  const activeToolbarProfile = config.toolbarProfiles?.[config.activeToolbarProfileIndex || 0] || [];
  const toolbarRows = useMemo(() => {
    const rows: any[][] = [[]];
    for (const item of activeToolbarProfile) {
      if (item.id === 'new_row') {
        if (rows[rows.length - 1].length > 0) rows.push([]);
      } else {
        rows[rows.length - 1].push(item);
      }
    }
    return rows.filter(row => row.length > 0);
  }, [activeToolbarProfile]);

  return (
    <div
      data-testid="bndz-app"
      style={{
        ...customStyles,
        fontFamily: config.uiFontFamily || undefined,
        fontSize: config.fontSize ? `${config.fontSize}px` : undefined,
        ['--bndz-ui-radius' as string]: uiRadius,
      }}
      className={`flex flex-col h-screen w-full bg-[#0f0f0f] text-[#d4d4d4] font-sans text-[12px] select-none overflow-hidden ${
        config.compactToolbar ? 'bndz-compact-toolbar' : ''
      } ${config.denseMenubar ? 'bndz-dense-menubar' : ''} ${config.showPanelAccentBorders ? 'bndz-accent-borders' : ''}`}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <LicenseBanner onRegister={() => setShowRegisterDialog(true)} />
      <TrialExpiredGate key={licenseEpoch} onRegister={() => setShowRegisterDialog(true)}>
      {/* Menu Bar + window controls (replaces native title bar) */}
      {config.showTopMenubar !== false && (
      <div
        ref={menubarRef}
        className="bndz-chrome-menubar flex items-stretch h-9 border-b border-[#333] text-[#ccc] shrink-0 select-none z-[200]"
        style={{ background: 'var(--bndz-surface-chrome)' }}
        onMouseDown={e => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest('[data-window-btn],[data-menu-trigger]')) return;
          if (e.button === 0) import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('drag'));
        }}
        onDoubleClick={() => import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('maximize'))}
      >
         <div className="flex items-center gap-2 pl-3 pr-3 border-r border-[#444] shrink-0">
            <img src={BNDZ_APP_ICON} alt="BNDZ" className="w-10 h-10 object-contain drop-shadow-md" draggable={false} />
            <span className="text-[12px] font-bold tracking-widest text-gray-200 uppercase hidden sm:inline">BNDZ</span>
         </div>
         <div
           className="flex items-center flex-1 px-1 min-w-0 overflow-x-auto overflow-y-visible scrollbar-hidden"
           onMouseMove={(e) => {
             if (!openMenuId) return;
             const el = (e.target as HTMLElement).closest('[data-menu-trigger]');
             const id = el?.getAttribute('data-menu-id');
             if (id && id !== openMenuId) setOpenMenuId(id);
           }}
         >
         <div className="relative shrink-0" ref={bindMenuAnchor('File')}>
             <div 
                 data-menu-trigger
                 data-menu-id="File"
                 role="menuitem"
                 aria-label="File menu"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'File' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'File' ? null : 'File'); }}
             >File</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'File'} anchorEl={menubarAnchors.current['File']} minWidth={220}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const selArgs = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.selectedItems[0];
                        if (selArgs) {
                           const cPath = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.path;
                           const entity = getDirContents(fileSystem, cPath || '')?.find(x => x.id === selArgs);
                           if (entity) import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(joinPanePath(cPath || '/', entity)), 'open'));
                        }
                    })}><Icons8Icon id="folder_open_ui" size={14} /> Open Selected</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const sel = currentTab.selectedItems[0];
                      if (!sel) { setToastMessage('Select an item first.'); return; }
                      const entity = pathContentsCache[currentTab.path]?.find((x: any) => x.id === sel);
                      const targetPath = entity ? joinPanePath(currentTab.path, entity) : currentTab.path;
                      addTab(activePaneId, targetPath);
                    })}><Icons8Icon id="folder_open_ui" size={14} /> Open in New Tab</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const sel = currentTab.selectedItems[0];
                      if (!sel) { setToastMessage('Select an item to rename.'); return; }
                      const entity = pathContentsCache[currentTab.path]?.find((x: any) => x.id === sel);
                      if (entity) beginInlineRename(currentTab.path, sel, entity);
                    })}><Icons8Icon id="pencil_ui" size={14} /> Rename</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'cut');
                    })}><Icons8Icon id="cut" size={14} /> Cut</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'copy');
                    })}><Icons8Icon id="copy" size={14} /> Copy</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => void executePaste(currentTab.path))}><Icons8Icon id="clipboard" size={14} /> Paste</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>

                    <MenubarSubmenu label="Recent Files">
                      {((config.recentFiles as string[] | undefined) || []).length === 0 ? (
                            <div className="px-3 py-1 text-sm text-gray-500 italic">(Empty)</div>
                      ) : (
                        ((config.recentFiles as string[]) || []).map(rp => (
                          <div
                            key={rp}
                            className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 truncate max-w-[320px]"
                            title={rp}
                            onMouseDown={menuAct(() => setCurrentPath(rp))}
                          >
                            {rp.replace(/^\//, '').replace(/\//g, ' › ') || 'This PC'}
                          </div>
                        ))
                      )}
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                       const cPath = currentTab.path;
                       import('../lib/ipcBridge').then(({ IPC }) => {
                         IPC.executeFsOperation(`new-folder-${Date.now()}`, 'create-dir', joinPanePathForFs(cPath || '/', 'New folder'), '', false, 'New folder');
                         setTimeout(() => refreshWorkspace(), 150);
                       });
                    })}><Icons8Icon id="new_folder" size={14} /> New Folder</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                       import('../lib/ipcBridge').then(({ IPC }) => IPC.executeFsOperation(`new-file-${Date.now()}`, 'create-file', joinPanePathForFs(currentTab.path || '/', 'New Text Document.txt'), '', false, 'New Text Document.txt'));
                    })}><Icons8Icon id="new_file" size={14} /> New Text Document</div>

                    <MenubarSubmenu label="New (Other)">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                              const paths = getSelectedEntityPaths();
                              if (!paths.length) { setToastMessage('Select files to archive.'); return; }
                              const dest = `${toWindowsPath(currentTab.path)}\\Archive-${Date.now()}.zip`;
                              const { IPC } = await import('../lib/ipcBridge');
                              const res = await IPC.createArchive(paths.map(toWindowsPath), dest, 'zip');
                              setToastMessage(res.ok ? 'Archive created.' : (res.error || 'Archive failed.'));
                            })}>ZIP Archive</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                              const paths = getSelectedEntityPaths();
                              if (paths.length !== 1) { setToastMessage('Select one item for a shortcut.'); return; }
                              const { IPC } = await import('../lib/ipcBridge');
                              const target = toWindowsPath(paths[0]);
                              const res = await IPC.createLink(`${target}.lnk`, target, 'shortcut');
                              setToastMessage(res.success ? 'Shortcut created.' : (res.error || 'Failed to create shortcut.'));
                            })}>Shortcut</div>
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const paths = getSelectedEntityPaths();
                      if (paths[0]) import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('copyPath', toWindowsPath(paths[0])));
                    })}><Icons8Icon id="copy_path" size={14} /> Copy Path</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => refreshWorkspace())}><Icons8Icon id="refresh" size={14} /> Refresh</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const sel = currentTab.selectedItems[0];
                        if (!sel) return;
                        const entity = pathContentsCache[currentTab.path]?.find((x: any) => x.id === sel)
                          || getDirContents(fileSystem, currentTab.path)?.find(x => x.id === sel);
                        if (entity) {
                          import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(joinPanePath(currentTab.path, entity)), 'properties'));
                        }
                    })}>
                       <Icons8Icon id="properties" size={14} /> Properties
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}><Icons8Icon id="config" size={14} /> Configuration...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsToolbarConfigOpen(true))}><Icons8Icon id="wrench" size={14} /> Customize Toolbar...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                       import('../lib/ipcBridge').then(({ IPC }) => IPC.requestClose('menu'));
                    })}>
                       Exit
                    </div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Edit')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Edit"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Edit' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Edit' ? null : 'Edit'); }}
             >Edit</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Edit'} anchorEl={menubarAnchors.current['Edit']} minWidth={220}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'cut');
                    })}><Icons8Icon id="cut" size={14} /> Cut</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'copy');
                    })}><Icons8Icon id="copy" size={14} /> Copy</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      void executePaste(currentTab.path);
                    })}><Icons8Icon id="clipboard" size={14} /> Paste</div>
                    {config.logClipboardContentsAndEnableRestore && clipboardHistory.length > 0 && (
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        if (restorePreviousClipboard()) setToastMessage('Previous clipboard restored.');
                        else setToastMessage('No clipboard history.', 'warning');
                      })}><Icons8Icon id="undo" size={14} /> Restore Previous Clipboard</div>
                    )}
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const items = pathContentsCache[currentTab.path] || [];
                      setSelectedItems(items.map((x: any) => x.id), activePaneId);
                    })}><Icons8Icon id="checksquare_ui" size={14} /> Select All</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        void runUndoRedo(false);
                    })}><Icons8Icon id="undo" size={14} /> Undo <span className="ml-auto text-[10px] text-gray-500">Ctrl+Z</span></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        void runUndoRedo(true);
                    })}><Icons8Icon id="redo" size={14} /> Redo <span className="ml-auto text-[10px] text-gray-500">Ctrl+Y</span></div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => {
                        const selArgs = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.selectedItems[0];
                        if (selArgs) {
                           const cPath = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.path;
                           const entity = getDirContents(fileSystem, cPath || '')?.find(x => x.id === selArgs);
                           if (entity) import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('copyPath', `${cPath}/${entity.name}`));
                        }
                    }}><Icons8Icon id="copy_path" size={14} /> Copy Path</div>

                    <MenubarSubmenu label="Copy To..." iconId="copy_to">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                              const other = panes.find(p => p.id !== activePaneId);
                              const dest = other?.tabs[other.activeTabIndex]?.path;
                              if (dest) void copyOrMoveToTarget('copy', dest);
                            })}>Other Pane</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { void copyOrMoveToTarget('copy'); })}>Browse...</div>
                    </MenubarSubmenu>

                    <MenubarSubmenu label="Move To...">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                              const other = panes.find(p => p.id !== activePaneId);
                              const dest = other?.tabs[other.activeTabIndex]?.path;
                              if (dest) void copyOrMoveToTarget('move', dest);
                            })}>Other Pane</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { void copyOrMoveToTarget('move'); })}>Browse...</div>
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => openBottomPlugin('batch-rename')}>
                       <Icons8Icon id="sparkles_ui" size={14} /> Smart Rename
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const tab = currentTab;
                        if (tab.selectedItems.length > 0) {
                           const dirContents = pathContentsCache[tab.path] || getDirContents(fileSystem, tab.path) || [];
                           const entities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                           if (entities.length > 0) handleDeleteRequest(entities, tab.path);
                        }
                    })}><Icons8Icon id="delete" size={14} /> Delete Selected</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('View')}>
             <div 
                 data-menu-trigger
                 data-menu-id="View"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'View' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'View' ? null : 'View'); }}
             >View</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'View'} anchorEl={menubarAnchors.current['View']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={toggleDualPane}>
                       <Icons8Icon id="toggle_dual_pane" size={14} /> {isDualPane ? 'Single Pane' : 'Dual Pane'}
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { togglePreviewPanel(); closeMenu(); }}>
                        <Icons8Icon id="toggle_preview" size={14} /> {isPreviewPanelOpen ? 'Hide Preview Panel' : 'Show Preview Panel'}
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { toggleBottomPanel(); closeMenu(); }}>
                        <Icons8Icon id="toggle_bottom" size={14} /> {isBottomPanelOpen ? 'Hide Bottom Panel' : 'Show Bottom Panel'}
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { refreshWorkspace(); closeMenu(); }}>
                       <Icons8Icon id="refresh" size={14} /> Refresh
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => scanCurrentFolderSizes(true, { manual: true }))}>
                       <Icons8Icon id="folder_size_sync" size={14} /> Get Folder Sizes
                    </div>
                    <div
                      className={`px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm flex items-center gap-2 ${config.autoSyncFolderSizes !== false ? 'text-emerald-300' : 'text-gray-200'}`}
                      onMouseDown={menuAct(() => {
                        const next = config.autoSyncFolderSizes === false;
                        updateConfig({ autoSyncFolderSizes: next });
                        setToastMessage(next ? 'Auto sync folder sizes enabled.' : 'Auto sync folder sizes paused.');
                        if (next) scanCurrentFolderSizes(false);
                        closeMenu();
                      })}
                    >
                      <span className="w-4 text-center text-[11px]">{config.autoSyncFolderSizes !== false ? '✓' : ''}</span>
                      <Icons8Icon id="folder_size_sync" size={14} className={config.autoSyncFolderSizes !== false ? '' : 'opacity-50'} />
                      Auto Sync Folder Sizes
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setViewMode('details', activePaneId))}><Icons8Icon id="view_details" size={14} /> Details</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setViewMode('grid', activePaneId))}><Icons8Icon id="view_grid" size={14} /> Grid</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setViewMode('list', activePaneId))}><Icons8Icon id="view_list" size={14} /> List</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}><Icons8Icon id="config" size={14} /> Configuration...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsToolbarConfigOpen(true))}><Icons8Icon id="wrench" size={14} /> Customize Toolbar...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsCommandPaletteOpen(true))}><Icons8Icon id="command_ui" size={14} /> Command Palette</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { setShowTutorial(true); closeMenu(); })}><Icons8Icon id="sparkles_ui" size={14} /> Show tutorial</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Go')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Go"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Go' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Go' ? null : 'Go'); }}
             >Go</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Go'} anchorEl={menubarAnchors.current['Go']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goBack())}>
                       <Icons8Icon id="nav_back" size={14} /> Back
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goForward())}>
                       <Icons8Icon id="nav_forward" size={14} /> Forward
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goUp())}>
                       <Icons8Icon id="nav_up" size={14} /> Up One Level
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(homeTreePath))}>
                       <Icons8Icon id="go_home" size={14} /> Home
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/'))}>
                       <Icons8Icon id="monitor_ui" size={14} /> This PC
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Desktop'))}><Icons8Icon id="monitor_ui" size={14} /> Desktop</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Personal'))}><Icons8Icon id="file_ui" size={14} /> Documents</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Downloads'))}><Icons8Icon id="arrow_down_circle_ui" size={14} /> Downloads</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => addTab(activePaneId, currentTab.path))}><Icons8Icon id="folder_open_ui" size={14} /> Open Location in New Tab</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { const q = filterText.trim() || prompt('Finding tab query:') || ''; if (q) addFindingTab(activePaneId, q); closeMenu(); })}><Icons8Icon id="file_search_ui" size={14} /> New Finding Tab…</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Tools')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Tools"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Tools' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Tools' ? null : 'Tools'); }}
             >Tools</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Tools'} anchorEl={menubarAnchors.current['Tools']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => scanCurrentFolderSizes(true, { manual: true }))}>
                       <Icons8Icon id="folder_size_sync" size={14} /> Get Folder Sizes
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => startFolderCompare())}>
                       <Icons8Icon id="sync_folders" size={14} /> Sync / Compare Folders
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsSmartToolsOpen(true))}>
                       <Icons8Icon id="smart_tools" size={14} /> AI Smart Workspace Tools
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        import('../lib/ipcBridge').then(({ IPC }) => {
                            IPC.clearIconCache().then(() => {
                                updateConfig({ iconCacheBuster: Date.now() });
                                setToastMessage("Icon cache cleared successfully");
                            });
                        });
                    })}>
                       <Icons8Icon id="refresh" size={14} /> Clear Icon Cache
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        import('../lib/ipcBridge').then(({ IPC }) => {
                            IPC.clearIconCache().then(() => {
                                updateConfig({ iconCacheBuster: Date.now() });
                                setToastMessage("Rebuilding icon cache...");
                            });
                        });
                    })}>
                       <Icons8Icon id="refresh" size={14} /> Rebuild Icon Cache
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsPluginStoreOpen(true))}>
                       <Icons8Icon id="extension_hub" size={14} /> Extension Hub
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsToolbarConfigOpen(true))}><Icons8Icon id="wrench" size={14} /> Customize Toolbar...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { setIsTagManagerOpen(true); closeMenu(); })}><Icons8Icon id="tag_manager" size={14} /> Manage Tags...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { setBottomPluginTab('batch-rename'); if (!isBottomPanelOpen) toggleBottomPanel(); closeMenu(); })}><Icons8Icon id="batch_rename" size={14} /> Batch Rename</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}>
                       <Icons8Icon id="config" size={14} /> Configuration
                    </div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Favorites')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Favorites"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Favorites' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Favorites' ? null : 'Favorites'); }}
             >Rapid access</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Favorites'} anchorEl={menubarAnchors.current['Favorites']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { toggleFavoriteFolder(); closeMenu(); }}><Icons8Icon id="star_ui" size={14} /> Toggle Rapid access pin</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(currentTab.path))}><Icons8Icon id="folder_open_ui" size={14} /> Add Current Folder</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <MenubarSubmenu label="Manage Rapid access">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}>Organize pins...</div>
                    </MenubarSubmenu>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Tags')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Tags"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Tags' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Tags' ? null : 'Tags'); }}
             >Tags</div>
             {config.fileTaggingFeature !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Tags'} anchorEl={menubarAnchors.current['Tags']} minWidth={200}>
                    {availableTags.map(tag => (
                        <div key={tag.name || tag.label} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" 
                             onClick={() => void applyTagToSelection(tag)}>
                            <Icons8Icon id="tag_manager" size={12} />
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                            {tag.label || tag.name}
                        </div>
                    ))}
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { setTagAssignmentActive(true); closeMenu(); }}>
                      <Icons8Icon id="tag_manager" size={12} /> Tag assignment mode…
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { setIsTagManagerOpen(true); closeMenu(); }}>
                      <Icons8Icon id="tag_manager" size={12} /> Manage Tags...
                    </div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('User')}>
             <div 
                 data-menu-trigger
                 data-menu-id="User"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'User' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'User' ? null : 'User'); }}
             >User</div>
             {config.userDefinedCommands !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'User'} anchorEl={menubarAnchors.current['User']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={async () => {
                      const paths = getSelectedEntityPaths();
                      const { IPC } = await import('../lib/ipcBridge');
                      IPC.shellExecute('openTerminal', paths.length ? paths : currentTab.path, undefined, buildShellExecuteOptions(config));
                      closeMenu();
                    }}>Open Terminal Here</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { setIsCommandPaletteOpen(true); closeMenu(); }}>Command Palette</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Scripting')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Scripting"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Scripting' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Scripting' ? null : 'Scripting'); }}
             >Scripting</div>
             {config.scripting !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Scripting'} anchorEl={menubarAnchors.current['Scripting']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={async () => {
                      const { IPC } = await import('../lib/ipcBridge');
                      const files = await IPC.openFileDialog('Scripts (*.ps1;*.bat;*.cmd)|*.ps1;*.bat;*.cmd|All files (*.*)|*.*');
                      if (files[0]) { IPC.shellExecute('executeScript', files[0], currentTab.path); setToastMessage('Running script...'); }
                      closeMenu();
                    }}>Load Script File...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={async () => {
                      const { IPC } = await import('../lib/ipcBridge');
                      const files = await IPC.openFileDialog('Scripts (*.ps1;*.bat;*.cmd)|*.ps1;*.bat;*.cmd|All files (*.*)|*.*');
                      if (files[0]) { IPC.shellExecute('executeScript', files[0], currentTab.path); setToastMessage('Running script...'); }
                      closeMenu();
                    }}>Run Script...</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Panes')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Panes"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Panes' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Panes' ? null : 'Panes'); }}
             >Panes</div>
             {config.dualPaneFeature !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Panes'} anchorEl={menubarAnchors.current['Panes']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={toggleDualPane}>Toggle Dual Pane</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { swapPanes(); closeMenu(); }}>Swap Panes</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { syncPanesToSamePath(); closeMenu(); }}>Sync Panes</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { setActivePaneId(panes[0]?.id || activePaneId); closeMenu(); }}>Focus Left Pane</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { setActivePaneId(panes[1]?.id || activePaneId); closeMenu(); }}>Focus Right Pane</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Tabsets')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Tabsets"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Tabsets' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Tabsets' ? null : 'Tabsets'); }}
             >Tabsets</div>
             {config.tabsets !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Tabsets'} anchorEl={menubarAnchors.current['Tabsets']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => {
                        setIsSaveTabsetOpen(true);
                        setTabsetNameInput('');
                    }}>Save Tabset As...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => setIsLoadTabsetOpen(true)}>Load Tabset...</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Window')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Window"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Window' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Window' ? null : 'Window'); }}
             >Window</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Window'} anchorEl={menubarAnchors.current['Window']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => {
                      const name = prompt('Layout preset name:', 'My Layout') || '';
                      if (!name.trim()) return;
                      const preset = { id: `wl-${Date.now()}`, name: name.trim(), outer: config.workspaceLayoutOuter, inner: config.workspaceLayoutInner, dualPane: isDualPane };
                      updateConfig({ workspaceLayoutPresets: [...(config.workspaceLayoutPresets || []), preset] });
                      setToastMessage(`Saved layout: ${name.trim()}`);
                      closeMenu();
                    }}>Save Window Layout…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => {
                      const presets = config.workspaceLayoutPresets || [];
                      if (!presets.length) { setToastMessage('No saved layouts.'); closeMenu(); return; }
                      const last = presets[presets.length - 1];
                      if (last.outer) updateConfig({ workspaceLayoutOuter: last.outer });
                      if (last.inner) updateConfig({ workspaceLayoutInner: last.inner });
                      if (last.dualPane != null) setIsDualPane(!!last.dualPane);
                      setToastMessage(`Loaded layout: ${last.name}`);
                      closeMenu();
                    }}>Restore Last Layout</div>
                    <div className="border-t border-[#444] my-1" />
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => {
                      const next = !config.alwaysOnTop;
                      updateConfig({ alwaysOnTop: next });
                      import('../lib/ipcBridge').then(({ IPC }) => IPC.setAlwaysOnTop(next));
                      setToastMessage(next ? 'Always on top enabled.' : 'Always on top disabled.');
                      closeMenu();
                    }}>Always on Top</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('minimize')); closeMenu(); }}>Minimize</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('maximize')); closeMenu(); }}>Maximize / Restore</div>
                    <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200" onClick={() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('close')); closeMenu(); }}>Close</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Help')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Help"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Help' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === 'Help' ? null : 'Help'); }}
             >Help</div>
             {config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Help'} anchorEl={menubarAnchors.current['Help']} minWidth={220}>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setShowHelpTopics(true))}>Help Topics</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                      setConfigInitialTab('Keyboard Shortcuts');
                      setIsConfigDialogOpen(true);
                    })}>Keyboard Shortcuts</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}>Settings Reference...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                      await import('../lib/settingsExport').then(m => m.exportSettingsBundle(config as Record<string, unknown>));
                      setToastMessage('Settings exported.');
                    })}>Export Settings...</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                      const r = await import('../lib/settingsExport').then(m => m.importSettingsBundle(s => updateConfig(s as any)));
                      setToastMessage(r.message);
                    })}>Import Settings...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1.5 hover:bg-emerald-700/80 cursor-pointer text-sm text-emerald-100 flex items-center gap-2" onMouseDown={menuAct(() => setShowRegisterDialog(true))}>
                      <Icons8Icon id="lock_ui" size={13} className="opacity-80" /> Register Product...
                    </div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                      setToastMessage('Checking for updates…');
                      void IPC.checkForUpdates(config.updateCheckUrl).then(r => {
                        if (r.error) setToastMessage(`Update check failed: ${r.error}`);
                        else if (r.updateAvailable) setToastMessage(`Update available: v${r.latestVersion}. See About BNDZ to download.`);
                        else setToastMessage(`You are on the latest version (v${r.currentVersion}).`);
                      });
                    })}>Check for Updates...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('eula').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open EULA.'); }))}>License Agreement (EULA)</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('privacy').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open Privacy Policy.'); }))}>Privacy Policy</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('third-party').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open third-party licenses.'); }))}>Third-Party Licenses</div>
                    <div className="px-3 py-1.5 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setShowAboutDialog(true))}>About BNDZ</div>
                 </MenubarPortalMenu>
             )}
         </div>
         </div>
         <WindowControls />
      </div>
      )}

      {/* Main Toolbar */}
      <div
         data-tutorial="toolbar"
         className="shrink-0 overflow-visible border-b border-[#333] bg-[#1a1a1a] bndz-toolbar-zone"
         onWheel={(e) => {
             if (e.shiftKey) {
                 const profiles = config.toolbarProfiles || [];
                 if (profiles.length < 2) return;
                 let newIdx = (config.activeToolbarProfileIndex || 0) + (e.deltaY > 0 ? 1 : -1);
                 if (newIdx >= profiles.length) newIdx = 0;
                 if (newIdx < 0) newIdx = profiles.length - 1;
                 updateConfig({ activeToolbarProfileIndex: newIdx });
             }
         }}
      >
         {toolbarRows.map((row, rowIndex) => (
         <div key={rowIndex} className="bndz-chrome-toolbar flex items-center px-1 py-0.5 overflow-visible min-h-[28px]" style={{ background: 'var(--bndz-surface-chrome)' }}>
         {row.map((item: any, i: number) => {
             const def = resolveToolbarItem(item.id, availableTags);
             if (!def) return null;
             
             if (item.id === 'separator') return <div key={i} className="w-[1px] h-4 bg-[#444] mx-1"></div>;
             if (item.id === 'spacer') return <div key={i} className="w-2"></div>;

             const toolbarDisabled =
                 item.id === 'undo' ? !canUndo :
                 item.id === 'redo' ? !canRedo :
                 item.id === 'paste' ? clipboard.items.length === 0 :
                 item.id === 'cut' || item.id === 'copy' ? activeTab.selectedItems.length === 0 :
                 false;

             const shortcutHint =
                 item.id === 'copy' ? keyboardMap.copy :
                 item.id === 'cut' ? keyboardMap.cut :
                 item.id === 'paste' ? keyboardMap.paste :
                 item.id === 'undo' ? keyboardMap.undo :
                 item.id === 'redo' ? keyboardMap.redo :
                 item.id === 'delete' ? keyboardMap.delete :
                 undefined;
             const toolbarTitle = shortcutHint ? `${def.label} (${shortcutHint})` : def.label;

             return (
                 <ToolbarButton 
                     key={i} 
                     launcherIcon={launcherIconUrl(item.id)}
                     title={toolbarTitle}
                     disabled={toolbarDisabled}
                     onClick={() => {
                         switch(item.id) {
                           case 'nav_back': goBack(activePaneId); break;
                           case 'nav_forward': goForward(activePaneId); break;
                           case 'nav_up': goUp(activePaneId); break;
                           case 'go_home': setCurrentPath(homeTreePath); break;
                          case 'refresh': {
                              IPC.getSystemDrives().then(setDrives);
                              IPC.getCloudProviders().then(setCloudProviders);
                              refreshPathsForPanes();
                              IPC.refreshWorkspace().catch(() => {});
                              break;
                          }
                           case 'folder_size_sync': {
                               const next = !(config.autoSyncFolderSizes ?? true);
                               updateConfig({ autoSyncFolderSizes: next });
                               setToastMessage(next ? 'Auto sync folder sizes enabled.' : 'Auto sync folder sizes paused.');
                               if (next) scanCurrentFolderSizes(false);
                               break;
                           }
                           case 'view_details': {
                               const ap = panes.find(p => p.id === activePaneId);
                               if (ap) setPanes(panes.map(p => p.id === activePaneId ? { ...p, tabs: p.tabs.map((t, ti) => ti === p.activeTabIndex ? { ...t, viewMode: 'details' as const } : t) } : p));
                               break;
                           }
                           case 'undo':
                             void runUndoRedo(false);
                             break;
                           case 'redo':
                             void runUndoRedo(true);
                             break;
                           case 'sync_folders': startFolderCompare(); break;
                           case 'config': setIsConfigDialogOpen(true); break;
                           case 'wrench': setIsToolbarConfigOpen(true); break;
                           case 'extension_hub': setIsPluginStoreOpen(true); break;
                           case 'view_grid': {
                               const ap = panes.find(p => p.id === activePaneId);
                               if (ap) setPanes(panes.map(p => p.id === activePaneId ? { ...p, tabs: p.tabs.map((t, i) => i === p.activeTabIndex ? { ...t, viewMode: 'grid' as const } : t) } : p));
                               break;
                           }
                           case 'view_list': {
                               const ap = panes.find(p => p.id === activePaneId);
                               if (ap) setPanes(panes.map(p => p.id === activePaneId ? { ...p, tabs: p.tabs.map((t, i) => i === p.activeTabIndex ? { ...t, viewMode: 'list' as const } : t) } : p));
                               break;
                           }
                           case 'search': omniFilterRef.current?.focus(); break;
                           case 'smart_tools': setIsSmartToolsOpen(true); break;
                           case 'tag_manager': setIsTagManagerOpen(true); break;
                           case 'icon_studio': openBottomPlugin('icon-studio'); break;
                           case 'find': openBottomPlugin('find'); break;
                           case 'dropstack': openBottomPlugin('dropstack'); break;
                           case 'filters': openBottomPlugin('filters'); break;
                           case 'properties': {
                               const ap = panes.find(p => p.id === activePaneId);
                               const tab = resolvePaneTab(ap);
                               if (tab) {
                                   const contents = getDirContents(fileSystem, tab.path);
                                   let paneTarget = tab.path;
                                   if (tab.selectedItems.length > 0) {
                                       const sel = contents.find(c => c.id === tab.selectedItems[0]);
                                       if (sel) paneTarget = joinPanePath(tab.path, sel);
                                   }
                                   const shellPath = resolveShellPropertiesPath(paneTarget);
                                   IPC.executeContextMenuVerb(shellPath, 'properties');
                               }
                               break;
                           }
                           case 'new_folder': {
                               const cPath = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.path;
                               if (cPath) {
                                 IPC.executeFsOperation(`new-folder-${Date.now()}`, 'create-dir', joinPanePathForFs(cPath, 'New folder'), '', false, 'New folder');
                                 setTimeout(() => refreshWorkspace(), 150);
                               }
                               break;
                           }
                           case 'new_file': {
                               const cPath = panes.find(p => p.id === activePaneId)?.tabs[panes.find(p => p.id === activePaneId)!.activeTabIndex]?.path;
                               if (cPath) IPC.executeFsOperation(`new-file-${Date.now()}`, 'create-file', `${cPath}/New Text Document.txt`, '', false, 'New Text Document.txt');
                               break;
                           }
                           case 'select_all': {
                               selectAllInActivePane();
                               break;
                           }
                           case 'invert_selection': {
                               invertSelectionInActivePane();
                               break;
                           }
                           case 'cut':
                           case 'copy': {
                               const ap = panes.find(p => p.id === activePaneId);
                               const tab = resolvePaneTab(ap);
                               if (tab && tab.selectedItems.length > 0) {
                                   const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
                                   const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                                   if (selectedEntities.length > 0) {
                                       setClipboardState(
                                         selectedEntities.map((ent: any) => joinPanePath(tab.path, ent)),
                                         item.id as 'copy' | 'cut'
                                       );
                                   }
                               }
                               break;
                           }
                           case 'paste': {
                               const ap = panes.find(p => p.id === activePaneId);
                               const tab = resolvePaneTab(ap);
                               if (tab) executePaste(tab.path);
                               break;
                           }
                           case 'delete':
                              const activePaneForBtn = panes.find(p => p.id === activePaneId);
                              const delTab = resolvePaneTab(activePaneForBtn);
                              if (delTab && delTab.selectedItems.length > 0) {
                                  const dirContents = safeGetDirContents(fileSystem, delTab.path) || [];
                                  const selectedEntities = dirContents.filter((x: any) => delTab.selectedItems.includes(x.id));
                                  if (selectedEntities.length > 0) {
                                      handleDeleteRequest(selectedEntities, delTab.path);
                                  }
                              }
                              break;
                           case 'compress': 
                           case 'extract': {
                              const apc = panes.find(p => p.id === activePaneId);
                              if (apc) {
                                  const tab = apc.tabs[apc.activeTabIndex];
                                  const dirContents = safeGetDirContents(fileSystem, tab.path) || [];
                                  const sel = dirContents.find((x: any) => x.id === tab.selectedItems[0]);
                                  const target = sel ? joinPanePath(tab.path, sel) : tab.path;
                                  IPC.shellExecute(item.id, target);
                              }
                              break;
                           }
                           case 'map_network_drive': 
                           case 'share': 
                           case 'burn_disc':
                           case 'cmd': 
                           case 'ps':
                           case 'taskmgr':
                           case 'regedit':
                           case 'control_panel':
                           case 'settings_app':
                           case 'device_manager':
                           case 'services':
                           case 'event_viewer':
                           case 'disk_mgmt':
                           case 'computer_mgmt':
                           case 'sysdm_cpl':
                           case 'network_connections':
                           case 'printers':
                           case 'programs_features':
                           case 'firewall':
                           case 'power_options':
                           case 'user_accounts':
                           case 'msinfo':
                           case 'dxdiag':
                           case 'notepad':
                           case 'calc':
                           case 'paint':
                           case 'snipping_tool':
                           case 'magnifier':
                           case 'osk':
                               IPC.shellExecute(`launch-${item.id}`, '');
                               break;
                           case 'explorer':
                               IPC.shellExecute('launch-explorer', toWindowsPath(currentTab.path || '/'));
                               break;
                           case 'batch_rename': openBottomPlugin('batch-rename'); break;
                           case 'shell_menus': openBottomPlugin('context-menu-manager'); break;
                           case 'metadata': openBottomPlugin('metadata'); break;
                           case 'storage_cleanup': openBottomPlugin('storage-cleanup'); break;
                           case 'sys_properties': openBottomPlugin('properties'); break;
                           case 'copy_path': {
                               const ap = panes.find(p => p.id === activePaneId);
                               if (ap) {
                                   const tab = ap.tabs[ap.activeTabIndex];
                                   const contents = safeGetDirContents(fileSystem, tab.path) || [];
                                   const selected = contents.filter((x: any) => tab.selectedItems.includes(x.id));
                                   const target = selected.length > 0
                                       ? selected.map((s: any) => toWindowsPath(joinPanePath(tab.path, s))).join('\n')
                                       : toWindowsPath(tab.path);
                                   IPC.shellExecute('copyPath', target);
                                   setToastMessage(selected.length > 1 ? `Copied ${selected.length} paths.` : 'Path copied to clipboard.');
                               }
                               break;
                           }
                           case 'terminal_here': {
                               const ap = panes.find(p => p.id === activePaneId);
                               const tabPath = ap?.tabs[ap.activeTabIndex]?.path;
                               if (tabPath) IPC.shellExecute('openTerminal', toWindowsPath(tabPath), undefined, buildShellExecuteOptions(config));
                               break;
                           }
                           case 'toggle_dual_pane': toggleDualPane(); break;
                           case 'toggle_preview': togglePreviewPanel(); break;
                           case 'toggle_bottom': toggleBottomPanel(); break;
                           case 'go_recycle_bin': guardedSetCurrentPath(RECYCLE_BIN_PATH); break;
                           case 'go_network': guardedSetCurrentPath('//'); break;
                           case 'new_tab': {
                               const ap = panes.find(p => p.id === activePaneId);
                               if (ap) addTab(ap.id, ap.tabs[ap.activeTabIndex]?.path || '/');
                               break;
                           }
                           default:
                               if (item.id.startsWith('tag__')) {
                                 const tagId = item.id.slice(5);
                                 const tag = availableTags.find((t: any) => tagChipId(t) === tagId);
                                 if (tag) void applyTagToSelection(tag);
                               }
                               break;
                         }
                     }}
                 />
             );
         })}
         </div>
         ))}

         <div className="bndz-chrome-toolbar flex items-center px-1 py-0.5 overflow-visible min-h-[28px]" style={{ background: 'var(--bndz-surface-chrome)' }}>
         {/* Drive letters scoped to active pane (always show at end for fast access) */}
         <div className="w-[1px] h-4 bg-[#444] mx-2"></div>
         <div className="flex text-[10px] items-center gap-[2px] mx-1 font-mono">
            {drives.map(d => (
                <span key={d.name} className="bg-[#333] px-1.5 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444] hover:border-[#0078d4]/40 transition-colors" onClick={() => setCurrentPath(d.name)} title={d.label || formatDriveLetter(d.name)}>{formatDriveLetter(d.name)}</span>
            ))}
            {!drives.length && (
              <><span className="bg-[#333] px-1 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444]" onClick={() => setCurrentPath('/')}>Root</span><span className="bg-[#333] px-1 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444]" onClick={() => setCurrentPath('/workspace')}>Workspace</span></>
            )}
         </div>
         <div className="w-[1px] h-4 bg-[#444] mx-2"></div>
         {config.dualPaneFeature !== false && (
            <ToolbarButton launcherIcon={launcherIconUrl('toggle_dual_pane')} className="ml-1" title="Toggle Dual Pane View" onClick={toggleDualPane} />
         )}
         <div className="flex-1"></div>
         <ToolbarButton launcherIcon={launcherIconUrl('extension_hub')} title="Extension Hub (Plugin Marketplace)" onClick={() => setIsPluginStoreOpen(true)} />
         <ToolbarButton launcherIcon={launcherIconUrl('toggle_bottom')} title={uiRuntime.bottomPanel ? "Toggle Bottom Plugin Panel" : "Bottom panel disabled in settings"} onClick={toggleBottomPanel} className={!uiRuntime.bottomPanel ? 'opacity-40 pointer-events-none' : ''} />
         <ToolbarButton launcherIcon={launcherIconUrl('toggle_preview')} title={uiRuntime.previewPanel ? "Toggle Right Side Preview Panel" : "Preview panel disabled in settings"} onClick={togglePreviewPanel} className={!uiRuntime.previewPanel ? 'opacity-40 pointer-events-none' : ''} />
         </div>
      </div>

      {/* Omni-Filter Bar + docked selection actions (opt-in via Appearance) */}
      <div className="shrink-0 relative z-30">
      <div data-tutorial="omnibar" className="bndz-chrome-omnibar flex px-2 py-1 items-center border-b border-[#333] shrink-0" style={{ background: 'var(--bndz-surface-chrome)' }}>
         <Icons8Icon id="search" size={14} className="mr-2 opacity-60" />
         <input 
            ref={omniFilterRef}
            type="text"
            className="flex-1 text-white border border-[#444] rounded px-2 py-[2px] text-[12px] focus:outline-none focus:border-blue-500 transition-colors placeholder-[#666]"
            style={{ background: 'var(--bndz-surface-raised)' }}
            placeholder="Type '/' to instantly fuzzy-filter files in the active pane..."
            value={filterText}
            onChange={(e) => {
               if (activeTab.viewLocked) {
                 setToastMessage('View is locked. Unlock to change filter.');
                 return;
               }
               setFilterText(e.target.value);
            }}
            onKeyDown={(e) => {
               if (e.key === 'Escape') {
                   setFilterText('');
                   omniFilterRef.current?.blur();
               }
            }}
         />
         {filterText && (
             <button onClick={() => setFilterText('')} className="ml-2 hover:bg-[#333] text-gray-400 hover:text-white px-2 py-[2px] rounded border border-transparent hover:border-[#555] transition-colors">
                <CloseGlyph size={14} />
             </button>
         )}
      </div>
      {config.showQuickActionsBar === true && (
        <QuickActionsBar
          enabled
          visible={showQuickActionsBar && activeTab.selectedItems.length > 1}
          placement="dock"
          count={activeTab.selectedItems.length}
          actions={buildDefaultQuickActions({
            onQuickLook: () => {
              setQuickPreviewIndex(quickPreviewStartIndex);
              setQuickPreviewOpen(true);
            },
            onCopy: () => {
              const selectedEntities = activeContents?.filter((x: any) => activeTab.selectedItems.includes(x.id)) || [];
              if (selectedEntities.length) {
                setClipboardState(
                  selectedEntities.map((ent: any) => joinPanePath(currentPath, ent)),
                  'copy',
                );
              }
            },
            onCut: () => {
              const selectedEntities = activeContents?.filter((x: any) => activeTab.selectedItems.includes(x.id)) || [];
              if (selectedEntities.length) {
                setClipboardState(
                  selectedEntities.map((ent: any) => joinPanePath(currentPath, ent)),
                  'cut',
                );
              }
            },
            onPaste: () => executePaste(currentPath),
            onDelete: () => {
              const selectedEntities = activeContents?.filter((x: any) => activeTab.selectedItems.includes(x.id)) || [];
              if (selectedEntities.length) handleDeleteRequest(selectedEntities, currentPath);
            },
            onCopyPath: () => {
              const ent = activeContents?.find((c: any) => activeTab.selectedItems.includes(c.id));
              if (ent) IPC.shellExecute('copyPath', toWindowsPath(joinPanePath(currentPath, ent)));
            },
            onOpenTerminal: () => {
              IPC.shellExecute('openTerminal', toWindowsPath(currentPath), undefined, buildShellExecuteOptions(config));
            },
            onOpenExplorer: () => {
              IPC.shellExecute('openExplorer', toWindowsPath(currentPath));
            },
            onProperties: () => openBottomPlugin('properties'),
            onBatchRename: () => openBottomPlugin('batch-rename'),
            canPaste: !!clipboard.items?.length && !!clipboard.action,
          })}
        />
      )}
      </div>

      {/* Main Split Architecture */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
         <ResizablePanelGroup
             key={`workspace-outer-v${config.workspaceLayoutVersion ?? WORKSPACE_LAYOUT_VERSION}`}
             id="workspace-outer"
             direction="horizontal"
             defaultLayout={outerDefaultLayout}
             onLayoutChanged={saveOuterLayout}
         >
            {/* Sidebar Tree */}
            <ResizablePanel
              id="sidebar"
              data-tutorial="sidebar"
              defaultSize={panelPct(outerDefaultLayout.sidebar!)}
              minSize={panelPct(MIN_SIDEBAR_SIZE)}
              maxSize={panelPct(MAX_SIDEBAR_SIZE)}
              className="bndz-chrome-sidebar border-r border-[#282830] overflow-hidden py-2 flex flex-col min-h-0"
              style={config.applyColors
                ? { backgroundColor: 'var(--tree-bg)', color: 'var(--tree-text)' }
                : { background: 'var(--bndz-surface-chrome)' }}
            >
               <LeftSidebar
                  sidebarOrder={config.sidebarOrder}
                  showMiniTree={config.showMiniTree !== false}
                  onSectionOrderChange={(order: string[]) => updateConfig({ sidebarOrder: order })}
                  onBackgroundClick={() => { setSelectedItems([], activePaneId); scheduleSelectionChrome([], true); scheduleQuickActionsBar(false); setFocusedItemId(null); setLastClickData(null); setInlineRename(null); }}
                  drivesContent={drives.length > 0 && drives.map(drive => (
                     <div
                        key={drive.name}
                        onClick={() => guardedSetCurrentPath(drive.name)}
                        onContextMenu={(e) => handleContextMenuRequest(e, drive.name, drive.name, true, drive.label, undefined, 'sidebar-item')}
                     >
                        <DriveCard drive={{ ...drive, path: drive.name }} layout="compact" />
                     </div>
                  ))}
                  quickAccessContent={
                     rapidAccessItems.length > 0 ? (
                        rapidAccessItems.map((s) => {
                           const qaPath = normalizePanePath(s.path);
                           const iconFetch = s.iconPath || qaPath;
                           const isRenaming = !s.isDefault && renamingFavoritePath && normalizePanePath(renamingFavoritePath) === qaPath;
                           const isFavoriteDropTarget = !s.isDefault && favoriteDrag?.overPath === qaPath && favoriteDrag.sourcePath !== qaPath;
                           return (
                              <div 
                                 key={qaPath}
                                 draggable={!s.isDefault}
                                 className={`sidebar-pin-row flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-[#ccc] hover:text-white border-l-2 border-transparent hover:border-amber-400/70 transition-all rounded-r-sm mx-1 ${favoriteDrag?.sourcePath === qaPath ? 'opacity-40' : ''} ${isFavoriteDropTarget ? 'ring-1 ring-inset ring-amber-400/60' : ''}`}
                                 onClick={() => { if (!isRenaming) guardedSetCurrentPath(s.path); }}
                                 onDoubleClick={() => { if (!s.isDefault) setRenamingFavoritePath(qaPath); }}
                                 onContextMenu={(e) => {
                                   handleContextMenuRequest(e, s.path, s.path, true, s.name, undefined, 'sidebar-item');
                                 }}
                                 onDragStart={e => {
                                   if (s.isDefault) { e.preventDefault(); return; }
                                   e.dataTransfer.effectAllowed = 'move';
                                   e.dataTransfer.setData('text/plain', qaPath);
                                   setFavoriteDrag({ sourcePath: qaPath, overPath: null });
                                 }}
                                 onDragOver={e => {
                                   const isFileDrag = hasBndzFileDrag(e) || (e.dataTransfer.types.includes('Files'));
                                   if (isFileDrag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return; }
                                   if (!favoriteDrag || s.isDefault) return;
                                   e.preventDefault();
                                   if (favoriteDrag.overPath !== qaPath) setFavoriteDrag(prev => prev ? { ...prev, overPath: qaPath } : prev);
                                 }}
                                 onDrop={e => {
                                   e.preventDefault();
                                   // Dropping files onto a favorite moves/copies them into that folder —
                                   // previously unsupported; only reordering existed.
                                   const bndzPayload = readBndzFileDragData(e);
                                   if (bndzPayload?.paths?.length) {
                                     const op = (e.ctrlKey || e.altKey) ? 'copy' : 'move';
                                     void copyOrMoveToTarget(op, s.path, bndzPayload.paths);
                                     setFavoriteDrag(null);
                                     return;
                                   }
                                   if (e.dataTransfer.files?.length) {
                                     const filePaths = Array.from(e.dataTransfer.files).map((f: any) => f.path).filter(Boolean);
                                     if (filePaths.length) void copyOrMoveToTarget('copy', s.path, filePaths);
                                     setFavoriteDrag(null);
                                     return;
                                   }
                                   if (!favoriteDrag || s.isDefault || favoriteDrag.sourcePath === qaPath) { setFavoriteDrag(null); return; }
                                   const pinned = [...(config.pinnedFavorites || [])];
                                   const fromIdx = pinned.findIndex((p: any) => normalizePanePath(p.path) === favoriteDrag.sourcePath);
                                   const toIdx = pinned.findIndex((p: any) => normalizePanePath(p.path) === qaPath);
                                   if (fromIdx >= 0 && toIdx >= 0) {
                                     const [moved] = pinned.splice(fromIdx, 1);
                                     pinned.splice(toIdx, 0, moved);
                                     updateConfig({ pinnedFavorites: pinned });
                                   }
                                   setFavoriteDrag(null);
                                 }}
                                 onDragEnd={() => setFavoriteDrag(null)}
                              >
                                 <ShellNativeIcon
                                    path={iconFetch}
                                    isDir={shellIconIsDirectory(iconFetch)}
                                    size={14}
                                    eager
                                 />
                                 {isRenaming ? (
                                   <input
                                      autoFocus
                                      type="text"
                                      defaultValue={s.name}
                                      className="text-[11px] font-medium bg-[#1a1a1a] border border-[#0078d4]/45 rounded-[var(--bndz-radius-sm)] px-1 py-0 flex-1 min-w-0 text-white outline-none"
                                      onClick={e => e.stopPropagation()}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') { e.preventDefault(); setRenamingFavoritePath(null); }
                                      }}
                                      onBlur={e => {
                                        const nextName = e.target.value.trim();
                                        setRenamingFavoritePath(null);
                                        if (!nextName || nextName === s.name) return;
                                        const pinned = config.pinnedFavorites || [];
                                        const next = pinned.map((p: any) =>
                                          normalizePanePath(p.path) === qaPath ? { ...p, label: nextName } : p,
                                        );
                                        updateConfig({ pinnedFavorites: next });
                                      }}
                                   />
                                 ) : (
                                   <span className="text-[11px] font-medium truncate">{s.name}</span>
                                 )}
                              </div>
                           );
                        })
                     ) : (
                        <div className="mx-3 my-2 px-3 py-4 text-center rounded-md border border-dashed border-[#333] bg-[#151515]/80">
                           <Icons8Icon id="star_ui" size={16} className="mx-auto mb-2 opacity-50" />
                           <p className="text-[10px] text-gray-500 leading-relaxed">Pin folders from the<br />context menu</p>
                        </div>
                     )
                  }
                  cloudProvidersContent={
                    cloudDriveItems.length > 0 ? (
                      cloudDriveItems.map((item: { label: string; path?: string; syncStatus?: string }) => (
                        <div
                          key={item.path || item.label}
                          className="sidebar-pin-row flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-[#ccc] hover:text-white border-l-2 border-transparent hover:border-[#0078d4]/55 transition-all rounded-r-sm mx-1"
                          onClick={() => item.path && guardedSetCurrentPath(item.path)}
                          onContextMenu={(e) => item.path && handleContextMenuRequest(e, item.path, item.path, true, item.label, undefined, 'sidebar-item')}
                        >
                          <ShellNativeIcon
                            path={item.path}
                            size={14}
                            eager
                          />
                          <span className="text-[11px] font-medium truncate flex-1">{item.label}</span>
                          {item.syncStatus && item.syncStatus !== 'available' && (
                            <span className={`text-[9px] uppercase shrink-0 ${
                              item.syncStatus === 'online-only' ? 'text-amber-400' :
                              item.syncStatus === 'pinned' ? 'text-emerald-400' : 'text-gray-500'
                            }`}>
                              {cloudSidebarStatusLabel(item.syncStatus)}
                            </span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="mx-3 my-2 px-3 py-4 text-center rounded-md border border-dashed border-[#333] bg-[#151515]/80">
                        <Icons8Icon id="cloud_ui" size={16} className="mx-auto mb-2 opacity-40" />
                        <p className="text-[10px] text-gray-500 leading-relaxed">No cloud drives detected</p>
                      </div>
                    )
                  }
                  miniTreeContent={
                    config.showMiniTree !== false ? (
                      <MiniTreePanel nodes={miniTreeNodes} activePath={currentPath} onNavigate={guardedSetCurrentPath} />
                    ) : null
                  }
                  treeContent={
                    <VirtualizedNavTree
                      key={treeRefreshNonce}
                      nodes={treeData}
                      config={config}
                      currentPath={currentPath}
                      indexedRoots={indexedRoots}
                      fileDropTarget={navTreeFileDropTarget}
                      onNavigate={guardedSetCurrentPath}
                      onContextMenu={(e, path, name) => path && handleContextMenuRequest(e, path, path, true, name, undefined, 'tree-item')}
                      onBackgroundContextMenu={(e) => handleContextMenuRequest(e, currentPath, null, true, null, undefined, 'tree-background')}
                      inlineRename={inlineRename}
                      setInlineRename={setInlineRename}
                      navTreeOrder={config.navTreeOrder}
                      onTreeOrderChange={(order) => updateConfig({ navTreeOrder: order })}
                      disallowDragFromTree={settingsRt.mouse.disallowDragFromTree}
                      clipboard={clipboard}
                      onFileDrop={async (payload, destPath, op) => {
                        const destWin = toWindowsPath(destPath);
                        const sourcePaths = payload.paths.map(p => toWindowsPath(p));
                        const shellRt = settingsRt.shell;
                        if (shellRt.confirmDrag) {
                          const label = sourcePaths.length === 1
                            ? (sourcePaths[0].split(/[/\\]/).pop() || 'item')
                            : `${sourcePaths.length} items`;
                          const verb = op === 'copy' ? 'Copy' : 'Move';
                          const approved = await confirm({
                            title: `${verb} ${sourcePaths.length === 1 ? 'Item' : 'Items'}`,
                            message: `${verb} ${label} to ${destPath}?`,
                            type: 'warning',
                            confirmLabel: verb,
                          });
                          if (!approved) return;
                        }
                        executeInternalDrop(op, sourcePaths, destWin, payload.sourcePath);
                      }}
                    />
                  }
               />
            </ResizablePanel>
            <ResizableHandle direction="horizontal" disabled={!uiRuntime.treePanel} className="bndz-resize-handle w-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-col-resize shrink-0 z-20" />

            {/* Center Workspace Area */}
            <ResizablePanel
              id="workspace"
              data-tutorial="workspace"
              defaultSize={panelPct(outerDefaultLayout.workspace!)}
              minSize={panelPct(35)}
              className="bndz-chrome-workspace bndz-gpu-layer min-h-0"
            >
               <ResizablePanelGroup
                   id="workspace-inner"
                   groupRef={innerGroupRef}
                   direction="vertical"
                   defaultLayout={innerDefaultLayout}
                   onLayoutChanged={saveInnerLayout}
               >
                  {/* Main File Grid */}
                  <ResizablePanel id="main" defaultSize={panelPct(innerDefaultLayout.main!)} minSize={panelPct(20)}>
                     <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#202020] relative">
                        {isSyncMode && (
                           <div className="w-full bg-[#36274c] border-b border-[#5e4186] px-4 py-2 flex items-center justify-between shrink-0 z-30 shadow-md">
                               <div className="flex items-center gap-3">
                                  <Icons8Icon id="refresh" size={16} spin={isSyncing} />
                                  <span className="font-semibold text-white">Compare & Sync</span>
                                  {!isSyncing && syncResults && (
                                      <span className="text-gray-300 ml-4 font-mono text-xs">{Object.keys(syncResults).length} differences</span>
                                  )}
                               </div>
                               <div className="flex items-center gap-2">
                                  <button disabled={isSyncing} onClick={() => executeFolderSync('mirror')} className="px-3 py-1 bg-[#10b981] hover:bg-[#059669] text-white rounded shadow text-xs font-semibold flex items-center gap-1 disabled:opacity-50">
                                     <Icons8Icon id="nav_forward" size={14}/> Mirror L {'->'} R
                                  </button>
                                  <button disabled={isSyncing} onClick={() => executeFolderSync('updateTarget')} className="px-3 py-1 bg-[#3b82f6] hover:bg-[#2563eb] text-white rounded shadow text-xs font-semibold flex items-center gap-1 disabled:opacity-50">
                                     <Icons8Icon id="nav_forward" size={14}/> Update Target
                                  </button>
                                  <div className="w-[1px] h-4 bg-[#5e4186] mx-2"></div>
                                  <button onClick={() => { setIsSyncMode(false); setSyncResults({}); }} className="px-3 py-1 bg-[#ef4444] hover:bg-[#dc2626] text-white rounded shadow text-xs font-semibold">
                                     Close
                                  </button>
                               </div>
                           </div>
                        )}
                        <div className="flex flex-1 overflow-hidden min-h-0">
                           {renderPane(panes[0], 0)}
                           
                           {config.dualPaneFeature !== false && isDualPane && panes[1] && (
                              <div ref={dualPaneSecondRef} className="flex flex-1 min-w-0 min-h-0">
                                 <div className="w-1 bg-[#282830] cursor-col-resize shrink-0 shadow-[inset_0_0_2px_rgba(0,0,0,0.5)] z-20"></div>
                                 {renderPane(panes[1], 1)}
                              </div>
                           )}
                        </div>
                     </div>
                  </ResizablePanel>

                  <ResizableHandle
                     direction="vertical"
                     disabled={!effectiveBottomOpen}
                     className="bndz-resize-handle h-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-row-resize shrink-0 z-20"
                  />
                  {/* Bottom Plugin Panel — always mounted; collapsed via panelRef when hidden */}
                  <ResizablePanel
                     id="bottom"
                     panelRef={bottomPanelRef}
                     defaultSize={panelPct(innerDefaultLayout.bottom!)}
                     minSize={panelPct(5)}
                     collapsible
                     collapsedSize={0}
                     className="bndz-chrome-bottom border-t border-[#282830] flex min-h-0 z-30"
                  >
                     <div className="flex-1 overflow-hidden h-full flex flex-col min-h-0">
                        <BottomPluginPanel
                           entity={previewEntity}
                           config={config}
                           drives={drives}
                           focusedPath={currentTab.path}
                           primarySelectedPath={focusedFullPath ? toWindowsPath(focusedFullPath) : null}
                           requestedTab={bottomPluginTab}
                           onRequestedTabConsumed={() => setBottomPluginTab(null)}
                           launchContext={bottomPluginLaunch}
                           onLaunchContextConsumed={() => setBottomPluginLaunch(null)}
                           onActiveTabChange={(_id, name) => setActiveBottomPluginLabel(name || null)}
                           selectedItems={bottomSelectionTargets.paths}
                           selectedTargetTypes={bottomSelectionTargets.types}
                           onOpenPluginStore={() => setIsPluginStoreOpen(true)}
                           currentPath={currentPath}
                           pathContentsCache={pathContentsCache}
                           folderSizeMap={folderSizeMap}
                           onNavigate={(path: string) => setCurrentPath(path)}
                           selectedPaths={bottomSelectionTargets.paths}
                        />
                     </div>
                  </ResizablePanel>
               </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle
               direction="horizontal"
               disabled={!effectivePreviewOpen}
               className="bndz-resize-handle w-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-col-resize shrink-0 z-20"
            />
            <ResizablePanel
               id="preview"
               panelRef={previewPanelRef}
               defaultSize={panelPct(outerDefaultLayout.preview!)}
               minSize={panelPct(MIN_PREVIEW_SIZE)}
               maxSize={panelPct(MAX_PREVIEW_SIZE)}
               collapsible
               collapsedSize={0}
               className="bndz-chrome-preview border-l border-[#282830] overflow-hidden z-10 flex min-h-0 bndz-gpu-layer"
            >
               <div
                  ref={previewPanelInnerRef}
                  className="w-full h-full flex flex-col min-w-0 min-h-0"
                  onContextMenu={(e) => {
                     if (focusedFullPath && focusedEntity) {
                        handleContextMenuRequest(
                           e,
                           currentPath,
                           focusedEntity.id,
                           focusedEntity.type === 'directory',
                           focusedEntity.name,
                           undefined,
                           'preview'
                        );
                     } else {
                        e.preventDefault();
                     }
                  }}
               >
                  <RightPreviewPanel
                     entity={previewEntity}
                     path={previewPath}
                     pathContentsCache={pathContentsCache}
                     onNavigate={p => setCurrentPath(p)}
                  />
               </div>
            </ResizablePanel>
         </ResizablePanelGroup>
      </div>

      {/* Transfer queue (native background jobs) */}
      <FileTransferQueuePanel enabled={fileOpsRt.showTransferPanel} />

      {/* Footer Status Bar scoped to active pane metrics */}
      {uiRuntime.showStatusBar && (
      <div className="bndz-chrome-statusbar border-t border-[#333] px-3 py-1 flex items-center justify-between text-[#a0a0a0] shrink-0 gap-3 min-h-[26px] text-[11px]" style={{ background: 'var(--bndz-surface-chrome)' }}>
         <div className="truncate">
           {config.useStatusBarTemplate && config.unwiredConfig14 ? (
             <span>{renderStatusBarTemplate(String(config.unwiredConfig14), {
               items: activeContents?.length ?? drives.length,
               selected: activeTab.selectedItems.length,
               path: currentTab.path,
               free: statusBarFreeLabel,
               volumes: drives.length,
               app: 'BNDZ',
               ver: appVersion,
               selectionSummary: selectionSummaryLine,
               durationMs: lastLoadDurationMs ?? undefined,
               clipboard: statusBarClipboardLabel,
             })}</span>
           ) : (
             <>
               {activeContents ? `${activeContents.length} item(s)` : `${drives.length} drive(s)`}
               {activeTab.selectedItems.length > 0 ? ` | ${selectionSummaryLine || `${activeTab.selectedItems.length} selected`}` : ''}
             </>
           )}
           {isGlobal && isGlobalSearchLoading && (
             <span className="text-amber-400/90 ml-2">Searching…</span>
           )}
           {isGlobal && !isGlobalSearchLoading && globalSearchEngine && (
             <span className="text-amber-400/70 ml-2">
               Global · {globalSearchEngine === 'indexed' ? 'Indexed search' : globalSearchEngine === 'everything' ? 'Everything' : 'Filesystem'}
             </span>
           )}
           {indexProgress && (!indexProgress.done || !!indexProgress.error) && (
             <IndexProgressChip
               filesIndexed={indexProgress.filesIndexed}
               currentPath={indexProgress.currentPath}
               root={indexProgress.root}
               error={indexProgress.error}
             />
           )}
           {activeTagFilter && (
             <button
               type="button"
               onClick={() => setActiveTagFilter(null)}
               className="bndz-glass-chip ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[#cce4f7] hover:text-white"
               title="Clear tag filter"
             >
               Tag: {activeTagFilter} ×
             </button>
           )}
           {isBottomPanelOpen && activeBottomPluginLabel && (
             <span className="ml-2 text-[#888] hidden sm:inline">
               Plugin · {activeBottomPluginLabel}
             </span>
           )}
           {folderSizeSync?.active && (
             <FolderSizeSyncChip
               current={folderSizeSync.current}
               total={folderSizeSync.total}
               path={folderSizeSync.path}
               percent={folderSizeSync.percent}
               onCancel={cancelFolderSizeSync}
             />
           )}
         </div>
         <div className="flex items-center gap-4 shrink-0">
            {describeClipboardState(clipboard) && (
              <span className={`bndz-status-clipboard ${clipboard.action === 'cut' ? 'bndz-status-clipboard--cut' : ''}`} title="Internal clipboard">
                <Icons8Icon id={clipboard.action === 'cut' ? 'cut' : 'copy'} size={11} />
                <span className="bndz-status-clipboard-label">{describeClipboardState(clipboard)}</span>
              </span>
            )}
            {getHoverPending() && config.showFileInfoTips !== false && config.listHoverTooltipsEnabled !== false && (
              <span className={`bndz-shift-hint hidden md:inline-flex ${isShiftKeyHeld() ? 'bndz-shift-hint-active' : ''}`}>
                <kbd>⇧</kbd> Shift + hover for file details
              </span>
            )}
            {(() => {
              const totalCap = drives.reduce((s, d) => s + (d.totalSpace || 0), 0);
              const totalFree = drives.reduce((s, d) => s + (d.freeSpace || 0), 0);
              const pctFree = totalCap > 0 ? Math.round((totalFree / totalCap) * 100) : 0;
              return (
                <div className="flex items-center gap-2" title={`${formatSize(totalFree)} free of ${formatSize(totalCap)} (${pctFree}% free)`}>
                  <Icons8Icon id="hard_drive_ui" size={12} />
                  <span className="bndz-glass-chip text-[10px] px-2 py-0.5 font-mono text-[#c8c8c8]">
                    {drives.length} vol · {formatSize(totalFree)} free ({pctFree}%)
                  </span>
                </div>
              );
            })()}
            {config.showVersionInformationInTheStatusBar && (
              <span className="text-[10px] font-mono text-[#888] hidden lg:inline">BNDZ {appVersion}</span>
            )}
         </div>
      </div>
      )}
      
      {/* Overlays / Modals */}
      {renameDialog && (
        <NativeDialogShell
          open={!!renameDialog}
          title="Rename"
          variant="sheet"
          size="sm"
          zIndexClass="z-50"
          onClose={() => setRenameDialog(null)}
          showCloseButton
          footerButtons={[
            { label: 'Cancel', onClick: () => setRenameDialog(null) },
            {
              label: 'Rename',
              style: 'primary',
              onClick: () => {
                if (!renameDialog) return;
                void commitRenameForEntity(renameDialog.entity, renameDialog.path, renameDialog.value).then(ok => {
                  if (ok) setRenameDialog(null);
                });
              },
            },
          ]}
        >
          <label className="bndz-native-field-label block mb-2">New name</label>
          <input
            autoFocus
            type="text"
            value={renameDialog.value}
            onChange={(e) => setRenameDialog({ ...renameDialog, value: e.target.value })}
            className="bndz-native-input w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void commitRenameForEntity(renameDialog.entity, renameDialog.path, renameDialog.value).then(ok => {
                  if (ok) setRenameDialog(null);
                });
              }
            }}
          />
          {settingsRt.rename.showNameLength && (
            <p className="text-[10px] text-gray-500 mt-2 tabular-nums">{renameDialog.value.length} characters</p>
          )}
        </NativeDialogShell>
      )}

      {isSaveTabsetOpen && (
        <NativeDialogShell
          open={isSaveTabsetOpen}
          title="Save Tabset As…"
          variant="sheet"
          size="sm"
          zIndexClass="z-50"
          onClose={() => setIsSaveTabsetOpen(false)}
          showCloseButton
          footerButtons={[
            { label: 'Cancel', onClick: () => setIsSaveTabsetOpen(false) },
            {
              label: 'Save',
              style: 'primary',
              onClick: () => {
                if (!tabsetNameInput.trim()) return;
                const newTabset = { id: `ts-${Date.now()}`, name: tabsetNameInput.trim(), panes: JSON.parse(JSON.stringify(panes)) };
                updateConfig({ savedTabsets: [...(config.savedTabsets || []), newTabset] });
                setIsSaveTabsetOpen(false);
                setToastMessage(`Saved Tabset: ${newTabset.name}`);
              },
            },
          ]}
        >
          <label className="bndz-native-field-label block mb-2">Tabset name</label>
          <input
            autoFocus
            type="text"
            value={tabsetNameInput}
            onChange={(e) => setTabsetNameInput(e.target.value)}
            className="bndz-native-input w-full"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tabsetNameInput.trim()) {
                const newTabset = { id: `ts-${Date.now()}`, name: tabsetNameInput.trim(), panes: JSON.parse(JSON.stringify(panes)) };
                updateConfig({ savedTabsets: [...(config.savedTabsets || []), newTabset] });
                setIsSaveTabsetOpen(false);
                setToastMessage(`Saved Tabset: ${newTabset.name}`);
              }
              if (e.key === 'Escape') setIsSaveTabsetOpen(false);
            }}
          />
        </NativeDialogShell>
      )}

      {isLoadTabsetOpen && (
        <NativeDialogShell
          open={isLoadTabsetOpen}
          title="Load Tabset"
          variant="sheet"
          size="sm"
          zIndexClass="z-50"
          onClose={() => setIsLoadTabsetOpen(false)}
          showCloseButton
          footerButtons={[{ label: 'Close', onClick: () => setIsLoadTabsetOpen(false) }]}
          maxHeightClass="max-h-[80vh]"
        >
          <div className="overflow-y-auto min-h-[100px] max-h-[320px] border border-white/10 rounded-lg">
            {!(config.savedTabsets && config.savedTabsets.length > 0) ? (
              <div className="bndz-native-dialog-muted text-sm p-4 text-center">No saved tabsets.</div>
            ) : (
              config.savedTabsets.map((ts) => (
                <div
                  key={ts.id}
                  className="flex justify-between items-center px-4 py-2 hover:bg-white/5 border-b border-white/5 last:border-0 cursor-pointer"
                  onClick={() => {
                    setPanes(JSON.parse(JSON.stringify(ts.panes)));
                    setIsDualPane((ts.panes as PaneState[]).length > 1);
                    updateConfig({ lastActiveTabsetId: ts.id });
                    setIsLoadTabsetOpen(false);
                    setToastMessage(`Loaded Tabset: ${ts.name}`);
                  }}
                >
                  <span>{ts.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateConfig({ savedTabsets: config.savedTabsets?.filter(s => s.id !== ts.id) });
                    }}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <Icons8Icon id="trash_ui" size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </NativeDialogShell>
      )}

      {isSmartToolsOpen && (
        <Suspense fallback={null}>
          <SmartToolsDialog
            isOpen={isSmartToolsOpen}
            onClose={() => { setIsSmartToolsOpen(false); setSmartToolsPrompt(undefined); }}
            selectedItems={activeFilesMap.map((e: any) => e.path || joinPanePath(currentTab.path, e))}
            currentPath={currentTab.path}
            initialPrompt={smartToolsPrompt}
            initialTab={smartToolsTab}
            onNavigate={p => setCurrentPath(p)}
          />
        </Suspense>
      )}
      
      {isToolbarConfigOpen && (
        <ToolbarConfigurator onClose={() => setIsToolbarConfigOpen(false)} availableTags={availableTags} />
      )}

      {isConfigDialogOpen && (
        <Suspense fallback={null}>
          <ConfigurationDialog
            initialTab={configInitialTab}
            onClose={() => { setConfigInitialTab(undefined); setIsConfigDialogOpen(false); }}
          />
        </Suspense>
      )}

      </TrialExpiredGate>

      <AnimatePresence>
        {showAboutDialog && (
          <Suspense fallback={null}>
            <AboutDialog onClose={() => setShowAboutDialog(false)} updateCheckUrl={config.updateCheckUrl} />
          </Suspense>
        )}
        {showRegisterDialog && (
          <Suspense fallback={null}>
            <RegisterDialog
              onClose={() => setShowRegisterDialog(false)}
              onActivated={() => {
                setLicenseEpoch(e => e + 1);
                setShowRegisterDialog(false);
                setToastMessage('License activated successfully.');
              }}
            />
          </Suspense>
        )}
        {showHelpTopics && (
          <Suspense fallback={null}>
            <HelpTopicsDialog onClose={() => setShowHelpTopics(false)} />
          </Suspense>
        )}
      </AnimatePresence>
      {isPluginStoreOpen && (
        <Suspense fallback={null}>
          <PluginStoreDialog onClose={() => setIsPluginStoreOpen(false)} />
        </Suspense>
      )}
      
      {isTagManagerOpen && (
        <Suspense fallback={null}>
          <TagManagerDialog
            isOpen={isTagManagerOpen}
            onClose={() => setIsTagManagerOpen(false)}
            availableTags={availableTags}
            onTagsUpdated={setAvailableTags}
            pathContentsCache={pathContentsCache}
          />
        </Suspense>
      )}

      <RapidAccessPopup
        open={rapidAccessPopupOpen}
        items={rapidAccessItems}
        onClose={() => setRapidAccessPopupOpen(false)}
        onNavigate={(path) => setCurrentPath(normalizePanePath(path))}
      />

      {tabContextMenu && (() => {
        const pane = panes.find(p => p.id === tabContextMenu.paneId);
        const tab = pane?.tabs[tabContextMenu.tabIndex];
        if (!pane || !tab) return null;
        return (
          <TabContextMenu
            x={tabContextMenu.x}
            y={tabContextMenu.y}
            tabLabel={isFindingTab(tab) ? findingTabLabel(tab) : getPaneTabLabel(tab.path)}
            isLocked={!!tab.locked}
            tabColor={tab.color}
            canClose={pane.tabs.length > 1}
            canCloseOthers={pane.tabs.length > 1}
            canCloseRight={tabContextMenu.tabIndex < pane.tabs.length - 1}
            showRefresh
            onRefresh={() => {
              if (isFindingTab(tab) && tab.findingQuery) {
                void refreshFindingTab(tabContextMenu.paneId, tab.id, tab.findingQuery, tab.findingRoot || tab.path, tab);
              } else {
                void refetchPath(tab.path);
              }
              setTabContextMenu(null);
            }}
            onLock={() => toggleTabLock(tabContextMenu.paneId, tabContextMenu.tabIndex)}
            onClose={() => closeTabAt(tabContextMenu.paneId, tabContextMenu.tabIndex)}
            onCloseOthers={() => closeOtherTabs(tabContextMenu.paneId, tabContextMenu.tabIndex)}
            onCloseRight={() => closeTabsToRight(tabContextMenu.paneId, tabContextMenu.tabIndex)}
            onCloseAll={() => closeAllTabs(tabContextMenu.paneId)}
            onDuplicate={() => duplicateTab(tabContextMenu.paneId, tabContextMenu.tabIndex)}
            onSetColor={(color) => setTabColor(tabContextMenu.paneId, tabContextMenu.tabIndex, color)}
            onCloseMenu={() => setTabContextMenu(null)}
          />
        );
      })()}

      {columnPicker && (
        <ClampedFixedMenu
          x={columnPicker.x}
          y={columnPicker.y}
          className="bndz-context-menu py-1 min-w-[190px] bndz-scrollbar"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500">Choose columns</div>
          {LIST_COLUMN_DEFS.map(col => {
            const visibility = resolveListColumnVisibility(config, { isGlobalSearch: isGlobal });
            const visible = col.id === 'name' || visibility[col.id];
            return (
              <label
                key={col.id}
                className={`bndz-context-menu-item px-3 py-[3px] flex items-center gap-2 text-[12px] select-none leading-[22px] ${col.id === 'name' ? 'opacity-50' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={col.id === 'name'}
                  onChange={() => {
                    const current = resolveListColumnVisibility(config, { isGlobalSearch: isGlobal });
                    updateConfig({ listColumnVisibility: { ...current, [col.id]: !current[col.id] } });
                  }}
                  className="accent-[#0078d4]"
                />
                {col.label}
              </label>
            );
          })}
          <div className="my-1 border-t border-white/[0.08]" />
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500">Metadata columns</div>
          {resolveCustomColumns(config).map(col => (
            <label
              key={col.id}
              className="bndz-context-menu-item px-3 py-[3px] flex items-center gap-2 text-[12px] select-none leading-[22px] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={col.enabled}
                onChange={() => {
                  updateConfig({
                    customColumns: setCustomColumnEnabled(config, col.id, !col.enabled),
                  });
                }}
                className="accent-[#0078d4]"
              />
              {col.label}
            </label>
          ))}
        </ClampedFixedMenu>
      )}

      {contextMenu && (
        <div ref={contextMenuRootRef} onMouseDown={e => e.stopPropagation()}>
        <ContextMenuView
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          config={config}
          updateConfig={updateConfig}
          activePaneId={activePaneId}
          addTab={addTab}
          onOpenBatchRename={() => openBottomPlugin('batch-rename')}
          setIsSmartToolsOpen={setIsSmartToolsOpen}
          setToastMessage={setToastMessage}
          setInlineRename={setInlineRename}
          setClipboardState={setClipboardState}
          executePaste={executePaste}
          onDeletePaths={handleDeletePaths}
          onEmptyRecycleBin={handleEmptyRecycleBin}
          onRefreshList={refreshActiveList}
          onRefreshTree={refreshNavigationTree}
          onCopyTo={sources => void copyOrMoveToTarget('copy', undefined, sources)}
          onMoveTo={sources => void copyOrMoveToTarget('move', undefined, sources)}
          availableTags={availableTags}
          onToggleTag={applyTagToSelection}
          selectionTagKeys={(() => {
            if (!contextMenu) return [];
            const items = pathContentsCache[contextMenu.path] || [];
            const keys = new Set<string>();
            const selectedIds = new Set(activeTab.selectedItems);
            for (const item of items) {
              if (selectedIds.has(item.id) || item.id === contextMenu.entityId) {
                (item.tags || []).forEach((t: string) => keys.add(t));
              }
            }
            return [...keys];
          })()}
          onRemoveAllTags={removeAllTagsFromSelection}
          rapidAccessDefaultPaths={rapidAccessItems.filter(i => i.isDefault).map(i => i.path)}
          sortColumn={currentPane.sortColumn as SortColumnId | undefined}
          sortDirection={currentPane.sortDirection}
          onSortBy={col => toggleSort(activePaneId, col)}
          onSetSortDirection={dir => setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, sortDirection: dir } : p))}
          listGroupBy={(config.listGroupBy as ListGroupBy) || 'none'}
          onGroupByChange={value => updateConfig({ listGroupBy: value })}
          onRenameFavorite={path => setRenamingFavoritePath(path)}
          onRestoreRecycleItems={async paths => {
            const { IPC } = await import('../lib/ipcBridge');
            const result = await IPC.restoreRecycleItems(paths);
            if (result.restored > 0) {
              setToastMessage(
                result.failed > 0
                  ? `Restored ${result.restored} item(s); ${result.failed} could not be restored.`
                  : `Restored ${result.restored} item(s) to their original location.`,
                result.failed > 0 ? 'warning' : 'success',
                result.failed > 0 ? 'Partial restore' : 'Restored',
              );
            } else {
              setToastMessage('Could not restore the selected item(s).', 'warning', 'Restore failed');
            }
            void refetchPath(currentPath);
          }}
          onPurgeRecycleItems={async paths => {
            const { IPC } = await import('../lib/ipcBridge');
            const result = await IPC.purgeRecycleItems(paths);
            if (result.purged > 0) {
              setToastMessage(
                result.failed > 0
                  ? `Permanently deleted ${result.purged} item(s); ${result.failed} could not be deleted.`
                  : `Permanently deleted ${result.purged} item(s).`,
                result.failed > 0 ? 'warning' : 'success',
              );
            } else {
              setToastMessage('Could not permanently delete the selected item(s).', 'warning', 'Delete failed');
            }
            void refetchPath(currentPath);
          }}
          onSelectAll={selectAllInActivePane}
          onInvertSelection={invertSelectionInActivePane}
        />
        </div>
      )}

      <DestinationPickerModal
        open={!!destinationPicker}
        title={destinationPicker?.mode === 'move' ? 'Move to folder' : 'Copy to folder'}
        drives={drives}
        onCancel={() => setDestinationPicker(null)}
        onConfirm={panePath => {
          const picker = destinationPicker;
          setDestinationPicker(null);
          if (picker) void copyOrMoveToTarget(picker.mode, panePath, picker.sources);
        }}
      />

      <QuitConfirmDialog
        open={quitDialogOpen}
        source={quitCloseSource}
        onCancel={() => {
          setQuitDialogOpen(false);
          import('../lib/ipcBridge').then(({ IPC }) => IPC.windowCloseResolve('cancel'));
        }}
        onQuit={() => {
          setQuitDialogOpen(false);
          import('../lib/ipcBridge').then(({ IPC }) => IPC.windowCloseResolve('quit'));
        }}
        onMinimizeToTray={(remember) => {
          if (remember) {
            updateConfig({ minimizeToTrayOnXClose: true, minimizeToTray: true });
          }
          setQuitDialogOpen(false);
          import('../lib/ipcBridge').then(({ IPC }) => IPC.windowCloseResolve('tray', remember));
        }}
      />

      <TutorialOverlay forceShow={showTutorial} onClose={() => setShowTutorial(false)} />
      <BndzQuickPreview
        open={quickPreviewOpen && quickPreviewItems.length > 0}
        items={quickPreviewItems}
        index={Math.min(quickPreviewIndex, Math.max(0, quickPreviewItems.length - 1))}
        onClose={() => setQuickPreviewOpen(false)}
        onIndexChange={setQuickPreviewIndex}
        onNavigate={p => setCurrentPath(p)}
      />
      <CommandPalette 
          isOpen={isCommandPaletteOpen} 
          onClose={() => setIsCommandPaletteOpen(false)} 
          actions={paletteActions}
      />
      {tagAssignmentActive && (
        <div className="fixed inset-x-0 bottom-8 z-[60] pointer-events-none flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-3xl relative">
            <Suspense fallback={null}>
              <TagAssignmentMode
                isActive={tagAssignmentActive}
                onExit={() => setTagAssignmentActive(false)}
                tags={availableTags}
                selectedCount={currentTab.selectedItems.length}
                onToggleTag={(tag) => void applyTagToSelection(tag)}
                tagActiveOnSelection={(tag) => {
                  const key = resolveTagKey(tag);
                  if (!key || !currentTab.selectedItems.length) return false;
                  const items = pathContentsCache[normalizePanePath(currentPath)] || [];
                  const selected = items.filter((x: any) => currentTab.selectedItems.includes(x.id));
                  return selected.length > 0 && selected.every((x: any) => entityHasTag((x as any).tags, key));
                }}
              />
            </Suspense>
          </div>
        </div>
      )}
      {listDragOperation && (
        <div className="fixed inset-x-0 bottom-4 z-[70] pointer-events-none flex justify-center px-4">
          <div className="bndz-glass-chip px-3 py-1.5 text-[11px] font-medium text-white/90 flex items-center gap-2">
            {listDragOperation === 'copy' ? (
              <Icons8Icon id="copy" size={13} className="shrink-0" />
            ) : (
              <Icons8Icon id="move_ui" size={13} className="shrink-0" />
            )}
            <span>{listDragOperation === 'copy' ? 'Copy here' : 'Move here'}</span>
            <span className="text-white/40 font-normal">· hold Ctrl to copy</span>
          </div>
        </div>
      )}
      {listDragGhost && <ListDragGhost ghost={listDragGhost} />}
      <FloatingTooltipHost />
    </div>
  );
}
