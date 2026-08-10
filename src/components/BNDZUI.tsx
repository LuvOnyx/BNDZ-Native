import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react';
import { flushSync } from 'react-dom';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { CloseGlyph } from './ChromeGlyphs';
import { normalizeDirEntries } from '../lib/normalizeDirEntry';
import { createInitialFileSystem, getDirContents, getEntityByPath, updateFileSystem } from '../data/initialFS';
import { VirtualDirectory, FSEntity, DriveInfo, ShortcutInfo } from '../types';
import { useModal } from './ModalProvider';
import { isArchiveExt } from '../lib/archiveTypes';
import { useClipboard } from '../data/ClipboardContext';
import { MenubarSubmenu } from './MenubarSubmenu';
import { MenubarPortalMenu } from './MenubarPortalMenu';
import QuickActionsBar, { buildDefaultQuickActions } from './QuickActionsBar';
import FileTransferQueuePanel from './FileTransferQueuePanel';
import FolderSizeSyncChip from './FolderSizeSyncChip';
import { SizeBar, type SizeBarStyle } from './SizeBar';
import IndexProgressChip from './IndexProgressChip';
import ListPaneSkeleton from './ListPaneSkeleton';
import DriveCard from './DriveCard';
import { BreadcrumbTrail } from './BreadcrumbTrail';
import {
  setMarqueeActive, isMarqueeActive, beginDragSession, trackDragPointer,
  clearDragSession, markPointerDown, hasMetDragThreshold, isDragSessionReady,
  canStartDragFromList, DRAG_DELAY_SELECTED, DRAG_DELAY_DEFAULT,
  isWithinDoubleClickGuard,
  setMarqueeDragOccurred, consumeMarqueeDragOccurred,
} from '../lib/dragController';
import {
  isFilesHostBoot,
  notifyFilesHostNavigate,
  requestFilesHostDirListing,
  subscribeFilesHostContext,
  subscribeFilesHostListing,
} from '../lib/filesHostBoot';
import {
  isNativeShellHostBoot,
  isNativeShellCraftIslandBoot,
  notifyNativeShellNavigate,
  requestNativeShellDirListing,
} from '../lib/nativeShellHostBoot';
import { useNativeShellHostBridge } from '../hooks/useNativeShellHostBridge';
import { resolveDropOperation } from '../lib/dropOperation';
import {
  shouldCommitInternalFileDrop,
  getParentWinPath,
} from '../lib/dropDestination';
import { isCopyDragModifier } from '../lib/listDragModifiers';
import ListDragGhost, { type ListDragGhostMeta } from './ListDragGhost';
import { prefetchFluidDragThumbs } from '../workstation/drag/fluidDragThumbs';
import FluidDragOrchestrator from '../workstation/drag/FluidDragOrchestrator';
import { WorkstationVisualProvider } from '../workstation/WorkstationVisualProvider';
import {
  armFluidDrag,
  disarmFluidDrag,
  fluidDragBridgeSetPointer,
  updateFluidDragMeta,
  setFluidDragSnapTension,
} from '../workstation/drag/fluidDragBridge';
import { setSnapZone, clearSnapZones, computeSnapTension } from '../workstation/drag/snapField';
import { setMotionDragPhase } from '../workstation/workstationMotionBus';
import type { ContextToolId } from '../workstation/command-deck/contextToolRegistry';
import CommandDeckShell from '../workstation/command-deck/CommandDeckShell';
import { deriveSelectionSignature } from '../workstation/selectionSignature';
import { autoScrollNearEdges, createDragAutoScrollLoop } from '../lib/dragAutoScroll';
import {
  hitTestBreadcrumbAtPoint,
  hitTestListFolderAtPoint,
  hitTestMillerDropPathAtPoint,
  hitTestNavTreeAtPoint,
  hitTestNewTabZoneAtPoint,
  hitTestTabAtPoint,
  hitTestListBodyAtPoint,
  hitTestWorkspaceSurfaceAtPoint,
  beginFileDragSession,
  endFileDragSession,
  stashOleDragSession,
  consumeOleDragSession,
  getFileDragSession,
  resolveFileDropDestination,
  isInternalFileDragChromeAtPoint,
  hitTestArchiveRootAtPoint,
  DEFAULT_TAB_HOVER_DELAY_MS,
  resolveNativeFileDropTarget,
} from '../lib/fileDragSession';
import {
  POINTER_FILE_DRAG_MOVE,
  POINTER_FILE_DRAG_ACTIVE,
  dispatchPointerFileDragMove,
  type PointerFileDragMoveDetail,
} from '../lib/pointerFileDragBridge';
import { IPC, RenameOperation } from '../lib/ipcBridge';
import { syncMeshDropConfig } from '../lib/meshDropConfigSync';
import { requestMediaHandoff } from '../lib/mediaPlaybackBridge';
import { isVideoExt } from '../lib/mediaTypes';
import ClampedFixedMenu from './ClampedFixedMenu';
import FolderContentsPeek, { type FolderContentsPeekState } from './FolderContentsPeek';
import { executeUndoWithTimeout, executeRedoWithTimeout } from '../lib/undoRedo';
import { isQueuedIpcResult } from '../lib/transferIpc';
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
import { setDragGhostPosition, armDragGhost } from '../lib/pointerDragGhost';
import { filterByName } from '../lib/fuzzyFilter';
import PaneTabStrip from './PaneTabStrip';
import MiniTreePanel from './MiniTreePanel';
import AddressAutocompleteDropdown from './AddressAutocompleteDropdown';
import WindowControls from './WindowControls';
import ContextMenuView from './ContextMenuView';
import MeshDropDialog from './meshdrop/MeshDropDialog';
import { filterSupplementalNativeItems, takeShellCascadeByLabel, resolveNativeItemVerb, type ContextMenuSurface, type NativeContextMenuItem } from '../lib/contextMenuActions';
import { TabContextMenu, showTabHostContextMenu } from './TabContextMenu';
import { requestNativePrompt } from '../lib/nativeDialog';
import { prefetchIconsForEntities, prefetchMediaThumbnailsForEntities, prefetchShellIconPaths, prefetchListingVisuals, listingPrefetchFromConfig } from '../lib/nativeIconService';
import { isRealityCheckActive, isRealityCheckMissing, subscribeRealityCheck } from '../lib/realityCheckState';
import { mergeDirEntryChunks } from '../lib/dirListingStream';
import { applyFsEventsToListing } from '../lib/fsListingPatch';
import { classifyListPointerDown } from '../lib/listGestureHit';
import { runWebViewPrimaryAction } from '../lib/webViewClick';
import { markScrolling as markIconQueueScrolling, getIconQueueDepth } from '../lib/iconRequestQueue';
import { getLocationEntityFromPath, getLocationIconPath } from '../lib/virtualLocations';
import BottomPluginPanel from './BottomPluginPanel';
import RightPreviewPanel from './RightPreviewPanel';
import { LeftSidebar } from './LeftSidebar';
import { ThumbnailIcon } from './ThumbnailIcon';
import { ShellNativeIcon } from './ShellNativeIcon';
import { CloudNavIcon } from './CloudNavIcon';
import ToolbarConfigurator, { resolveToolbarItem } from './ToolbarConfigurator';
import { createEntityTooltipHandlers } from '../lib/entityTooltip';
import {
  advanceSlowDoubleClickRename,
  clearSlowDoubleClickTimer,
} from '../lib/slowDoubleClickRename';
import { shouldSuppressNativeEntityTitle } from '../lib/tooltipSettings';
import CustomColumnCell from './CustomColumnCell';
import { parseCustomColumnListId, resolveCustomColumns, setCustomColumnEnabled } from '../lib/customColumns';
import { invalidateExtendedMetadata, prefetchExtendedMetadataBatch } from '../lib/extendedMetadataCache';
import { hideFloatingTooltip, getFloatingTooltip, isShiftKeyHeld, subscribeShiftKey, getHoverPending, subscribeFloatingTooltip } from '../lib/floatingTooltip';
import { registerEscapeLayer } from '../lib/globalEscape';
import FloatingTooltipHost from './FloatingTooltipHost';
import LicenseBanner from './LicenseBanner';
import TrialExpiredGate from './TrialExpiredGate';

const AboutDialog = lazy(() => import('./AboutDialog'));
const RegisterDialog = lazy(() => import('./RegisterDialog'));
const HelpTopicsDialog = lazy(() => import('./HelpTopicsDialog'));
const ConfigurationDialog = lazy(() => import('./ConfigurationDialog'));
const ActionHistoryDialog = lazy(() => import('./ActionHistoryDialog'));
const PluginStoreDialog = lazy(() => import('./PluginStoreDialog').then(m => ({ default: m.PluginStoreDialog })));
const TagManagerDialog = lazy(() => import('./TagManagerDialog').then(m => ({ default: m.TagManagerDialog })));
const SmartToolsDialog = lazy(() => import('./SmartToolsDialog'));
const TagAssignmentMode = lazy(() => import('../spacedrive/port/TagAssignmentMode'));
import { toLocalStreamUrl } from '../lib/iconLibraryUtils';
import { formatFolderSizeLabel } from '../lib/folderSizeDisplay';
import { VirtualizedFileList } from './VirtualizedFileList';
import FileListRow from './list/FileListRow';
import ListGroupHeaderRow from './list/ListGroupHeaderRow';
import { PaneListBridgeSync, type FileListRowBridge } from './list/fileListRowBridge';
import { InlineRenameInput } from './list/InlineRenameInput';
import { BndzDensitySlider } from './BndzDensitySlider';
import MillerColumnsView from './MillerColumnsView';
import BranchViewStrip from './BranchViewStrip';
import { flattenGroupedList, isGroupHeaderRow, LIST_GROUP_BY_OPTIONS, resolveStickyGroupHeader, type ListGroupBy, type ListRowItem } from '../lib/listGrouping';
import { resolveThumbnailCaptionLines } from '../lib/thumbnailCaptions';
import { isSemanticDeskActive } from '../lib/semanticDeskRuntime';
import { cloudBadgeForPath, cloudSidebarStatusLabel, type CloudProvider } from '../lib/cloudStatus';
import { VirtualizedNavTree } from './VirtualizedNavTree';
import TutorialOverlay from './TutorialOverlay';
import DestinationPickerModal from './DestinationPickerModal';
import QuitConfirmDialog from './QuitConfirmDialog';
import { JobTicketOverdueBadge } from './preview/JobTicketPanel';
import SearchToolbar, { type SearchScope, type SearchKindFilter } from '../spacedrive/port/SearchToolbar';
import FolderSizeTreemap from './views/FolderSizeTreemap';
import FolderSizeListView from './views/FolderSizeListView';
import SizeView from '../spacedrive/port/SizeView';
import FindingTabToolbar from './FindingTabToolbar';
import BndzMediaView from './views/BndzMediaView';
import BndzHubView from './views/BndzHubView';
import BndzHomeView from './views/BndzHomeView';
import BndzSpatialCanvasView from './views/BndzSpatialCanvasView';
import BndzAutomationView from './views/BndzAutomationView';
import BndzTwinVolumeChessView from './views/BndzTwinVolumeChessView';
import BndzTemporalDiffView from './views/BndzTemporalDiffView';
import BndzRecentsView from './views/BndzRecentsView';
import BndzIndexEmptyState from './views/BndzIndexEmptyState';
import { isPortableDeviceReadOnly } from '../lib/portablePaths';
import DropMagnetStrip from './DropMagnetStrip';
import HelloGateOverlay from './HelloGateOverlay';
import { useLiveShareCursor, isPathInPeerSelection } from '../lib/liveShareCursor';
import { initAdaptiveListDensity, onAdaptiveListScroll, onAdaptiveListFocus } from '../lib/adaptiveListDensity';
import { useJobTicketOverdueMap } from '../lib/useJobTicketOverdueMap';
import { useHealthProblemMap, HEALTH_BADGE_COLORS } from '../lib/useHealthProblemMap';
import BndzQuickPreview from './preview/BndzQuickPreview';
import ListFilterChips, { matchesListKindFilter, matchesTagFilter, type ListKindFilter } from './views/ListFilterChips';
import TagBadge from './TagBadge';
import { resolveTagKey, tagStorageKey, entityHasTag, tagChipId } from '../lib/tagUtils';
import { gridTileMetrics, listTileMetrics, driveGridMetrics, driveListMetrics, detailsTileMetrics, packGridTracks } from '../lib/viewModeMetrics';
import { useContextMenuDismissOnLeave } from '../hooks/useContextMenuDismissOnLeave';
import { isBndzVirtualPath, isBndzHomePath, isBndzCanvasPath, isBndzAutomationPath, isBndzTwinVolumePath, isBndzTemporalDiffPath, isBndzWorkspacePath, isBndzRamPath, isBndzPortalPath, isFsDropTargetPath, parseBndzRamZoneId, parseBndzVirtualView, parseBndzPortalView, bndzVirtualPath, bndzVirtualLabel, bndzRamVirtualPath, remapRetiredVirtualPath, BNDZ_VIEWS_ROOT, BNDZ_HOME, BNDZ_CANVAS, BNDZ_AUTOMATION, BNDZ_TWIN_VOLUME, BNDZ_TEMPORAL_DIFF, BNDZ_RAM_ROOT, BNDZ_PROBLEMS, BNDZ_INBOUND } from '../lib/bndzVirtualViews';
import { invalidateRamZoneMountCache, remapRamListingEntries, refreshRamZoneMounts, resolvePanePathForFs, resolveRamStagingFsPath, resolveRamZoneMountPath, entityFsPath } from '../lib/ramStagingPaths';
import {
  WORK_INTENT_ORDER,
  WORK_INTENT_PACKS,
  applyWorkIntentPack,
  intentRequiresStrictConfirm,
  readFolderIntentContract,
  type WorkIntentId,
} from '../lib/workIntent';
import { EmblemIcon } from './EmblemIcon';
import { isWorkspacePointerTarget } from '../lib/workspace/workspaceFocus';
import { bindGlobalChromeCursorReset, bindGlobalSpatialCursorGuard } from '../lib/workspace/workspaceCursorGuard';
import { pushGhostTrail, getGhostTrail } from '../lib/ghostTrail';
import {
  GOOGLE_DRIVE_HUB_PATH,
  groupCloudProvidersForNav,
  googleDriveHubEntities,
  isGoogleDriveHubPath,
  isCloudOwnedDrive,
  cloudVolumeRoot,
} from '../lib/cloudDriveNav';
import { buildGlobalSearchArgs, normalizeSearchResults, type IndexedSearchScope } from '../lib/globalSearchCall';

import { setPathCacheEntry, setPinnedPathCacheKeys, configurePathCacheMax, invalidatePathCacheKey } from '../lib/pathCacheLru';
import type { BottomPluginLaunchContext } from './BottomPluginPanel';
import {
  getVisibleListColumns,
  getColumnStyle,
  formatAttributesLabel,
  formatFsDateTime,
  resolveListColumnOrder,
  resolveListColumnVisibility,
  LIST_COLUMN_DEFS,
  type ListColumnId,
  type SortColumnId,
} from '../lib/listColumns';
import ListColumnHeaderStrip from './ListColumnHeaderStrip';
import { computeAutosizedColumnWidths, parseColumnAutosizeLimits } from '../lib/columnAutosize';
import RapidAccessPopup from './RapidAccessPopup';
import ClipboardMarkBadge from './ClipboardMarkBadge';
import {
  describeClipboardState,
  getClipboardMarkForEntity,
  resolveEntityWindowsPath,
} from '../lib/clipboardVisual';
import { findEntityInCache, joinPanePath, joinPanePathForFs, toWindowsPath, normalizePanePath, watcherDirToPanePath, RECYCLE_BIN_PATH, isRecycleBinPath, panePathsEqual, isValidShellTarget } from '../lib/pathUtils';
import { millerRootForMount, resolveMillerRootOnNavigate } from '../lib/millerColumns';
import { appendDropStackPaths } from '../lib/dropStackStore';
import { isMeshPath } from '../lib/meshPaths';
import { canonicalDropPath, resolveDropRoute, MESH_DROP_INBOX_DEST } from '../lib/fsPathRouting';
import { executeMeshTransfer, hydrateMeshPathsForDrag } from '../lib/meshTransfer';
import { formatTransferProgressLine } from '../lib/fileTransferQueue';
import { buildRapidAccessDefaults, mergeRapidAccessItems, dedupePinnedFavorites, collapseKnownFolderShadowPath, orderRapidAccessItems, knownFolderDedupeKey } from '../lib/rapidAccessDefaults';
import { resolveFileDragHoverAtPoint, setExternalDragHover, setPointerDragHover, clearPointerDragHover, clearExternalDragHover, recordExternalDragHover } from '../lib/fileDragHover';
import { registerFileDropBusContext, commitExternalOleDrop, commitArchiveInternalDrop } from '../lib/fileDropBus';
import DropDebugOverlay from './DropDebugOverlay';
import { toPanePath, SHELL_CLSID, KNOWN_FOLDER_SHELL, shellIconIsDirectory, resolveEntityPanePath, isShellKnownFolderRoot, shellKnownFolderParent, resolveShellKnownFolderToFs, resolveShellPropertiesPath, CONTROL_PANEL_PATH } from '../lib/shellPaths';
import { applySettingsRuntime } from '../lib/settingsRuntime';
import { applyListChromeFromConfig } from '../lib/listChromeSettings';
import { installUiZoomGuard } from '../lib/uiZoomGuard';
import { getIndexStatusCached, invalidateIndexStatusCache } from '../lib/indexStatusCache';
import { pushToast, dismissToast, type ToastKind } from './ToastHost';
import { getPaneTabLabel } from '../lib/paneLabels';
import { formatAddressBarPath, formatDriveDisplayName, formatDriveLetter, formatDriveRootLabel, formatDriveVolumeLabel, formatUiPath, getBreadcrumbSegments, parseUserPathToPane, resolveUserPathToPane } from '../lib/displayPath';
import { isVirtualCatalogPath } from '../lib/virtualPaths';
import { listCatalogs } from '../lib/catalog';
import { dispatchCustomEvent } from '../lib/customEventActions';
import { dispatchMouseItemBinding, resolveMouseBindingKey } from '../lib/mouseBindings';
import { applyNavTreeOrder, mergeNavTreeOrder, type NavTreeBuildNode } from '../lib/navTreeOrder';
import { buildMeshPath, MESH_ROOT } from '../lib/meshPaths';
import { normalizeMeshHost, type MeshHost } from '../lib/meshTypes';
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
import { buildFileOpsRuntime, readSettingNumber } from '../lib/settingsWiring';
import {
  getTabLimitBehavior,
  getListIxBehavior,
  getHistoryBehavior,
  getFindBehavior,
  getWorkspaceLeftoverBehavior,
  getStartupBehavior,
  getNetworkBehavior,
} from '../lib/settingsBehavior';
import {
  applyWebPathMap,
  buildListReportCsv,
  formatCopyNameFromTemplates,
  formatMessageSaveName,
  resolveHonoredPath,
} from '../lib/listReportExport';
import {
  findReusableTab,
  localizedEntityName,
  resolveVolumeLabelPath,
  toFsPathWithOverlongSupport,
} from '../lib/startupTabsSettings';
import {
  clearTabsetRevertSnapshot,
  getTabsetRevertSnapshot,
} from '../lib/settingsPersist';
import { protectDirectionalFormatting } from '../lib/bidiProtection';
import {
  deletePermanentVariable,
  normalizePermanentVariables,
  setPermanentVariable,
} from '../lib/permanentVariables';
import { formatTabCaption } from '../lib/tabCaption';
import { resolvePasteDestination } from '../lib/pasteDestination';
import { resolvePaneTab } from '../lib/paneTabGuards';
import { matchesShortcut, matchesTypeAhead, typeAheadEntityName } from '../lib/keyboardShortcuts';
import { advanceTypeAheadPrefix, pickTypeAheadMatch, typeAheadCharFromEvent, scrollListToEntity } from '../lib/typeAheadFind';
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
  getDualPaneDefaultLayout,
  getMainRowDefaultLayout,
  computeVisibleMainRowLayout,
  computeVisibleOuterLayout,
  migrateLayoutV45,
  DEFAULT_INNER_LAYOUT,
  DEFAULT_OUTER_LAYOUT,
  DEFAULT_DUAL_PANE_LAYOUT,
  WORKSPACE_LAYOUT_VERSION,
  MAX_PREVIEW_SIZE,
  MIN_PREVIEW_SIZE,
  MIN_SIDEBAR_SIZE,
  MAX_SIDEBAR_SIZE,
  MAX_BOTTOM_DOCKED,
  BOTTOM_IMMERSIVE_TRIGGER,
  normalizeOuterLayout,
  panelPct,
} from '../lib/workspaceLayout';
import { motionPanelImmersiveEnter, motionPanelImmersiveExit } from '../lib/bndzMotion';
import { buildShellExecuteOptions } from '../lib/shellExecuteRuntime';
import { TagGlyph } from './TagGlyph';
import FolderColorIcon from './FolderColorIcon';
import { launcherIconUrl } from '../lib/toolbarLauncherIcons';

const BNDZ_APP_ICON = '/BNDZ-Glass-folder.webp';

const ToolbarButton = ({ iconId, launcherIcon, tagColor, onClick, onContextMenu, className = '', title, disabled }: {
  iconId?: string;
  launcherIcon?: string;
  /** When set, render the tintable Tags glyph instead of a raster launcher icon. */
  tagColor?: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
      className={`p-[4px] hover:bg-[#333] active:bg-[#444] rounded-[5px] mx-[1px] flex items-center justify-center transition-none disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent ${className}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
        {tagColor ? (
          <TagGlyph color={tagColor} size={18} />
        ) : launcherIcon ? (
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

const EMPTY_TOOLTIP_HANDLERS = { onMouseEnter: () => {}, onMouseMove: () => {}, onMouseLeave: () => {} };

function nativeContextSignature(items: any[] | undefined): string {
  const walk = (list: any[] | undefined): string[] => {
    if (!list?.length) return [];
    const out: string[] = [];
    for (const item of list) {
      if (item?.separator) {
        out.push('-');
        continue;
      }
      out.push(String(item.id || item.verb || item.label || ''));
      if (Array.isArray(item.children) && item.children.length) {
        out.push(`{${walk(item.children).join(',')}}`);
      }
    }
    return out;
  };
  return walk(filterSupplementalNativeItems(items)).join('|');
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

export default function BNDZUI() {
  const { showModal, confirm } = useModal();
  const { clipboard, clipboardHistory, setClipboardState, executePaste, restorePreviousClipboard, clearClipboard } = useClipboard();
  const { config, updateConfig } = useAppConfig();
  const keyboardMap = useMemo(() => {
    // Settings → Custom Keyboard Shortcuts (literal toggle for strong wiring)
    void config.customKeyboardShortcuts;
    return buildSettingsRuntime(config).keyboard;
  }, [config, config.customKeyboardShortcuts]);
  const fileOpsRt = useMemo(() => buildFileOpsRuntime(config), [config]);
  const settingsRt = useMemo(() => buildSettingsRuntime(config), [config]);
  const { pluginRegistry } = usePluginRegistry();

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

  type MarqueeSelectMeta = {
    rowHeight: number;
    items: Array<{ id: string; rowIndex: number; colIndex?: number }>;
    /** When set, marquee uses 2D tile hit-testing (grid view). */
    gridCols?: number;
    colWidth?: number;
    /** Horizontal gap between grid tracks (must match CSS `gap`). */
    colGap?: number;
    /** Scroll-content origin of the first tile (list padding). */
    contentOffsetX?: number;
    contentOffsetY?: number;
  };

  const marqueeOpsRef = useRef({
    setSelectedItems: (_ids: string[] | ((prev: string[]) => string[]), _paneId: string) => {},
    scheduleSelectionChrome: (_ids: string[], _immediate: boolean) => {},
    scheduleQuickActionsBar: (_show: boolean, _immediate?: boolean) => {},
  });

  /** Per-pane DOM elements for the marquee rect — updated imperatively, zero React renders. */
  const marqueeRectByPaneRef = useRef<Map<string, HTMLElement>>(new Map());
  /**
   * Live marquee selection preview — DOM + renderItem read this without React setState
   * every pointermove (virtualized remounts still pick it up).
   */
  const marqueeLiveSelectionRef = useRef<{ paneId: string; ids: Set<string> } | null>(null);

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
    // Cache list geometry ΓÇö avoid getBoundingClientRect every move.
    let listRect = listEl.getBoundingClientRect();
    let originScrollLeft = listEl.scrollLeft;
    let originScrollTop = listEl.scrollTop;
    const pointInList = (cx: number, cy: number) => ({
      x: cx - listRect.left + listEl.scrollLeft,
      y: cy - listRect.top + listEl.scrollTop,
    });

    const pt = pointInList(clientX, clientY);
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
    document.documentElement.dataset.marqueeActive = '1';
    setMarqueeDragOccurred(false);
    if (capturePointerId != null) {
      try { listEl.setPointerCapture(capturePointerId); } catch { /* ignore */ }
    }

    let lastSelectionKey = '';
    let latestSelected: string[] = additive ? [...baseSelection] : [];
    let latestClientY = clientY;

    const syncMountedSelectionChrome = (ids: Set<string>) => {
      listEl.querySelectorAll('.fs-item-wrapper[data-id]').forEach(node => {
        const el = node as HTMLElement;
        const id = el.getAttribute('data-id');
        if (!id) return;
        const on = ids.has(id);
        el.classList.toggle('fs-item-selected', on);
      });
    };

    const computeSelection = (state: typeof marqueeState): string[] => {
      const mLeft = Math.min(state.startX, state.currX);
      const mTop = Math.min(state.startY, state.currY);
      const mRight = Math.max(state.startX, state.currX);
      const mBottom = Math.max(state.startY, state.currY);
      const selected: string[] = [];
      if (selectMeta?.items?.length) {
        const rh = selectMeta.rowHeight;
        const cols = selectMeta.gridCols;
        const cw = selectMeta.colWidth;
        const cg = selectMeta.colGap ?? 0;
        const ox = selectMeta.contentOffsetX ?? 0;
        const oy = selectMeta.contentOffsetY ?? 0;
        for (const item of selectMeta.items) {
          const rowTop = oy + item.rowIndex * rh;
          const rowBottom = rowTop + rh;
          if (rowBottom < mTop || rowTop > mBottom) continue;
          if (cols && cw != null && item.colIndex != null) {
            const colLeft = ox + item.colIndex * (cw + cg);
            const colRight = colLeft + cw;
            if (colRight < mLeft || colLeft > mRight) continue;
          }
          selected.push(item.id);
        }
      } else {
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
      return state.additive
        ? [...new Set([...state.baseSelection, ...selected])]
        : selected;
    };

    const applyMarqueeSelectionPreview = (state: typeof marqueeState) => {
      const finalSelected = computeSelection(state);
      const key = finalSelected.join('\0');
      if (key === lastSelectionKey) return;
      lastSelectionKey = key;
      latestSelected = finalSelected;
      const idSet = new Set(finalSelected);
      marqueeLiveSelectionRef.current = { paneId: state.activePane, ids: idSet };
      syncMountedSelectionChrome(idSet);
      // No React setState / quick-actions during scrub ΓÇö commit on pointerup.
    };

    // Single merged RAF: imperative rect style write + selection preview in one frame.
    let mergedRaf = 0;
    let pendingMarqueeState: typeof marqueeState | null = null;

    const scheduleMergedFrame = (state: typeof marqueeState) => {
      pendingMarqueeState = state;
      if (mergedRaf) return;
      mergedRaf = window.requestAnimationFrame(() => {
        mergedRaf = 0;
        const s = pendingMarqueeState;
        if (!s) return;
        pendingMarqueeState = null;
        // Refresh rect if scroll changed (edge auto-scroll).
        if (listEl.scrollLeft !== originScrollLeft || listEl.scrollTop !== originScrollTop) {
          listRect = listEl.getBoundingClientRect();
          originScrollLeft = listEl.scrollLeft;
          originScrollTop = listEl.scrollTop;
        }
        const rectEl = marqueeRectByPaneRef.current.get(paneId);
        if (rectEl) {
          const left = Math.min(s.startX, s.currX);
          const top = Math.min(s.startY, s.currY);
          const w = Math.abs(s.startX - s.currX);
          const h = Math.abs(s.startY - s.currY);
          rectEl.style.left = `${left}px`;
          rectEl.style.top = `${top}px`;
          rectEl.style.width = `${w}px`;
          rectEl.style.height = `${h}px`;
        }
        applyMarqueeSelectionPreview(s);
        autoScrollNearEdges(listEl, latestClientY, { edgePx: 56, maxStepPx: 28 });
      });
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - clientX) > 3 || Math.abs(ev.clientY - clientY) > 3) {
        setMarqueeDragOccurred(true);
      }
      latestClientY = ev.clientY;
      const p = pointInList(ev.clientX, ev.clientY);
      marqueeState.currX = p.x;
      marqueeState.currY = p.y;
      scheduleMergedFrame({ ...marqueeState });
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (mergedRaf) {
        window.cancelAnimationFrame(mergedRaf);
        mergedRaf = 0;
      }
      if (capturePointerId != null) {
        try { listEl.releasePointerCapture(capturePointerId); } catch { /* ignore */ }
      }
      const moved = Math.abs(marqueeState.currX - marqueeState.startX) > 3
        || Math.abs(marqueeState.currY - marqueeState.startY) > 3;
      const ops = marqueeOpsRef.current;
      if (moved) {
        if (pendingMarqueeState) applyMarqueeSelectionPreview(pendingMarqueeState);
        else applyMarqueeSelectionPreview(marqueeState);
        ops.setSelectedItems(latestSelected, paneId);
        ops.scheduleQuickActionsBar(latestSelected.length > 0, true);
      } else if (!additive) {
        // Plain click on empty canvas / marquee gutter ΓÇö clear selection (Explorer-class).
        marqueeLiveSelectionRef.current = null;
        syncMountedSelectionChrome(new Set());
        ops.setSelectedItems([], paneId);
        ops.scheduleQuickActionsBar(false, true);
      }
      // Suppress the trailing click so row handlers do not re-select after a gutter hit.
      setMarqueeDragOccurred(true);
      pendingMarqueeState = null;
      marqueeLiveSelectionRef.current = null;
      delete document.documentElement.dataset.marqueeActive;
      setMarquee(null);
      setMarqueeActive(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [drivesReady, setDrivesReady] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudProvider[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [networkNodes, setNetworkNodes] = useState<any[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const lastAppliedTagRef = useRef<any | null>(null);
  const [indexedSearchScope, setIndexedSearchScope] = useState<SearchScope>('library');
  const [globalSearchKindFilter, setGlobalSearchKindFilter] = useState<SearchKindFilter>('all');
  const [listKindFilter, setListKindFilter] = useState<ListKindFilter>('all');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [smartViewsExpanded, setSmartViewsExpanded] = useState(true);
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [externalDragPaths, setExternalDragPaths] = useState<string[]>([]);
  const [ramStagingExpanded, setRamStagingExpanded] = useState(true);
  const [ghostColdExpanded, setGhostColdExpanded] = useState(false);
  const [sidebarRamZones, setSidebarRamZones] = useState<{ id: string; name: string; isDirty?: boolean; driveLetter?: string }[]>([]);
  const lastFolderIntentRef = useRef<string>('');
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const quickPreviewOpenRef = useRef(false);
  const openQuickPreviewRef = useRef<((startIndex?: number) => void) | null>(null);
  useEffect(() => { quickPreviewOpenRef.current = quickPreviewOpen; }, [quickPreviewOpen]);
  const [quickPreviewIndex, setQuickPreviewIndex] = useState(0);
  const [quickPreviewStudio, setQuickPreviewStudio] = useState(false);
  const [fileSystem, setFileSystem] = useState<VirtualDirectory>(() => createInitialFileSystem());
  const [isSyncMode, setIsSyncMode] = useState(false);
  const [syncResults, setSyncResults] = useState<{ [path: string]: { id: string, statusA?: string, statusB?: string, status?: string } }>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [folderSizeMap, setFolderSizeMap] = useState<Record<string, number>>({});
  const folderSizeMapRef = useRef(folderSizeMap);
  folderSizeMapRef.current = folderSizeMap;
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
  /** After Esc/cancel, block auto-rescan until path changes or user starts a manual scan. */
  const folderSizeScanSuppressedRef = useRef(false);
  /** Signature of last completed auto-scan for this listing (path + dir count). */
  const folderSizeCompletedSigRef = useRef('');
  const folderSizeScanPathRef = useRef('');
  const folderSizeScanActiveRef = useRef(false);

  useEffect(() => {
    let unsubDrives: (() => void) | undefined;
    let cancelled = false;
    const applyDrives = (d: unknown) => {
      if (cancelled) return;
      setDrives(Array.isArray(d) ? d : []);
      setDrivesReady(true);
    };
    import('../lib/ipcBridge').then(({ IPC }) => {
      const pull = (force = false) =>
        IPC.getSystemDrives(force ? { force: true } : undefined).then(applyDrives).catch(() => applyDrives([]));
      void pull(false);
      // Forced retry — first paint often races DriveInfo; force bypasses warm empty-size cache.
      window.setTimeout(() => { if (!cancelled) void pull(true); }, 1200);
      window.setTimeout(() => { if (!cancelled) void pull(true); }, 3200);
      IPC.getCloudProviders().then(p => { if (!cancelled) setCloudProviders(Array.isArray(p) ? p : []); });
      IPC.getSystemShortcuts().then(s => { if (!cancelled) setShortcuts(s); });
      const netBeh = getNetworkBehavior(config);
      if (!netBeh.noNetworkBrowsingAtStartup) {
        IPC.getNetworkLocations({
          assumeMappedReady: !!netBeh.assumeThatMappedNetworkDrivesAreAvailable
            || !!config.assumeThatMappedNetworkDrivesAreAvailable
            || !!config.assumeThatServersAreAvailable
            || !!netBeh.assumeThatServersAreAvailable,
          cacheServers: !!netBeh.cacheNetworkServers || !!config.cacheNetworkServers,
        }).then(n => { if (!cancelled) setNetworkNodes(n); });
      } else if (!cancelled) {
        setNetworkNodes([]);
      }
      if (netBeh.reconnectMappedNetworkDrivesAtStartup) {
        void IPC.shellExecute('runCommand', 'net use /persistent:yes');
      }
      IPC.getTagsConfig().then(t => { if (!cancelled) setAvailableTags(t); });
      unsubDrives = IPC.onDrivesChanged((newDrives) => applyDrives(newDrives));
    });
    return () => {
      cancelled = true;
      if (unsubDrives) unsubDrives();
    };
  // config network flags intentionally read once at boot
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onFolderSizeProgress(prog => {
        if (folderSizeScanSuppressedRef.current) return;
        const active = (prog.percent ?? 0) < 100;
        folderSizeScanActiveRef.current = active;
        setFolderSizeSync({
          active,
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
    folderSizeScanSuppressedRef.current = true;
    folderSizeScanActiveRef.current = false;
    import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.cancelFolderSizeScan();
      setFolderSizeSync(prev => prev ? { ...prev, active: false } : null);
      pushToast({ kind: 'info', title: 'Sync stopped', message: 'Folder size sync cancelled.' });
    });
  }, []);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["/", "/workspace"]));
  const [isSmartToolsOpen, setIsSmartToolsOpen] = useState(false);
  const [smartToolsTab, setSmartToolsTab] = useState<'assistant' | 'organize' | 'duplicates' | 'music' | 'healer' | 'recycle'>('assistant');
  const [smartToolsPrompt, setSmartToolsPrompt] = useState<string | undefined>();
  const [isPreviewPanelOpen, setIsPreviewPanelOpen] = useState(config.previewPanelOpen !== false);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(config.bottomPanelOpen !== false);
  const [bottomImmersive, setBottomImmersive] = useState(false);
  const bottomPanelRef = usePanelRef();
  const previewPanelRef = usePanelRef();
  const previewPanelInnerRef = useRef<HTMLDivElement>(null);
  const dualPaneSecondRef = useRef<HTMLDivElement>(null);
  const innerGroupRef = useGroupRef();
  const immersiveShellRef = useRef<HTMLDivElement>(null);
  const lastDockedBottomPctRef = useRef(DEFAULT_INNER_LAYOUT.bottom!);
  const immersiveLatchRef = useRef(false);

  const outerDefaultLayout = useMemo(
    () => getOuterDefaultLayout(config.workspaceLayoutOuter),
    [config.workspaceLayoutOuter]
  );
  const innerDefaultLayout = useMemo(
    () => getInnerDefaultLayout(config.workspaceLayoutInner),
    [config.workspaceLayoutInner]
  );

  // Repaint chrome whenever theme, apply-colors, or any colorConfig fill changes.
  const colorRuntimeKey = [
    config.theme,
    config.applyColors,
    config.accent,
    config.bgMain,
    ...Array.from({ length: 49 }, (_, i) => String((config as any)[`colorConfig${i + 1}`] ?? '')),
  ].join('\0');

  useEffect(() => {
    applySettingsRuntime(config);
  }, [colorRuntimeKey,
    config.appearanceChromePalette, config.appearanceSurfaceStyle, config.appearanceSelectionStyle,
    config.appearanceTabStyle, config.showListGridCards, config.appearanceCornerRadius,
    config.appearanceDensity, config.appearanceGridSelection]);

  useEffect(() => {
    applySettingsRuntime(config);
  }, [
    config.fontSize, config.uiFontFamily, config.uiFontWeight, config.uiFontFamilyMono,
    config.treeFontFamily, config.listFontFamily, config.tabsFontFamily, config.previewFontFamily,
    config.bottomFontFamily, config.statusFontFamily, config.chromeFontFamily,
    config.treeFontSize, config.listFontSize, config.tabsFontSize, config.previewFontSize,
    config.bottomFontSize, config.statusFontSize, config.chromeFontSize,
    config.rowHeight, config.interfaceScale, config.lockBrowserZoom,
  ]);

  useEffect(() => {
    return installUiZoomGuard(() => ({
      lockBrowserZoom: config.lockBrowserZoom !== false,
    }));
  }, [config.lockBrowserZoom]);

  useEffect(() => {
    applySettingsRuntime(config);
  }, [
    config.translucentSelectionBox,
    config.listSelectionBorderStyle,
    config.listSelectionChromeStyle,
    config.listSelectionFillStyle,
    config.listSelectionOpacity,
    config.listHoverOpacity,
    config.listInactiveOpacity,
    config.listHoverFadeSteps,
  ]);

  useEffect(() => {
    applyListChromeFromConfig(config);
  }, [
    config.listGridLineWidth,
    config.listSortArrowSize,
    config.columnAutosizeExtraPadding,
    config.semiTransparentGridColor,
    config.mirrorTreeBoxColorInList,
    config.matchColorWithBreadcrumbBar,
    config.matchColorWithTreePathTracing,
    config.applyTextColorsToTheNameColumnOnly,
    config.applyListStylesGlobally,
    config.adaptiveColors,
    config.alignToBottom,
    config.lineFeedOnOversizedFilenames,
    config.fileTagging,
    config.fileTaggingFeature,
    config.tagsStorage,
    colorRuntimeKey,
  ]);

  useEffect(() => {
    const onApplyListStyles = () => {
      applySettingsRuntime(config);
      applyListChromeFromConfig(config);
    };
    window.addEventListener('bndz-apply-list-styles', onApplyListStyles);
    return () => window.removeEventListener('bndz-apply-list-styles', onApplyListStyles);
  }, [config]);

  /** Force-reset workspace panel sizes when layout defaults change (must re-run after settings load). */
  useEffect(() => {
    const ver = config.workspaceLayoutVersion ?? 0;
    if (ver >= WORKSPACE_LAYOUT_VERSION) return;
    const migrated = migrateLayoutV45(
      config.workspaceLayoutOuter as Record<string, number>,
      config.workspaceLayoutMainRow as Record<string, number>,
      config.previewDockedInWorkspace === true,
    );
    updateConfig({
      workspaceLayoutVersion: WORKSPACE_LAYOUT_VERSION,
      workspaceLayoutOuter: migrated.outer,
      workspaceLayoutMainRow: migrated.mainRow,
      workspaceLayoutInner: config.workspaceLayoutInner ?? { ...DEFAULT_INNER_LAYOUT },
    });
  }, [config.workspaceLayoutVersion]);

  /** After layout-version reset, force the live splitter to the default bottom plugin height. */
  useEffect(() => {
    if ((config.workspaceLayoutVersion ?? 0) !== WORKSPACE_LAYOUT_VERSION) return;
    if (bottomImmersive) return;
    const targetMain = DEFAULT_INNER_LAYOUT.main!;
    const targetBottom = DEFAULT_INNER_LAYOUT.bottom!;
    lastDockedBottomPctRef.current = targetBottom;
    const apply = () => {
      try {
        innerGroupRef.current?.setLayout({ main: targetMain, bottom: targetBottom });
      } catch { /* ignore */ }
    };
    apply();
    requestAnimationFrame(apply);
    const t = window.setTimeout(apply, 50);
    return () => window.clearTimeout(t);
  }, [config.workspaceLayoutVersion, bottomImmersive]);

  useEffect(() => {
    const patches: Record<string, unknown> = {};
    const sidebarVer = config.sidebarOrderVersion ?? 0;
    if (sidebarVer < 2) {
      patches.sidebarOrderVersion = 2;
      const order = [...(config.sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])];
      const miniIdx = order.indexOf('miniTree');
      const treeIdx = order.indexOf('tree');
      if (miniIdx >= 0 && treeIdx >= 0 && miniIdx < treeIdx) {
        order.splice(miniIdx, 1);
        const newTreeIdx = order.indexOf('tree');
        order.splice(newTreeIdx + 1, 0, 'miniTree');
        patches.sidebarOrder = order;
      }
    }
    if (sidebarVer < 3) {
      patches.sidebarOrderVersion = 3;
      const order = [...((patches.sidebarOrder as string[] | undefined) || config.sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])];
      if (!order.includes('ram')) {
        const cloudIdx = order.indexOf('cloud');
        order.splice(cloudIdx >= 0 ? cloudIdx + 1 : order.length, 0, 'ram');
        patches.sidebarOrder = order;
      }
    }
    if (sidebarVer < 4) {
      patches.sidebarOrderVersion = 4;
      const order = [...((patches.sidebarOrder as string[] | undefined) || config.sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])];
      if (order.includes('miniTree')) {
        order.splice(order.indexOf('miniTree'), 1);
      }
      const treeIdx = order.indexOf('tree');
      if (treeIdx >= 0) order.splice(treeIdx + 1, 0, 'miniTree');
      else order.push('miniTree');
      patches.sidebarOrder = order;
      patches.showMiniTree = false;
    }
    if ((config.productDefaultsVersion ?? 0) < 2) {
      patches.productDefaultsVersion = 2;
      patches.branchViewStrip = false;
      patches.theme = 'Midnight Cobalt';
      patches.applyColors = true;
      patches.openItemsOnDoubleClick = true;
      patches.logActionsAndEnableUndoRedo = true;
      const legacyPlugins = [
        'properties', 'context-menu-manager', 'batch-rename', 'find', 'dropstack', 'filters',
        'metadata', 'storage-cleanup', 'folder-sync', 'catalog', 'action-log', 'compare',
        'ghost-link', 'ram-staging',
      ];
      const installed = config.installedPlugins as string[] | undefined;
      if (Array.isArray(installed) && installed.length >= 10 && legacyPlugins.every(id => installed.includes(id))) {
        patches.installedPlugins = ['properties', 'find', 'filters'];
        patches.bottomPluginTabOrder = ['properties', 'find', 'filters'];
        patches.bottomPanelLastTab = 'properties';
        patches.bottomPanelDefaultPlugin = 'properties';
      }
    }
    if ((config.productDefaultsVersion ?? 0) < 1) {
      patches.productDefaultsVersion = Math.max(Number(patches.productDefaultsVersion) || 0, 1);
      patches.branchViewStrip = false;
      patches.theme = 'Midnight Cobalt';
      patches.applyColors = true;
      const legacyPlugins = [
        'properties', 'context-menu-manager', 'batch-rename', 'find', 'dropstack', 'filters',
        'metadata', 'storage-cleanup', 'folder-sync', 'catalog', 'action-log', 'compare',
        'ghost-link', 'ram-staging',
      ];
      const installed = config.installedPlugins as string[] | undefined;
      if (Array.isArray(installed) && installed.length >= 10 && legacyPlugins.every(id => installed.includes(id))) {
        patches.installedPlugins = ['properties', 'find', 'filters'];
        patches.bottomPluginTabOrder = ['properties', 'find', 'filters'];
        patches.bottomPanelLastTab = 'properties';
        patches.bottomPanelDefaultPlugin = 'properties';
      }
    }
    if ((config.tooltipBehaviorVersion ?? 0) < 1) {
      patches.tooltipBehaviorVersion = 1;
      patches.onlyWhileTheShiftKeyIsHeldDown = true;
    }
    if ((config.xCloseActionVersion ?? 0) < 1) {
      patches.xCloseActionVersion = 1;
      patches.xCloseAction = 'ask';
      patches.minimizeToTrayOnXClose = false;
    }
    /** Old default stretched a single tab across the bar — force compact once. */
    if ((config.tabWidthDefaultsVersion ?? 0) < 1) {
      patches.tabWidthDefaultsVersion = 1;
      patches.flexibleTabWidth = false;
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
  const previewDockedInWorkspace = config.previewDockedInWorkspace === true;
  const outerLayoutLive = useMemo(
    () => {
      const saved = getOuterDefaultLayout(config.workspaceLayoutOuter);
      if (previewDockedInWorkspace) {
        const dockedOuter = normalizeOuterLayout({
          sidebar: saved.sidebar,
          workspace: (saved.workspace ?? 0) + (saved.preview ?? 0),
          preview: 0,
        });
        return computeVisibleOuterLayout(dockedOuter, uiRuntime.treePanel, false);
      }
      return computeVisibleOuterLayout(saved, uiRuntime.treePanel, effectivePreviewOpen);
    },
    [config.workspaceLayoutOuter, previewDockedInWorkspace, uiRuntime.treePanel, effectivePreviewOpen],
  );
  const mainRowDefaultLayout = useMemo(
    () => (previewDockedInWorkspace
      ? computeVisibleMainRowLayout(
        getMainRowDefaultLayout(config.workspaceLayoutMainRow),
        effectivePreviewOpen,
      )
      : { list: 100, preview: 0 }),
    [config.workspaceLayoutMainRow, effectivePreviewOpen, previewDockedInWorkspace],
  );
  /** Updated after pane state — workspace tools hide the bottom plugin dock. */
  const layoutBottomOpenRef = useRef(effectiveBottomOpen);

  const outerLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const innerLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveOuterLayout = (layout: Record<string, number>) => {
    const sidebarVal = uiRuntime.treePanel
      ? (layout.sidebar ?? outerLayoutLive.sidebar)
      : (config.workspaceLayoutOuter?.sidebar ?? outerLayoutLive.sidebar);
    const previewVal = previewDockedInWorkspace
      ? 0
      : (effectivePreviewOpen
        ? (layout.preview ?? outerLayoutLive.preview)
        : 0);
    const nextOuter = normalizeOuterLayout({
      sidebar: sidebarVal,
      workspace: layout.workspace ?? outerLayoutLive.workspace,
      preview: previewVal,
    });
    if (outerLayoutSaveTimerRef.current) clearTimeout(outerLayoutSaveTimerRef.current);
    outerLayoutSaveTimerRef.current = setTimeout(() => {
      updateConfig({ workspaceLayoutOuter: nextOuter });
      outerLayoutSaveTimerRef.current = null;
    }, 200);
  };

  const mainRowLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMainRowLayout = (layout: Record<string, number>) => {
    if (!previewDockedInWorkspace) return;
    const previewVal = effectivePreviewOpen
      ? (layout.preview ?? mainRowDefaultLayout.preview)
      : (config.workspaceLayoutMainRow?.preview ?? mainRowDefaultLayout.preview);
    const listVal = effectivePreviewOpen
      ? (layout.list ?? mainRowDefaultLayout.list)
      : 100;
    const next = computeVisibleMainRowLayout({ list: listVal, preview: previewVal }, true);
    if (mainRowLayoutSaveTimerRef.current) clearTimeout(mainRowLayoutSaveTimerRef.current);
    mainRowLayoutSaveTimerRef.current = setTimeout(() => {
      updateConfig({ workspaceLayoutMainRow: next });
      mainRowLayoutSaveTimerRef.current = null;
    }, 200);
  };

  const dualPaneLayout = useMemo(
    () => getDualPaneDefaultLayout(config.workspaceLayoutPanes),
    [config.workspaceLayoutPanes],
  );
  const [dualPaneLayoutLive, setDualPaneLayoutLive] = useState(dualPaneLayout);
  const dualPaneLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dualPaneOuterWidthRef = useRef(0);
  const saveDualPaneLayout = (layout: Record<string, number>) => {
    const next = getDualPaneDefaultLayout({
      pane1: layout.pane1 ?? dualPaneLayoutLive.pane1,
      pane2: layout.pane2 ?? dualPaneLayoutLive.pane2,
    });
    setDualPaneLayoutLive(next);
    if (dualPaneLayoutSaveTimerRef.current) clearTimeout(dualPaneLayoutSaveTimerRef.current);
    dualPaneLayoutSaveTimerRef.current = setTimeout(() => {
      updateConfig({ workspaceLayoutPanes: next });
      dualPaneLayoutSaveTimerRef.current = null;
    }, 200);
  };

  const enterBottomImmersive = React.useCallback(() => {
    if (bottomImmersive || immersiveLatchRef.current) return;
    immersiveLatchRef.current = true;
    const docked = Math.min(
      MAX_BOTTOM_DOCKED - 4,
      Math.max(DEFAULT_INNER_LAYOUT.bottom!, lastDockedBottomPctRef.current || DEFAULT_INNER_LAYOUT.bottom!),
    );
    setBottomImmersive(true);
    requestAnimationFrame(() => {
      try {
        innerGroupRef.current?.setLayout({
          main: 100 - docked,
          bottom: docked,
        });
      } catch { /* ignore */ }
      motionPanelImmersiveEnter(immersiveShellRef.current);
      immersiveLatchRef.current = false;
    });
  }, [bottomImmersive, innerGroupRef]);

  const exitBottomImmersive = React.useCallback(() => {
    if (!bottomImmersive) return;
    const docked = Math.min(
      MAX_BOTTOM_DOCKED - 4,
      Math.max(DEFAULT_INNER_LAYOUT.bottom!, lastDockedBottomPctRef.current || DEFAULT_INNER_LAYOUT.bottom!),
    );
    motionPanelImmersiveExit(immersiveShellRef.current, () => {
      // Clear leftover motion transforms — translated abspos hosts can inflate
      // ancestor scrollable overflow and spawn a bogus workspace scrollbar.
      const host = immersiveShellRef.current;
      if (host) {
        host.style.transform = '';
        host.style.opacity = '';
        host.style.removeProperty('translate');
        host.style.removeProperty('scale');
      }
      setBottomImmersive(false);
      requestAnimationFrame(() => {
        try {
          innerGroupRef.current?.setLayout({
            main: 100 - docked,
            bottom: docked,
          });
        } catch { /* ignore */ }
      });
    });
  }, [bottomImmersive, innerGroupRef]);

  // Immersive Esc is handled via registerEscapeLayer (capture/priority) so it
  // beats nav-back / filter layers — a bubble-only keydown loses that race.

  const resetBottomPanelLayout = React.useCallback(() => {
    if (bottomImmersive) return;
    const targetMain = innerDefaultLayout.main!;
    const targetBottom = innerDefaultLayout.bottom!;
    lastDockedBottomPctRef.current = targetBottom;
    try {
      innerGroupRef.current?.setLayout({ main: targetMain, bottom: targetBottom });
    } catch { /* ignore */ }
    updateConfig({ workspaceLayoutInner: { main: targetMain, bottom: targetBottom } });
    bottomPanelRef.current?.expand();
  }, [bottomImmersive, innerDefaultLayout, innerGroupRef, updateConfig, bottomPanelRef]);

  const saveInnerLayout = (layout: Record<string, number>) => {
    const bottomRaw = layout.bottom ?? innerDefaultLayout.bottom ?? 22;
    if (!bottomImmersive && bottomRaw < BOTTOM_IMMERSIVE_TRIGGER) {
      lastDockedBottomPctRef.current = bottomRaw;
    }
    if (!bottomImmersive && layoutBottomOpenRef.current && bottomRaw >= BOTTOM_IMMERSIVE_TRIGGER) {
      enterBottomImmersive();
      return;
    }
    const bottom = layoutBottomOpenRef.current
      ? (bottomImmersive ? (lastDockedBottomPctRef.current || DEFAULT_INNER_LAYOUT.bottom!) : bottomRaw)
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
      void IPC.checkForUpdates(manifestUrl, !!config.includeBetaVersions).then(result => {
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
  }, [config.checkForUpdatesAtStartup, config.updateCheckUrl, config.includeBetaVersions]);

  // Settings → Check for language updates at startup
  useEffect(() => {
    if (!config.checkForLanguageUpdatesAtStartup) return;
    const manifestUrl = String(config.updateCheckUrl || '').trim();
    if (!manifestUrl) return;
    void import('../lib/ipcBridge').then(({ IPC }) => {
      if (!IPC.isNative) return;
      void IPC.checkForLanguageUpdates(manifestUrl).then(result => {
        if (result?.error || !result?.updates?.length) return;
        const names = result.updates.map(u => `${u.id} ${u.installedVersion}→${u.latestVersion}`).join(', ');
        window.dispatchEvent(new CustomEvent('bndz-native-alert', {
          detail: {
            title: 'Language pack updates',
            message: `Updates available: ${names}. Packs live under %LocalAppData%\\BNDZ\\Languages.`,
          },
        }));
      }).catch(() => {});
    });
  }, [config.checkForLanguageUpdatesAtStartup, config.updateCheckUrl]);

  // Settings → Maximum number of items cached
  useEffect(() => {
    configurePathCacheMax(config.maximumNumberOfItemsCached as number | boolean | undefined);
  }, [config.maximumNumberOfItemsCached]);

  useEffect(() => {
    syncMeshDropConfig(config);
  }, [
    config.meshDropStunServers,
    config.meshDropLanDiscovery,
    config.meshDropTurnUrl,
    config.meshDropTurnUsername,
    config.meshDropTurnCredential,
  ]);

  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (effectivePreviewOpen) panel.expand();
    else panel.collapse();
  }, [effectivePreviewOpen, previewPanelRef]);

  const [isToolbarConfigOpen, setIsToolbarConfigOpen] = useState(false);
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<string | undefined>(undefined);
  const [homeQuickPreview, setHomeQuickPreview] = useState<{
    items: Array<{ entity: any; path: string }>;
    index: number;
  } | null>(null);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [meshDropPaths, setMeshDropPaths] = useState<string[]>([]);
  const [showMeshDropDialog, setShowMeshDropDialog] = useState(false);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [licenseEpoch, setLicenseEpoch] = useState(0);
  const [showHelpTopics, setShowHelpTopics] = useState(false);
  /** Sticky header identity per pane — React updates only when the active group changes. */
  const [stickyHeaderKeys, setStickyHeaderKeys] = useState<Record<string, string>>({});
  const listScrollTopsRef = useRef<Record<string, number>>({});
  const paneScrollElsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const stickyHeaderKeysRef = useRef<Record<string, string>>({});
  const stickyScrollMetaRef = useRef<Record<string, { rows: ListRowItem[]; rowHeight: number; enabled: boolean }>>({});
  const stickyHeaderRafRef = useRef(0);
  const stickyHeaderPendingRef = useRef<Record<string, string> | null>(null);
  const paneScrollSyncRafRef = useRef(0);
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
  /** Last type-ahead hit — sync so same-key cycling works before React re-renders focusedItemId. */
  const typeAheadMatchIdRef = useRef<string | null>(null);
  const lastGlobalQueryRef = useRef('');
  /** True after the user clicks/focuses a file list — type-ahead stays armed even if WebView2 leaves chrome focused. */
  const listTypeAheadArmedRef = useRef(false);
  /** Latest type-ahead context — handler is stable so letter keys never hit a stale closure. */
  const typeAheadCtxRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (isConfigDialogOpen || isPluginStoreOpen) {
      listTypeAheadArmedRef.current = false;
      typeAheadPrefixRef.current = '';
    }
  }, [isConfigDialogOpen, isPluginStoreOpen]);

  const installedPluginIds = React.useMemo(
    () => (pluginRegistry || [])
      .filter((p: { isInstalled?: boolean }) => p.isInstalled)
      .map((p: { id: string }) => p.id),
    [pluginRegistry],
  );
  const installedPluginIdSet = React.useMemo(() => new Set(installedPluginIds), [installedPluginIds]);

  const openBottomPlugin = React.useCallback((pluginId: string, launch?: BottomPluginLaunchContext) => {
    // Mesh Drop is a dialog, not a bottom plugin — never open a phantom tab.
    if (pluginId === 'mesh-drop') {
      const paths = launch?.paths?.filter(Boolean) ?? [];
      setMeshDropPaths(paths);
      setShowMeshDropDialog(true);
      return;
    }
    // Folded Part B sibling → Shell Menus (Explorer verbs tab lives there).
    const resolvedId = pluginId === 'shell-verb-forge' ? 'context-menu-manager' : pluginId;
    // Never auto-install — only open plugins the user already has installed.
    if (!installedPluginIdSet.has(resolvedId)) {
      const label = (pluginRegistry || []).find((p: { id: string }) => p.id === resolvedId)?.name || resolvedId;
      setToastMessage(`“${label}” isn’t installed. Add it from the Plugin Store.`, 'warning');
      return;
    }
    setIsBottomPanelOpen(true);
    setBottomPluginTab(resolvedId);
    if (launch) setBottomPluginLaunch(launch);
  }, [installedPluginIdSet, pluginRegistry]);

  // filesHost: always open System Properties in the bottom plugins panel on launch.
  const filesHostPropsBootedRef = useRef(false);
  useEffect(() => {
    if (!isFilesHostBoot() || filesHostPropsBootedRef.current) return;
    if (!installedPluginIdSet.has('properties')) return;
    filesHostPropsBootedRef.current = true;
    openBottomPlugin('properties');
    // Files modern layout language via BNDZ chrome (explorer tabs + denser address strip).
    updateConfig({
      bottomPanelOpen: true,
      bottomPanelDefaultPlugin: 'properties',
      bottomPanelLastTab: 'properties',
      commandDeck: false,
      appearanceTabStyle: 'explorer',
      visualStyleTabs: 'Classic Explorer',
      tabBarHeight: 36,
      makeSelectedTabBold: true,
    } as any);
  }, [installedPluginIdSet, openBottomPlugin, updateConfig]);

  // Truncated first-paint when MORE fails — clear sticky Streaming and force one full refetch.
  useEffect(() => {
    const failCounts = new Map<string, number>();
    const onFail = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { path?: string } | undefined;
      const path = normalizePanePath(detail?.path || '');
      if (!path) return;
      const n = (failCounts.get(path) || 0) + 1;
      failCounts.set(path, n);
      setStreamingPaths(prev => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      if (n <= 2 && !isFilesHostBoot()) beginDirFetchRef.current?.(path, { force: true });
      if (n <= 2 && isFilesHostBoot()) {
        requestFilesHostDirListing(path);
        notifyFilesHostNavigate(path);
      }
      // Native-shell listing is React IPC-owned; do not re-trigger NativeListHost Push.
    };
    window.addEventListener('bndz-dir-more-failed', onFail as EventListener);
    return () => window.removeEventListener('bndz-dir-more-failed', onFail as EventListener);
  }, []);

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
    if (immediate || ids.length === 0 || ids.length === 1) {
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
  const pointerFileDragActiveRef = useRef(false);
  const [pointerFileDragActive, setPointerFileDragActive] = useState(false);
  pointerFileDragActiveRef.current = pointerFileDragActive;
  const dropModifierRef = useRef({ copy: false });
  /** Last HTML5 drag-over target — fallback when native drop coordinates miss. */
  const htmlDropTargetRef = useRef<{ paneId: string; tabPath: string } | null>(null);
  const xferMetaRef = useRef(new Map<string, { op: 'copy' | 'move' | 'delete'; label: string; selectParentPath?: string }>());
  const transferActiveCountRef = useRef(0);
  /** Pending FS ops — keep tombstoned names filtered from cache until the queue job finishes. */
  const pendingFsOpsRef = useRef(new Map<string, {
    opId: string;
    kind: 'delete' | 'move' | 'rename';
    namesByPane: Record<string, Set<string>>;
    winPaths: Set<string>;
    /** Full list entities for instant reinject on failure (Explorer-grade optimistic UI). */
    snapshotByPane: Record<string, any[]>;
    startedAt: number;
  }>());

  const filterTombstonedEntries = React.useCallback((panePath: string, entries: any[]): any[] => {
    if (!pendingFsOpsRef.current.size || !entries?.length) return entries;
    const norm = normalizePanePath(panePath);
    return entries.filter((e: any) => {
      const name = e?.name;
      if (!name) return true;
      for (const op of pendingFsOpsRef.current.values()) {
        if (op.namesByPane[norm]?.has(name)) return false;
        const ep = String(e.path || e.fsPath || '').replace(/\//g, '\\').toLowerCase();
        if (ep && op.winPaths.has(ep)) return false;
      }
      return true;
    });
  }, []);

  const registerFsTombstone = React.useCallback((
    opId: string,
    kind: 'delete' | 'move' | 'rename',
    panePath: string | null | undefined,
    names: string[],
    winPaths: string[],
    entities?: any[],
  ) => {
    const namesByPane: Record<string, Set<string>> = {};
    const snapshotByPane: Record<string, any[]> = {};
    const norm = panePath ? normalizePanePath(panePath) : '';
    if (norm && names.length) {
      namesByPane[norm] = new Set(names.filter(Boolean));
    }
    if (norm && entities?.length) {
      snapshotByPane[norm] = entities.map(e => ({ ...e }));
    }
    const winSet = new Set<string>();
    const entries: Array<Record<string, unknown>> = [];
    for (const wp of winPaths) {
      const canon = String(wp || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
      if (!canon) continue;
      winSet.add(canon);
      const slash = Math.max(canon.lastIndexOf('\\'), canon.lastIndexOf('/'));
      const base = slash > 0 ? canon.slice(slash + 1) : canon;
      const matchEnt = entities?.find(e => {
        const n = String(e?.name || '').toLowerCase();
        return n === base || String(e?.path || '').replace(/\//g, '\\').toLowerCase().endsWith('\\' + base);
      });
      entries.push({
        path: wp,
        name: matchEnt?.name || base,
        type: matchEnt?.type || (matchEnt?.isDirectory ? 'directory' : 'file'),
        size: matchEnt?.size ?? 0,
        extension: matchEnt?.extension,
        parentPath: slash > 0 ? wp.slice(0, Math.max(wp.lastIndexOf('\\'), wp.lastIndexOf('/'))) : '',
        modified: matchEnt?.modified,
      });
      if (slash > 0) {
        const parentWin = canon.slice(0, slash);
        const parentPane = normalizePanePath('/' + parentWin.replace(/\\/g, '/'));
        if (!namesByPane[parentPane]) namesByPane[parentPane] = new Set();
        if (base) namesByPane[parentPane].add(matchEnt?.name || base);
        if (matchEnt) {
          if (!snapshotByPane[parentPane]) snapshotByPane[parentPane] = [];
          if (!snapshotByPane[parentPane].some(s => s.name === matchEnt.name)) {
            snapshotByPane[parentPane].push({ ...matchEnt });
          }
        }
      }
    }
    pendingFsOpsRef.current.set(opId, {
      opId,
      kind,
      namesByPane,
      winPaths: winSet,
      snapshotByPane,
      startedAt: Date.now(),
    });
    void import('../lib/ipcBridge').then(({ IPC }) => {
      if (IPC.isNative) void IPC.tombstoneSnapshot?.(opId, kind, entries);
    });
  }, []);

  const reinjectFsTombstone = React.useCallback((opId: string) => {
    const op = pendingFsOpsRef.current.get(opId);
    if (!op?.snapshotByPane) return;
    setPathContentsCache(prev => {
      let next = prev;
      for (const [pane, snaps] of Object.entries(op.snapshotByPane)) {
        if (!snaps?.length) continue;
        const existing = next[pane] ?? [];
        const seen = new Set(existing.map((e: any) => String(e?.name || '').toLowerCase()));
        const merged = [...existing];
        for (const s of snaps) {
          const key = String(s?.name || '').toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(s);
        }
        next = setPathCacheEntry(next, pane, merged);
      }
      return next;
    });
  }, []);

  const clearFsTombstone = React.useCallback((opId: string) => {
    pendingFsOpsRef.current.delete(opId);
    void import('../lib/ipcBridge').then(({ IPC }) => {
      if (IPC.isNative) void IPC.tombstoneClear?.(opId);
    });
  }, []);
  const [listDragGhost, setListDragGhost] = useState<ListDragGhostMeta | null>(null);
  const clearListDragGhost = React.useCallback(() => {
    fluidDragGenRef.current += 1;
    setListDragGhost(null);
    setMotionDragPhase('snapping');
    setFluidDragSnapTension(1);
    window.setTimeout(() => {
      disarmFluidDrag();
      setMotionDragPhase('idle');
      clearSnapZones();
    }, 140);
  }, []);
  useEffect(() => {
    const onEndFileDrag = () => {
      clearListDragGhost();
      endFileDragSession();
    };
    window.addEventListener('bndz-end-file-drag', onEndFileDrag);
    return () => window.removeEventListener('bndz-end-file-drag', onEndFileDrag);
  }, [clearListDragGhost]);
  const listDragGhostElRef = useRef<HTMLDivElement | null>(null);
  const fluidDragGenRef = useRef(0);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [editingAddressBarPaneId, setEditingAddressBarPaneId] = useState<string | null>(null);
  const [addressBarInput, setAddressBarInput] = useState<string>('');
  const [addressSuggestIndex, setAddressSuggestIndex] = useState(0);
  const [findSuggestIndex, setFindSuggestIndex] = useState(0);
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

  // Settings → Resizing the window (dual pane): keep left/right pixel width fixed on window resize
  useEffect(() => {
    const mode = String(config.resizingTheWindowDualPane || 'Both panes flexible size');
    if (!isDualPane || mode === 'Both panes flexible size') return;
    const onResize = () => {
      const el = document.getElementById('dual-pane');
      const width = el?.clientWidth || 0;
      if (width < 80) return;
      const prev = dualPaneOuterWidthRef.current;
      dualPaneOuterWidthRef.current = width;
      if (!prev || Math.abs(prev - width) < 2) return;
      const layout = dualPaneLayoutLive;
      const p1 = layout.pane1 ?? 50;
      if (mode === 'Keep left pane fixed') {
        const leftPx = (prev * p1) / 100;
        const nextP1 = Math.max(20, Math.min(80, (leftPx / width) * 100));
        saveDualPaneLayout({ pane1: nextP1, pane2: 100 - nextP1 });
      } else if (mode === 'Keep right pane fixed') {
        const p2 = layout.pane2 ?? (100 - p1);
        const rightPx = (prev * p2) / 100;
        const nextP2 = Math.max(20, Math.min(80, (rightPx / width) * 100));
        saveDualPaneLayout({ pane1: 100 - nextP2, pane2: nextP2 });
      }
    };
    dualPaneOuterWidthRef.current = document.getElementById('dual-pane')?.clientWidth || 0;
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [config.resizingTheWindowDualPane, isDualPane, dualPaneLayoutLive]);
  // pathContentsCache stores backend-fetched directory contents keyed by path
  const [pathContentsCache, setPathContentsCache] = useState<Record<string, any[]>>({});
  const cachePathContents = React.useCallback((path: string, data: any[], opts?: { retainLarger?: boolean }) => {
    const filtered = filterTombstonedEntries(path, data);
    setPathContentsCache(prev => {
      const existing = prev[path];
      // Never clobber a warm listing with an empty race (NativeList Push / dual-fetch).
      if (existing?.length && (!filtered || filtered.length === 0)) {
        return prev;
      }
      // Progressive first-page RESULT must not shrink a fuller warm/streamed listing.
      if (
        opts?.retainLarger
        && existing?.length
        && filtered?.length
        && existing.length > filtered.length
      ) {
        return setPathCacheEntry(prev, path, mergeDirEntryChunks(existing, filtered));
      }
      if (config.addNewItemsAtTheEndOfTheList && existing?.length && filtered?.length) {
        const existingIds = new Set(existing.map((e: any) => e.id || e.name));
        const existingNames = new Set(existing.map((e: any) => e.name));
        const kept = existing.filter((e: any) =>
          filtered.some((n: any) => (n.id && n.id === e.id) || n.name === e.name),
        );
        const added = filtered.filter((n: any) =>
          !(existingIds.has(n.id) || existingNames.has(n.name)),
        );
        return setPathCacheEntry(prev, path, [...kept, ...added]);
      }
      return setPathCacheEntry(prev, path, filtered);
    });
  }, [config.addNewItemsAtTheEndOfTheList, filterTombstonedEntries]);

  // Progressive SharedBuffer append — merge remainder into first-paint list (never replace).
  useEffect(() => {
    const onAppend = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { path?: string; items?: any[] } | undefined;
      if (!detail?.items || !Array.isArray(detail.items) || !detail.items.length) {
        // Empty remainder (folder == first-paint size) — just clear streaming flag.
        const rawPath = detail?.path || '';
        if (rawPath) {
          const path = normalizePanePath(rawPath);
          setStreamingPaths(prev => {
            if (!prev.has(path)) return prev;
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
        return;
      }
      const rawPath = detail.path || '';
      if (!rawPath) return;
      const path = normalizePanePath(rawPath);
      const chunk = filterTombstonedEntries(path, normalizeDirEntries(detail.items));
      setPathContentsCache(prev => {
        const existing = prev[path] ?? [];
        return setPathCacheEntry(prev, path, mergeDirEntryChunks(existing, chunk));
      });
      setStreamingPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      void prefetchIconsForEntities(chunk, path, 'shell', 160);
      void prefetchMediaThumbnailsForEntities(chunk, path, isFilesHostBoot() ? 32 : 128, {
        includeFolders: configRef.current.showFolderThumbnails === true,
      });
    };
    window.addEventListener('bndz-dir-append', onAppend as EventListener);
    return () => window.removeEventListener('bndz-dir-append', onAppend as EventListener);
  }, [filterTombstonedEntries]);

  const streamPrefetchTimersRef = useRef<Map<string, number>>(new Map());

  // Mid-enumeration stream chunks — merge into live list while backend scans disk.
  useEffect(() => {
    const onStream = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { path?: string; items?: any[] } | undefined;
      if (!detail?.items?.length) return;
      const rawPath = detail.path || '';
      if (!rawPath) return;
      const path = normalizePanePath(rawPath);
      const chunk = filterTombstonedEntries(path, normalizeDirEntries(detail.items));
      setPathContentsCache(prev => {
        const existing = prev[path] ?? [];
        return setPathCacheEntry(prev, path, mergeDirEntryChunks(existing, chunk));
      });
      setStreamingPaths(prev => new Set(prev).add(path));
      const prevTimer = streamPrefetchTimersRef.current.get(path);
      if (prevTimer) window.clearTimeout(prevTimer);
      streamPrefetchTimersRef.current.set(path, window.setTimeout(() => {
        streamPrefetchTimersRef.current.delete(path);
        const cfg = configRef.current;
        void prefetchIconsForEntities(chunk, path, 'shell', 64);
        void prefetchMediaThumbnailsForEntities(chunk, path, 48, {
          includeFolders: cfg.showFolderThumbnails === true,
        });
      }, 250));
    };
    window.addEventListener('bndz-dir-stream', onStream as EventListener);
    return () => {
      window.removeEventListener('bndz-dir-stream', onStream as EventListener);
      streamPrefetchTimersRef.current.forEach(t => window.clearTimeout(t));
      streamPrefetchTimersRef.current.clear();
    };
  }, []);

  // loadingPaths tracks which paths are currently being fetched so we show a spinner
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [streamingPaths, setStreamingPaths] = useState<Set<string>>(new Set());
  const refetchInFlightRef = useRef<Record<string, Promise<void>>>({});
  const beginDirFetchRef = useRef<(path: string, opts?: { force?: boolean }) => Promise<void> | undefined>(() => undefined);
  /** Paths seeded by Files ShellViewModel (`BNDZ_DIR_LISTING`) — prefer over GET_DIR_CONTENTS. */
  const filesFedPathsRef = useRef(new Set<string>());
  /** Cancelable Files-feed wait per path — listing handler clears; never falls back to GET_DIR_CONTENTS. */
  const filesHostFetchTimersRef = useRef<Map<string, number>>(new Map());
  const filesHostFallbackTimersRef = useRef<Map<string, number>>(new Map());
  /** Resolvers for filesHost beginDirFetch promises (listing arrive / timeout). */
  const filesHostListingWaitersRef = useRef(new Map<string, Array<() => void>>());
  const dirFetchTransientRetryRef = useRef<Record<string, number>>({});

  const resolveFilesHostListingWaiters = React.useCallback((path: string) => {
    const waiters = filesHostListingWaitersRef.current.get(path);
    if (!waiters?.length) return;
    filesHostListingWaitersRef.current.delete(path);
    for (const resolve of waiters) resolve();
  }, []);
  const prefetchTimersRef = useRef<Map<string, number>>(new Map());
  const [prefetchingPaths, setPrefetchingPaths] = useState<Set<string>>(() => new Set());
  const [, setRealityCheckTick] = useState(0);

  useEffect(() => subscribeRealityCheck(() => setRealityCheckTick(t => t + 1)), []);

  const [panes, setPanes] = useState<PaneState[]>([
     { 
       id: 'pane1', 
       tabs: [{ id: 't1', path: BNDZ_HOME, history: [BNDZ_HOME], historyIndex: 0, selectedItems: [], viewMode: undefined }],
       activeTabIndex: 0,
       sortColumn: ((config.listSortColumn as SortColumnId) || 'name'),
       sortDirection: config.listSortDirection === 'desc' ? 'desc' : 'asc',
     }
  ]);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const configRef = useRef(config);
  configRef.current = config;

  const flushSessionBeforeClose = React.useCallback(async (rememberPatch?: Record<string, unknown>) => {
    const cfg = configRef.current;
    const currentPanes = panesRef.current;
    const patch: Record<string, unknown> = {
      xCloseActionVersion: 1,
      ...(rememberPatch || {}),
    };
    if (cfg.autoSaveTabsetsOnSwitch !== false) {
      const panesWithScroll = currentPanes.map(p => ({
        ...p,
        scrollTop: listScrollTopsRef.current[p.id] ?? (p as any).scrollTop ?? 0,
      }));
      const autosave = { id: '__autosave__', name: '(Auto-save)', panes: JSON.parse(JSON.stringify(panesWithScroll)) };
      const rest = (cfg.savedTabsets || []).filter((t: any) => t.id !== '__autosave__');
      patch.savedTabsets = [...rest, autosave];
      patch.lastActiveTabsetId = '__autosave__';
    }
    // Close-remember + tabset autosave must hit disk even when "Save settings on exit" is off.
    if (rememberPatch || cfg.saveSettingsOnExit !== false) {
      const { persistConfigNow } = await import('../data/configContext');
      await persistConfigNow(cfg, patch as any, updateConfig);
      return;
    }
    updateConfig(patch as any);
    const { discardPendingSettingsSave } = await import('../data/configContext');
    discardPendingSettingsSave();
  }, [updateConfig]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onCloseRequest(({ source } = {}) => {
        const src = source || 'x';
        if (src === 'x') {
          const action = (configRef.current.xCloseAction as string) || (configRef.current.minimizeToTrayOnXClose ? 'tray' : 'ask');
          if (action === 'tray' || action === 'quit') {
            void (async () => {
              await flushSessionBeforeClose();
              IPC.windowCloseResolve(action);
            })();
            return;
          }
        }
        setQuitCloseSource(src);
        setQuitDialogOpen(true);
      });
    });
    return () => { if (unsub) unsub(); };
  }, [flushSessionBeforeClose]);

  // Restore Always on Top after settings hydrate (toggle persists but WinUI needs re-apply).
  useEffect(() => {
    if (!config.alwaysOnTop) return;
    import('../lib/ipcBridge').then(({ IPC }) => {
      try { IPC.setAlwaysOnTop(true); } catch { /* ignore */ }
    });
  }, [config.alwaysOnTop]);

  // Keep open-tab paths pinned in the listing LRU so hover-prefetch of children
  // (common in large folders like Program Files) cannot evict the live view.
  {
    const pinned: string[] = [];
    for (const pane of panes) {
      for (const tab of pane.tabs) {
        const p = normalizePanePath(tab?.path || '');
        if (p && p !== '/' && p !== '/this-pc') pinned.push(p);
      }
    }
    setPinnedPathCacheKeys(pinned);
  }


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
        setSmartToolsTab(
          t === 'agent' || t === 'tasks' || t === 'memories' ? 'assistant'
            : t === 'duplicates' ? 'duplicates'
              : t === 'organize' ? 'organize'
                : t === 'music' ? 'music'
                  : t === 'healer' ? 'healer'
                    : t === 'recycle' ? 'recycle'
                      : 'assistant',
        );
      }
      if (detail?.prompt) setSmartToolsPrompt(detail.prompt);
      setIsSmartToolsOpen(true);
    };
    window.addEventListener('bndz-open-smart-tools', onOpenSmartTools);
    const onGlobalHotkey = (ev: Event) => {
      const id = (ev as CustomEvent).detail?.id as string | undefined;
      if (!id) return;
      if (id === 'bndz.commandPalette') {
        setIsCommandPaletteOpen(prev => !prev);
      } else if (id === 'bndz.globalSearch') {
        window.dispatchEvent(new CustomEvent('bndz-focus-omni'));
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener('bndz-global-hotkey', onGlobalHotkey);
    return () => {
      window.removeEventListener('bndz-open-smart-tools', onOpenSmartTools);
      window.removeEventListener('bndz-global-hotkey', onGlobalHotkey);
    };
  }, []);

  useEffect(() => {
    const onOpenTagAssignment = () => setTagAssignmentActive(true);
    window.addEventListener('bndz-open-tag-assignment', onOpenTagAssignment);
    return () => window.removeEventListener('bndz-open-tag-assignment', onOpenTagAssignment);
  }, []);

  const beginDirFetch = React.useCallback((rawPath: string, opts?: { force?: boolean }): Promise<void> | undefined => {
    const path = normalizePanePath(rawPath);
    if (!path) return undefined;
    // Cache hit: still re-warm shell glyphs / thumbs (Explorer feel — icons stay ready).
    // Successful empties are cached as []; failed fetches must NOT stamp sticky [].
    if (!opts?.force && pathContentsCacheRef.current[path] !== undefined) {
      const cached = pathContentsCacheRef.current[path];
      if (Array.isArray(cached) && cached.length > 0) {
        prefetchListingVisuals(cached, path, listingPrefetchFromConfig(configRef.current));
      }
      return undefined;
    }
    // Blend / native-host: skip only when host already fed AND cache is warm.
    if (!opts?.force && (isFilesHostBoot() || isNativeShellHostBoot()) && filesFedPathsRef.current.has(path) && pathContentsCacheRef.current[path] !== undefined) {
      return undefined;
    }
    if (!opts?.force && dirFetchInFlightRef.current.has(path)) return undefined;

    const isHostNativeListFolder = (isFilesHostBoot() || isNativeShellHostBoot())
      && !(isFilesHostBoot() && path === '/')
      && !path.startsWith('/vf/')
      && !path.includes('>')
      && !isBndzVirtualPath(path)
      && !isVirtualCatalogPath(path);

    // BNDZShell full-face: React list owns FS fetch via in-process IPC.
    // Craft islands (chrome/sidebar): host NativeList owns listing — navigate only.
    if (isNativeShellCraftIslandBoot()) {
      if (opts?.force) filesFedPathsRef.current.delete(path);
      notifyNativeShellNavigate(path);
      return undefined;
    }
    if (isHostNativeListFolder && isNativeShellHostBoot()) {
      if (opts?.force) filesFedPathsRef.current.delete(path);

      dirFetchInFlightRef.current.add(path);
      setLoadingPaths(prev => new Set(prev).add(path));
      setPathLoadErrors((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });

      return IPC.getDirContents(path).then(data => {
        const normalized = normalizeDirEntries(data);
        filesFedPathsRef.current.add(path);
        cachePathContents(path, normalized, { retainLarger: true });
        resolveFilesHostListingWaiters(path);
        setPathLoadErrors((prev) => {
          if (!(path in prev)) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        });
        dirFetchInFlightRef.current.delete(path);
        setLoadingPaths(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        prefetchListingVisuals(normalized, path, listingPrefetchFromConfig(configRef.current));
      }).catch((err) => {
        dirFetchInFlightRef.current.delete(path);
        setLoadingPaths(prev => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        setPathLoadErrors((prev) => ({ ...prev, [path]: String(err?.message || err || 'Folder load failed') }));
        resolveFilesHostListingWaiters(path);
      });
    }

    const isFilesHostFsFolder = isFilesHostBoot()
      && path !== '/'
      && !path.startsWith('/vf/')
      && !path.includes('>')
      && !isBndzVirtualPath(path)
      && !isVirtualCatalogPath(path);

    if (isFilesHostFsFolder) {
      if (opts?.force) filesFedPathsRef.current.delete(path);
      notifyFilesHostNavigate(path);
      requestFilesHostDirListing(path);
      const prevT = filesHostFetchTimersRef.current.get(path);
      if (prevT) window.clearTimeout(prevT);
      filesHostFetchTimersRef.current.set(path, window.setTimeout(() => requestFilesHostDirListing(path), 500));

      dirFetchInFlightRef.current.add(path);
      setLoadingPaths(prev => new Set(prev).add(path));
      setPathLoadErrors((prev) => {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      });

      const loadStarted = performance.now();
      return IPC.getDirContents(path).then(data => {
        const normalized = normalizeDirEntries(data);
        filesFedPathsRef.current.add(path);
        cachePathContents(path, normalized, { retainLarger: true });
        resolveFilesHostListingWaiters(path);
        setPathLoadErrors((prev) => {
          if (!(path in prev)) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        });
        setLastLoadDurationMs(Math.round(performance.now() - loadStarted));
        prefetchListingVisuals(normalized, path, listingPrefetchFromConfig(configRef.current));
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Could not load folder contents.';
        if (isFilesHostBoot()) {
          const prevT = filesHostFallbackTimersRef.current.get(path);
          if (prevT) window.clearTimeout(prevT);
          const t = window.setTimeout(() => {
            filesHostFallbackTimersRef.current.delete(path);
            if (pathContentsCacheRef.current[path] === undefined) {
              setPathLoadErrors((prev) => ({ ...prev, [path]: message }));
            }
          }, 5000);
          filesHostFallbackTimersRef.current.set(path, t);
          return;
        }
        setPathLoadErrors((prev) => ({ ...prev, [path]: message }));
      }).finally(() => {
        dirFetchInFlightRef.current.delete(path);
        setLoadingPaths((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        const pending = filesHostFetchTimersRef.current.get(path);
        if (pending) {
          window.clearTimeout(pending);
          filesHostFetchTimersRef.current.delete(path);
        }
        const pendingFallback = filesHostFallbackTimersRef.current.get(path);
        if (pendingFallback) {
          window.clearTimeout(pendingFallback);
          filesHostFallbackTimersRef.current.delete(path);
        }
      });
    }

    if (isVirtualCatalogPath(path)) {
      dirFetchInFlightRef.current.add(path);
      setLoadingPaths(prev => new Set(prev).add(path));
      return IPC.getCatalogContents(path).then(data => {
        const normalized = normalizeDirEntries(data);
        cachePathContents(path, normalized);
        prefetchListingVisuals(normalized, path, listingPrefetchFromConfig(configRef.current));
      }).catch(() => {
        // Do not stamp sticky [] — leave undefined so the next navigate/open can retry.
        setPathLoadErrors(prev => ({ ...prev, [path]: 'Could not load catalog.' }));
      }).finally(() => {
        dirFetchInFlightRef.current.delete(path);
        setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
      });
    }

    if (isBndzVirtualPath(path)) {
      if (isBndzPortalPath(path) || parseBndzPortalView(path)) {
        // Portal namespace retired — leftover /bndz/port/* paths remap in setCurrentPath.
        cachePathContents(path, []);
        return Promise.resolve();
      }

      const view = parseBndzVirtualView(path);
      if (!view || isBndzWorkspacePath(path)) {
        if (isBndzRamPath(path)) {
          const normRam = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
          if (normRam === BNDZ_RAM_ROOT) {
            dirFetchInFlightRef.current.add(path);
            setLoadingPaths(prev => new Set(prev).add(path));
            return IPC.ramStagingListZones().then(r => {
              const zones = (r.zones as Array<{ id: string; name: string; kind?: string; sizeBudgetMb?: number; usedBytes?: number; isDirty?: boolean }>) ?? [];
              const entries = zones.map(z => ({
                id: bndzRamVirtualPath(z.id),
                name: z.name,
                type: 'directory',
                path: bndzRamVirtualPath(z.id),
                size: z.usedBytes ?? 0,
                typeDescription: z.kind === 'ramdisk' ? 'RAM staging zone' : 'Fast staging zone',
                tags: z.isDirty ? ['dirty'] : [],
              }));
              cachePathContents(path, entries);
            }).catch(() => cachePathContents(path, [])).finally(() => {
              dirFetchInFlightRef.current.delete(path);
              setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
            });
          }
          const zoneId = parseBndzRamZoneId(path);
          if (!zoneId) {
            setPathContentsCache(prev => setPathCacheEntry(prev, path, []));
            return Promise.resolve();
          }
          dirFetchInFlightRef.current.add(path);
          setLoadingPaths(prev => new Set(prev).add(path));
          return resolveRamStagingFsPath(path).then(async (resolved) => {
            let fsRoot = resolved;
            if (!fsRoot) {
              invalidateRamZoneMountCache();
              fsRoot = await resolveRamStagingFsPath(path);
            }
            if (!fsRoot) {
              cachePathContents(path, []);
              return;
            }
            // Remap must use the zone mount root so subfolder listings keep correct virtual paths.
            await refreshRamZoneMounts();
            let zoneMount = await resolveRamZoneMountPath(zoneId);
            if (!zoneMount) {
              invalidateRamZoneMountCache();
              zoneMount = await resolveRamZoneMountPath(zoneId);
            }
            if (!zoneMount) {
              cachePathContents(path, []);
              return;
            }
            const data = await IPC.getDirContents(fsRoot);
            const normalized = normalizeDirEntries(data) as Array<Record<string, unknown>>;
            const remapped = remapRamListingEntries(zoneId, zoneMount, normalized);
            cachePathContents(path, remapped);
            prefetchListingVisuals(remapped as any[], path, listingPrefetchFromConfig(configRef.current));
            // Watch the real mount so paste/drop refreshes the virtual listing.
            try { IPC.watchDirectory(fsRoot); } catch { /* */ }
          }).catch(() => {
            cachePathContents(path, []);
          }).finally(() => {
            dirFetchInFlightRef.current.delete(path);
            setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
          });
        }
        setPathContentsCache(prev => setPathCacheEntry(prev, path, []));
        return Promise.resolve();
      }
      dirFetchInFlightRef.current.add(path);
      setLoadingPaths(prev => new Set(prev).add(path));
      return IPC.getVirtualViewContents(view, configRef.current.globalSearchLimit || 500).then(items => {
        setVirtualViewErrors(prev => { const next = { ...prev }; delete next[path]; return next; });
        const normalized = normalizeDirEntries(items || []);
        cachePathContents(path, normalized);
        prefetchListingVisuals(normalized, path, listingPrefetchFromConfig(configRef.current));
      }).catch((err: unknown) => {
        setVirtualViewErrors(prev => ({ ...prev, [path]: err instanceof Error ? err.message : 'Failed to load smart view.' }));
        cachePathContents(path, []);
      }).finally(() => {
        dirFetchInFlightRef.current.delete(path);
        setLoadingPaths(prev => { const next = new Set(prev); next.delete(path); return next; });
      });
    }

    dirFetchInFlightRef.current.add(path);
    setLoadingPaths(prev => new Set(prev).add(path));
    setStreamingPaths(prev => new Set(prev).add(path));
    const loadStarted = performance.now();

    // Backend already enforces Hello Gate inside GET_DIR_CONTENTS. Do not serialize a separate
    // HELLO_GATE_CHECK here — a check timeout used to replace the whole pane with
    // "IPC timeout: HELLO_GATE_CHECK_RESULT" and never load Desktop.
    const clearStream = () => {
      setStreamingPaths(prev => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    };

    const applyHelloGateBlock = (gatePath: string) => {
      const key = normalizePanePath(path);
      setHelloGateBlocked(prev => ({ ...prev, [key]: gatePath || key }));
      setPathLoadErrors(prev => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      // Empty cache so the pane leaves the infinite "Streaming…" skeleton and shows the gate UI.
      setPathContentsCache(prev => setPathCacheEntry(prev, key, prev[key] !== undefined ? prev[key] : []));
      clearStream();
    };

    return IPC.getDirContents(path).then(data => {
      const normalized = normalizeDirEntries(data);
      // First-page resolve may be only 64 rows — keep fuller warm/streamed cache until APPEND.
      cachePathContents(path, normalized, { retainLarger: true });
      dirFetchTransientRetryRef.current[path] = 0;
      if (normalized.length === 0) clearStream();
      setHelloGateBlocked(prev => {
        const key = normalizePanePath(path);
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setPathLoadErrors(prev => {
        const next = { ...prev };
        delete next[path];
        delete next[normalizePanePath(path)];
        return next;
      });
      setLastLoadDurationMs(Math.round(performance.now() - loadStarted));
      prefetchListingVisuals(normalized, path, listingPrefetchFromConfig(configRef.current));
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Could not load folder contents.';
      const gateMatch = /^HELLO_GATE_BLOCKED(?::(.*))?$/.exec(message);
      if (gateMatch) {
        applyHelloGateBlock((gateMatch[1] || path).trim() || path);
        return;
      }
      const isTransient = /^IPC timeout:/i.test(message) || /timed out/i.test(message);
      const prior = pathContentsCacheRef.current[path];
      // Keep prior listing on failure; never stamp sticky empty [] for a soft miss
      // (that made folders look empty forever until force refresh).
      if (Array.isArray(prior) && prior.length > 0) {
        setPathContentsCache(prev => setPathCacheEntry(prev, path, prior));
      } else {
        setPathContentsCache(prev => {
          if (prev[path] === undefined) return prev;
          const next = { ...prev };
          delete next[path];
          invalidatePathCacheKey(path);
          return next;
        });
      }
      if (isTransient && !(Array.isArray(prior) && prior.length > 0)) {
        const retries = dirFetchTransientRetryRef.current[path] || 0;
        if (retries < 1) {
          dirFetchTransientRetryRef.current[path] = retries + 1;
          window.setTimeout(() => {
            void beginDirFetchRef.current?.(path, { force: true });
          }, 900);
        }
      }
      setPathLoadErrors(prev => ({ ...prev, [path]: message }));
      clearStream();
    }).finally(() => {
      dirFetchInFlightRef.current.delete(path);
      setLoadingPaths(prev => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      clearStream();
    });
  }, [cachePathContents, resolveFilesHostListingWaiters]);

  beginDirFetchRef.current = beginDirFetch;

  useEffect(() => {
    const timers: number[] = [];
    panes.forEach(pane => {
      const tab = pane.tabs[pane.activeTabIndex];
      const path = normalizePanePath(tab?.path || '');
      if (!path) return;
      // Blend: Files ShellViewModel feeds BNDZ_DIR_LISTING — short fallback, not a 2.2s stall.
      if (isFilesHostBoot()) {
        if (filesFedPathsRef.current.has(path) && pathContentsCacheRef.current[path] !== undefined) {
          return;
        }
        void beginDirFetch(path);
        return;
      }
      beginDirFetch(path);
    });
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanePathsKey, beginDirFetch]);

  const refetchPath = React.useCallback(async (rawPath: string) => {
    const path = normalizePanePath(rawPath);
    if (!path) return;
    const inFlight = refetchInFlightRef.current[path];
    if (inFlight) return inFlight;

    const loadPromise = beginDirFetch(path, { force: true }) ?? Promise.resolve();
    refetchInFlightRef.current[path] = loadPromise;
    try {
      await loadPromise;
    } finally {
      delete refetchInFlightRef.current[path];
    }
    return loadPromise;
  }, [beginDirFetch]);

  const commitRenameForEntity = React.useCallback(async (
    entity: any,
    panePath: string,
    editedValue: string,
  ) => {
    let targetName = resolveRenameTargetName(entity, editedValue, config);
    // Settings → Directional formatting codes protection
    targetName = protectDirectionalFormatting(targetName, config);
    if (settingsRt.rename.autoReplaceInvalidChars || !!config.autoReplaceInvalidCharacters) {
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

    if (isPortableDeviceReadOnly(panePath, config.treatPortableDevicesAsReadOnly === true)
      || isPortableDeviceReadOnly(entity.path, config.treatPortableDevicesAsReadOnly === true)) {
      setToastMessage('Portable device is read-only. Disable that option in Settings to rename on MTP.', 'warning');
      return false;
    }

    const sourcePath = entity.path ? normalizePanePath(entity.path) : joinPanePath(panePath, entity);
    let targetPath: string;
    if (settingsRt.rename.allowMoveOnRename && /[\\/]/.test(editedValue.trim())) {
      targetPath = normalizePanePath(editedValue.trim());
    } else {
      const targetDir = sourcePath.replace(/[/\\][^/\\]+$/, '');
      targetPath = targetDir ? `${targetDir}/${targetName}` : joinPanePath(panePath, { name: targetName });
    }

    const winSource = entity.fsPath
      ? String(entity.fsPath)
      : await resolvePanePathForFs(sourcePath);
    const winTarget = await resolvePanePathForFs(normalizePanePath(targetPath));
    if (!winSource || /^bndz\\/i.test(winSource) || !winTarget || /^bndz\\/i.test(winTarget)) {
      setToastMessage('Cannot rename in this location.', 'warning');
      return false;
    }

    const displayTarget = targetName;
    const renameLabel = `Rename: ${entity.name} → ${displayTarget}`;
    const { IPC } = await import('../lib/ipcBridge');
    const renameOpId = `rename-${Date.now()}`;
    registerFsTombstone(renameOpId, 'rename', panePath, [entity.name], [winSource], [entity]);
    setPathContentsCache(prev => {
      const existing = prev[normalizePanePath(panePath)];
      if (!existing) return prev;
      return setPathCacheEntry(
        prev,
        normalizePanePath(panePath),
        existing.map((e: any) => (e.name === entity.name || e.id === entity.id
          ? { ...e, name: targetName, id: e.id }
          : e)),
      );
    });
    const res = await IPC.executeFsOperation(
      renameOpId,
      'move',
      winSource,
      winTarget,
      false,
      renameLabel,
    );
    if (!isQueuedIpcResult(res)) {
      clearFsTombstone(renameOpId);
      if (settingsRt.rename.resortAfterRename || !!config.resortListImmediatelyAfterRename) {
        void refetchPath(panePath);
      }
    }
    return true;
  }, [config, settingsRt.rename, refetchPath, registerFsTombstone, clearFsTombstone]);

  const prefetchPathQuiet = React.useCallback(async (rawPath: string) => {
    const path = normalizePanePath(rawPath);
    if (!path) return;
    // Hover when listing already cached — still hydrate shells (plan #10).
    if (pathContentsCacheRef.current[path] !== undefined) {
      const cached = pathContentsCacheRef.current[path];
      if (Array.isArray(cached) && cached.length > 0) {
        prefetchListingVisuals(cached, path, {
          ...listingPrefetchFromConfig(configRef.current),
          iconLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 96,
          thumbLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 64,
        });
      }
      return;
    }
    if (dirFetchInFlightRef.current.has(path)) return;
    if (isVirtualCatalogPath(path) || isBndzVirtualPath(path)) return;
    dirFetchInFlightRef.current.add(path);
    setPrefetchingPaths(prev => new Set(prev).add(path));
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const data = await IPC.getDirContents(path);
      const normalized = normalizeDirEntries(data);
      cachePathContents(path, normalized);
      prefetchListingVisuals(normalized, path, {
        iconLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 96,
        thumbLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 64,
        includeFolderThumbs: false,
      });
    } catch {
      /* hover prefetch is best-effort */
    } finally {
      dirFetchInFlightRef.current.delete(path);
      setPrefetchingPaths(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [cachePathContents]);

  /** Dwell before hover-prefetch so fast scrolling does not flood the listing cache. */
  const schedulePrefetchPath = React.useCallback((rawPath: string) => {
    const path = normalizePanePath(rawPath);
    if (!path) return;
    if (pathContentsCacheRef.current[path] !== undefined) {
      void prefetchPathQuiet(path);
      return;
    }
    if (dirFetchInFlightRef.current.has(path)) return;
    const prev = prefetchTimersRef.current.get(path);
    if (prev) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      prefetchTimersRef.current.delete(path);
      void prefetchPathQuiet(path);
    }, 120);
    prefetchTimersRef.current.set(path, timer);
  }, [prefetchPathQuiet]);

  useEffect(() => () => {
    for (const t of prefetchTimersRef.current.values()) window.clearTimeout(t);
    prefetchTimersRef.current.clear();
  }, []);

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
      const activePane = panes.find(p => p.id === paneId);
      const tabPath = activePane?.tabs.find(t => t.id === tabId)?.path || '/';
      prefetchListingVisuals(normalizedItems, tabPath, listingPrefetchFromConfig(config));
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
      const status = await getIndexStatusCached();
      setIndexedRoots((status.locations || []).map(loc => loc.path));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refreshIndexedRoots();
    if (!IPC.isNative) return;
    return IPC.onIndexProgress(p => {
      if (p.done) {
        invalidateIndexStatusCache();
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
    const onRootsChanged = () => {
      invalidateIndexStatusCache();
      void refreshIndexedRoots();
    };
    window.addEventListener('bndz-index-roots-changed', onRootsChanged);
    return () => window.removeEventListener('bndz-index-roots-changed', onRootsChanged);
  }, [refreshIndexedRoots]);

  const refreshFindingTabRef = useLatest(refreshFindingTab);

  const invalidatePath = React.useCallback((rawPath: string) => {
    const path = normalizePanePath(rawPath);
    // Stale-while-revalidate: keep showing cached rows until the refetch completes.
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

  useNativeShellHostBridge({
    activePaneId,
    paneScrollElsRef,
    cachePathContents,
    filesFedPathsRef,
    resolveFilesHostListingWaiters,
    dirFetchInFlightRef,
    setLoadingPaths,
    setPathLoadErrors,
  });

  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [helloGateBlocked, setHelloGateBlocked] = useState<Record<string, string>>({});
  const [liveShareForced, setLiveShareForced] = useState(false);
  const selectionAnchorRef = useRef<{ paneId: string; itemId: string } | null>(null);
  const listGestureRef = useRef<{
    paneId: string;
    pointerId: number;
    startX: number;
    startY: number;
    entityId: string;
    wasSelected: boolean;
    selectedOnPress: boolean;
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
  const listClickDeferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnResizeActiveRef = useRef(false);
  const [columnPicker, setColumnPicker] = useState<{ x: number; y: number } | null>(null);
  const [renamingFavoritePath, setRenamingFavoritePath] = useState<string | null>(null);
  const [favoriteDrag, setFavoriteDrag] = useState<{ sourcePath: string; overPath: string | null; insertAfter?: boolean } | null>(null);
  const [breadcrumbDropTarget, setBreadcrumbDropTargetState] = useState<string | null>(null);
  const breadcrumbDropTargetRef = useRef<string | null>(null);
  const setBreadcrumbDropTarget = (v: string | null) => {
    if (breadcrumbDropTargetRef.current === v) return;
    breadcrumbDropTargetRef.current = v;
    setBreadcrumbDropTargetState(v);
  };
  const [navTreeFileDropTarget, setNavTreeFileDropTargetState] = useState<string | null>(null);
  const navTreeFileDropTargetRef = useRef<string | null>(null);
  const setNavTreeFileDropTarget = (v: string | null) => {
    if (navTreeFileDropTargetRef.current === v) return;
    navTreeFileDropTargetRef.current = v;
    setNavTreeFileDropTargetState(v);
  };
  const [fileDragFavoriteTarget, setFileDragFavoriteTargetState] = useState<string | null>(null);
  const fileDragFavoriteTargetRef = useRef<string | null>(null);
  const setFileDragFavoriteTarget = (v: string | null) => {
    if (fileDragFavoriteTargetRef.current === v) return;
    fileDragFavoriteTargetRef.current = v;
    setFileDragFavoriteTargetState(v);
  };
  /** Last hover coords+state from the drag-hover RAF — used to skip duplicate hit-tests in onMove. */
  const lastDragHoverStateRef = useRef<{ x: number; y: number; state: import('../lib/fileDragHover').FileDragHoverState } | null>(null);
  const nativeOleDragRef = useRef(false);
  const suppressRowClickRef = useRef(false);
  /** WebView2 often synthesizes list-body clicks after a row press — block deselect briefly. */
  const listItemPressGuardRef = useRef<{ entityId: string; at: number } | null>(null);
  const listEntityDblRef = useRef<{ paneId: string; entityId: string; at: number } | null>(null);
  const listEntityDoubleClickRef = useRef<((entity: any) => void) | null>(null);

  // Sticky suppress after drag/marquee must not eat the next real click forever.
  useEffect(() => {
    const clear = () => { suppressRowClickRef.current = false; };
    window.addEventListener('pointerup', clear, true);
    window.addEventListener('pointercancel', clear, true);
    window.addEventListener('dragend', clear, true);
    return () => {
      window.removeEventListener('pointerup', clear, true);
      window.removeEventListener('pointercancel', clear, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, []);

  // File Operations State
  const [conflict, setConflict] = useState<{ opId: string, fileName: string, srcPath: string, destPath: string } | null>(null);
  const [folderContentsPeek, setFolderContentsPeek] = useState<FolderContentsPeekState | null>(null);
  const [dropActionMenu, setDropActionMenu] = useState<{
    x: number; y: number; paths: string[]; dest: string; sourcePath: string;
  } | null>(null);

  // Omni-Filter State
  const [filterText, setFilterText] = useState("");
  const [debouncedFilterText, setDebouncedFilterText] = useState("");
  useEffect(() => {
    const delay = Math.max(0, Number(settingsRt.search.delayBeforeFilterIsApplied) || 0);
    if (!delay) {
      setDebouncedFilterText(filterText);
      return;
    }
    // Keep global search prefix responsive; debounce local name filter only.
    if (filterText.trimStart().startsWith('> ')) {
      setDebouncedFilterText(filterText);
      return;
    }
    const t = window.setTimeout(() => setDebouncedFilterText(filterText), delay);
    return () => window.clearTimeout(t);
  }, [filterText, settingsRt.search.delayBeforeFilterIsApplied]);
  const [globalSearchResults, setGlobalSearchResults] = useState<any[] | null>(null);
  const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false);
  const [globalSearchEngine, setGlobalSearchEngine] = useState<'everything' | 'indexed' | 'indexed-empty' | 'windows-search' | null>(null);
  const omniFilterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onFocusOmni = () => { try { omniFilterRef.current?.focus(); } catch { /* */ } };
    window.addEventListener('bndz-focus-omni', onFocusOmni);
    return () => window.removeEventListener('bndz-focus-omni', onFocusOmni);
  }, []);
  const paneScrollSyncRef = useRef(false);
  const tabsetAutosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredTabsetRef = useRef(false);
  const dualPaneInitRef = useRef(false);
  const startColumnResize = (colId: ListColumnId, startX: number, headerEl: HTMLElement) => {
    columnResizeActiveRef.current = true;
    document.documentElement.dataset.colResizing = '1';
    const startWidth = headerEl.getBoundingClientRect().width;
    const folderKey = normalizePanePath(currentPath || '/');
    let finalWidth = Math.round(startWidth);

    const applyLiveWidth = (w: number) => {
      const sel = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? `[data-col-id="${CSS.escape(String(colId))}"]`
        : `[data-col-id="${String(colId).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
      document.querySelectorAll<HTMLElement>(sel).forEach(el => {
        el.style.width = `${w}px`;
        el.style.minWidth = `${w}px`;
        el.style.maxWidth = `${w}px`;
        el.style.flexBasis = `${w}px`;
        el.style.flexGrow = '0';
        el.style.flexShrink = '0';
      });
    };

    const onMove = (ev: PointerEvent) => {
      finalWidth = Math.max(56, Math.min(640, Math.round(startWidth + (ev.clientX - startX))));
      applyLiveWidth(finalWidth);
    };
    const onUp = () => {
      columnResizeActiveRef.current = false;
      delete document.documentElement.dataset.colResizing;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // Read latest config via ref — mid-drag updates must not clobber sibling widths.
      const cfg = configRef.current;
      const folderWidths = {
        ...((cfg.listColumnWidthsByPath || {})[folderKey] || {}),
        [colId]: finalWidth,
      };
      updateConfig({
        listColumnWidths: { ...(cfg.listColumnWidths || {}), [colId]: finalWidth },
        listColumnWidthsByPath: {
          ...(cfg.listColumnWidthsByPath || {}),
          [folderKey]: folderWidths,
        },
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const runUndoRedo = React.useCallback(async (redo = false) => {
    const fileOps = buildFileOpsRuntime(config);
    if (!(redo ? canRedo : canUndo)) {
      pushToast({
        kind: 'info',
        title: redo ? 'Redo' : 'Undo',
        message: redo
          ? 'Nothing to redo in the Action Log.'
          : 'Nothing to undo in the Action Log. Recent shell transfers appear here when Action Log is enabled; Windows may also keep its own undo stack (Explorer Ctrl+Z).',
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
      if (isQueuedIpcResult(r)) {
        pushToast({ kind: 'info', title: redo ? 'Redo queued' : 'Undo queued', message: 'Running in the transfer panel…' });
        return;
      }
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
             const dest = String(config.showSearchResultsIn || '').toLowerCase();
             const forceFindingTab = dest.includes('new tab') && !config.showQuickSearchResultsInCurrentTab;
             if (forceFindingTab) {
               addFindingTab(activePaneId, query);
               setFilterText('');
               return;
             }
             if (
               (config.toggleOnSameQuery || getFindBehavior(config).toggleOnSameQuery)
               && lastGlobalQueryRef.current
               && lastGlobalQueryRef.current.toLowerCase() === query.toLowerCase()
               && globalSearchResults
             ) {
               lastGlobalQueryRef.current = '';
               setFilterText('');
               setGlobalSearchResults(null);
               setGlobalSearchEngine(null);
               setIsGlobalSearchLoading(false);
               return;
             }
             setIsGlobalSearchLoading(true);
             const timer = setTimeout(() => {
                 const activePane = panes.find(p => p.id === activePaneId) || panes[0];
                 const tabPath = activePane?.tabs[activePane.activeTabIndex]?.path || '';
                 let searchQuery = query;
                 // Settings → Use space character for Boolean AND
                 if (config.useSpaceCharacterForBooleanAnd && !/[()"]|\bAND\b|\bOR\b|\bNOT\b/i.test(query)) {
                   searchQuery = query.trim().split(/\s+/).filter(Boolean).join(' AND ');
                 }
                 const args = buildGlobalSearchArgs(config, searchQuery, indexedSearchScope, tabPath);

                 import('../lib/ipcBridge').then(({ IPC }) =>
                   IPC.performGlobalSearch(
                     args.query, args.limit, args.useRegex, args.rootPath,
                     args.useEverything, args.searchContent, args.opts,
                   ).then(({ items, engine }) => {
                     lastGlobalQueryRef.current = query;
                     setGlobalSearchResults(normalizeSearchResults(items));
                     setGlobalSearchEngine(
                       engine === 'everything' || engine === 'indexed+everything' || (typeof engine === 'string' && engine.includes('everything'))
                         ? 'everything'
                         : engine === 'indexed-empty'
                           ? 'indexed-empty'
                           : engine === 'windows-search' || (typeof engine === 'string' && engine.includes('windows-search'))
                             ? 'windows-search'
                             : 'indexed',
                     );
                     setIsGlobalSearchLoading(false);
                     if (config.synchronizeTreeWithSearchLocation && tabPath) {
                       setCurrentPath(tabPath, activePaneId);
                     }
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
  }, [filterText, config.enableGlobalSearchPrefix, config.enableEverythingSearch, config.enableBndzIndexedSearch, config.enableSmartBooleanQueryParsing, config.useSpaceCharacterForBooleanAnd, config.searchFileContent, config.globalSearchLimit, config.showFolderThumbnails, config.showSearchResultsIn, config.showQuickSearchResultsInCurrentTab, config.toggleOnSameQuery, config.synchronizeTreeWithSearchLocation, panes, activePaneId, indexedSearchScope]);

  useEffect(() => {
    if (!globalSearchResults?.length) return;
    // Settings → Thumbnails → Include search results (disk cache / full visual warm)
    if (config.cacheThumbnailsOnDisk !== false && !config.includeSearchResults) {
      // Still warm shell icons; skip heavy media thumbnail extract for search hitsets.
      prefetchIconsForEntities(globalSearchResults, panes.find(p => p.id === activePaneId)?.tabs[0]?.path || '/', 'shell', 160);
      return;
    }
    const activePane = panes.find(p => p.id === activePaneId) || panes[0];
    const tabPath = activePane?.tabs[activePane.activeTabIndex]?.path || '/';
    prefetchListingVisuals(globalSearchResults, tabPath, listingPrefetchFromConfig(config));
  }, [globalSearchResults, activePaneId, panes, config.showFolderThumbnails, config.createAllThumbnailsAtOnce, config.includeSearchResults, config.cacheThumbnailsOnDisk]);

  // Restore last tabset on startup (XYplorer tabsets++)
  useEffect(() => {
    if (restoredTabsetRef.current) return;
    if (config.restoreLastTabsetOnStartup === false || !config.lastActiveTabsetId) return;
    // Permanent startup path wins over last tabset when set.
    if (typeof config.permanentStartupPath === 'string' && config.permanentStartupPath.trim()) return;
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
      const sortPane = restored.find(p => p.id === activePaneId) || restored[0];
      if (sortPane?.sortColumn) {
        updateConfig({
          listSortColumn: sortPane.sortColumn,
          listSortDirection: sortPane.sortDirection === 'desc' ? 'desc' : 'asc',
        });
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          for (const pane of restored) {
            const top = Number((pane as any).scrollTop) || 0;
            if (top <= 0) continue;
            listScrollTopsRef.current[pane.id] = top;
            const el = paneScrollElsRef.current[pane.id];
            if (el) el.scrollTop = top;
          }
        });
      });
    }
  }, [config.restoreLastTabsetOnStartup, config.lastActiveTabsetId, config.savedTabsets, config.permanentStartupPath]);

  // Apply persisted list sort when no tabset restored panes (survives reboot).
  const appliedListSortRef = useRef(false);
  useEffect(() => {
    if (appliedListSortRef.current) return;
    if (restoredTabsetRef.current) {
      appliedListSortRef.current = true;
      return;
    }
    // Wait until config has had a chance to load tabset id (undefined → settled).
    const col = config.listSortColumn as SortColumnId | undefined;
    const dir = config.listSortDirection === 'desc' ? 'desc' : config.listSortDirection === 'asc' ? 'asc' : undefined;
    if (!col && !dir) return;
    if (config.restoreLastTabsetOnStartup !== false && config.lastActiveTabsetId && !restoredTabsetRef.current) {
      // Tabset restore effect may still run — apply after a microtask if it didn't.
      const t = window.setTimeout(() => {
        if (appliedListSortRef.current || restoredTabsetRef.current) return;
        appliedListSortRef.current = true;
        const c = (config.listSortColumn as SortColumnId) || 'name';
        const d = config.listSortDirection === 'desc' ? 'desc' : 'asc';
        setPanes(prev => prev.map(p => ({ ...p, sortColumn: c, sortDirection: d })));
      }, 50);
      return () => clearTimeout(t);
    }
    appliedListSortRef.current = true;
    const c = col || 'name';
    const d = dir || 'asc';
    setPanes(prev => prev.map(p => ({ ...p, sortColumn: c, sortDirection: d })));
  }, [config.listSortColumn, config.listSortDirection, config.restoreLastTabsetOnStartup, config.lastActiveTabsetId]);

  // Permanent Continuum Home tab — locked Home in every pane when enabled.
  useEffect(() => {
    if (config.permanentHomeTab !== true) return;
    setPanes(prev => {
      let changed = false;
      const next = prev.map(pane => {
        const homeIx = pane.tabs.findIndex(t => isBndzHomePath(t.path));
        if (homeIx >= 0) {
          if (pane.tabs[homeIx].locked) return pane;
          changed = true;
          const tabs = pane.tabs.map((t, i) => (i === homeIx ? { ...t, locked: true } : t));
          return { ...pane, tabs };
        }
        changed = true;
        const homeTab = {
          id: `home_${pane.id}_${Date.now()}`,
          path: BNDZ_HOME,
          history: [BNDZ_HOME],
          historyIndex: 0,
          selectedItems: [] as string[],
          locked: true,
          viewMode: undefined as undefined,
        };
        return {
          ...pane,
          tabs: [homeTab, ...pane.tabs],
          activeTabIndex: pane.activeTabIndex + 1,
        };
      });
      return changed ? next : prev;
    });
  }, [config.permanentHomeTab]);

  // Permanent startup path (overrides default This PC / last tabset when set)
  const appliedStartupPathRef = useRef(false);
  useEffect(() => {
    if (appliedStartupPathRef.current) return;
    const raw = typeof config.permanentStartupPath === 'string' ? config.permanentStartupPath.trim() : '';
    if (!raw) return;
    appliedStartupPathRef.current = true;
    restoredTabsetRef.current = true; // skip tabset restore race
    const pane = normalizePanePath(raw.includes(':') || raw.startsWith('/') || raw.startsWith('\\')
      ? (raw.startsWith('/') ? raw : `/${raw.replace(/\\/g, '/')}`)
      : raw);
    setCurrentPath(pane);
  }, [config.permanentStartupPath]);

  // Startup & Exit → Focus panel
  const appliedStartupPaneRef = useRef(false);
  useEffect(() => {
    if (appliedStartupPaneRef.current) return;
    const choice = String(config.startupPane || 'Last active panel');
    if (!choice || choice === 'Last active panel' || choice === 'false') return;
    appliedStartupPaneRef.current = true;
    if (choice === 'Left pane') {
      setActivePaneId('pane1');
      return;
    }
    if (choice === 'Right pane') {
      setActivePaneId('pane2');
      if (!isDualPane && panes.length < 2) {
        // Dual-pane restore effect may still run; mark intent via config flag consumer.
        updateConfig({ dualPaneOpen: true });
      }
      return;
    }
    if (choice === 'Folder tree') {
      window.dispatchEvent(new CustomEvent('bndz-focus-nav-tree'));
    }
  }, [config.startupPane, isDualPane, panes.length, updateConfig]);

  // Match OS light/dark once at startup when enabled
  const appliedOsThemeRef = useRef(false);
  useEffect(() => {
    if (appliedOsThemeRef.current) return;
    if (!config.adjustToOsLightDarkModeAtStartup) return;
    appliedOsThemeRef.current = true;
    try {
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
      const nextTheme = dark ? 'Dark' : 'Light';
      if (config.theme !== nextTheme) updateConfig({ theme: nextTheme });
    } catch { /* ignore */ }
  }, [config.adjustToOsLightDarkModeAtStartup, config.theme, updateConfig]);

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
        sortColumn: (config.listSortColumn as SortColumnId) || 'name',
        sortDirection: config.listSortDirection === 'desc' ? 'desc' : 'asc',
      },
    ]);
    setIsDualPane(true);
  }, [config.dualPaneOpen, config.restoreLastTabsetOnStartup, config.lastActiveTabsetId, config.defaultViewMode, config.listSortColumn, config.listSortDirection, isDualPane, panes]);

  // Auto-save tabset on workspace changes
  useEffect(() => {
    if (config.autoSaveTabsetsOnSwitch === false) return;
    if (tabsetAutosaveRef.current) clearTimeout(tabsetAutosaveRef.current);
    tabsetAutosaveRef.current = setTimeout(() => {
      const panesWithScroll = panes.map(p => ({
        ...p,
        scrollTop: listScrollTopsRef.current[p.id] ?? (p as any).scrollTop ?? 0,
      }));
      const autosave = { id: '__autosave__', name: '(Auto-save)', panes: JSON.parse(JSON.stringify(panesWithScroll)) };
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
      // Quick Look overlay (Space) — skip while open/IME; audio keeps playing via shared session
      if (!isInput && e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !(e as any).isComposing) {
         if (quickPreviewOpenRef.current) return;
         const activePane = panes.find(p => p.id === activePaneId);
         const tab = activePane?.tabs[activePane.activeTabIndex];
         if (tab && (tab.selectedItems.length > 0 || focusedItemId)) {
            e.preventDefault();
            e.stopPropagation();
            openQuickPreviewRef.current?.();
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
         // Status-bar style feedback only — avoid toast/notification spam on every F5.
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
                 const norm = normalizePanePath(tab.path);
                 const dirContents = pathContentsCache[tab.path] || pathContentsCache[norm] || [];
                 const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id)).map((x: any) => ({
                    id: x.id,
                    name: x.name,
                    path: x.path || undefined,
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

      // Paste Special shortcuts (XYplorer-style)
      if (!isInput && e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          void pasteSpecialHandlersRef.current.pasteIntoNewSubfolder();
      }
      if (!isInput && e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          void pasteSpecialHandlersRef.current.pasteTextIntoNewFile();
      }
      if (!isInput && e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          void pasteSpecialHandlersRef.current.pasteImageIntoNewPng();
      }

      // Open focused/selected directory in the opposite pane (rebindable, default Alt+P)
      if (!isInput && matchesShortcut(e, keyboardMap.openInNewPane)) {
          const activePane = panes.find(p => p.id === activePaneId);
          const tab = activePane?.tabs[activePane.activeTabIndex];
          if (tab) {
              const targetId = focusedItemId || tab.selectedItems[0];
              const norm = normalizePanePath(tab.path);
              const entity = (pathContentsCache[tab.path] || pathContentsCache[norm] || [])
                .find((x: any) => x.id === targetId);
              if (entity && entity.type === 'directory') {
                  e.preventDefault();
                  openFolderInOppositePane(joinPanePath(tab.path, entity), activePaneId);
              }
          }
      }

      // Smart Tools (Ctrl+Shift+A) — opens Assistant tab
      if (!isInput && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSmartToolsTab('assistant');
        setIsSmartToolsOpen(true);
        return;
      }

      // View mode chords — Ctrl+Shift+1/2/3/4 (details / list / grid / columns)
      if (!isInput && e.ctrlKey && e.shiftKey && !e.altKey) {
        const digit = e.key;
        if (digit === '1' || digit === '2' || digit === '3' || digit === '4') {
          e.preventDefault();
          const mode = digit === '1' ? 'details' : digit === '2' ? 'list' : digit === '3' ? 'grid' : 'columns';
          setViewMode(mode, activePaneId);
        }
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
           const normTab = normalizePanePath(tab.path);
           const entity = (pathContentsCache[tab.path] || pathContentsCache[normTab] || [])
             .find((x: any) => x.id === focusedItemId)
             || findEntityInCache(pathContentsCache, focusedItemId);
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
           const norm = normalizePanePath(tab.path);
           const dirContents = pathContentsCache[tab.path] || pathContentsCache[norm] || [];
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
           void (async () => {
             const { createItemInPane } = await import('../lib/ramStagingPaths');
             const r = await createItemInPane(tab.path, 'New folder', 'dir');
             if (!r.ok) {
               pushToast({ kind: 'error', title: 'New folder failed', message: r.error || 'Unknown error' });
               return;
             }
             if (isBndzRamPath(tab.path)) {
               window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: tab.path } }));
             } else {
               void refetchPath(tab.path);
             }
           })();
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedItemId, panes, activePaneId, fileSystem, isToolbarConfigOpen, isSmartToolsOpen, setClipboardState, executePaste, keyboardMap, config, config.pinnedFavorites, refetchPath, beginInlineRename]);

  // Context Menu State
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [fileMenuShellNewItems, setFileMenuShellNewItems] = useState<NativeContextMenuItem[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, entityId: string | null, path: string, entityName: string | null, entityExtension?: string | null, isDirectory: boolean, isGhostLink?: boolean, surface?: ContextMenuSurface, nativeContextItems?: any[], selectedPaths?: string[] } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; paneId: string; tabIndex: number } | null>(null);

  useContextMenuDismissOnLeave(!!contextMenu, () => setContextMenu(null));
  useContextMenuDismissOnLeave(!!tabContextMenu, () => setTabContextMenu(null));

  // Optionally merge Windows shell "New" cascade into the File → New menubar when available.
  useEffect(() => {
    if (openMenuId !== 'File') return;
    let cancelled = false;
    const pane = panes.find(p => p.id === activePaneId) || panes[0];
    const tab = pane ? resolvePaneTab(pane) : null;
    const folderPath = tab?.path;
    if (!folderPath || isRecycleBinPath(folderPath) || !isValidShellTarget(folderPath)) {
      setFileMenuShellNewItems([]);
      return;
    }
    void (async () => {
      try {
        const { IPC } = await import('../lib/ipcBridge');
        if (!IPC.isNative) return;
        const items = await IPC.fetchNativeContextMenuItems(toWindowsPath(folderPath));
        if (cancelled) return;
        const { cascade } = takeShellCascadeByLabel(filterSupplementalNativeItems(items), 'New');
        setFileMenuShellNewItems(cascade?.children?.length ? cascade.children : []);
      } catch {
        if (!cancelled) setFileMenuShellNewItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [openMenuId, panes, activePaneId]);

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

      const isVirtualLocation =
        isRecycleBinPath(targetPath)
        || isBndzVirtualPath(targetPath)
        || targetPath.startsWith('/shell:')
        || targetPath.startsWith('/cloud/');

      // Never join display labels onto virtual roots (e.g. /shell:RecycleBin/Recycle Bin).
      const menuItemPath = isVirtualLocation && (surface === 'tree-item' || surface === 'sidebar-item' || !entityName)
          ? targetPath
          : (entityId && entityName
              ? (selectedPaths?.length ? selectedPaths[0] : joinPanePath(targetPath, { name: entityName }))
              : targetPath);
      const winPath = toWindowsPath(menuItemPath);
      const menuEntity = entityId
        ? (pathContentsCache[targetPath] || []).find((item: FSEntity) => item.id === entityId)
        : null;

      // Settings → Use custom context menu (false → host shell menu only)
      if (config.useCustomContextMenu === false) {
        const shellOnly = (selectedPaths?.length
          ? selectedPaths
          : [winPath]).map(p => toWindowsPath(p)).filter(Boolean);
        if (shellOnly.length > 0) {
          void import('../lib/ipcBridge').then(({ IPC }) => {
            IPC.showNativeContextMenu(shellOnly, Math.round(e.screenX), Math.round(e.screenY));
          });
        }
        return;
      }

      // Always use the BNDZ context menu. Native shell verbs are merged when enabled (default on).
      // Shift+right-click opens the live Windows shell popup (Vanara IContextMenu) for full extension parity.
      setContextMenu({
          x: e.clientX,
          y: e.clientY,
          entityId: isVirtualLocation && (surface === 'tree-item' || surface === 'sidebar-item') ? null : entityId,
          path: targetPath,
          entityName: isVirtualLocation && (surface === 'tree-item' || surface === 'sidebar-item') ? null : entityName,
          entityExtension,
          isDirectory,
          isGhostLink: !!(menuEntity as any)?.isGhostLink,
          surface,
          nativeContextItems: [],
          selectedPaths
      });

      // Skip native shell verb fetch for virtual locations — they produce empty/separator-only menus.
      if (isVirtualLocation) return;

      const shellPaths = (selectedPaths?.length
        ? selectedPaths
        : [winPath]).map(p => toWindowsPath(p)).filter(Boolean);

      // Shift+right-click → real host shell menu (multi-select aware).
      if (e.shiftKey && shellPaths.length > 0) {
        void import('../lib/ipcBridge').then(({ IPC }) => {
          IPC.showNativeContextMenu(shellPaths, Math.round(e.screenX), Math.round(e.screenY));
        });
        setContextMenu(null);
        return;
      }

      // Pure BNDZ menu (icons + product verbs) unless user opted into merging shell verbs.
      const mergeShellVerbs = !!(config.useNativeOSContextMenu || config.nativeContextMenu);
      if (!mergeShellVerbs) return;

      void import('../lib/nativeContextMenuCache').then(({ getCachedNativeContextMenu, setCachedNativeContextMenu }) => {
        if (requestId !== contextMenuRequestRef.current) return;
        const cacheKey = shellPaths.length === 1 ? shellPaths[0] : shellPaths.slice().sort().join('|');
        const cachedNative = getCachedNativeContextMenu(cacheKey) as any[] | null;
        if (cachedNative?.length) {
          setContextMenu(prev => (requestId === contextMenuRequestRef.current && prev)
            ? { ...prev, nativeContextItems: cachedNative }
            : prev);
        }
      });

      // Fetch live shell extensions for the supplemental block (IContextMenu / multi-select).
      const runFetch = () => {
        void (async () => {
          try {
            const { IPC } = await import('../lib/ipcBridge');
            const { setCachedNativeContextMenu } = await import('../lib/nativeContextMenuCache');
            const nativeItems = await IPC.fetchNativeContextMenuItems(shellPaths.length > 1 ? shellPaths : shellPaths[0]);
            if (requestId !== contextMenuRequestRef.current) return;
            const cacheKey = shellPaths.length === 1 ? shellPaths[0] : shellPaths.slice().sort().join('|');
            if (nativeItems?.length) setCachedNativeContextMenu(cacheKey, nativeItems);
            setContextMenu(prev => (requestId === contextMenuRequestRef.current && prev)
              && nativeContextSignature(prev.nativeContextItems) !== nativeContextSignature(nativeItems)
              ? { ...prev, nativeContextItems: nativeItems }
              : prev);
          } catch (err) {
            console.warn('Native context menu fetch failed', err);
          }
        })();
      };
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(runFetch, { timeout: 80 });
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
    if (isPortableDeviceReadOnly(path, config.treatPortableDevicesAsReadOnly === true)) {
      pushToast({
        kind: 'warning',
        title: 'Portable device is read-only',
        message: 'Turn off “Treat portable devices as read-only” in Settings to allow deletes on phones/MTP.',
      });
      return;
    }
    const rt = buildSettingsRuntime(config);
    const listIx = getListIxBehavior(config);
    // Recycle when deleteToRecycleBin is on and bypassRecycleBin is off (Shift+Delete → permanent).
    const useRecycleBin = config.deleteToRecycleBin !== false
      && !rt.shell.bypassRecycle
      && !config.bypassRecycleBin;
    const bypassRecycle = options?.permanent ? true : !useRecycleBin;
    const startup = getStartupBehavior(config);

    if (isFromTree && config.disallowDeleteByKeyInFolderTree) return;

    const executeDelete = () => {
      void (async () => {
      const normPath = normalizePanePath(path);
      const winPaths = (await Promise.all(items.map(async (entity: any) => {
        if (entity.fsPath) return String(entity.fsPath).replace(/\//g, '\\');
        const raw = entity.path || joinPanePath(path, { name: entity.name });
        if (isBndzRamPath(raw) || isBndzRamPath(path)) {
          return (await resolvePanePathForFs(String(raw))) || '';
        }
        return toWindowsPath(raw);
      }))).filter((p): p is string => !!p && !p.toLowerCase().startsWith('bndz\\'));
      if (!winPaths.length) {
        pushToast({ kind: 'error', title: 'Delete failed', message: 'Could not resolve item paths on disk.' });
        return;
      }
      const label = items.length === 1 ? items[0].name : `${items.length} items`;
      const opId = `delete-${Date.now()}`;
      const deletedIds = new Set(items.map(i => i.id).filter(Boolean));
      const deletedNames = new Set(items.map(i => i.name));
      if (startup.playASoundOnCertainEvents) {
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch { /* ignore */ }
      }

      registerFsTombstone(opId, 'delete', normPath, [...deletedNames], winPaths, items);

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
        const remaining = existing.filter((e: any) => !deletedNames.has(e.name));
        // Select next item after delete when enabled.
        if (config.selectNextItemAfterDeleteAndMove && !isFromTree) {
          const firstDeletedIdx = existing.findIndex((e: any) => deletedNames.has(e.name));
          const nextItem = remaining[Math.min(Math.max(0, firstDeletedIdx), Math.max(0, remaining.length - 1))];
          if (nextItem) {
            queueMicrotask(() => {
              setSelectedItems([nextItem.id], activePaneId);
              setFocusedItemId(nextItem.id);
            });
          }
        } else if (isFromTree && config.selectParentOfDeletedFolder) {
          const parent = normPath.replace(/\/[^/]+$/, '') || '/';
          queueMicrotask(() => setCurrentPath(parent));
        }
        return setPathCacheEntry(prev, normPath, remaining);
      });

      xferMetaRef.current.set(opId, { op: 'delete', label });
      // Progress lives in the transfer queue panel — avoid center sticky toasts for every op.
      if (!fileOpsRt.showTransferPanel) {
        pushToast({
          id: `xfer-${opId}`,
          kind: 'progress',
          title: 'Deleting…',
          message: label,
          sticky: true,
        });
      }
      IPC.executeFsOperation(opId, 'delete', winPaths, '', bypassRecycle, label, 'high');
      // Skip aggressive RAM refetch — tombstones keep rows hidden until the job completes.
      })();
    };

    const names = items.map(x => x.name).slice(0, 5).join('\n• ');
    const confirmMsg = items.length === 1
      ? `${options?.permanent ? 'Permanently remove' : 'Delete'} "${items[0].name}"?${bypassRecycle ? '\n\n(Bypassing Recycle Bin)' : '\n\nItems will be moved to the Recycle Bin.'}`
      : `${options?.permanent ? 'Permanently delete' : 'Delete'} ${items.length} items?${bypassRecycle ? '\n\n(Bypassing Recycle Bin)' : '\n\nItems will be moved to the Recycle Bin.'}\n\n• ${names}${items.length > 5 ? '\n• ...' : ''}`;

    // Permanent deletes (Shift+Delete / bypass) always require an explicit confirmation — never skippable.
    if (options?.permanent || bypassRecycle) {
      showModal({
        type: 'destructive',
        title: items.length === 1 ? 'Delete Permanently' : `Permanently Delete ${items.length} Items`,
        message: items.length === 1
          ? `Permanently delete "${items[0].name}"?\n\nThis cannot be undone and will not go to the Recycle Bin.`
          : `Permanently delete ${items.length} items?\n\nThis cannot be undone.\n\n• ${names}${items.length > 5 ? '\n• ...' : ''}`,
        actions: [
          { label: items.length === 1 ? 'Delete Permanently' : `Delete ${items.length} Permanently`, style: 'destructive', action: executeDelete },
          { label: 'Cancel', style: 'secondary', action: () => {} },
        ],
      });
      return;
    }

    // Skip confirmation when suppressed in File Operations or explicitly disabled in Shell settings
    if (config.suppressDeleteConfirmationDialog || config.confirmDeleteOperations === false) {
      if (listIx.promptBeforeDelete && !options?.permanent) {
        /* still confirm when promptBeforeDelete is on even if global confirm is off */
      } else {
        executeDelete();
        return;
      }
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

  const createNewItemInActivePane = async (name: string, kind: 'dir' | 'file') => {
    const pane = panes.find(p => p.id === activePaneId);
    const cPath = pane?.tabs[pane.activeTabIndex]?.path || currentTab.path;
    if (!cPath) return;
    const { createItemInPane } = await import('../lib/ramStagingPaths');
    const r = await createItemInPane(cPath, name, kind);
    if (!r.ok) {
      pushToast({ kind: 'error', title: kind === 'dir' ? 'New folder failed' : 'New file failed', message: r.error || 'Unknown error' });
      return;
    }
    if (isBndzRamPath(cPath)) {
      invalidateRamZoneMountCache();
      window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: cPath } }));
    } else {
      setTimeout(() => refreshWorkspace(), 150);
    }
  };

  const handleDeletePaths = (paths: string[]) => {
    if (!paths.length) return;
    if (isRecycleBinPath(currentPath)) {
      requestPermanentPurge(paths);
      return;
    }
    const items = paths.map(p => ({ name: p.split(/[/\\]/).pop() || p, path: p }));
    handleDeleteRequest(items, paths[0].substring(0, Math.max(paths[0].lastIndexOf('/'), paths[0].lastIndexOf('\\'))) || currentPath);
  };

  /** Mandatory confirmation for irreversible Recycle Bin purge — never skippable. */
  const requestPermanentPurge = (paths: string[]) => {
    if (!paths.length) return;
    const label = paths.length === 1
      ? (paths[0].split(/[/\\]/).pop() || 'item')
      : `${paths.length} items`;
    showModal({
      type: 'destructive',
      title: paths.length === 1 ? 'Delete Permanently' : `Permanently Delete ${paths.length} Items`,
      message: `Permanently delete ${label}?\n\nThis cannot be undone and will not go to the Recycle Bin.`,
      actions: [
        {
          label: paths.length === 1 ? 'Delete Permanently' : `Delete ${paths.length} Permanently`,
          style: 'destructive',
          action: () => {
            void (async () => {
              const { IPC } = await import('../lib/ipcBridge');
              const result = await IPC.purgeRecycleItems(paths);
              if (isQueuedIpcResult(result)) {
                setToastMessage('Delete queued — see transfer panel.');
                return;
              }
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
          },
        },
        { label: 'Cancel', style: 'secondary', action: () => {} },
      ],
    });
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
                if (isQueuedIpcResult(result)) {
                  setToastMessage('Empty Recycle Bin queued — see transfer panel.');
                  return;
                }
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
      IPC.getSystemDrives().then(d => setDrives(Array.isArray(d) ? d : []));
      IPC.getCloudProviders().then(p => setCloudProviders(Array.isArray(p) ? p : []));
      refreshPathsForPanes();
      IPC.refreshWorkspace().catch(() => {});
    });
  };

  // Refresh lists when background transfer jobs finish (copy/move/archive/sync/etc.)
  // Job terminal status is the single source of truth for success/failure toasts.
  useEffect(() => {
    if (!IPC.isNative) return;
    const completed = new Set<string>();
    const refreshCategories = new Set(['fs', 'recycle', 'archive', 'folder-sync', 'mesh']);
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = IPC.onFileTransferQueueChanged(state => {
      transferActiveCountRef.current = Number(state.activeCount) || 0;
      let shouldRefresh = false;
      // Track whether every newly-completed job in this batch was a delete so we can
      // use a shorter (or zero) refresh delay — tombstones already removed the rows
      // optimistically, so the only reason to refresh is to confirm FS truth.
      let batchIsDeleteOnly = true;
      let hasDeleteFailure = false;

      for (const job of state.jobs) {
        if (!refreshCategories.has(job.category || 'fs')) continue;
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          if (!completed.has(job.operationId)) {
            completed.add(job.operationId);
            shouldRefresh = true;
            const meta = xferMetaRef.current.get(job.operationId);
            xferMetaRef.current.delete(job.operationId);
            dismissToast(`xfer-${job.operationId}`);
            const label = meta?.label || job.label || 'items';
            const action = (job.action || meta?.op || '').toLowerCase();

            const isDelete = action === 'delete' || meta?.op === 'delete';
            const isMove = action === 'move' || meta?.op === 'move' || action === 'mesh-move';
            if (!isDelete) batchIsDeleteOnly = false;
            if ((isDelete || isMove) && (job.status === 'failed' || job.status === 'cancelled')) {
              hasDeleteFailure = true;
              // Instant reinject — don't wait for disk refresh (blank gap after optimistic hide).
              reinjectFsTombstone(job.operationId);
            }
            clearFsTombstone(job.operationId);

            if (job.status === 'failed') {
              const failTitle = action === 'delete' ? 'Delete failed'
                : action.includes('archive') || job.operationId.startsWith('archive-') ? 'Compression failed'
                : action.includes('extract') || job.operationId.startsWith('extract-') ? 'Extraction failed'
                : isMove ? 'Move failed'
                : 'Operation failed';
              pushToast({
                kind: 'error',
                title: failTitle,
                message: job.error || label,
              });
              void IPC.tombstoneRestoreFailed?.(job.operationId);
            } else if (job.status === 'completed') {
              const doneVerb = isDelete ? 'Deleted'
                : action === 'move' || meta?.op === 'move' || action === 'mesh-move' ? 'Move complete'
                : action === 'copy' || meta?.op === 'copy' || action === 'mesh-copy' ? 'Copy complete'
                : action === 'mesh-upload' ? 'Upload complete'
                : action === 'mesh-download' ? 'Download complete'
                : job.operationId.startsWith('archive-') ? 'Archive created'
                : job.operationId.startsWith('extract-') ? 'Extraction complete'
                : 'Transfer complete';
              pushToast({ kind: 'success', title: doneVerb, message: label });
              if (meta?.op === 'move' && meta.selectParentPath && config.selectParentOfMovedFolder) {
                setCurrentPath(meta.selectParentPath);
              }
            }
          }
        }
      }
      if (shouldRefresh) {
        if (refreshTimer) clearTimeout(refreshTimer);
        // Delete completions: refresh immediately — tombstones already hid the rows so the only
        // purpose of the refresh is FS truth confirmation, which should feel instant.
        // A failed delete also needs an immediate refresh to restore tombstoned rows.
        // Copy/move/archive: keep the 400ms anti-flicker buffer.
        const delay = (batchIsDeleteOnly || hasDeleteFailure) ? 0 : 400;
        refreshTimer = setTimeout(() => refreshWorkspace(), delay);
      }
    });
    return () => {
      unsub();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [refreshPathsForPanes, config.selectParentOfMovedFolder, clearFsTombstone, reinjectFsTombstone]);

  // Live speed/ETA in progress toasts (optional — Configuration → Background processing).
  useEffect(() => {
    if (!IPC.isNative || !fileOpsRt.showTransferSpeedEta || fileOpsRt.showTransferPanel) return;
    const unsub = IPC.onFileTransferQueueChanged(state => {
      for (const job of state.jobs) {
        if (job.status !== 'running' && job.status !== 'queued') continue;
        const meta = xferMetaRef.current.get(job.operationId);
        if (!meta) continue;
        const progressLine = formatTransferProgressLine(job);
        if (!progressLine) continue;
        const action = (job.action || meta.op || '').toLowerCase();
        const verb = action === 'mesh-upload' ? 'Uploading'
          : action === 'mesh-download' ? 'Downloading'
          : action.includes('mesh') ? 'Transferring'
          : meta.op === 'move' ? 'Moving'
          : meta.op === 'copy' ? 'Copying'
          : 'Transferring';
        pushToast({
          id: `xfer-${job.operationId}`,
          kind: 'progress',
          title: `${verb}…`,
          message: `${meta.label} · ${progressLine}`,
          progress: job.progress ?? undefined,
          sticky: true,
        });
      }
    });
    return () => unsub();
  }, [fileOpsRt.showTransferSpeedEta, fileOpsRt.showTransferPanel]);

  useEffect(() => {
    if (config.showTopMenubar === false || config.showTopMenuBar === false) return;
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
  }, [config.showTopMenubar, config.showTopMenuBar]);

  useEffect(() => {
    const handleDismiss = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target?.closest?.('[data-bndz-context-menu], [data-bndz-submenu-flyout], [data-bndz-tab-context-menu], [data-bndz-menubar-menu], [data-menu-trigger]')) return;
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
    document.addEventListener('pointerdown', handleDismiss, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleDismiss, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const activePaneIndex = panes.findIndex(p => p.id === activePaneId);
  const activePane = panes[activePaneIndex] || panes[0];
  const activeTab: TabState = activePane?.tabs[activePane.activeTabIndex] ?? {
    id: 'fallback', path: '/', history: ['/'], historyIndex: 0, selectedItems: [],
  };
  const currentPath = activeTab.path;
  const sidebarActiveNorm = normalizePanePath(currentPath);
  const isSidebarDriveActive = React.useCallback((driveName: string) => {
    const d = normalizePanePath(driveName).toLowerCase().replace(/\/$/, '');
    const a = sidebarActiveNorm.toLowerCase().replace(/\/$/, '');
    if (panePathsEqual(a, d)) return true;
    if (/^\/[a-z]:$/.test(d)) return a.startsWith(`${d}/`);
    return false;
  }, [sidebarActiveNorm]);
  const liveShareEnabled = config.liveShareCursorEnabled === true || liveShareForced;
  const { peers: liveSharePeers, publish: publishLiveShare } = useLiveShareCursor(currentPath, liveShareEnabled);

  // Settings → Resolve cache path from current folder
  useEffect(() => {
    if (!config.resolveCachePathFromCurrentFolder) {
      void import('../lib/ipcBridge').then(({ IPC }) => IPC.setMediaCacheBrowseFolder(null));
      return;
    }
    const folder = toWindowsPath(currentPath);
    if (!folder || folder.startsWith('/bndz') || /^shell:/i.test(folder)) return;
    void import('../lib/ipcBridge').then(({ IPC }) => IPC.setMediaCacheBrowseFolder(folder));
  }, [config.resolveCachePathFromCurrentFolder, currentPath]);

  useEffect(() => {
    const onLiveShare = (ev: Event) => {
      setLiveShareForced(!!(ev as CustomEvent<{ active?: boolean }>).detail?.active);
    };
    window.addEventListener('bndz-live-share-changed', onLiveShare);
    return () => window.removeEventListener('bndz-live-share-changed', onLiveShare);
  }, []);

  useEffect(() => {
    initAdaptiveListDensity(config.adaptiveListDensity !== false);
  }, [config.adaptiveListDensity]);

  useEffect(() => {
    onAdaptiveListFocus(!!focusedItemId || (activeTab.selectedItems?.length ?? 0) > 0);
  }, [focusedItemId, activeTab.selectedItems]);

  useEffect(() => {
    if (!liveShareEnabled || !currentPath) return;
    const norm = normalizePanePath(currentPath);
    const contents = pathContentsCache[norm] || [];
    const selPaths = (activeTab.selectedItems || []).map(sid => {
      const ent = contents.find((c: any) => c.id === sid);
      return ent ? joinPanePath(currentPath, ent) : '';
    }).filter(Boolean);
    const cursorEnt = focusedItemId ? contents.find((c: any) => c.id === focusedItemId) : null;
    const cursorPath = cursorEnt ? joinPanePath(currentPath, cursorEnt) : undefined;
    publishLiveShare(selPaths, cursorPath);
  }, [liveShareEnabled, currentPath, activeTab.selectedItems, focusedItemId, publishLiveShare, pathContentsCache]);

  const workspaceToolActive = useMemo(
    () => panes.some(pane => {
      const tab = pane.tabs[pane.activeTabIndex];
      const path = normalizePanePath(tab?.path || '');
      return isBndzWorkspacePath(path);
    }),
    [panes],
  );
  const layoutBottomOpen = effectiveBottomOpen && !workspaceToolActive;
  layoutBottomOpenRef.current = layoutBottomOpen;

  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (layoutBottomOpen) panel.expand();
    else panel.collapse();
  }, [layoutBottomOpen, bottomPanelRef]);

  useEffect(() => {
    if (workspaceToolActive && bottomImmersive) exitBottomImmersive();
  }, [workspaceToolActive, bottomImmersive, exitBottomImmersive]);

  useEffect(() => {
    if (!workspaceToolActive) return;
    setMarquee(null);
    setMarqueeActive(false);
  }, [workspaceToolActive]);

  useEffect(() => {
    const unbindChrome = bindGlobalChromeCursorReset();
    const unbindSpatial = bindGlobalSpatialCursorGuard();
    return () => {
      unbindChrome();
      unbindSpatial();
    };
  }, []);

  const miniTreeNodes = useMemo(
    () => buildMiniTreeFromVisits(config.navigationHistory || []),
    [config.navigationHistory],
  );
  const [miniTreeLiveNodes, setMiniTreeLiveNodes] = useState(miniTreeNodes);
  useEffect(() => {
    let cancelled = false;
    const allowZombies = !!config.allowZombiesInTheMiniTree;
    if (allowZombies || !IPC.isNative) {
      setMiniTreeLiveNodes(miniTreeNodes);
      return;
    }
    void (async () => {
      const kept: typeof miniTreeNodes = [];
      for (const node of miniTreeNodes) {
        try {
          const exists = await IPC.checkPathExists(toWindowsPath(node.path));
          if (exists) kept.push(node);
        } catch {
          kept.push(node);
        }
      }
      if (!cancelled) setMiniTreeLiveNodes(kept);
    })();
    return () => { cancelled = true; };
  }, [miniTreeNodes, config.allowZombiesInTheMiniTree]);

  // Autofit Name column when enabled and folder contents change
  useEffect(() => {
    if (!getListIxBehavior(config).autofitTheWidthOfTheNameColumn) return;
    const items = getSortedContentsForActivePane();
    if (!items.length) return;
    const folderPath = normalizePanePath(currentPath);
    const cols = getVisibleListColumns(config, { folderPath });
    const widths = computeAutosizedColumnWidths(items, cols, {
      disregardHeaders: !!config.onAutosizeDisregardTheColumnHeaders,
      alwaysAutosizeSize: !!config.alwaysAutosizeTheSizeColumn,
      limits: parseColumnAutosizeLimits(config),
    });
    if (!Object.keys(widths).length) return;
    const prev = config.listColumnWidthsByPath?.[folderPath] || {};
    const changed = Object.keys(widths).some((k) => prev[k] !== widths[k]);
    if (!changed) return;
    const byPath = { ...(config.listColumnWidthsByPath || {}) };
    byPath[folderPath] = { ...prev, ...widths };
    updateConfig({
      listColumnWidths: { ...(config.listColumnWidths || {}), ...widths },
      listColumnWidthsByPath: byPath,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, pathContentsCache[currentPath]?.length, config.autofitTheWidthOfTheNameColumn]);

  // Dual-pane: auto-select matching items in the inactive pane
  useEffect(() => {
    if (!isDualPane || !getTabLimitBehavior(config).autoSelectMatchingItems) return;
    if (panes.length < 2) return;
    const active = panes.find(p => p.id === activePaneId);
    const other = panes.find(p => p.id !== activePaneId);
    if (!active || !other) return;
    const aTab = active.tabs[active.activeTabIndex];
    const oTab = other.tabs[other.activeTabIndex];
    if (!aTab?.selectedItems?.length) return;
    const activeItems = pathContentsCache[aTab.path] || [];
    const selectedNames = new Set(
      activeItems
        .filter((x: any) => aTab.selectedItems.includes(x.id))
        .map((x: any) => String(x.name || '').toLowerCase()),
    );
    if (!selectedNames.size) return;
    const otherItems = pathContentsCache[oTab.path] || [];
    const matchIds = otherItems
      .filter((x: any) => selectedNames.has(String(x.name || '').toLowerCase()))
      .map((x: any) => x.id);
    const prev = oTab.selectedItems || [];
    if (matchIds.length && matchIds.join('|') !== prev.join('|')) {
      setSelectedItems(matchIds, other.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDualPane, activePaneId, activeTab?.selectedItems?.join('|'), currentPath, config.autoSelectMatchingItems]);

  const addressSuggestions = useMemo(() => {
    if (!editingAddressBarPaneId) return [];
    // Settings → Auto-Complete Path Names → Address Bar
    if (!config.addressBar) return [];
    const pathCandidates = (shortcuts || [])
      .filter((s): s is { name?: string; path: string } => !!s.path)
      .map(s => ({ path: s.path, label: s.name }));
    // Controls → Auto-complete recently used items gates history visits in the dropdown.
    const includeRecent = !!config.autoCompleteRecentlyUsedItems;
    return buildPathSuggestions(addressBarInput, {
      visits: includeRecent ? config.navigationHistory : [],
      favorites: config.pinnedFavorites,
      pathCandidates,
      autoCompleteFilter: config.autoCompleteFilter || 'Contains',
      moveLastUsedItemToTop: !!config.moveLastUsedItemToTop,
    });
  }, [editingAddressBarPaneId, addressBarInput, config.navigationHistory, config.pinnedFavorites, config.autoCompleteRecentlyUsedItems, config.addressBar, config.autoCompleteFilter, config.moveLastUsedItemToTop, shortcuts]);

  const findLocationSuggestions = useMemo(() => {
    // Settings → Auto-Complete Path Names → Find Files Location
    if (!config.findFilesLocation) return [];
    if (!filterText.trim() || filterText.trimStart().startsWith('> ')) return [];
    const pathCandidates = (shortcuts || [])
      .filter((s): s is { name?: string; path: string } => !!s.path)
      .map(s => ({ path: s.path, label: s.name }));
    return buildPathSuggestions(filterText, {
      visits: config.autoCompleteRecentlyUsedItems ? config.navigationHistory : [],
      favorites: config.pinnedFavorites,
      pathCandidates,
      autoCompleteFilter: config.autoCompleteFilter || 'Contains',
      moveLastUsedItemToTop: !!config.moveLastUsedItemToTop,
      limit: 8,
    });
  }, [filterText, config.findFilesLocation, config.autoCompleteFilter, config.autoCompleteRecentlyUsedItems, config.navigationHistory, config.pinnedFavorites, config.moveLastUsedItemToTop, shortcuts]);

  const selectionSummaryLine = useMemo(() => {
    if (!activeTab.selectedItems?.length) return '';
    const items = pathContentsCache[currentPath] || [];
    const selected = items.filter((x: any) => activeTab.selectedItems.includes(x.id));
    if (!selected.length) return '';
    return formatSelectionSummaryLine(summarizeSelection(selected), formatSize);
  }, [activeTab.selectedItems, currentPath, pathContentsCache]);

  useEffect(() => {
    const template = config.windowTitleTemplate;
    if (template) {
      document.title = renderTitleBarTemplate(String(template), {
        path: activeTab.path,
        app: 'BNDZ',
        ver: appVersion,
        selection: selectionSummaryLine,
      }, config) || 'BNDZ';
    } else {
      document.title = 'BNDZ';
    }
  }, [config.windowTitleTemplate, config.rememberPermanentVariables, config.permanentVariables, activeTab.path, appVersion, selectionSummaryLine]);

  const statusBarFreeLabel = useMemo(() => {
    const totalCap = drives.reduce((s, d) => s + (d.totalSpace || 0), 0);
    const totalFree = drives.reduce((s, d) => s + (d.freeSpace || 0), 0);
    const pctFree = totalCap > 0 ? Math.round((totalFree / totalCap) * 100) : 0;
    return `${formatSize(totalFree)} free (${pctFree}%)`;
  }, [drives]);

  const statusBarClipboardLabel = useMemo(() => describeClipboardState(clipboard) || '', [clipboard]);

  /** Live density while scrubbing — avoid config/save/runtime churn every pointer move. */
  const [liveDensity, setLiveDensity] = useState<null | { mode: 'grid' | 'list' | 'details'; value: number }>(null);
  const listIconSz = Math.max(12, Math.min(96, (liveDensity?.mode === 'list' ? liveDensity.value : null) ?? config.listIconSize ?? 16));
  const gridIconSz = Math.max(12, Math.min(192, (liveDensity?.mode === 'grid' ? liveDensity.value : null) ?? config.gridIconSize ?? 48));
  const detailsIconSz = Math.max(12, Math.min(48, (liveDensity?.mode === 'details' ? liveDensity.value : null) ?? config.detailsIconSize ?? 20));
  const gridMetrics = useMemo(
    () => gridTileMetrics(gridIconSz, { cardChrome: config.showListGridCards === true }),
    [gridIconSz, config.showListGridCards],
  );
  const listMetrics = useMemo(() => listTileMetrics(listIconSz), [listIconSz]);
  const detailsMetrics = useMemo(() => detailsTileMetrics(detailsIconSz), [detailsIconSz]);
  const thisPcGridMetrics = useMemo(() => driveGridMetrics(gridIconSz), [gridIconSz]);
  const thisPcListMetrics = useMemo(() => driveListMetrics(listIconSz), [listIconSz]);

  useEffect(() => {
    if (!liveDensity) return;
    const committed =
      liveDensity.mode === 'grid' ? (config.gridIconSize ?? 48)
      : liveDensity.mode === 'list' ? (config.listIconSize ?? 16)
      : (config.detailsIconSize ?? 20);
    if (Number(committed) === liveDensity.value) setLiveDensity(null);
  }, [config.gridIconSize, config.listIconSize, config.detailsIconSize, liveDensity]);

  // Auto-select first item when entering a folder (settings: autoSelectFirstItem)
  const lastAutoSelectPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsRt.list.autoSelectFirst) return;
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const items = pathContentsCache[currentPath];
    if (!items?.length) return;
    if (lastAutoSelectPathRef.current === currentPath) return;
    lastAutoSelectPathRef.current = currentPath;
    setFocusedItemId(items[0].id);
    setSelectedItems([items[0].id], activePaneId);
  }, [currentPath, pathContentsCache, config.autoSelectFirstItem, activePaneId]);

  // Settings → Persist visual filters across folders (kind/tag list filters)
  const lastVisualFilterPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentPath) return;
    if (lastVisualFilterPathRef.current == null) {
      lastVisualFilterPathRef.current = currentPath;
      return;
    }
    if (lastVisualFilterPathRef.current === currentPath) return;
    lastVisualFilterPathRef.current = currentPath;
    if (config.persistVisualFiltersAcrossFolders) return;
    if (listKindFilter !== 'all') setListKindFilter('all');
    if (activeTagFilter) setActiveTagFilter(null);
  }, [currentPath, config.persistVisualFiltersAcrossFolders, listKindFilter, activeTagFilter]);

  // Select last-used subfolder when navigating into a parent (settings: selectLastUsedSubfolder)
  const lastUsedSubfolderByParentRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const parent = currentPath.replace(/\/[^/]+$/, '') || '/';
    const leaf = currentPath.split('/').filter(Boolean).pop();
    if (leaf) lastUsedSubfolderByParentRef.current[parent] = leaf;
  }, [currentPath]);
  useEffect(() => {
    if (!config.selectLastUsedSubfolder) return;
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const remembered = lastUsedSubfolderByParentRef.current[currentPath];
    if (!remembered) return;
    const items = pathContentsCache[currentPath];
    if (!items?.length) return;
    const match = items.find((e: any) => e.name === remembered || e.name === `${remembered}\\` || formatDriveRootLabel(e.name) === remembered);
    if (!match) return;
    setFocusedItemId(match.id);
    setSelectedItems([match.id], activePaneId);
  }, [currentPath, pathContentsCache, config.selectLastUsedSubfolder, activePaneId]);

  // Details view + custom columns: batch-prefetch shell metadata for first ~40 visible files.
  useEffect(() => {
    const viewMode = activeTab.viewMode || 'details';
    if (viewMode !== 'details') return;
    const cols = resolveCustomColumns(config);
    if (!cols.some(c => c.enabled)) return;
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const norm = normalizePanePath(currentPath);
    const items = pathContentsCache[currentPath] || pathContentsCache[norm];
    if (!items?.length) return;

    const paths: string[] = [];
    for (const ent of items) {
      if (!ent || ent.type === 'directory' || ent.type === 'folder') continue;
      const panePath = joinPanePath(currentPath, ent);
      if (!panePath) continue;
      paths.push(toWindowsPath(panePath));
      if (paths.length >= 40) break;
    }
    if (!paths.length) return;
    void prefetchExtendedMetadataBatch(paths);
  }, [currentPath, pathContentsCache, activeTab.viewMode, config.customColumns]);

  const scanCurrentFolderSizes = React.useCallback((
    forceRescan = false,
    opts?: { batchOffset?: number; manual?: boolean },
  ) => {
    if (!currentPath || currentPath === '/' || currentPath === '/this-pc') return;
    const items = pathContentsCacheRef.current[currentPath];
    if (!items?.length) return;

    const FOLDER_SIZE_BATCH = 12;
    const batchOffset = opts?.batchOffset ?? 0;
    const manual = !!opts?.manual;
    const allDirs = items
      .filter((e: any) => e.type === 'directory' || e.type === 'folder')
      .map((e: any) => toWindowsPath(joinPanePath(currentPath, e)));
    const dirs = allDirs.slice(batchOffset, batchOffset + FOLDER_SIZE_BATCH);
    const listingSig = `${currentPath}|${allDirs.length}`;

    if (!allDirs.length) {
      if (batchOffset === 0 && manual) setToastMessage('No folders to scan in the current directory.', 'info');
      return;
    }
    if (!dirs.length) return;

    // Auto-scan: skip when every folder already has a size in the session map.
    if (!manual && batchOffset === 0) {
      const map = folderSizeMapRef.current;
      const missing = allDirs.filter(d => map[d] == null && map[d.toLowerCase()] == null);
      if (missing.length === 0) {
        folderSizeCompletedSigRef.current = listingSig;
        return;
      }
      if (folderSizeScanSuppressedRef.current) return;
      if (folderSizeCompletedSigRef.current === listingSig) return;
      if (folderSizeScanActiveRef.current && folderSizeScanPathRef.current === currentPath) return;
    }

    if (manual) {
      folderSizeScanSuppressedRef.current = false;
      folderSizeCompletedSigRef.current = '';
    }

    if (batchOffset === 0) {
      folderSizeSessionScannedRef.current = 0;
      folderSizeScanPathRef.current = currentPath;
    }

    const gen = ++folderSizeScanGen.current;
    folderSizeScanActiveRef.current = true;
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
          scanCurrentFolderSizes(forceRescan, { batchOffset: batchOffset + FOLDER_SIZE_BATCH, manual });
          return;
        }

        folderSizeScanActiveRef.current = false;
        setFolderSizeSync(prev => prev ? {
          ...prev,
          active: false,
          current: allDirs.length,
          total: allDirs.length,
          percent: result.cancelled ? prev.percent : 100,
        } : null);

        if (result.cancelled) {
          folderSizeScanSuppressedRef.current = true;
          return;
        }

        folderSizeCompletedSigRef.current = listingSig;

        const scanned = folderSizeSessionScannedRef.current;
        const onlyFetched = config.folderSizeToastOnlyWhenFetched !== false;
        if (scanned > 0 || !onlyFetched) {
          const cooldownMs = (config.folderSizeToastCooldownSeconds ?? 90) * 1000;
          const now = Date.now();
          const allowToast = manual || (scanned > 0 && now - folderSizeToastCooldownRef.current >= cooldownMs);
          if (allowToast && (!onlyFetched || scanned > 0)) {
            folderSizeToastCooldownRef.current = now;
            const label = scanned > 0
              ? `${scanned} folder${scanned === 1 ? '' : 's'} calculated`
              : `${Object.keys(next).length} folder size${Object.keys(next).length === 1 ? '' : 's'} from cache`;
            setToastMessage(label, 'success', 'Folder sizes', { native: scanned > 0 });
          }
        }
      }).catch(() => {
        if (folderSizeScanGen.current !== gen) return;
        folderSizeScanActiveRef.current = false;
        setFolderSizeSync(null);
      });
    });
  }, [currentPath, config.folderSizeToastCooldownSeconds, config.folderSizeToastOnlyWhenFetched, setToastMessage]);

  const currentDirItems = pathContentsCache[currentPath];
  const currentDirCount = currentDirItems?.length ?? 0;
  const jobTicketOverdueMap = useJobTicketOverdueMap(currentPath, currentDirItems);
  const healthProblemMap = useHealthProblemMap(currentPath, currentDirItems);

  // Cancel in-flight scan when leaving a path — keep completed signatures so revisits skip IPC.
  useEffect(() => {
    folderSizeScanGen.current += 1;
    folderSizeScanActiveRef.current = false;
    folderSizeScanSuppressedRef.current = false;
    folderSizeScanPathRef.current = '';
    import('../lib/ipcBridge').then(({ IPC }) => IPC.cancelFolderSizeScan());
  }, [currentPath]);

  useEffect(() => {
    if (config.showCachedFolderSizesOnly) return;
    if (config.autoSyncFolderSizes === false && !config.alwaysShowFolderSizes) return;
    if (!currentDirCount) return;
    // filesHost: never contend with cold list/icon pipe storm right after navigate.
    const isFilesHost = typeof document !== 'undefined'
      && document.documentElement.dataset.bndzShell === 'files-host';
    const deferMs = isFilesHost ? 8000 : 1200;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = window.setTimeout(() => {
      const tryScan = () => {
        if (cancelled) return;
        if (getIconQueueDepth() > 6) {
          retryTimer = window.setTimeout(tryScan, 600);
          return;
        }
        scanCurrentFolderSizes(false);
      };
      tryScan();
    }, deferMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [currentPath, currentDirCount, config.alwaysShowFolderSizes, config.autoSyncFolderSizes, config.showCachedFolderSizesOnly, scanCurrentFolderSizes]);

  useEffect(() => {
    if (!config.cacheFolderSizes) return;
    if (config.alwaysShowFolderSizes && !config.showCachedFolderSizesOnly) return;
    if (!currentDirCount) return;
    // Same scheduler as above when both flags are on — skip duplicate kick.
    if (!config.showCachedFolderSizesOnly && (config.autoSyncFolderSizes !== false || config.alwaysShowFolderSizes)) return;
    const isFilesHost = typeof document !== 'undefined'
      && document.documentElement.dataset.bndzShell === 'files-host';
    const deferMs = isFilesHost ? 10000 : 1600;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = window.setTimeout(() => {
      const tryScan = () => {
        if (cancelled) return;
        if (getIconQueueDepth() > 6) {
          retryTimer = window.setTimeout(tryScan, 600);
          return;
        }
        scanCurrentFolderSizes(false);
      };
      tryScan();
    }, deferMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [currentPath, currentDirCount, config.cacheFolderSizes, config.alwaysShowFolderSizes, config.showCachedFolderSizesOnly, config.autoSyncFolderSizes, scanCurrentFolderSizes]);

  // --- External File System Watcher ---
  useEffect(() => {
    let unsubscribe: () => void;
    const softRefreshTimers = new Map<string, number>();
    const scheduleSoftRefresh = (panePath: string) => {
      const prev = softRefreshTimers.get(panePath);
      if (prev) window.clearTimeout(prev);
      softRefreshTimers.set(panePath, window.setTimeout(() => {
        softRefreshTimers.delete(panePath);
        invalidatePath(panePath);
      }, 400));
    };
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsubscribe = IPC.onFsEvents((events) => {
        const rt = buildSettingsRuntime(config);
        const transfersBusy = transferActiveCountRef.current > 0;
        // Mid-transfer list churn is opt-in via "Refresh during file operations".
        if (transfersBusy && !(rt.operations.refreshDuringOps || !!config.refreshDuringFileOperations)) return;
        const shouldRefresh = rt.operations.autoRefresh !== false
          && (rt.operations.fsNotifications !== false || config.respondToFileSystemNotifications !== false);
        if (shouldRefresh) {
          const byDir = new Map<string, typeof events>();
          for (const ev of events) {
            const panePath = watcherDirToPanePath(ev.dir || '');
            if (panePath) {
              // Auto-refresh scope: network / removable / virtual are opt-in.
              const win = String(ev.dir || '').replace(/\//g, '\\');
              const isUnc = win.startsWith('\\\\');
              const isRemovable = /\b(Removable|CDRom)\b/i.test(String((ev as any).driveType || ''));
              const isVirtual = panePath.startsWith('/shell:') || panePath.startsWith('/bndz/');
              if (isUnc && !config.includeNetworkLocations) continue;
              if (isRemovable && !config.includeRemovableDrives) continue;
              if (isVirtual && !config.includeVirtualFolders) continue;
              const list = byDir.get(panePath) || [];
              list.push(ev);
              byDir.set(panePath, list);
            }
            // RAM staging: host watches the real mount — map back to open /bndz/ram tabs.
            const winDir = (ev.dir || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
            for (const pane of panesRef.current) {
              for (const tab of pane.tabs) {
                if (!isBndzRamPath(tab.path)) continue;
                void resolveRamStagingFsPath(tab.path).then(fs => {
                  if (!fs) return;
                  const mount = fs.replace(/\\+$/, '').toLowerCase();
                  if (winDir === mount || winDir.startsWith(mount + '\\')) {
                    scheduleSoftRefresh(normalizePanePath(tab.path));
                  }
                });
              }
            }
          }
          byDir.forEach((dirEvents, panePath) => {
            const cached = pathContentsCacheRef.current[panePath];
            const { next, needsSoftRefresh } = applyFsEventsToListing(cached, dirEvents);
            if (next && next !== cached) {
              setPathContentsCache(prev => setPathCacheEntry(prev, panePath, next));
            }
            const meaningful = dirEvents.some(e => {
              const t = String(e.type || '');
              return t === 'Created' || t === 'Deleted' || t === 'Renamed';
            });
            if (meaningful && (needsSoftRefresh || !cached)) {
              scheduleSoftRefresh(panePath);
            }
          });
        }
        // Settings → Auto-refresh tags: re-fetch listing so sidecar tags re-enrich
        if (config.autoRefreshTags && config.fileTagging !== false) {
          for (const ev of events) {
            const panePath = watcherDirToPanePath(ev.dir || '');
            if (panePath && panesRef.current.some(p => p.tabs.some(t => normalizePanePath(t.path) === panePath))) {
              scheduleSoftRefresh(panePath);
            }
          }
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
    return () => {
      unsubscribe?.();
      softRefreshTimers.forEach(t => window.clearTimeout(t));
      softRefreshTimers.clear();
    };
  }, [config, invalidatePath]);

  // Monitor paths when panes change to fire native FileSystemWatcher
  useEffect(() => {
    import('../lib/ipcBridge').then(async ({ IPC }) => {
      for (const p of panes) {
        for (const t of p.tabs) {
          const path = normalizePanePath(t.path);
          if (!path || path === '/' || path === '/this-pc') continue;
          if (isBndzRamPath(path)) {
            const fs = await resolveRamStagingFsPath(path);
            if (fs) IPC.watchDirectory(fs);
            continue;
          }
          if (isBndzVirtualPath(path)) continue;
          IPC.watchDirectory(path);
        }
      }
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
          // Terminal error toasts come from FILE_TRANSFER_QUEUE_CHANGED (avoids Deleted+Failed doubles).
          return;
        }

        const meta = xferMetaRef.current.get(opId);
        const fileName = (progressDetails.currentFile || '').split(/[/\\]/).pop() || meta?.label || 'items';
        const isArchiveOp = opId.startsWith('archive-');
        const isExtractOp = opId.startsWith('extract-');
        const verb = isArchiveOp ? 'Compressing' : isExtractOp ? 'Extracting'
          : meta?.op === 'delete' ? 'Deleting'
          : meta?.op === 'move' ? 'Moving' : meta?.op === 'copy' ? 'Copying' : 'Transferring';
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
        // Terminal success/failure toasts come from FILE_TRANSFER_QUEUE_CHANGED (job status).
        // Never treat percentage>=100 as success — failures used to post 100 and lied to the UI.
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
  const [meshExpanded, setMeshExpanded] = useState(false);
  const [meshHosts, setMeshHosts] = useState<MeshHost[]>([]);
  const [linuxExpanded, setLinuxExpanded] = useState(false);
  const [librariesExpanded, setLibrariesExpanded] = useState(true);
  const [destinationPicker, setDestinationPicker] = useState<{ mode: 'copy' | 'move'; sources: string[] } | null>(null);
  const [tabFileDropTarget, setTabFileDropTarget] = useState<{ paneId: string; tabIndex: number } | null>(null);
  /** During pointer file drag — drives list + tab chrome to hovered tab before drop. */
  const [fileDragListPreview, setFileDragListPreview] = useState<{ paneId: string; tabIndex: number } | null>(null);
  const [newTabDropPaneId, setNewTabDropPaneId] = useState<string | null>(null);
  const tabFileDragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabFileDragHoverRef = useRef<{ paneId: string; tabIndex: number } | null>(null);
  const [favoriteReorderGhost, setFavoriteReorderGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const favoriteDragLiveRef = useRef<{ sourcePath: string; overPath: string | null; insertAfter: boolean } | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);

  const beginFavoriteReorder = React.useCallback((qaPath: string, label: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    favoriteDragLiveRef.current = { sourcePath: qaPath, overPath: null, insertAfter: false };

    const findDropTarget = (clientY: number) => {
      const rows = Array.from(document.querySelectorAll('[data-favorite-path]'));
      for (const row of rows) {
        const el = row as HTMLElement;
        const path = el.getAttribute('data-favorite-path');
        if (!path || path === qaPath) continue;
        const rect = el.getBoundingClientRect();
        if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
          return { overPath: path, insertAfter: clientY > rect.top + rect.height / 2 };
        }
      }
      return { overPath: null as string | null, insertAfter: false };
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragging = true;
      }
      const target = findDropTarget(ev.clientY);
      favoriteDragLiveRef.current = { sourcePath: qaPath, ...target };
      setFavoriteDrag({ sourcePath: qaPath, ...target });
      setFavoriteReorderGhost({ x: ev.clientX, y: ev.clientY, label });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setFavoriteReorderGhost(null);
      const live = favoriteDragLiveRef.current;
      favoriteDragLiveRef.current = null;
      setFavoriteDrag(null);
      if (!dragging || !live?.overPath || live.sourcePath === live.overPath) return;
      const items = [...rapidAccessItemsRef.current];
      const fromIdx = items.findIndex(i => normalizePanePath(i.path) === live.sourcePath);
      const toIdx = items.findIndex(i => normalizePanePath(i.path) === live.overPath);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = [...items];
      const [moved] = reordered.splice(fromIdx, 1);
      let insertAt = toIdx;
      if (fromIdx < toIdx) insertAt -= 1;
      if (live.insertAfter) insertAt += 1;
      reordered.splice(Math.max(0, Math.min(insertAt, reordered.length)), 0, moved);
      const rapidAccessOrder = reordered.map(i =>
        knownFolderDedupeKey(i.path, shortcuts) || normalizePanePath(i.path).replace(/\\/g, '/').toLowerCase(),
      );
      const pinPaths = reordered.filter(i => !i.isDefault).map(i => normalizePanePath(i.path));
      const pinned = [...(config.pinnedFavorites || [])];
      const sortedPins = pinPaths
        .map(p => pinned.find((pf: { path?: string }) => normalizePanePath(pf.path || '') === p))
        .filter(Boolean) as typeof pinned;
      const remainingPins = pinned.filter((pf: { path?: string }) =>
        !pinPaths.includes(normalizePanePath(pf.path || '')),
      );
      updateConfig({
        rapidAccessOrder,
        pinnedFavorites: dedupePinnedFavorites([...sortedPins, ...remainingPins], shortcuts),
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [config.pinnedFavorites, shortcuts, updateConfig]);

  useEffect(() => {
    if (!IPC.isNative) return;
    IPC.meshListHosts().then(list => {
      setMeshHosts((list as Record<string, unknown>[]).map(normalizeMeshHost));
    }).catch(() => {});
    return IPC.onMeshHostsChanged((list) => {
      setMeshHosts((list as Record<string, unknown>[]).map(normalizeMeshHost));
    });
  }, []);

  useEffect(() => {
    const onOpenConfig = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setConfigInitialTab(tab);
      setIsConfigDialogOpen(true);
    };
    window.addEventListener('bndz-open-configuration', onOpenConfig);
    return () => window.removeEventListener('bndz-open-configuration', onOpenConfig);
  }, []);

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
    const items: { label: string; path: string; iconPath?: string; isDynamic: boolean; leaf?: boolean; useShellIcon: boolean; icon: string; iconColor: string }[] = [];

    const add = (name: string, rawPath: string) => {
      const p = collapseKnownFolderShadowPath(
        resolveShellKnownFolderToFs(toPanePath(rawPath), shortcuts),
        shortcuts,
      );
      if (seen.has(p.toLowerCase())) return;
      seen.add(p.toLowerCase());
      items.push({
        label: name,
        path: p,
        // Navigate via FS path; icon via shell: known-folder (avoids yellow generic glyphs).
        iconPath: KNOWN_FOLDER_SHELL[name]
          ? `/${KNOWN_FOLDER_SHELL[name]}`
          : p,
        // Navigate-only under Libraries — expanding here surfaced a nested
        // "Desktop" folder (Desktop\Desktop) that shadowed the known folder.
        isDynamic: false,
        leaf: true,
        useShellIcon: true,
        icon: 'folder_open_ui',
        iconColor: '#38bdf8',
      });
    };

    for (const name of order) {
      const s = shortcuts.find(sc => sc.name === name);
      const shellKey = KNOWN_FOLDER_SHELL[name];
      // Prefer real FS paths from GET_SYSTEM_SHORTCUTS so the address bar shows
      // C:\Users\…\Desktop instead of shell:Desktop.
      add(name, s?.path || (shellKey ? `/${shellKey}` : `C:/Users/${windowsUsername}/${name}`));
    }
    if (galleryShortcut?.path) add('Gallery', galleryShortcut.path);
    return items;
  }, [shortcuts, windowsUsername, galleryShortcut]);

  /** List-pane entities for Libraries — same known folders as the tree (shell enum often returns blank names). */
  const libraryListEntities = useMemo(() => (
    libraryFolderItems.map(item => ({
      id: item.path,
      name: item.label,
      type: 'directory' as const,
      path: item.path,
      size: 0,
      isVirtual: true,
      isShellItem: true,
    }))
  ), [libraryFolderItems]);

  const cloudNav = useMemo(() => groupCloudProvidersForNav(cloudProviders, drives), [cloudProviders, drives]);
  const cloudDriveItems = useMemo(() => (
    cloudNav.navItems.map(item => ({
      label: item.label,
      path: item.path,
      isDynamic: !item.isHub,
      useShellIcon: true,
      icon: item.icon,
      iconColor: item.iconColor,
      syncStatus: item.syncStatus,
      leaf: !!item.isHub,
      shellIconPath: item.shellIconPath || item.path,
      onClick: item.isHub ? () => setCurrentPath(GOOGLE_DRIVE_HUB_PATH) : undefined,
    }))
  ), [cloudNav]);

  /** Drives shown in This PC / tree / letter bar — exclude dedicated cloud volume letters only,
   *  and also exclude any drive letters currently mounted as RAM staging zones. */
  const navigationDrives = useMemo(() => {
    const ramLetters = new Set(
      sidebarRamZones
        .map(z => z.driveLetter?.toUpperCase().replace(/[^A-Z]/g, ''))
        .filter(Boolean) as string[],
    );
    return drives.filter(d => {
      if (isCloudOwnedDrive(d)) return false;
      if (ramLetters.size === 0) return true;
      const letter = (d.name || '').replace(/^\/+/, '').replace(/[^A-Za-z:]/g, '').toUpperCase();
      // letter is "C:" — check both with and without colon
      const letterOnly = letter.replace(':', '');
      return !ramLetters.has(letter) && !ramLetters.has(letterOnly);
    });
  }, [drives, sidebarRamZones]);

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
    const maxPinsRaw = config.listHoverFadeMs;
    const maxPins = !maxPinsRaw || maxPinsRaw === 'Unlimited'
      ? Infinity
      : (parseInt(String(maxPinsRaw), 10) || 12);
    const pins = dedupePinnedFavorites(config.pinnedFavorites || [], shortcuts)
      .slice(0, maxPins === Infinity ? undefined : maxPins)
      .map((p: any) => ({
      name: p.label || p.name,
      path: collapseKnownFolderShadowPath(
        resolveShellKnownFolderToFs(normalizePanePath(p.path), shortcuts),
        shortcuts,
      ),
      iconPath: p.iconPath,
      isDefault: false,
    }));
    return orderRapidAccessItems(mergeRapidAccessItems(pins, defaults, shortcuts), config.rapidAccessOrder, shortcuts);
  }, [config.pinnedFavorites, config.hiddenRapidAccess, config.listHoverFadeMs, config.rapidAccessOrder, shortcuts, windowsUsername, galleryShortcut]);

  const rapidAccessItemsRef = useRef(rapidAccessItems);
  rapidAccessItemsRef.current = rapidAccessItems;

  // Once system shortcuts load, rewrite open tabs still on /shell:Desktop etc. to real FS paths.
  useEffect(() => {
    if (!shortcuts.length) return;
    setPanes(prev => {
      let changed = false;
      const next = prev.map(p => ({
        ...p,
        tabs: p.tabs.map(t => {
          const resolved = collapseKnownFolderShadowPath(
            resolveShellKnownFolderToFs(t.path, shortcuts),
            shortcuts,
          );
          if (resolved === t.path) return t;
          changed = true;
          return { ...t, path: resolved };
        }),
      }));
      return changed ? next : prev;
    });
  }, [shortcuts]);

  // Scrub pinned Rapid Access entries that point at Desktop\Desktop (etc.) shadows.
  useEffect(() => {
    if (!shortcuts.length) return;
    const pinned = config.pinnedFavorites || [];
    if (!pinned.length) return;
    const next = dedupePinnedFavorites(pinned, shortcuts);
    const before = pinned.map((p: any) => normalizePanePath(p.path || '').replace(/\\/g, '/').toLowerCase()).join('|');
    const after = next.map(p => p.path.replace(/\\/g, '/').toLowerCase()).join('|');
    if (before !== after) updateConfig({ pinnedFavorites: next });
  }, [shortcuts]);

  useEffect(() => {
    if (wslDistroNodes.length > 0) setLinuxExpanded(true);
  }, [wslDistroNodes.length]);

  // Tier-1 sidebar: live RAM zones for nav tree.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!IPC.isNative) return;
      void IPC.ramStagingListZones().then(r => {
        if (cancelled) return;
        const zones = (Array.isArray(r.zones) ? r.zones : []).map((z: any) => ({
          id: String(z.id ?? z.Id ?? ''),
          name: String(z.name ?? z.Name ?? z.id ?? 'Zone'),
          isDirty: !!(z.isDirty ?? z.IsDirty),
          driveLetter: z.driveLetter ?? z.DriveLetter ?? undefined,
        })).filter(z => z.id);
        setSidebarRamZones(prev => {
          if (
            prev.length === zones.length
            && prev.every((p, i) => p.id === zones[i].id && p.name === zones[i].name && p.isDirty === zones[i].isDirty && p.driveLetter === zones[i].driveLetter)
          ) {
            return prev;
          }
          return zones;
        });
      }).catch(() => { /* optional */ });
    };
    refresh();
    window.addEventListener('bndz-ram-zone-changed', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('bndz-ram-zone-changed', refresh);
    };
  }, []);

  // Work Intent: folder `.bndz-intent` contract on navigate (never omnibar).
  // Path-only deps + refs — avoid updateConfig/openBottomPlugin identity storms.
  const workIntentIdRef = useRef(config.workIntentId || 'browse');
  workIntentIdRef.current = config.workIntentId || 'browse';
  const updateConfigRef = useRef(updateConfig);
  updateConfigRef.current = updateConfig;
  const openBottomPluginRef = useRef(openBottomPlugin);
  openBottomPluginRef.current = openBottomPlugin;
  const setToastMessageRef = useRef(setToastMessage);
  setToastMessageRef.current = setToastMessage;

  const activePanePath = (() => {
    const pane = panes.find(p => p.id === activePaneId) || panes[0];
    return pane?.tabs[pane.activeTabIndex]?.path || '';
  })();

  useEffect(() => {
    const path = activePanePath;
    if (!path || path === lastFolderIntentRef.current) return;
    lastFolderIntentRef.current = path;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const intentId = await readFolderIntentContract(path);
          if (cancelled || !intentId) return;
          if (workIntentIdRef.current === intentId) return;
          const { patch, toast } = applyWorkIntentPack(intentId, {
            fromContract: true,
            installedPluginIds: installedPluginIdSet,
          });
          updateConfigRef.current(patch);
          setToastMessageRef.current(toast);
          // Do not auto-open/install plugins on navigate — that chained ensurePluginInstalled
          // → updateConfig → shell apply and contributed to host freezes.
        } catch {
          /* contract optional */
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activePanePath]);

  const treeData = useMemo(() => {
    const raw: NavTreeBuildNode[] = [
      {
        treeKey: 'continuum-home',
        draggable: true,
        label: 'Home',
        path: BNDZ_HOME,
        // Continuum Home is virtual (/bndz/home) — fetch the Windows Profile/Home shell glyph.
        iconPath: KNOWN_FOLDER_SHELL.Home,
        icon: 'home',
        iconColor: '#7eb8e8',
        useShellIcon: true,
        onClick: () => setCurrentPath(BNDZ_HOME),
      },
      {
        treeKey: 'profile',
        draggable: true,
        label: (windowsUsername && windowsUsername !== 'Public') ? windowsUsername : 'Profile',
        path: homeTreePath,
        iconPath: homeTreePath,
        icon: 'home',
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
        treeKey: 'control-panel',
        draggable: true,
        label: 'Control Panel',
        path: CONTROL_PANEL_PATH,
        iconPath: SHELL_CLSID.controlPanel,
        icon: 'control_panel',
        iconColor: '#6db4e6',
        useShellIcon: true,
        leaf: true,
        onClick: () => setCurrentPath(CONTROL_PANEL_PATH),
      },
      {
        treeKey: 'smart-views',
        draggable: true,
        label: 'Smart views',
        path: BNDZ_VIEWS_ROOT,
        icon: 'sparkles_ui',
        iconColor: '#0078d4',
        // Virtual /bndz paths are not shell namespace items — shell fetch → white file placeholders.
        useShellIcon: false,
        expanded: smartViewsExpanded,
        onClick: () => setCurrentPath(BNDZ_VIEWS_ROOT),
        onToggle: () => setSmartViewsExpanded(!smartViewsExpanded),
        childrenItems: [
          ...(['recent', 'media', 'audio', 'documents', 'large'] as const).map(view => ({
            label: bndzVirtualLabel(view),
            path: bndzVirtualPath(view),
            useShellIcon: false as const,
            icon: view === 'recent' ? 'clock_ui'
              : view === 'media' ? 'film_ui'
              : view === 'audio' ? 'music_ui'
              : view === 'documents' ? 'file_ui'
              : 'hard_drive_ui',
            iconColor: view === 'recent' ? '#fbbf24'
              : view === 'media' ? '#7eb8e8'
              : view === 'audio' ? '#34d399'
              : view === 'documents' ? '#60a5fa'
              : '#a78bfa',
          })),
          { label: 'Problems', path: BNDZ_PROBLEMS, icon: 'warning', iconColor: '#f59e0b', useShellIcon: false as const },
          { label: 'Inbound', path: BNDZ_INBOUND, icon: 'download_ui', iconColor: '#60a5fa', useShellIcon: false as const },
          { label: 'Time Diff', path: BNDZ_TEMPORAL_DIFF, icon: 'clock_ui', iconColor: '#38bdf8', useShellIcon: false as const },
        ],
      },
      {
        treeKey: 'spatial-canvas',
        draggable: true,
        label: 'Spatial Canvas',
        path: BNDZ_CANVAS,
        icon: 'view_grid',
        iconColor: '#c4a35a',
        useShellIcon: false,
        onClick: () => setCurrentPath(BNDZ_CANVAS),
      },
      {
        treeKey: 'automation',
        draggable: true,
        label: 'Automation',
        path: BNDZ_AUTOMATION,
        icon: 'zap_ui',
        iconColor: '#fbbf24',
        useShellIcon: false,
        onClick: () => setCurrentPath(BNDZ_AUTOMATION),
      },
      ...(installedPluginIdSet.has('ram-staging') && sidebarRamZones.length > 0
        ? [{
            treeKey: 'ram-staging',
            draggable: true as const,
            label: 'RAM Staging',
            path: BNDZ_RAM_ROOT,
            icon: 'hard_drive_ui',
            iconColor: '#a78bfa',
            useShellIcon: false as const,
            expanded: ramStagingExpanded,
            onClick: () => setCurrentPath(BNDZ_RAM_ROOT),
            onToggle: () => setRamStagingExpanded(!ramStagingExpanded),
            childrenItems: sidebarRamZones.map(z => ({
              label: z.isDirty ? `${z.name} · dirty` : z.name,
              path: bndzRamVirtualPath(z.id),
              icon: 'hard_drive_ui',
              iconColor: z.isDirty ? '#fbbf24' : '#a78bfa',
              useShellIcon: false as const,
            })),
          }]
        : []),
      ...(config.ghostLinkColdStorageRoot
        ? [{
            treeKey: 'ghost-cold',
            draggable: true as const,
            label: 'Ghost cold',
            path: toPanePath(config.ghostLinkColdStorageRoot),
            icon: 'emblem-symbolic-link',
            iconColor: '#c4b5fd',
            useShellIcon: false as const,
            expanded: ghostColdExpanded,
            onClick: () => guardedSetCurrentPath(toPanePath(config.ghostLinkColdStorageRoot)),
            onToggle: () => setGhostColdExpanded(!ghostColdExpanded),
            childrenItems: [] as { label: string; path: string; icon: string; iconColor: string }[],
          }]
        : []),
      {
        treeKey: 'this-pc',
        draggable: true,
        label: 'This PC',
        path: '/',
        iconPath: SHELL_CLSID.thisPc,
        icon: 'this_pc',
        iconColor: '#6db4e6',
        useShellIcon: false,
        expanded: thisPcExpanded,
        selected: currentPath === '/',
        onClick: () => setCurrentPath('/'),
        onToggle: () => setThisPcExpanded(!thisPcExpanded),
        childrenItems: navigationDrives.map(d => ({
          label: formatDriveDisplayName(d.label, d.name),
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
      ...(config.meshShowInNavTree !== false && meshHosts.some(h => h.showInNavTree !== false) ? [{
        treeKey: 'remote-mesh',
        draggable: true,
        label: 'Remote Mesh',
        path: MESH_ROOT,
        icon: 'cloud_ui',
        iconColor: '#38bdf8',
        useShellIcon: false,
        expanded: meshExpanded,
        selected: currentPath === MESH_ROOT || currentPath.startsWith(`${MESH_ROOT}/`),
        onClick: () => guardedSetCurrentPath(MESH_ROOT),
        onToggle: () => setMeshExpanded(!meshExpanded),
        childrenItems: meshHosts
          .filter(h => h.showInNavTree !== false)
          .map(h => ({
            label: h.alias,
            path: buildMeshPath(h.id, h.remoteRootPath || '/'),
            icon: h.provider === 1 ? 'cloud_ui' : 'server_ui',
            iconColor: h.state === 2 ? '#34d399' : '#38bdf8',
            useShellIcon: false,
          })),
      } as NavTreeBuildNode] : []),
      {
        treeKey: 'recycle-bin',
        draggable: true,
        label: 'Recycle Bin',
        path: RECYCLE_BIN_PATH,
        iconPath: SHELL_CLSID.recycleBin,
        icon: 'go_recycle_bin',
        iconColor: '#c084fc',
        useShellIcon: true,
        leaf: true,
        selected: isRecycleBinPath(currentPath),
        onClick: () => guardedSetCurrentPath(RECYCLE_BIN_PATH),
      },
    ];
    // Deduplicate nodes with the same treeKey (safety guard for ram-staging and any conditional nodes).
    const seen = new Set<string>();
    const deduped = raw.filter(n => {
      if (!n.treeKey || !seen.has(n.treeKey)) {
        if (n.treeKey) seen.add(n.treeKey);
        return true;
      }
      return false;
    });
    const keys = deduped.map(n => n.treeKey).filter(Boolean) as string[];
    const order = mergeNavTreeOrder(config.navTreeOrder, keys);
    return applyNavTreeOrder(deduped, order);
  }, [
    drives, navigationDrives, currentPath, thisPcExpanded, libraryFolderItems,
    networkOnlyNodes, networkExpanded, homeTreePath, wslLinuxPath,
    wslRootNode, wslDistroNodes,
    linuxExpanded, librariesExpanded, smartViewsExpanded, config.navTreeOrder,
    config.meshShowInNavTree, meshHosts, meshExpanded,
    ramStagingExpanded, ghostColdExpanded, sidebarRamZones, config.ghostLinkColdStorageRoot,
    installedPluginIdSet,
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
    const tabLimits = getTabLimitBehavior(config);
    if (isDualPane) {
       if (tabLimits.alwaysKeep1stPaneVisible && panes.length >= 2) {
         // Keep pane 1 (first) visible — collapse by removing the inactive/other pane only.
         const keep = panes[0] || activePane;
         setPanes([keep]);
         setActivePaneId(keep.id);
         setIsDualPane(false);
         updateConfig({ dualPaneOpen: false });
         return;
       }
       setPanes([activePane]);
       setIsDualPane(false);
       updateConfig({ dualPaneOpen: false });
    } else {
       setPanes([panes[0], { 
         id: `pane-${Date.now()}`, 
         tabs: [{ id: `t-${Date.now()}`, path: '/workspace', history: ['/workspace'], historyIndex: 0, selectedItems: [], viewMode: undefined }],
         activeTabIndex: 0,
         sortColumn: ((config.listSortColumn as SortColumnId) || 'name'),
         sortDirection: config.listSortDirection === 'desc' ? 'desc' : 'asc',
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
    const el = e.currentTarget;
    const top = el.scrollTop;
    if (config.adaptiveListDensity !== false) {
      onAdaptiveListScroll(top);
    }
    listScrollTopsRef.current[paneId] = top;
    markIconQueueScrolling();

    const meta = stickyScrollMetaRef.current[paneId];
    if (meta?.enabled && meta.rows?.length) {
      const sticky = resolveStickyGroupHeader(meta.rows, top, meta.rowHeight);
      const identity = sticky
        ? `${sticky.header.label}|${sticky.header.count}|${sticky.index}`
        : '';
      if (stickyHeaderKeysRef.current[paneId] !== identity) {
        stickyHeaderKeysRef.current[paneId] = identity;
        // Coalesce sticky-header React updates to one/frame during fast flings.
        const pending = stickyHeaderPendingRef.current ?? (stickyHeaderPendingRef.current = {});
        pending[paneId] = identity;
        if (!stickyHeaderRafRef.current) {
          stickyHeaderRafRef.current = requestAnimationFrame(() => {
            stickyHeaderRafRef.current = 0;
            const batch = stickyHeaderPendingRef.current;
            stickyHeaderPendingRef.current = null;
            if (!batch) return;
            setStickyHeaderKeys(prev => {
              let next = prev;
              for (const [id, key] of Object.entries(batch)) {
                if (next[id] === key) continue;
                if (next === prev) next = { ...prev };
                next[id] = key;
              }
              return next;
            });
          });
        }
      }
    }

    if (!isDualPane || config.syncDualPaneScroll === false) return;
    if (paneScrollSyncRef.current) return;
    paneScrollSyncRef.current = true;
    if (paneScrollSyncRafRef.current) cancelAnimationFrame(paneScrollSyncRafRef.current);
    paneScrollSyncRafRef.current = requestAnimationFrame(() => {
      paneScrollSyncRafRef.current = 0;
      const syncTop = listScrollTopsRef.current[paneId] ?? top;
      for (const [id, other] of Object.entries(paneScrollElsRef.current)) {
        if (id === paneId || !other) continue;
        if (Math.abs(other.scrollTop - syncTop) < 1) continue;
        other.scrollTop = syncTop;
      }
      // Keep the guard through the synced panes' scroll events.
      requestAnimationFrame(() => {
        paneScrollSyncRef.current = false;
      });
    });
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
      // Settings → Remember permanent variables
      setPermanentVariable: (name, value) => {
        const current = normalizePermanentVariables(config.permanentVariables);
        updateConfig({
          permanentVariables: setPermanentVariable(current, name, value),
          rememberPermanentVariables: config.rememberPermanentVariables !== false ? config.rememberPermanentVariables : true,
        });
      },
      clearPermanentVariable: (name) => {
        const current = normalizePermanentVariables(config.permanentVariables);
        updateConfig({ permanentVariables: deletePermanentVariable(current, name) });
      },
      listPermanentVariables: () => normalizePermanentVariables(config.permanentVariables),
    });
  };

  const getSelectedEntities = (): any[] => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return [];
    const tab = pane.tabs[pane.activeTabIndex];
    const dir = pathContentsCache[tab.path] || pathContentsCache[normalizePanePath(tab.path)] || [];
    return tab.selectedItems
      .map(id => dir.find((x: any) => x.id === id))
      .filter(Boolean);
  };

  const getSelectedEntityPaths = (): string[] => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return [];
    const tab = pane.tabs[pane.activeTabIndex];
    return getSelectedEntities().map((ent: any) => {
      if (ent.fsPath) return ent.fsPath;
      if (ent.path) return normalizePanePath(ent.path);
      return joinPanePath(tab.path, ent);
    });
  };

  const pasteIntoActivePane = (opts?: Parameters<typeof executePaste>[1]) => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return Promise.resolve();
    const tab = pane.tabs[pane.activeTabIndex];
    const dest = resolvePasteDestination(config, tab.path, getSelectedEntities());
    return executePaste(dest, opts);
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
    if (rt.shell.confirmMove || !!config.confirmCopyAndMoveOperations) {
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
    xferMetaRef.current.set(opId, {
      op: mode,
      label,
      selectParentPath: mode === 'move' && config.selectParentOfMovedFolder
        ? normalizePanePath(sources[0].replace(/[/\\][^/\\]+$/, '') || '/')
        : undefined,
    });
    const winSources = await Promise.all(sources.map(async s => {
      if (isBndzRamPath(s)) return (await resolvePanePathForFs(s)) || toWindowsPath(s);
      return toWindowsPath(s);
    }));
    if (mode === 'move') {
      const names = sources.map(s => s.split(/[/\\]/).pop() || '').filter(Boolean);
      const sourceParents = [...new Set(sources.map(s => normalizePanePath(s.replace(/[/\\][^/\\]+$/, '') || '/')))];
      const snapEntities: any[] = [];
      for (const parent of sourceParents) {
        const listing = pathContentsCacheRef.current[parent] ?? [];
        for (const e of listing) {
          if (names.includes(e.name)) snapEntities.push(e);
        }
      }
      registerFsTombstone(opId, 'move', sourceParents[0] || null, names, winSources, snapEntities);
      setPathContentsCache(prev => {
        let next = prev;
        for (const parent of sourceParents) {
          const existing = next[parent];
          if (!existing) continue;
          next = setPathCacheEntry(next, parent, existing.filter((e: any) => !names.includes(e.name)));
        }
        return next;
      });
    }
    if (!fileOpsRt.showTransferPanel) {
      pushToast({
        id: `xfer-${opId}`,
        kind: 'progress',
        title: mode === 'copy' ? 'Copying…' : 'Moving…',
        message: label,
        sticky: true,
      });
    }
    const winDest = (await resolvePanePathForFs(dest)).replace(/\\$/, '');
    void IPC.executeFsOperation(opId, mode, winSources, winDest, false, label, 'high').then(res => {
      if (!isQueuedIpcResult(res)) refreshWorkspace();
    });
  };

  const openFolderContentsPeek = async (
    folderPath: string,
    folderName: string,
    clientX: number,
    clientY: number,
  ) => {
    // Settings → Folder contents preview (+ In list / In tree + mouse-up buttons)
    if (!config.folderContentsPreview) return;
    try {
      const items = await IPC.getDirContents(folderPath);
      const sortBy = String(config.folderContentsPreviewSortedBy || 'Name').toLowerCase();
      const entries = (items || [])
        .map((it: any) => ({
          name: String(it.name || ''),
          isDir: it.type === 'directory' || !!it.isDirectory,
          size: Number(it.size) || 0,
          mtime: Number(it.modified || it.lastWriteTime || 0),
          ext: String(it.extension || it.name || '').split('.').pop() || '',
        }))
        .filter((it: { name: string }) => !!it.name)
        .sort((a: any, b: any) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          if (sortBy === 'size') return b.size - a.size || a.name.localeCompare(b.name);
          if (sortBy === 'date') return b.mtime - a.mtime || a.name.localeCompare(b.name);
          if (sortBy === 'type') return a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name);
          return a.name.localeCompare(b.name);
        })
        .slice(0, 80)
        .map((it: any) => ({ name: it.name, isDir: it.isDir }));
      setFolderContentsPeek({
        x: clientX,
        y: clientY,
        path: toWindowsPath(folderPath),
        name: folderName,
        entries,
      });
    } catch {
      setFolderContentsPeek({
        x: clientX,
        y: clientY,
        path: toWindowsPath(folderPath),
        name: folderName,
        entries: [],
      });
    }
  };

  const executeInternalDrop = (
    op: 'copy' | 'move',
    sourcePaths: string[],
    destPath: string,
    sourcePath?: string,
  ) => {
    void (async () => {
      const rt = buildSettingsRuntime(config);
      const canonSources = sourcePaths.map(canonicalDropPath).filter(Boolean);
      const destCanon = canonicalDropPath(destPath);
      const route = resolveDropRoute(op, canonSources, destCanon);
      const isMeshDropSend = route.kind === 'mesh-drop-send';

      if (rt.shell.confirmMove && op === 'move' && route.kind === 'local') {
        const labelPreview = canonSources.length === 1
          ? (canonSources[0].split(/[/\\]/).pop() || 'item')
          : `${canonSources.length} items`;
        const approved = await confirm({
          title: `Move ${canonSources.length === 1 ? 'Item' : 'Items'}`,
          message: `Move ${labelPreview} to ${destCanon}?`,
          type: 'warning',
          confirmLabel: 'Move',
        });
        if (!approved) return;
      } else if (intentRequiresStrictConfirm(config) && op === 'move' && route.kind === 'local') {
        const labelPreview = canonSources.length === 1
          ? (canonSources[0].split(/[/\\]/).pop() || 'item')
          : `${canonSources.length} items`;
        const approved = await confirm({
          title: 'Intent · strict confirm',
          message: `Archive/Clean intent requires confirm before moving ${labelPreview} to ${destCanon}.`,
          type: 'warning',
          confirmLabel: 'Move',
        });
        if (!approved) return;
      }

      const opId = `drop-int-${Date.now()}`;
      const label = canonSources.length === 1
        ? (canonSources[0].split(/[/\\]/).pop() || 'item')
        : `${canonSources.length} items`;
      const meshOp = route.kind === 'mesh-replicate' || route.kind === 'mesh-relay'
        ? ((route as { move?: boolean }).move ? 'move' : 'copy')
        : route.kind === 'mesh-upload' || route.kind === 'mesh-download' ? op : op;
      xferMetaRef.current.set(opId, {
        op: meshOp,
        label,
        selectParentPath: op === 'move' && config.selectParentOfMovedFolder && sourcePath
          ? normalizePanePath(sourcePath)
          : undefined,
      });
      const verb = route.kind === 'mesh-upload' ? 'Uploading'
        : route.kind === 'mesh-download' ? 'Downloading'
        : route.kind === 'mesh-relay' ? 'Relaying'
        : route.kind === 'mesh-replicate' ? (meshOp === 'move' ? 'Moving' : 'Copying')
        : isMeshDropSend ? 'Mesh Drop'
        : op === 'copy' ? 'Copying' : 'Moving';
      if (!isMeshDropSend && !fileOpsRt.showTransferPanel) {
        pushToast({
          id: `xfer-${opId}`,
          kind: 'progress',
          title: `${verb}…`,
          message: label,
          sticky: true,
        });
      } else if (isMeshDropSend) {
        // Mesh Drop opens the pairing dialog — no fake progress toast.
        dismissToast(`xfer-${opId}`);
      }

      if (route.kind !== 'local') {
        const result = await executeMeshTransfer({ operationId: opId, route, sourcePaths: canonSources });
        if (!result.ok) {
          dismissToast(`xfer-${opId}`);
          pushToast({ kind: 'error', title: `${verb} failed`, message: result.error || label });
        } else if (isMeshDropSend) {
          pushToast({ kind: 'info', title: 'Mesh Drop', message: 'Pairing dialog opened — share the Mesh Code with your peer.' });
        }
        return;
      }

      // Budget governor — soft warn / hard block before local copy/move lands.
      try {
        if (IPC.isNative) {
          let incomingBytes = 0;
          for (const src of canonSources) {
            const srcNorm = normalizePanePath(src);
            let ent = findEntityInCache(pathContentsCache, srcNorm)
              || findEntityInCache(pathContentsCache, src);
            if (!ent) {
              for (const items of Object.values(pathContentsCache)) {
                const hit = items?.find((i: any) =>
                  normalizePanePath(i?.path || i?.id || '') === srcNorm);
                if (hit) { ent = hit; break; }
              }
            }
            if (ent) incomingBytes += Number(ent.size) || 0;
          }
          const check = await IPC.budgetGovernorCheck(destCanon, incomingBytes);
          if (check.hardBlock) {
            dismissToast(`xfer-${opId}`);
            pushToast({
              kind: 'error',
              title: 'Budget governor blocked drop',
              message: check.message || 'Hard quota would be exceeded on this volume.',
            });
            return;
          }
          if (check.softWarning) {
            pushToast({
              kind: 'warning',
              title: 'Approaching volume budget',
              message: check.message || 'Soft quota warning for this volume.',
            });
          }

          const winSources = canonSources.map(s => toWindowsPath(s));
          const policy = await IPC.policyPackValidate(toWindowsPath(destCanon), winSources);
          if (policy.ok && policy.allowed === false) {
            dismissToast(`xfer-${opId}`);
            const msg = policy.violations?.[0]?.message
              || `Policy pack '${policy.packName || 'pack'}' blocked this drop.`;
            pushToast({
              kind: 'error',
              title: 'Policy pack blocked drop',
              message: msg,
            });
            return;
          }
        }
      } catch {
        /* governor / policy optional — never block drops on IPC failure */
      }

      // Drop onto RAM zone root → stage API (preserves folder trees into the mount).
      const ramZoneId = parseBndzRamZoneId(destCanon);
      const ramZoneRoot = ramZoneId ? bndzRamVirtualPath(ramZoneId) : null;
      if (ramZoneId && ramZoneRoot && normalizePanePath(destCanon) === ramZoneRoot) {
        const winSources = await Promise.all(canonSources.map(async s => {
          if (isBndzRamPath(s)) return (await resolvePanePathForFs(s)) || toWindowsPath(s);
          return toWindowsPath(s);
        }));
        try {
          const r = await IPC.ramStagingStagePaths(ramZoneId, winSources);
          dismissToast(`xfer-${opId}`);
          if ((r as { ok?: boolean }).ok === false) {
            throw new Error((r as { error?: string }).error || 'Stage failed');
          }
          pushToast({ kind: 'success', title: op === 'move' ? 'Moved to zone' : 'Staged to zone', message: label });
          invalidateRamZoneMountCache();
          window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: ramZoneRoot } }));
        } catch (e) {
          dismissToast(`xfer-${opId}`);
          const msg = e instanceof Error ? e.message : String(e);
          const partial = /^Staged \d+ of \d+/.test(msg);
          pushToast({
            kind: partial ? 'warning' : 'error',
            title: partial ? 'Staging partial' : 'Staging failed',
            message: msg,
          });
          if (partial) {
            invalidateRamZoneMountCache();
            window.dispatchEvent(new CustomEvent('bndz-refresh-path', { detail: { path: ramZoneRoot } }));
          }
        }
        return;
      }

      const destWin = await resolvePanePathForFs(destCanon);
      const resolvedSources = await Promise.all(canonSources.map(async s => {
        if (isBndzRamPath(s)) return (await resolvePanePathForFs(s)) || toWindowsPath(s);
        return toWindowsPath(s);
      }));
      if (op === 'move') {
        const names = canonSources.map(s => s.split(/[/\\]/).pop() || '').filter(Boolean);
        const sourceParents = [...new Set(
          (sourcePath ? [normalizePanePath(sourcePath)] : [])
            .concat(canonSources.map(s => normalizePanePath(s.replace(/[/\\][^/\\]+$/, '') || '/'))),
        )];
        const snapEntities: any[] = [];
        for (const parent of sourceParents) {
          const listing = pathContentsCacheRef.current[parent] ?? [];
          for (const e of listing) {
            if (names.includes(e.name)) snapEntities.push(e);
          }
        }
        registerFsTombstone(opId, 'move', sourceParents[0] || null, names, resolvedSources, snapEntities);
        setPathContentsCache(prev => {
          let next = prev;
          for (const parent of sourceParents) {
            const existing = next[parent];
            if (!existing) continue;
            next = setPathCacheEntry(next, parent, existing.filter((e: any) => !names.includes(e.name)));
          }
          return next;
        });
      }
      IPC.executeFsOperation(opId, op, resolvedSources, destWin, false, label, 'high');
      // Tombstones keep source rows hidden — avoid 200ms RAM refresh fighting optimistic UI.
      if (!IPC.isNative && op === 'move' && sourcePath) {
        let newFs = fileSystem;
        for (const sp of canonSources) {
          const name = sp.split(/[/\\]/).pop() || '';
          newFs = updateFileSystem(newFs, sourcePath, (dir) => {
            const key = Object.keys(dir.children).find(k => dir.children[k].name === name);
            if (key) delete dir.children[key];
          });
        }
        setFileSystem(newFs);
      }
    })();
  };
  const executeInternalDropRef = useRef(executeInternalDrop);
  executeInternalDropRef.current = executeInternalDrop;

  const toggleFavoriteFolder = () => {
    const path = collapseKnownFolderShadowPath(
      resolveShellKnownFolderToFs(normalizePanePath(currentTab.path), shortcuts),
      shortcuts,
    );
    if (!path || path === '/') {
      setToastMessage('Navigate to a folder to pin to Rapid access.');
      return;
    }
    const pinned = config.pinnedFavorites || [];
    const exists = pinned.some((p: any) =>
      collapseKnownFolderShadowPath(
        resolveShellKnownFolderToFs(normalizePanePath(p.path), shortcuts),
        shortcuts,
      ) === path);
    if (exists) {
      updateConfig({
        pinnedFavorites: dedupePinnedFavorites(
          pinned.filter((p: any) =>
            collapseKnownFolderShadowPath(
              resolveShellKnownFolderToFs(normalizePanePath(p.path), shortcuts),
              shortcuts,
            ) !== path),
          shortcuts,
        ),
      });
      setToastMessage('Removed from Rapid access.');
    } else {
      const name = path.split('/').filter(Boolean).pop() || 'Folder';
      updateConfig({ pinnedFavorites: dedupePinnedFavorites([...pinned, { name, path, icon: 'folder' }], shortcuts) });
      setToastMessage('Pinned to Rapid access.');
    }
  };

  const closeMenu = () => setOpenMenuId(null);
  const toggleMenubarMenu = (menuId: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setOpenMenuId(prev => (prev === menuId ? null : menuId));
  };
  const menuAct = (fn: () => void) => runMenubarAction(() => { fn(); closeMenu(); });

  /** Prefer live list cache over the empty virtual FS tree — toolbar/menubar/hotkeys must use this. */
  const getCachedPaneContents = React.useCallback((panePath: string) => {
    const norm = normalizePanePath(panePath);
    return (pathContentsCache[panePath] || pathContentsCache[norm] || []) as any[];
  }, [pathContentsCache]);

  const getMenuSelectedEntities = () => {
    const tab = currentTab;
    const dirContents = getCachedPaneContents(tab.path);
    const selected = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
    if (selected.length) return selected;
    if (focusedItemId) {
      const focused = dirContents.find((x: any) => x.id === focusedItemId)
        || findEntityInCache(pathContentsCache, focusedItemId);
      if (focused) return [focused];
    }
    return [] as any[];
  };

  const getMenuPrimaryPath = () => {
    const entities = getMenuSelectedEntities();
    if (entities[0]) return joinPanePath(currentTab.path, entities[0]);
    return currentTab.path && currentTab.path !== '/' ? currentTab.path : null;
  };

  const runShellVerbOnSelection = (verb: string, needSelection = true) => {
    const entities = getMenuSelectedEntities();
    if (needSelection && !entities.length) {
      setToastMessage('Select an item first.');
      return;
    }
    const target = entities[0]
      ? toWindowsPath(joinPanePath(currentTab.path, entities[0]))
      : toWindowsPath(currentTab.path);
    import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(target, verb));
  };

  const copyTextToClipboard = async (text: string, okMsg: string) => {
    const { writeClipboardText } = await import('../lib/clipboardSafe');
    const ok = await writeClipboardText(text);
    if (ok) setToastMessage(okMsg);
    else setToastMessage('Could not copy to clipboard.', 'warning');
  };

  const openPathInExplorer = (winPath: string) => {
    import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('openExplorer', winPath));
  };

  const navigateToAppDataFolder = async (kind: 'ini' | 'appdata' | 'app') => {
    const { IPC } = await import('../lib/ipcBridge');
    if (kind === 'appdata') {
      const expanded = await IPC.expandEnvironmentPath('%AppData%\\BNDZ64');
      const pane = await import('../lib/displayPath').then(m => m.resolveUserPathToPane(expanded, p => IPC.expandEnvironmentPath(p)));
      if (pane) setCurrentPath(pane);
      else setToastMessage('Could not resolve AppData folder.');
      return;
    }
    const info = await IPC.getAppRuntimeInfo();
    const target = kind === 'ini' ? (info.iniPath || info.jsonConfigPath) : (info.jsonConfigPath || info.iniPath);
    if (!target) {
      setToastMessage('Application folder path unavailable.');
      return;
    }
    if (kind === 'ini') {
      openPathInExplorer(target);
      setToastMessage('Opening configuration file location…');
      return;
    }
    const parent = target.replace(/[\\/][^\\/]+$/, '');
    const pane = await import('../lib/displayPath').then(m => m.resolveUserPathToPane(parent, p => IPC.expandEnvironmentPath(p)));
    if (pane) setCurrentPath(pane);
    else openPathInExplorer(parent);
  };

  const invertListSelection = () => {
    const items = pathContentsCache[currentTab.path] || [];
    const selected = new Set(currentTab.selectedItems || []);
    setSelectedItems(items.filter((x: any) => !selected.has(x.id)).map((x: any) => x.id), activePaneId);
  };

  const enterFocusedOrSelectedFolder = () => {
    const entities = getMenuSelectedEntities();
    const dir = entities.find((e: any) => e.type === 'directory') || entities[0];
    if (!dir) {
      setToastMessage('Select a folder to enter.');
      return;
    }
    setCurrentPath(resolveEntityPanePath(currentTab.path, dir));
  };

  const goToDriveRoot = () => {
    const p = normalizePanePath(currentTab.path);
    const m = p.match(/^\/([A-Za-z]:)/);
    if (m) setCurrentPath(`/${m[1]}`);
    else setCurrentPath('/');
  };

  const focusAddressBar = () => {
    setEditingAddressBarPaneId(activePaneId);
    listTypeAheadArmedRef.current = false;
    setAddressBarInput(formatAddressBarPath(currentTab.path));
  };

  const duplicateSelectedItems = async () => {
    const paths = getSelectedEntityPaths();
    if (!paths.length) {
      setToastMessage('Select item(s) to duplicate.');
      return;
    }
    setClipboardState(paths, 'copy');
    await executePaste(currentTab.path);
    setToastMessage(paths.length === 1 ? 'Duplicated item.' : `Duplicated ${paths.length} items.`);
  };

  const hasFileClipboard = () => clipboard.items.length > 0 && !!clipboard.action;

  const pasteSpecialRequireClipboard = () => {
    if (!hasFileClipboard()) {
      setToastMessage('Clipboard has no files.');
      return false;
    }
    return true;
  };

  const pasteAsLinksFromClipboard = async (linkType: 'shortcut' | 'hardlink' | 'symlink' | 'junction') => {
    if (!pasteSpecialRequireClipboard()) return;
    const dest = toWindowsPath(currentTab.path);
    const { IPC } = await import('../lib/ipcBridge');
    let ok = 0;
    let err = '';
    for (const target of clipboard.items) {
      const base = target.split(/[/\\]/).pop() || 'item';
      const stem = formatCopyNameFromTemplates(config, base.replace(/\.lnk$/i, ''), false);
      const linkPath = linkType === 'shortcut'
        ? `${dest}\\${stem} - Shortcut.lnk`
        : linkType === 'hardlink'
          ? `${dest}\\${stem} - Hardlink`
          : linkType === 'symlink'
            ? `${dest}\\${stem} - Symlink`
            : `${dest}\\${stem} - Junction`;
      const res = await IPC.createLink(linkPath, toWindowsPath(target), linkType);
      if (res.success || isQueuedIpcResult(res)) ok += 1;
      else err = res.error || 'Failed';
    }
    setToastMessage(ok ? `Created ${ok} ${linkType} link(s).` : (err || 'Link creation failed.'));
    if (ok) refreshWorkspace();
  };

  const pasteIntoNewSubfolder = async () => {
    if (!pasteSpecialRequireClipboard()) return;
    const raw = await requestNativePrompt({
      title: 'New subfolder name',
      message: 'Paste clipboard items into a new subfolder.',
      defaultValue: 'Paste',
      confirmLabel: 'Create & paste',
    });
    const name = (raw || '').trim();
    if (!name) return;
    const { createItemInPane } = await import('../lib/ramStagingPaths');
    const r = await createItemInPane(currentTab.path || '/', name, 'dir');
    if (!r.ok) {
      setToastMessage(r.error || 'Could not create folder.');
      return;
    }
    const destPane = isBndzRamPath(currentTab.path)
      ? `${normalizePanePath(currentTab.path).replace(/\/$/, '')}/${name}`
      : joinPanePathForFs(currentTab.path || '/', name);
    await executePaste(destPane);
    setToastMessage(`Pasted into "${name}".`);
    refreshWorkspace();
  };

  const pasteHereAs = async () => {
    if (!pasteSpecialRequireClipboard()) return;
    if (clipboard.items.length !== 1) {
      setToastMessage('Paste Here As… works with one clipboard item.');
      return;
    }
    const src = toWindowsPath(clipboard.items[0]);
    const base = src.split(/[/\\]/).pop() || 'item';
    const raw = await requestNativePrompt({
      title: 'Paste Here As…',
      message: 'Enter the destination file or folder name.',
      defaultValue: base,
      confirmLabel: 'Paste',
    });
    const asName = (raw || '').trim();
    if (!asName) return;
    const destDir = toWindowsPath(currentTab.path);
    const destFile = `${destDir}\\${asName}`;
    const { IPC } = await import('../lib/ipcBridge');
    const op = clipboard.action === 'cut' ? 'move' : 'copy';
    await IPC.executeFsOperation(`paste-as-${Date.now()}`, op, src, destFile, false, asName, 'high');
    if (clipboard.action === 'cut') clearClipboard();
    setToastMessage(`Pasted as "${asName}".`);
    refreshWorkspace();
  };

  const pasteFolderStructureOnly = async () => {
    if (!pasteSpecialRequireClipboard()) return;
    const dest = toWindowsPath(currentTab.path);
    const { IPC } = await import('../lib/ipcBridge');
    let created = 0;
    for (const src of clipboard.items) {
      const win = toWindowsPath(src);
      const base = win.split(/[/\\]/).pop() || 'Folder';
      // Prefer creating a folder named after each clipboard item (files → folder of parent name skipped; use basename without ext for files)
      const folderName = base.includes('.') && !base.endsWith('\\') ? base.replace(/\.[^.]+$/, '') || base : base;
      const target = `${dest}\\${folderName}`;
      await IPC.executeFsOperation(`paste-struct-${Date.now()}-${created}`, 'create-dir', target, '', false, folderName);
      created += 1;
    }
    setToastMessage(created ? `Created ${created} folder(s) from clipboard structure.` : 'Nothing to create.');
    refreshWorkspace();
  };

  const pasteExtractedFromClipboard = async () => {
    if (!pasteSpecialRequireClipboard()) return;
    const dest = toWindowsPath(currentTab.path);
    const archives = clipboard.items.filter(p => {
      const ext = (p.split(/[/\\]/).pop() || '').split('.').pop() || '';
      return isArchiveExt(ext);
    });
    if (!archives.length) {
      setToastMessage('No archives on the clipboard.');
      return;
    }
    const { IPC } = await import('../lib/ipcBridge');
    for (const arch of archives) {
      const win = toWindowsPath(arch);
      const base = (win.split('\\').pop() || 'archive').replace(/\.[^.]+$/, '');
      await IPC.extractArchive(win, `${dest}\\${base}`);
    }
    setToastMessage(`Extracting ${archives.length} archive(s)…`);
    refreshWorkspace();
  };

  const pasteZippedFromClipboard = async () => {
    if (!pasteSpecialRequireClipboard()) return;
    const dest = `${toWindowsPath(currentTab.path)}\\Clipboard-${Date.now()}.zip`;
    const { IPC } = await import('../lib/ipcBridge');
    const res = await IPC.createArchive(clipboard.items.map(toWindowsPath), dest, 'zip');
    setToastMessage(isQueuedIpcResult(res) ? 'Zip queued — see transfer panel.' : (res.ok ? 'Clipboard items zipped.' : (res.error || 'Zip failed.')));
    refreshWorkspace();
  };

  const pasteTextAsItems = async () => {
    try {
      const text = await (await import('../lib/clipboardSafe')).readClipboardText();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) { setToastMessage('Clipboard has no text.'); return; }
      const { IPC } = await import('../lib/ipcBridge');
      const dest = toWindowsPath(currentTab.path);
      for (const line of lines) {
        const safe = line.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'item';
        const path = `${dest}\\${safe}`;
        await IPC.executeFsOperation(`paste-text-item-${Date.now()}-${safe}`, 'create-file', path, '', false, safe);
      }
      setToastMessage(`Created ${lines.length} item(s) from clipboard text.`);
      refreshWorkspace();
    } catch {
      setToastMessage('Could not read clipboard text.', 'warning');
    }
  };

  const pasteTextIntoNewFile = async () => {
    try {
      const text = await (await import('../lib/clipboardSafe')).readClipboardText();
      const defaultName = `${formatMessageSaveName(config, {
        from: 'clipboard',
        to: 'file',
        subject: 'paste',
      })}.txt`;
      const raw = await requestNativePrompt({
        title: 'New file name',
        message: 'Write clipboard text into a new file.',
        defaultValue: defaultName,
        confirmLabel: 'Create',
      });
      const name = (raw || '').trim();
      if (!name) return;
      const path = `${toWindowsPath(currentTab.path)}\\${name}`;
      const { IPC } = await import('../lib/ipcBridge');
      const ok = await IPC.writeTextFile(path, text ?? '');
      setToastMessage(ok ? `Wrote "${name}".` : 'Failed to write file.', ok ? undefined : 'warning');
      if (ok) refreshWorkspace();
    } catch {
      setToastMessage('Could not read clipboard text.', 'warning');
    }
  };

  const pasteImageIntoNewPng = async () => {
    try {
      const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clip || typeof clip.read !== 'function') {
        setToastMessage('Clipboard image API unavailable.', 'warning');
        return;
      }
      const items = await clip.read();
      const imgItem = items.find(i => i.types.includes('image/png') || i.types.includes('image/jpeg'));
      if (!imgItem) { setToastMessage('Clipboard has no image.'); return; }
      const type = imgItem.types.includes('image/png') ? 'image/png' : 'image/jpeg';
      const blob = await imgItem.getType(type);
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const raw = await requestNativePrompt({
        title: 'Image file name',
        message: 'Save the clipboard image as a new file.',
        defaultValue: type === 'image/png' ? 'Clipboard.png' : 'Clipboard.jpg',
        confirmLabel: 'Save',
      });
      const name = (raw || '').trim();
      if (!name) return;
      const path = `${toWindowsPath(currentTab.path)}\\${name}`;
      const { IPC } = await import('../lib/ipcBridge');
      const ok = await IPC.writeBinaryFile(path, base64);
      setToastMessage(ok ? `Saved "${name}".` : 'Failed to save image.', ok ? undefined : 'warning');
      if (ok) refreshWorkspace();
    } catch {
      setToastMessage('Could not read clipboard image (permission or empty).', 'warning');
    }
  };

  const editClipboardPaths = async () => {
    if (!hasFileClipboard()) {
      setToastMessage('Clipboard has no files to edit.');
      return;
    }
    const edited = await requestNativePrompt({
      title: 'Edit Clipboard',
      message: 'One path per line. Clear all lines to empty the clipboard.',
      defaultValue: clipboard.items.join('\n'),
      confirmLabel: 'Update',
    });
    if (edited == null) return;
    const paths = edited.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!paths.length) {
      clearClipboard();
      setToastMessage('Clipboard cleared.');
      return;
    }
    setClipboardState(paths, clipboard.action || 'copy');
    setToastMessage(`Clipboard updated (${paths.length} path(s)).`);
  };

  const pasteSpecialHandlersRef = useRef({
    pasteIntoNewSubfolder: () => Promise.resolve(),
    pasteTextIntoNewFile: () => Promise.resolve(),
    pasteImageIntoNewPng: () => Promise.resolve(),
  });
  pasteSpecialHandlersRef.current = {
    pasteIntoNewSubfolder,
    pasteTextIntoNewFile,
    pasteImageIntoNewPng,
  };

  const applyTagToSelection = async (tag: { id?: string; name?: string; label?: string; color?: string }) => {
    if (config.fileTagging === false || config.fileTaggingFeature === false) {
      setToastMessage('File tagging is disabled in Settings.');
      closeMenu();
      return;
    }
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
    const storageMode = String(config.tagsStorage || 'Absolute paths');
    const { IPC } = await import('../lib/ipcBridge');

    // Fetch every sidecar once, in parallel — previously this fetched each path's
    // sidecar twice (once to compute allHaveTag, once to apply) and did both
    // sequentially, so tagging N items cost 2N+N sequential IPC round-trips.
    const sidecars = await Promise.all(paths.map(p => IPC.getTagSidecar(p)));
    const allHaveTag = sidecars.every(side => entityHasTag(side?.tags, tagKey));

    // Settings → Confirm copying tags (confirm before applying)
    if (config.confirmCopyingTags && !allHaveTag) {
      const ok = window.confirm(`Apply tag "${tag.label || tagKey}" to ${paths.length} item(s)?\nStorage: ${storageMode}`);
      if (!ok) {
        closeMenu();
        return;
      }
    }

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
    // tagsStorage: Relative/Database modes still write the resolved absolute path keys
    // today (sidecar DB). Relative mode records the mode on the toast; Database prefers
    // batch write (already) as a single durable update.
    void storageMode;
    await IPC.setTagMetaBatchItems(items);
    if (!allHaveTag) lastAppliedTagRef.current = tag;

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
      : `Tagged ${paths.length} item(s) as "${tag.label || tagKey}" (${storageMode}). Click again to remove.`);
    closeMenu();
  };

  const selectAllInActivePane = () => {
    const items = getSortedContentsForActivePane();
    const ids = items.map((x: any) => x.id);
    setSelectedItems(ids, activePaneId);
    scheduleSelectionChrome(ids, true);
    scheduleQuickActionsBar(ids.length > 0, true);
  };

  const invertSelectionInActivePane = () => {
    const ap = panes.find(p => p.id === activePaneId);
    if (!ap) return;
    const tab = ap.tabs[ap.activeTabIndex];
    const dirContents = getSortedContentsForActivePane();
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

  const addTab = (paneId: string, path: string, options?: { preferConfiguredHome?: boolean }) => {
    const tabLimits = getTabLimitBehavior(config);
    const maxTabs = Math.max(1, Number(tabLimits.maximumNumberOfTabs) || 50);
    const paneNow = panes.find(p => p.id === paneId);
    if (paneNow && paneNow.tabs.length >= maxTabs) {
      setToastMessage(`Maximum number of tabs reached (${maxTabs}).`);
      return;
    }
    let targetPath = path;
    if (options?.preferConfiguredHome) {
      const home = typeof config.newTabPath === 'string' ? config.newTabPath.trim() : '';
      if (home) {
        const norm = home.replace(/\\/g, '/');
        targetPath = norm.startsWith('/') ? norm : `/${norm}`;
      }
    }
    const tabId = `t-${Date.now()}`;
    scheduleTabEnter(tabId);
    const placeAtEnd = String(config.openNewTab || '') === 'At the end';
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const newTab: TabState = {
        id: tabId,
        path: targetPath,
        history: [targetPath],
        historyIndex: 0,
        selectedItems: [],
        viewMode: undefined,
      };
      if (placeAtEnd || p.tabs.length === 0) {
        return { ...p, tabs: [...p.tabs, newTab], activeTabIndex: p.tabs.length };
      }
      const insertAt = Math.min(p.activeTabIndex + 1, p.tabs.length);
      const tabs = [...p.tabs];
      tabs.splice(insertAt, 0, newTab);
      return { ...p, tabs, activeTabIndex: insertAt };
    }));
  };

  const addFindingTab = (paneId: string, query: string, root?: string) => {
    const q = query.trim();
    if (!q) return;
    const dest = String(config.showSearchResultsIn || '').toLowerCase();
    const preferCurrent = !!config.showQuickSearchResultsInCurrentTab
      || dest.includes('current');
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const rootPath = root || p.tabs[p.activeTabIndex]?.path || '/';
      const active = p.tabs[p.activeTabIndex];
      // Toggle on same query: re-running the identical Finding search clears it.
      if (
        (config.toggleOnSameQuery || getFindBehavior(config).toggleOnSameQuery)
        && isFindingTab(active)
        && String(active.findingQuery || '').trim().toLowerCase() === q.toLowerCase()
      ) {
        const tabs = p.tabs.filter((_, i) => i !== p.activeTabIndex);
        return {
          ...p,
          tabs: tabs.length ? tabs : p.tabs,
          activeTabIndex: Math.max(0, Math.min(p.activeTabIndex, tabs.length - 1)),
        };
      }
      if (preferCurrent && isFindingTab(active)) {
        const updated = { ...active, findingQuery: q, findingRoot: rootPath, findingLoading: true };
        void refreshFindingTab(paneId, active.id, q, rootPath, updated);
        if (config.synchronizeTreeWithSearchLocation) {
          queueMicrotask(() => setCurrentPath(rootPath, paneId));
        }
        return {
          ...p,
          tabs: p.tabs.map((t, i) => (i === p.activeTabIndex ? updated : t)),
        };
      }
      const newTab = createFindingTab(q, rootPath, config);
      void refreshFindingTab(paneId, newTab.id, q, rootPath, newTab);
      if (config.synchronizeTreeWithSearchLocation) {
        queueMicrotask(() => setCurrentPath(rootPath, paneId));
      }
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
        if (p.activeTabIndex === tabIndex) {
          const policy = String(config.onClosingTheCurrentTab || 'Activate the right tab');
          if (policy.includes('left')) {
            newActive = Math.max(0, tabIndex - 1);
          } else if (policy.includes('last active')) {
            const mru = tabMruRef.current[paneId] || [];
            const nextId = mru.find((id) => newTabs.some(t => t.id === id));
            const idx = nextId ? newTabs.findIndex(t => t.id === nextId) : -1;
            newActive = idx >= 0 ? idx : Math.min(tabIndex, newTabs.length - 1);
          } else {
            newActive = Math.min(tabIndex, newTabs.length - 1);
          }
        } else if (p.activeTabIndex > tabIndex) {
          newActive = p.activeTabIndex - 1;
        }
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

  const openTabContextMenuAt = (paneId: string, tabIndex: number, clientX: number, clientY: number) => {
    if (IPC.isNative) {
      void (async () => {
        const pane = panes.find(p => p.id === paneId);
        const tab = pane?.tabs[tabIndex];
        if (!pane || !tab) return;
        await showTabHostContextMenu({
          clientX,
          clientY,
          tabLabel: isFindingTab(tab) ? findingTabLabel(tab) : getPaneTabLabel(tab.path),
          isLocked: !!tab.locked,
          canClose: pane.tabs.length > 1,
          canCloseOthers: pane.tabs.length > 1,
          canCloseRight: tabIndex < pane.tabs.length - 1,
          showRefresh: true,
          showTearOff: true,
          onLock: () => toggleTabLock(paneId, tabIndex),
          onClose: () => { void closeTabAt(paneId, tabIndex); },
          onCloseOthers: () => { void closeOtherTabs(paneId, tabIndex); },
          onCloseRight: () => { void closeTabsToRight(paneId, tabIndex); },
          onCloseAll: () => { void closeAllTabs(paneId); },
          onDuplicate: () => duplicateTab(paneId, tabIndex),
          onTearOff: () => {
            if (config.openNewInstanceAlways && config.allowMultipleInstances === false) {
              setToastMessage('Enable “Allow multiple instances” to tear off into a new window.', 'warning');
              return;
            }
            void IPC.openPathInNewWindow(tab.path).then(r => {
              if (!r.ok) setToastMessage(r.error || 'Could not open Stage window.', 'warning');
              else setToastMessage(config.openNewInstanceAlways
                ? 'Opened in a new BNDZ instance.'
                : 'Opened in a new Stage window.');
            });
          },
          onRefresh: () => {
            if (isFindingTab(tab) && tab.findingQuery) {
              void refreshFindingTab(paneId, tab.id, tab.findingQuery, tab.findingRoot || tab.path, tab);
            } else {
              void refetchPath(tab.path);
            }
          },
          onResetColor: () => setTabColor(paneId, tabIndex, ''),
        });
      })();
      return;
    }
    setTabContextMenu({ x: clientX, y: clientY, paneId, tabIndex });
  };

  const tabMruRef = useRef<Record<string, string[]>>({});

  const touchTabMru = (paneId: string, tabId: string) => {
    const prev = tabMruRef.current[paneId] || [];
    tabMruRef.current[paneId] = [tabId, ...prev.filter((id) => id !== tabId)].slice(0, 64);
  };

  const setActiveTab = (paneId: string, tabIndex: number) => {
    setActivePaneId(paneId);
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      const tab = p.tabs[tabIndex];
      if (tab?.id) touchTabMru(paneId, tab.id);
      return { ...p, activeTabIndex: tabIndex };
    }));
    // Explorer: activating a tab returns keyboard ownership to the file list.
    requestAnimationFrame(() => {
      const listEl = document.querySelector(
        `[data-list-body][data-list-pane-id="${paneId}"]`,
      ) as HTMLElement | null;
      try { listEl?.focus({ preventScroll: true }); } catch { /* ignore */ }
      listTypeAheadArmedRef.current = true;
    });
  };

  const cycleActivePaneTab = (direction: 1 | -1) => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane || pane.tabs.length < 2) return;
    const tabLimits = getTabLimitBehavior(config);
    if (tabLimits.cycleTabsInRecentlyUsedOrder) {
      const mru = tabMruRef.current[pane.id] || [];
      const orderedIds = [
        ...mru.filter((id) => pane.tabs.some(t => t.id === id)),
        ...pane.tabs.map(t => t.id).filter(id => !mru.includes(id)),
      ];
      const activeId = pane.tabs[pane.activeTabIndex]?.id;
      const cur = Math.max(0, orderedIds.indexOf(activeId || ''));
      const nextId = orderedIds[(cur + direction + orderedIds.length) % orderedIds.length];
      const nextIdx = pane.tabs.findIndex(t => t.id === nextId);
      if (nextIdx >= 0) setActiveTab(pane.id, nextIdx);
      return;
    }
    const next = (pane.activeTabIndex + direction + pane.tabs.length) % pane.tabs.length;
    setActiveTab(pane.id, next);
  };

  const clearTabFileDragTimer = () => {
    if (tabFileDragTimerRef.current) {
      clearTimeout(tabFileDragTimerRef.current);
      tabFileDragTimerRef.current = null;
    }
  };

  const clearFileDragChrome = React.useCallback(() => {
    clearTabFileDragTimer();
    setTabFileDropTarget(null);
    setFileDragListPreview(null);
    setNewTabDropPaneId(null);
    setBreadcrumbDropTarget(null);
    setNavTreeFileDropTarget(null);
    setFileDragFavoriteTarget(null);
    setPointerFileDragActive(false);
    clearPointerDragHover();
    tabFileDragHoverRef.current = null;
  }, []);

  /** Pointer-drag: switch tab + list immediately when cursor is over a tab strip target. */
  const activateTabForFileDragImmediate = React.useCallback((paneId: string, tabIndex: number) => {
    const targetPane = panesRef.current.find(p => p.id === paneId);
    if (!targetPane || tabIndex < 0 || tabIndex >= targetPane.tabs.length) return;

    const preview = { paneId, tabIndex };
    tabFileDragHoverRef.current = preview;
    setTabFileDropTarget(preview);
    setFileDragListPreview(preview);

    if (targetPane.tabs[tabIndex]?.locked) return;

    const alreadyActive = targetPane.activeTabIndex === tabIndex
      && paneId === activePaneIdRef.current;
    if (alreadyActive) return;

    if (config.autoSelectTabsOnDragOver === false) return;
    const sourcePaneId = getFileDragSession()?.sourcePaneId ?? activePaneIdRef.current;
    const activeId = activePaneIdRef.current;
    if (
      config.alsoAutoSelectTabsInTheInactivePane === false
      && paneId !== sourcePaneId
      && paneId !== activeId
    ) return;

    clearTabFileDragTimer();
    activePaneIdRef.current = paneId;
    const nextPanes = panesRef.current.map(p =>
      p.id === paneId ? { ...p, activeTabIndex: tabIndex } : p,
    );
    panesRef.current = nextPanes;
    flushSync(() => {
      setActivePaneId(paneId);
      setPanes(nextPanes);
    });
    const targetPath = targetPane.tabs[tabIndex]?.path;
    if (targetPath) {
      const norm = normalizePanePath(targetPath);
      if (pathContentsCacheRef.current[norm] === undefined) {
        void refetchPath(norm);
      }
    }
  }, [config.alsoAutoSelectTabsInTheInactivePane, config.autoSelectTabsOnDragOver, refetchPath]);

  const resolveTabHoverAtPoint = React.useCallback((clientX: number, clientY: number) => {
    const newTabPaneId = hitTestNewTabZoneAtPoint(clientX, clientY);
    if (newTabPaneId) {
      setNewTabDropPaneId(newTabPaneId);
      setTabFileDropTarget(null);
      return true;
    }
    setNewTabDropPaneId(null);
    const tabHit = hitTestTabAtPoint(clientX, clientY);
    if (!tabHit?.tabId) {
      setTabFileDropTarget(null);
      return false;
    }
    let matched = false;
    for (const p of panesRef.current) {
      const idx = p.tabs.findIndex(t => t.id === tabHit.tabId);
      if (idx >= 0) {
        activateTabForFileDragImmediate(p.id, idx);
        matched = true;
        break;
      }
    }
    if (!matched && tabHit.paneId && tabHit.tabIndex >= 0) {
      activateTabForFileDragImmediate(tabHit.paneId, tabHit.tabIndex);
      matched = true;
    }
    return matched;
  }, [activateTabForFileDragImmediate]);

  const applyFileDragHoverAtPoint = React.useCallback((clientX: number, clientY: number) => {
    const hover = resolveFileDragHoverAtPoint(clientX, clientY, panesRef.current);
    lastDragHoverStateRef.current = { x: clientX, y: clientY, state: hover };
    setNavTreeFileDropTarget(hover.navTreePath);
    setBreadcrumbDropTarget(hover.breadcrumbPath);
    setFileDragFavoriteTarget(hover.favoritePath);
    const overList = !!hitTestListBodyAtPoint(clientX, clientY);
    setPointerDragHover(clientX, clientY, overList);
    if (hover.htmlDropTarget) {
      htmlDropTargetRef.current = hover.htmlDropTarget;
    }
    if (hover.navTreePath && configRef.current.expandTreeNodesOnDragOver) {
      window.dispatchEvent(new CustomEvent('bndz-tree-expand-drag', { detail: { path: hover.navTreePath } }));
    }
    resolveTabHoverAtPoint(clientX, clientY);
  }, [resolveTabHoverAtPoint]);

  useEffect(() => {
    // Coalesce hover updates — accumulate coords into a pending ref, flush once per animation
    // frame. This prevents 3+ React setState calls from firing on every raw pointermove.
    let hoverRafId = 0;
    let pendingHoverX = 0;
    let pendingHoverY = 0;
    const onPointerDragMove = (e: Event) => {
      const { clientX, clientY } = (e as CustomEvent<PointerFileDragMoveDetail>).detail;
      pendingHoverX = clientX;
      pendingHoverY = clientY;
      if (hoverRafId) return;
      hoverRafId = window.requestAnimationFrame(() => {
        hoverRafId = 0;
        applyFileDragHoverAtPoint(pendingHoverX, pendingHoverY);
      });
    };
    const onPointerDragActive = (e: Event) => {
      const active = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
      setPointerFileDragActive(active);
      if (!active) clearFileDragChrome();
    };
    window.addEventListener(POINTER_FILE_DRAG_MOVE, onPointerDragMove);
    window.addEventListener(POINTER_FILE_DRAG_ACTIVE, onPointerDragActive);
    return () => {
      if (hoverRafId) window.cancelAnimationFrame(hoverRafId);
      window.removeEventListener(POINTER_FILE_DRAG_MOVE, onPointerDragMove);
      window.removeEventListener(POINTER_FILE_DRAG_ACTIVE, onPointerDragActive);
    };
  }, [applyFileDragHoverAtPoint, clearFileDragChrome]);

  /** HTML5 drag-over tabs: delayed switch (Explorer-style). Pointer session uses immediate switch. */
  const scheduleTabSwitchOnFileDrag = (paneId: string, tabIndex: number) => {
    if (getFileDragSession() || pointerFileDragActiveRef.current) {
      activateTabForFileDragImmediate(paneId, tabIndex);
      return;
    }
    if (config.autoSelectTabsOnDragOver === false) return;
    const sourcePaneId = getFileDragSession()?.sourcePaneId ?? activePaneIdRef.current;
    const activeId = activePaneIdRef.current;
    if (
      config.alsoAutoSelectTabsInTheInactivePane === false
      && paneId !== sourcePaneId
      && paneId !== activeId
    ) return;
    const targetPane = panesRef.current.find(p => p.id === paneId);
    if (targetPane?.tabs[tabIndex]?.locked) return;
    const prev = tabFileDragHoverRef.current;
    if (prev?.paneId === paneId && prev?.tabIndex === tabIndex) return;
    clearTabFileDragTimer();
    const preview = { paneId, tabIndex };
    tabFileDragHoverRef.current = preview;
    setTabFileDropTarget(preview);
    setFileDragListPreview(preview);
    const delay = config.delayBeforeADraggedOverTabIsAutoSelected ?? DEFAULT_TAB_HOVER_DELAY_MS;
    const applySwitch = () => {
      tabFileDragTimerRef.current = null;
      activateTabForFileDragImmediate(paneId, tabIndex);
    };
    if (delay <= 0) {
      applySwitch();
      return;
    }
    tabFileDragTimerRef.current = setTimeout(applySwitch, delay);
  };

  useEffect(() => () => clearTabFileDragTimer(), []);

  const setCurrentPath = (path: string, paneId: string = activePaneId, updateHistory: boolean = true) => {
    const remapped = remapRetiredVirtualPath(path);
    let norm = resolveShellKnownFolderToFs(normalizePanePath(remapped), shortcuts);
    // Settings → Support volume labels in paths
    const fromLabel = resolveVolumeLabelPath(config, remapped, drives);
    if (fromLabel) norm = normalizePanePath(fromLabel);

    // Settings → Reuse existing tabs when changing the location
    if (config.reuseExistingTabsWhenChangingTheLocation) {
      const hit = findReusableTab(panes, norm, paneId);
      if (hit && !(hit.paneId === paneId && panes.find(p => p.id === paneId)?.activeTabIndex === hit.tabIndex)) {
        setPanes(prev => prev.map(p => {
          if (p.id !== hit.paneId) return p;
          return { ...p, activeTabIndex: hit.tabIndex };
        }));
        setActivePaneId(hit.paneId);
        beginDirFetchRef.current(norm);
        if (isFilesHostBoot() && updateHistory && norm) {
          notifyFilesHostNavigate(norm);
        }
        if (isNativeShellCraftIslandBoot() && updateHistory && norm) {
          notifyNativeShellNavigate(norm);
        }
        return;
      }
    }

    // Settings → Auto-create any missing folders
    if (
      config.autoCreateAnyMissingFolders
      && norm
      && !norm.startsWith('/shell:')
      && !norm.startsWith('/bndz/')
      && !norm.startsWith('/vf/')
      && norm !== '/'
    ) {
      void import('../lib/ipcBridge').then(async ({ IPC }) => {
        const win = toWindowsPath(norm);
        const exists = await IPC.checkPathExists(win).catch(() => false);
        if (!exists) {
          const fsPath = toFsPathWithOverlongSupport(config, win);
          await IPC.executeFsOperation(`mkdir-${Date.now()}`, 'create-dir', fsPath, '', false, 'Auto-create folder');
        }
      });
    }

    const bndzView = parseBndzVirtualView(norm);
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
        const newTabs = [...p.tabs];
        const tab = newTabs[p.activeTabIndex];
        let newHistory = tab.history;
        let newHistoryIndex = tab.historyIndex;
        if (updateHistory && tab.path !== norm) {
            const histBeh = getHistoryBehavior(config);
            newHistory = newHistory.slice(0, newHistoryIndex + 1);
            if (histBeh.historyWithoutDuplicates && newHistory[newHistory.length - 1] === norm) {
              newHistoryIndex = newHistory.length - 1;
            } else {
              newHistory.push(norm);
              newHistoryIndex = newHistory.length - 1;
            }
            // Shared history: when History per tab is off, mirror stack onto every tab in this pane.
            if (!histBeh.historyPerTab && !config.historyPerTab) {
              return {
                ...p,
                tabs: newTabs.map((t, i) => {
                  if (i === p.activeTabIndex) {
                    return {
                      ...t,
                      path: norm,
                      history: newHistory,
                      historyIndex: newHistoryIndex,
                      selectedItems: [],
                      viewMode: t.viewMode,
                      millerRootPath: resolveMillerRootOnNavigate(t.millerRootPath, t.viewMode, norm, t.path),
                    };
                  }
                  return { ...t, history: newHistory, historyIndex: newHistoryIndex };
                }),
                ...(bndzView === 'large'
                  ? { sortColumn: 'size' as const, sortDirection: 'desc' as const }
                  : {}),
              };
            }
        }
        newTabs[p.activeTabIndex] = {
          ...tab,
          path: norm,
          history: newHistory,
          historyIndex: newHistoryIndex,
          selectedItems: [],
          // View bar is sole authority — smart views filter content, never force layout.
          viewMode: tab.viewMode,
          millerRootPath: resolveMillerRootOnNavigate(tab.millerRootPath, tab.viewMode, norm, tab.path),
        };
        return {
          ...p,
          tabs: newTabs,
          ...(bndzView === 'large'
            ? { sortColumn: 'size' as const, sortDirection: 'desc' as const }
            : {}),
        };
      }
      return p;
    }));
    // Drop focus that may still point at an item from the previous folder (stale audio preview).
    if (paneId === activePaneId) setFocusedItemId(null);
    if (updateHistory && norm) {
      if (navHistoryTimerRef.current) clearTimeout(navHistoryTimerRef.current);
      navHistoryTimerRef.current = setTimeout(() => {
        updateConfig({ navigationHistory: recordNavVisit(config.navigationHistory, norm) });
      }, 500);
      pushGhostTrail(norm, getPaneTabLabel(norm));
      if (norm !== '/' && !norm.startsWith('/vf/') && !norm.startsWith('/shell:') && !norm.includes('>')) {
        const prev = (config.recentFiles as string[] | undefined) || [];
        const next = [norm, ...prev.filter(p => p !== norm)].slice(0, 15);
        if (next[0] !== prev[0] || next.length !== prev.length) {
          updateConfig({ recentFiles: next });
        }
      }
    }
    beginDirFetchRef.current(norm);
    if (isFilesHostBoot() && updateHistory && norm) {
      notifyFilesHostNavigate(norm);
    }
    if (isNativeShellCraftIslandBoot() && updateHistory && norm) {
      notifyNativeShellNavigate(norm);
    }
  };

  // FilesMerge tabs → BNDZ cwd (avoid echo loops via normalized compare).
  useEffect(() => {
    if (!isFilesHostBoot()) return;
    const normKey = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    return subscribeFilesHostContext((path) => {
      const pane = panesRef.current?.find((p: { id: string }) => p.id === activePaneIdRef.current)
        || panesRef.current?.[0];
      const tab = pane?.tabs?.[pane.activeTabIndex];
      const cur = typeof tab?.path === 'string' ? tab.path : '';
      if (cur && normKey(cur) === normKey(path)) return;
      setCurrentPath(path, activePaneIdRef.current, false);
    });
  }, []);

  // WinUI craft islands: sync path highlight from NativeListHost selection/nav.
  useEffect(() => {
    if (!isNativeShellCraftIslandBoot()) return;
    const normKey = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const onMsg = (e: MessageEvent) => {
      try {
        const raw = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const data = raw?.type ? raw : raw?.data?.type ? raw.data : raw;
        if (!data || data.type !== 'BNDZ_PANE_CONTEXT') return;
        const path = data.payload?.path ? String(data.payload.path) : '';
        if (!path) return;
        const pane = panesRef.current?.find((p: { id: string }) => p.id === activePaneIdRef.current)
          || panesRef.current?.[0];
        const tab = pane?.tabs?.[pane.activeTabIndex];
        const cur = typeof tab?.path === 'string' ? tab.path : '';
        if (cur && normKey(cur) === normKey(path)) return;
        setCurrentPath(path, activePaneIdRef.current, false);
      } catch { /* ignore */ }
    };
    (window as any).chrome?.webview?.addEventListener('message', onMsg);
    return () => (window as any).chrome?.webview?.removeEventListener('message', onMsg);
  }, []);

  // Files engines → BNDZ list (blend): seed cache and skip GET_DIR_CONTENTS for that path.
  useEffect(() => {
    if (!isFilesHostBoot()) return;
    return subscribeFilesHostListing((path, items, complete) => {
      const norm = normalizePanePath(path);
      if (!norm) return;
      const pending = filesHostFetchTimersRef.current.get(norm);
      if (pending) {
        window.clearTimeout(pending);
        filesHostFetchTimersRef.current.delete(norm);
      }
      const pendingFallback = filesHostFallbackTimersRef.current.get(norm);
      if (pendingFallback) {
        window.clearTimeout(pendingFallback);
        filesHostFallbackTimersRef.current.delete(norm);
      }
      filesFedPathsRef.current.add(norm);
      dirFetchInFlightRef.current.delete(norm);
      const normalized = normalizeDirEntries(items as any[]);
      cachePathContents(norm, normalized);
      resolveFilesHostListingWaiters(norm);
      setPathLoadErrors((prev) => {
        if (!(norm in prev)) return prev;
        const next = { ...prev };
        delete next[norm];
        return next;
      });
      setLoadingPaths((prev) => {
        if (!prev.has(norm)) return prev;
        const next = new Set(prev);
        next.delete(norm);
        return next;
      });
      setStreamingPaths((prev) => {
        if (!prev.has(norm)) return prev;
        const next = new Set(prev);
        next.delete(norm);
        return next;
      });
      if (complete && normalized.length > 0) {
        const runPrefetch = () => prefetchListingVisuals(
          normalized,
          norm,
          listingPrefetchFromConfig(configRef.current),
        );
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(() => runPrefetch(), { timeout: 1200 });
        } else {
          window.setTimeout(runPrefetch, 0);
        }
      }
    });
  }, [cachePathContents, resolveFilesHostListingWaiters]);

  useEffect(() => {
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setCurrentPath(path);
    };
    const onRefreshPath = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (!path) return;
      const norm = normalizePanePath(path);
      if (isBndzRamPath(norm)) invalidateRamZoneMountCache();
      invalidatePath(norm);
      void refetchPath(norm);
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
    window.addEventListener('bndz-refresh-path', onRefreshPath);
    window.addEventListener('bndz-open-bottom-plugin', onOpenPlugin);
    const onOpenTagManager = () => setIsTagManagerOpen(true);
    window.addEventListener('bndz-open-tag-manager', onOpenTagManager);
    const onOpenInBndz = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const path = typeof d.path === 'string' ? d.path : '';
      if (!path) return;
      if (d.isDirectory) {
        setCurrentPath(toPanePath(path));
        return;
      }
      const pane = toPanePath(path);
      const parent = pane.replace(/[/\\][^/\\]+$/, '') || '/';
      const normParent = normalizePanePath(parent);
      const listing = pathContentsCache[normParent] || pathContentsCache[normalizePanePath(currentPath)] || [];
      const leaf = pane.split(/[/\\]/).pop()?.toLowerCase() || '';
      const ent = listing.find((c: any) => String(c.name || '').toLowerCase() === leaf);
      if (ent?.id) {
        setSelectedItems([ent.id], activePaneId);
        setFocusedItemId(ent.id);
      }
      const idx = listing.findIndex((c: any) => c.id === ent?.id);
      openQuickPreviewRef.current?.(idx >= 0 ? idx : undefined);
    };
    window.addEventListener('bndz-open-in-bndz', onOpenInBndz);
    const onRamZoneChanged = () => {
      invalidateRamZoneMountCache();
      // Refresh any open RAM virtual tabs so browse isn't stuck empty after create/eject.
      for (const pane of panes) {
        for (const tab of pane.tabs || []) {
          if (isBndzRamPath(tab.path)) {
            invalidatePath(normalizePanePath(tab.path));
            void refetchPath(normalizePanePath(tab.path));
          }
        }
      }
      if (isBndzRamPath(currentPath)) {
        invalidatePath(normalizePanePath(currentPath));
        void refetchPath(normalizePanePath(currentPath));
      }
    };
    window.addEventListener('bndz-ram-zone-changed', onRamZoneChanged);
    return () => {
      window.removeEventListener('bndz-navigate', onNavigate);
      window.removeEventListener('bndz-refresh-path', onRefreshPath);
      window.removeEventListener('bndz-open-bottom-plugin', onOpenPlugin);
      window.removeEventListener('bndz-open-tag-manager', onOpenTagManager);
      window.removeEventListener('bndz-open-in-bndz', onOpenInBndz);
      window.removeEventListener('bndz-ram-zone-changed', onRamZoneChanged);
    };
  }, [activePaneId, panes, currentPath]);

  useEffect(() => {
    const onMeshDropSend = (e: Event) => {
      const raw = (e as CustomEvent).detail?.paths as string[] | undefined;
      const paths = Array.isArray(raw) ? raw.filter(Boolean) : [];
      setMeshDropPaths(paths);
      setShowMeshDropDialog(true);
    };
    window.addEventListener('bndz-mesh-drop-send', onMeshDropSend);
    return () => window.removeEventListener('bndz-mesh-drop-send', onMeshDropSend);
  }, []);

  useEffect(() => {
    const onInboundCopy = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean) ?? [];
      if (!paths.length) return;
      const panesSnap = panesRef.current;
      const activeId = activePaneIdRef.current;
      const activePane = panesSnap.find(p => p.id === activeId) || panesSnap[0];
      const dest = normalizePanePath(activePane?.tabs[activePane.activeTabIndex]?.path || '');
      if (!dest || !isFsDropTargetPath(dest)) {
        setToastMessage('Open a real folder to receive inbound items.');
        return;
      }
      executeInternalDropRef.current('copy', paths.map(toWindowsPath), canonicalDropPath(dest));
    };
    window.addEventListener('bndz-inbound-copy', onInboundCopy);
    return () => window.removeEventListener('bndz-inbound-copy', onInboundCopy);
  }, []);

  // Native OLE drag-hover: warm drop targets (list / tree / breadcrumb / tabs) — no HTML5.
  useEffect(() => {
    const onExternalDragHover = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX : null;
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY : null;
      if (clientX == null || clientY == null) return;
      setExternalDragActive(true);
      setExternalDragHover(clientX, clientY);
      applyFileDragHoverAtPoint(clientX, clientY);
    };
    const onExternalDragEnd = () => {
      setExternalDragActive(false);
      setExternalDragPaths([]);
      clearExternalDragHover();
    };
    window.addEventListener('bndz-external-drag-hover', onExternalDragHover);
    window.addEventListener('bndz-external-drop', onExternalDragEnd);
    window.addEventListener('bndz-external-drop-failed', onExternalDragEnd);
    return () => {
      window.removeEventListener('bndz-external-drag-hover', onExternalDragHover);
      window.removeEventListener('bndz-external-drop', onExternalDragEnd);
      window.removeEventListener('bndz-external-drop-failed', onExternalDragEnd);
    };
  }, [applyFileDragHoverAtPoint]);

  useEffect(() => {
    const onMagnetApplied = () => {
      setExternalDragActive(false);
      setExternalDragPaths([]);
    };
    window.addEventListener('bndz-magnet-applied', onMagnetApplied);
    return () => window.removeEventListener('bndz-magnet-applied', onMagnetApplied);
  }, []);

  useLayoutEffect(() => {
    registerFileDropBusContext({
      getPanes: () => panesRef.current,
      getActivePaneId: () => activePaneIdRef.current,
      getPathContents: (tabPath) => {
        const norm = normalizePanePath(tabPath);
        return pathContentsCacheRef.current[tabPath] ?? pathContentsCacheRef.current[norm];
      },
      getHtmlDropTarget: () => htmlDropTargetRef.current,
      getActivePaneListCenter: () => {
        const paneId = activePaneIdRef.current;
        const el = document.querySelector(`[data-list-body][data-list-pane-id="${paneId}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      activatePaneTab: (paneId, tabIndex) => {
        flushSync(() => {
          setActivePaneId(paneId);
          setPanes(prevPanes => {
            const next = prevPanes.map(p =>
              p.id === paneId ? { ...p, activeTabIndex: tabIndex } : p,
            );
            panesRef.current = next;
            return next;
          });
        });
      },
      applyHover: applyFileDragHoverAtPoint,
      executeDrop: (op, paths, destPath, sourcePath) => {
        executeInternalDropRef.current(op, paths, destPath, sourcePath);
      },
      addTab,
      setActivePaneId,
      toast: setToastMessage,
      bottomPluginTab,
      onArchiveAdd: (archivePath, paths) => {
        void import('../lib/ipcBridge').then(async ({ IPC }) => {
          const winPaths = paths.map(toWindowsPath);
          const entryNames = winPaths.map(p => p.split(/[/\\]/).pop() || 'file');
          const result = await IPC.archiveAddFiles(archivePath, winPaths, entryNames);
          if (result.success) {
            setToastMessage(`Added ${paths.length} item(s) to archive.`);
            window.dispatchEvent(new CustomEvent('bndz-archive-reload', { detail: { path: archivePath } }));
          } else {
            setToastMessage(result.error || 'Failed to add to archive.');
          }
        });
      },
    });
  }, [applyFileDragHoverAtPoint, addTab, bottomPluginTab]);

  // Host: AllowExternalDrop=true (except BNDZ OLE) — Path A file: nav + Path B WPF PreviewDrop + forceCommit.
  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;

      const clientX = typeof detail.webViewX === 'number' ? detail.webViewX
        : typeof detail.clientX === 'number' ? detail.clientX
        : (recordExternalDragHover.last.valid ? recordExternalDragHover.last.clientX : window.innerWidth / 2);
      const clientY = typeof detail.webViewY === 'number' ? detail.webViewY
        : typeof detail.clientY === 'number' ? detail.clientY
        : (recordExternalDragHover.last.valid ? recordExternalDragHover.last.clientY : window.innerHeight / 2);

      // Spatial / Automation canvas owns its own drop surface.
      if (hitTestWorkspaceSurfaceAtPoint(clientX, clientY)) return;

      setExternalDragPaths(paths);
      void commitExternalOleDrop({
        paths,
        webViewX: typeof detail.webViewX === 'number' ? detail.webViewX : undefined,
        webViewY: typeof detail.webViewY === 'number' ? detail.webViewY : undefined,
        clientX,
        clientY,
        source: 'externalOle',
        preferredEffect: detail.preferredEffect,
        fromBndzOle: !!detail.fromBndzOle,
        coordSourceHint: detail.coordSource,
      });
    };

    const onExternalDropFailed = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const reason = detail.reason || 'Could not read dropped files.';
      const formats = Array.isArray(detail.formats) ? detail.formats.join(', ') : '';
      setToastMessage(
        typeof reason === 'string'
          ? (formats ? `${reason} (${formats})` : reason)
          : 'Drop failed — no file paths extracted.',
      );
    };

    const onArchiveDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;

      const clientX = typeof detail.clientX === 'number' ? detail.clientX : window.innerWidth / 2;
      const clientY = typeof detail.clientY === 'number' ? detail.clientY : window.innerHeight / 2;
      if (hitTestWorkspaceSurfaceAtPoint(clientX, clientY)) return;

      commitArchiveInternalDrop({
        paths,
        clientX,
        clientY,
        source: 'archiveInternal',
        op: detail.op === 'move' ? 'move' : 'copy',
      });
    };

    window.addEventListener('bndz-external-drop', onExternalDrop);
    window.addEventListener('bndz-external-drop-failed', onExternalDropFailed);
    window.addEventListener('bndz-archive-drop', onArchiveDrop);
    return () => {
      window.removeEventListener('bndz-external-drop', onExternalDrop);
      window.removeEventListener('bndz-external-drop-failed', onExternalDropFailed);
      window.removeEventListener('bndz-archive-drop', onArchiveDrop);
    };
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      void import('../lib/ipcBridge').then(({ IPC }) => IPC.notifyUiReady());
    };
    void import('../lib/ipcBridge').then(({ IPC }) => {
      IPC.notifyUiReady();
      if (isFilesHostBoot()) {
        const pane = panesRef.current?.find((p: { id: string }) => p.id === activePaneIdRef.current)
          || panesRef.current?.[0];
        const tab = pane?.tabs?.[pane.activeTabIndex ?? 0];
        const cur = typeof tab?.path === 'string' ? normalizePanePath(tab.path) : '';
        if (cur) requestFilesHostDirListing(cur);
      }
    });
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  // Startup: warm open-tab listing visuals into L1/FE Map (Desktop/Downloads/Documents warmed on host).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const paths = new Set<string>();
      for (const pane of panesRef.current ?? panes) {
        for (const tab of pane.tabs) {
          const p = normalizePanePath(tab.path);
          if (p && !isVirtualCatalogPath(p) && !isBndzVirtualPath(p)) paths.add(p);
        }
      }
      for (const path of paths) {
        const cached = pathContentsCacheRef.current[path];
        if (Array.isArray(cached) && cached.length > 0) {
          prefetchListingVisuals(cached, path, {
            ...listingPrefetchFromConfig(configRef.current),
            iconLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 120,
            thumbLimit: configRef.current.createAllThumbnailsAtOnce ? 50_000 : 48,
          });
        } else {
          void beginDirFetchRef.current?.(path);
        }
      }
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once after mount; panesRef covers later tabs
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/ipcBridge').then(({ IPC }) => {
      unsub = IPC.onOpenPath(path => {
        if (!path) return;
        const norm = normalizePanePath(path);
        // Settings → Open command line start path in a new tab
        if (config.openCommandLineStartPathInNewTab) {
          addTab(activePaneId, norm);
          return;
        }
        // Settings → Open new instance always (multi-instance)
        if (config.openNewInstanceAlways && config.allowMultipleInstances) {
          void IPC.openPathInNewWindow(norm).then(r => {
            if (!r.ok) setCurrentPath(norm);
          });
          return;
        }
        setCurrentPath(norm);
      });
    });
    return () => { if (unsub) unsub(); };
  }, [activePaneId, config.openCommandLineStartPathInNewTab, config.openNewInstanceAlways, config.allowMultipleInstances]);

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
        } else if (action.startsWith('plugin:')) {
          const pluginId = action.slice(7).trim();
          if (pluginId) {
            // Let BNDZ_OPEN_PATH land first, then open the plugin for that selection.
            window.setTimeout(() => openBottomPlugin(pluginId), 80);
          }
        }
      });
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const goBack = (paneId: string = activePaneId) => {
    const histBeh = getHistoryBehavior(config);
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         if (tab.historyIndex > 0) {
             const newHistoryIndex = tab.historyIndex - 1;
             const path = tab.history[newHistoryIndex];
             newTabs[p.activeTabIndex] = {
               ...tab,
               path,
               historyIndex: newHistoryIndex,
               selectedItems: (histBeh.historyRetainsSelections || !!config.historyRetainsSelections) ? tab.selectedItems : [],
               viewMode: (histBeh.historyRetainsSortOrder || !!config.historyRetainsSortOrder) ? tab.viewMode : tab.viewMode,
             };
         }
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };

  const goForward = (paneId: string = activePaneId) => {
    const histBeh = getHistoryBehavior(config);
    setPanes(prev => prev.map(p => {
      if (p.id === paneId) {
         const newTabs = [...p.tabs];
         const tab = newTabs[p.activeTabIndex];
         if (tab.historyIndex < tab.history.length - 1) {
             const newHistoryIndex = tab.historyIndex + 1;
             const path = tab.history[newHistoryIndex];
             newTabs[p.activeTabIndex] = {
               ...tab,
               path,
               historyIndex: newHistoryIndex,
               selectedItems: (histBeh.historyRetainsSelections || !!config.historyRetainsSelections) ? tab.selectedItems : [],
             };
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
        // Above omni-filter (500) and nav-back (100); below menus/dialogs.
        // Bubble-phase Esc was losing to capture-phase nav-back (tree path change).
        id: 'bottom-immersive',
        priority: 550,
        isActive: () => bottomImmersive,
        dismiss: () => exitBottomImmersive(),
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
    bottomImmersive, exitBottomImmersive,
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
                  sortColumn: ((config.listSortColumn as SortColumnId) || 'name'),
                  sortDirection: (config.listSortDirection === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
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
          if (isQueuedIpcResult(res)) {
              pushToast({ kind: 'info', title: 'Sync queued', message: 'Running in the transfer panel…' });
              return;
          }
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
      IPC.getSystemDrives().then(d => setDrives(Array.isArray(d) ? d : []));
      IPC.getCloudProviders().then(p => setCloudProviders(Array.isArray(p) ? p : []));
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
         newTabs[p.activeTabIndex] = {
           ...tab,
           viewMode: nextMode,
           // Entering Columns freezes the left edge at the current folder.
           millerRootPath: nextMode === 'columns'
             ? normalizePanePath(tab.path || '/')
             : undefined,
         };
         return { ...p, tabs: newTabs };
      }
      return p;
    }));
  };

  const resolveEntityByteSize = React.useCallback((entity: any, panePath: string) => {
    const isDir = entity?.type === 'directory' || entity?.type === 'folder';
    if (isDir) {
      const drive = entity.driveInfo;
      if (drive && typeof drive.totalSpace === 'number') {
        const free = typeof drive.freeSpace === 'number'
          ? drive.freeSpace
          : (typeof drive.availableSpace === 'number' ? drive.availableSpace : 0);
        const used = Math.max(0, drive.totalSpace - free);
        return used > 0 ? used : drive.totalSpace;
      }
      const key = toWindowsPath(joinPanePath(panePath, entity)).toLowerCase();
      const cached = folderSizeMap[key];
      if (typeof cached === 'number') return cached;
    }
    return Number(entity?.size) || 0;
  }, [folderSizeMap]);

  const toggleSort = (paneId: string, column: SortColumnId) => {
    const pane = panes.find(p => p.id === paneId);
    const tab = pane?.tabs[pane.activeTabIndex];
    if (tab?.viewLocked) {
      setToastMessage('View is locked. Unlock to change sort.');
      return;
    }
    const keepId = focusedItemId || tab?.selectedItems?.[0] || null;
    const rememberPerTab = !!config.rememberListSettingsPerTab;
    const effectiveCol = pane
      ? ((rememberPerTab && tab?.sortColumn) || pane.sortColumn || resolveSortColumn(config, pane))
      : resolveSortColumn(config);
    const effectiveDir = resolveSortDirection(
      effectiveCol,
      (rememberPerTab && tab?.sortDirection) || pane?.sortDirection,
      config,
    );
    const nextDir: 'asc' | 'desc' = effectiveCol === column
      ? (effectiveDir === 'asc' ? 'desc' : 'asc')
      : (column === 'size' && config.sortSizeColumnsDescendingByDefault)
        ? 'desc'
        : (column === 'modified' && config.sortDateColumnsDescendingByDefault)
          ? 'desc'
          : 'asc';
    setPanes(prev => prev.map(p => {
      if (p.id !== paneId) return p;
      if (rememberPerTab) {
        const tabs = [...p.tabs];
        const ti = p.activeTabIndex;
        tabs[ti] = { ...tabs[ti], sortColumn: column, sortDirection: nextDir };
        return { ...p, tabs, sortColumn: column, sortDirection: nextDir };
      }
      return { ...p, sortColumn: column, sortDirection: nextDir };
    }));
    // Persist globally so sort survives close/reboot even without tabset restore.
    if (!rememberPerTab) {
      updateConfig({ listSortColumn: column, listSortDirection: nextDir });
    }
    if (column === 'size') {
      queueMicrotask(() => scanCurrentFolderSizes(false));
    }
    queueMicrotask(() => {
      const listEl = document.querySelector(`[data-list-body][data-list-pane-id="${paneId}"]`) as HTMLElement | null;
      if (!listEl) return;
      if (config.scrollToTopAfterResorting) {
        listEl.scrollTop = 0;
        return;
      }
      if (config.keepCurrentItemInViewAfterResorting && keepId) {
        scrollListToEntity({
          paneId,
          entityId: String(keepId),
          index: -1,
          rowHeight: Number(settingsRt.ui.rowHeight) || 26,
        });
      }
    });
  };

  const getSortedContentsForActivePane = React.useCallback(() => {
    const pane = panes.find(p => p.id === activePaneId);
    if (!pane) return [] as any[];
    const tab = pane.tabs[pane.activeTabIndex];
    const panePath = tab.path;
    const normPanePath = normalizePanePath(panePath);
    const isThisPc = normPanePath === '/' || normPanePath === '/this-pc';
    const isLibraries = normPanePath.toLowerCase() === '/shell:libraries';
    let contents: any[] = isThisPc
      ? (Array.isArray(drives) ? drives : []).map(d => ({
          id: `drive-${d.name.replace(/^\/+/, '/')}`,
          name: formatDriveLetter(d.name),
          label: d.label,
          type: 'directory',
          path: d.name,
          driveInfo: d,
        }))
      : isLibraries
        ? libraryListEntities
      : (pathContentsCache[panePath] || pathContentsCache[normPanePath] || []);

    const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
    if (isGlobal) {
      contents = globalSearchResults || [];
    } else if (debouncedFilterText.trim() !== '') {
      const beforeFilter = contents;
      contents = filterByName(contents, debouncedFilterText, {
        matchCase: !!settingsRt.search.matchCase,
        multiColumn: !!settingsRt.search.multiColumnMatching,
        localized: !!config.useLocalizedSearchAndFilterPatterns,
        includePath: !!config.findFilesLocation,
      });
      // Settings → Find → Let folders pass all filters
      if (config.letFoldersPassAllFilters) {
        const kept = new Set(contents.map((c: any) => c.id ?? c.path ?? c.name));
        const folders = beforeFilter.filter((item: any) => {
          const isDir = item.type === 'directory' || item.type === 'folder' || item.isDirectory;
          if (!isDir) return false;
          const key = item.id ?? item.path ?? item.name;
          return !kept.has(key);
        });
        if (folders.length) contents = [...folders, ...contents];
      }
    }

    if (pane.filterRegex?.trim()) {
      try {
        const regex = new RegExp(pane.filterRegex, 'i');
        const beforeRegex = contents;
        contents = contents.filter((item: any) => regex.test(item.name));
        if (config.letFoldersPassAllFilters) {
          const kept = new Set(contents.map((c: any) => c.id ?? c.path ?? c.name));
          const folders = beforeRegex.filter((item: any) => {
            const isDir = item.type === 'directory' || item.type === 'folder' || item.isDirectory;
            if (!isDir) return false;
            return !kept.has(item.id ?? item.path ?? item.name);
          });
          if (folders.length) contents = [...folders, ...contents];
        }
      } catch {
        contents = contents.filter((item: any) => item.name.toLowerCase().includes(pane.filterRegex!.toLowerCase()));
      }
    }


    return sortEntities(filterListEntities(contents, config), config, {
      sortColumn: pane.sortColumn,
      sortDirection: pane.sortDirection,
      getByteSize: (entity) => resolveEntityByteSize(entity, panePath),
    });
  }, [panes, activePaneId, pathContentsCache, drives, config, filterText, debouncedFilterText, globalSearchResults, resolveEntityByteSize, libraryListEntities]);

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
    if (isGoogleDriveHubPath(norm)) {
      setCurrentPath('/', paneId);
      setSelectedItems([], paneId);
      return;
    }
    if (isBndzVirtualPath(norm)) {
      if (isBndzRamPath(norm)) {
        if (norm === BNDZ_RAM_ROOT) setCurrentPath(BNDZ_VIEWS_ROOT, paneId);
        else {
          const parent = norm.substring(0, norm.lastIndexOf('/')) || BNDZ_RAM_ROOT;
          setCurrentPath(parent, paneId);
        }
        setSelectedItems([], paneId);
        return;
      }
      if (isBndzHomePath(norm) || norm === BNDZ_VIEWS_ROOT) setCurrentPath('/', paneId);
      else setCurrentPath(BNDZ_VIEWS_ROOT, paneId);
      setSelectedItems([], paneId);
      return;
    }
    if (isShellKnownFolderRoot(norm) || norm.toLowerCase().startsWith('/shell:')) {
      setCurrentPath(shellKnownFolderParent(cPath), paneId);
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
    openSmallTabMenu: (x: number, y: number) => openTabContextMenuAt(paneId, tabIndex ?? 0, x, y),
    autosizeColumns: () => {
      const items = getSortedContentsForActivePane();
      const active = panes.find(x => x.id === paneId);
      const tab = active?.tabs[active?.activeTabIndex ?? 0];
      const folderPath = tab?.path ? normalizePanePath(tab.path) : undefined;
      const cols = getVisibleListColumns(config, folderPath ? { folderPath } : undefined);
      const widths = computeAutosizedColumnWidths(items, cols, {
        disregardHeaders: !!config.onAutosizeDisregardTheColumnHeaders,
        alwaysAutosizeSize: !!config.alwaysAutosizeTheSizeColumn,
        limits: parseColumnAutosizeLimits(config),
      });
      if (Object.keys(widths).length > 0) {
        if (folderPath) {
          const byPath = { ...(config.listColumnWidthsByPath || {}) };
          byPath[folderPath] = { ...(byPath[folderPath] || {}), ...widths };
          updateConfig({
            listColumnWidths: { ...(config.listColumnWidths || {}), ...widths },
            listColumnWidthsByPath: byPath,
          });
        } else {
          updateConfig({ listColumnWidths: { ...(config.listColumnWidths || {}), ...widths } });
        }
      }
    },
    runScript: (shell: string, script: string) => {
      void IPC.runUserScript(shell, script).then(res => setToastMessage(res.output.slice(0, 200) || (res.ok ? 'Script OK' : 'Script failed')));
    },
    toast: setToastMessage,
  }), [panes, addTab, closeTabAt, goUp, openFolderInOppositePane, refetchPath, setToastMessage, getSortedContentsForActivePane, config, updateConfig]);

  // Keyboard state — type-ahead find in file list (Explorer-style)
  typeAheadCtxRef.current = {
    activePaneId,
    focusedItemId,
    config,
    settingsRt,
    getSortedContentsForActivePane,
    contextMenu,
    tabContextMenu,
    openMenuId,
    columnPicker,
    inlineRename,
    isCommandPaletteOpen,
    isSmartToolsOpen,
    isToolbarConfigOpen,
    isTagManagerOpen,
    isConfigDialogOpen,
    isPluginStoreOpen,
    quickPreviewOpen,
    editingAddressBarPaneId,
    rowHeight: settingsRt.ui.rowHeight || 26,
    setFocusedItemId,
    setSelectedItems,
    setFilterText,
    scheduleSelectionChrome,
    scheduleQuickActionsBar,
    selectionAnchorRef,
    omniFilterRef,
  };

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const char = typeAheadCharFromEvent(e);
      if (!char) return;

      const ctx = typeAheadCtxRef.current;
      if (!ctx) return;

      if (ctx.contextMenu
        || ctx.tabContextMenu
        || ctx.openMenuId
        || ctx.columnPicker
        || ctx.inlineRename
        || ctx.isCommandPaletteOpen
        || ctx.isSmartToolsOpen
        || ctx.isToolbarConfigOpen
        || ctx.isTagManagerOpen
        || ctx.isConfigDialogOpen
        || ctx.isPluginStoreOpen
        || ctx.quickPreviewOpen
        || ctx.editingAddressBarPaneId) {
        return;
      }

      const searchRt = ctx.settingsRt?.search;
      const ae = document.activeElement as HTMLElement | null;
      const inList = !!(ae?.closest?.('[data-list-body]') || ae?.hasAttribute?.('data-list-body'));
      const onTabChrome = !!(ae?.closest?.('[data-tabstrip], .bndz-tab-item') || (e.target as HTMLElement | null)?.closest?.('[data-tabstrip], .bndz-tab-item'));
      const editable = isEditableTarget(e.target) || isEditableTarget(ae);
      // Modals / settings own keyboard — never type-ahead into the list behind them.
      if (ae?.closest?.('[role="dialog"], [data-bndz-dialog], .bndz-native-dialog, .bndz-config-dialog')) {
        return;
      }
      // Workspace surfaces own letters.
      if (ae?.closest?.('[data-bndz-workspace-surface], .bndz-automation, .bndz-spatial-canvas, .react-flow')) {
        return;
      }
      if (editable) {
        // Only steal from the omni filter / list when those surfaces themselves own focus.
        // An armed list must NOT blur Settings / Jump-to / other dialogs.
        const editingInListChrome = !!(
          inList
          || ae === ctx.omniFilterRef?.current
          || (e.target as HTMLElement | null)?.closest?.('[data-list-body], .bndz-omni-filter, [data-omni-filter]')
        );
        if (!editingInListChrome) return;
        if (ae === ctx.omniFilterRef?.current && !listTypeAheadArmedRef.current) return;
        try { ae?.blur?.(); } catch { /* ignore */ }
      }

      // Type-ahead disabled: still swallow letters when the list owns keyboard focus so
      // WebView first-letter navigation can't highlight folder tabs (role=button/tabIndex).
      if (!searchRt || searchRt.typeAhead === false || config.enableTypeAheadFind === false) {
        if (listTypeAheadArmedRef.current || inList || onTabChrome) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (searchRt.redirectTypingToFilter || !!config.redirectTypingToLiveFilterBox) {
        e.preventDefault();
        e.stopPropagation();
        listTypeAheadArmedRef.current = false;
        const input = ctx.omniFilterRef?.current as HTMLInputElement | null;
        input?.focus();
        if (input) {
          const next = `${input.value}${char}`;
          ctx.setFilterText(next);
          input.setSelectionRange(next.length, next.length);
        }
        return;
      }

      // Settings → Skip single spaces: Space alone does not advance type-ahead.
      if (config.skipSingleSpaces && char === ' ') return;

      const now = Date.now();
      const { prefix, repeatCycle } = advanceTypeAheadPrefix(
        typeAheadPrefixRef.current,
        typeAheadAtRef.current,
        char,
        now,
        { allowRepeatCycle: searchRt.allowRepeatedCharacters !== false },
      );
      typeAheadPrefixRef.current = prefix;
      typeAheadAtRef.current = now;
      e.preventDefault();
      e.stopPropagation();

      let listItemsRaw = (ctx.getSortedContentsForActivePane?.() || []) as any[];
      if (searchRt.useSortedColumn || config.useSortedColumn) {
        // Prefer current column sort order (already applied by getSortedContents).
        listItemsRaw = [...listItemsRaw];
      }
      const findBeh = getFindBehavior(ctx.config);
      const listItems = findBeh.applyToFilesOnly || findBeh.foldersOnly
        ? listItemsRaw.filter((item: any) => {
            const isDir = item?.type === 'directory' || item?.isDirectory;
            if (findBeh.foldersOnly) return !!isDir;
            if (findBeh.applyToFilesOnly) return !isDir;
            return true;
          })
        : listItemsRaw;
      if (!listItems.length) return;

      const matchMode = searchRt.typeAheadMatch || config.typeAheadFindMatch || 'Match at beginning';
      const ignoreDia = !!searchRt.ignoreDiacritics;
      const matchCase = !!searchRt.matchCase;
      const multiCol = !!searchRt.multiColumnMatching;
      const predicate = (item: any) => {
        const display = getDisplayName(item, ctx.config);
        const raw = typeAheadEntityName(item, display);
        const hit = (name: string) => matchesTypeAhead(name, prefix, matchMode, ignoreDia, matchCase);
        if (hit(raw) || (raw !== display && hit(display))) return true;
        if (multiCol) {
          const ext = String(item?.extension || '');
          const typ = String(item?.typeDescription || '');
          if (ext && hit(ext)) return true;
          if (typ && hit(typ)) return true;
        }
        return false;
      };

      // Explorer: walk current view order from focus (ignore alpha re-sort).
      // Prefer sync last-hit over React state so rapid same-key presses cycle.
      const focusForPick = typeAheadMatchIdRef.current || ctx.focusedItemId || null;
      const match = pickTypeAheadMatch(listItems, predicate, focusForPick, repeatCycle);
      if (!match) return;
      typeAheadMatchIdRef.current = match.id;

      const paneId = ctx.activePaneId as string;
      const index = listItems.findIndex((item: any) => item.id === match.id);
      const rowHeight = Number(ctx.rowHeight) || 26;

      ctx.setFocusedItemId(match.id);
      if (findBeh.autoSelectFirstMatch !== false && findBeh.autoSelectFirstMatch !== '') {
        ctx.setSelectedItems([match.id], paneId);
      }
      if (ctx.selectionAnchorRef) {
        ctx.selectionAnchorRef.current = { paneId, itemId: match.id };
      }
      ctx.scheduleSelectionChrome?.([match.id], true);
      ctx.scheduleQuickActionsBar?.(true, true);

      scrollListToEntity({
        paneId,
        entityId: String(match.id),
        index,
        rowHeight,
      });
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Keyboard state (navigation, shortcuts — separate from type-ahead capture handler)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const millerNavKeys = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Backspace', 'Home', 'End']);
      const inMiller = !!(e.target as HTMLElement | null)?.closest?.('.bndz-miller')
        || !!document.activeElement?.closest?.('.bndz-miller');
      const columnsViewActive = activeTab.viewMode === 'columns';
      const deferToMiller = (inMiller || columnsViewActive)
        && millerNavKeys.has(e.key)
        && !e.altKey
        && !e.ctrlKey
        && !e.metaKey
        && !isInput;

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
      } else if (e.altKey && e.key === 'ArrowUp') {
         e.preventDefault();
         goUp(activePaneId);
      } else if (e.key === 'Backspace' && !isInput) {
         if (deferToMiller) return;
         e.preventDefault();
         goUp(activePaneId);
      }

      if (deferToMiller) return;

      // Ignore other keys if user is typing in another input (like Smart Tools)
      if (isInput && document.activeElement !== omniFilterRef.current) return;

      // Allow typing in OmniFilter to proceed normally, but handle specific keys like Down/Up/Enter
      if (document.activeElement === omniFilterRef.current && !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
          return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          cycleActivePaneTab(e.shiftKey ? -1 : 1);
        } else if (isDualPane) {
           const mode = String(config.tabKeyDualPane || 'Tab between both panes only');
           if (mode.toLowerCase().includes('cycle')) {
             const ae = document.activeElement as HTMLElement | null;
             if (ae === omniFilterRef.current) {
               const list = document.querySelector(`[data-list-body][data-list-pane-id="${activePaneId}"]`) as HTMLElement | null;
               list?.focus({ preventScroll: true });
             } else {
               const nextIdx = (activePaneIndex + 1) % panes.length;
               setActivePaneId(panes[nextIdx].id);
               omniFilterRef.current?.blur();
             }
           } else {
             const nextIdx = (activePaneIndex + 1) % panes.length;
             setActivePaneId(panes[nextIdx].id);
           }
        }
      } else if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        addTab(activePaneId, activeTab.path, { preferConfiguredHome: true });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const items = getSortedContentsForActivePane();
        setSelectedItems(items.map((x: any) => x.id), activePaneId);
        if (items[0]) selectionAnchorRef.current = { paneId: activePaneId, itemId: items[0].id };
        scheduleQuickActionsBar(true, true);
        return;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'PageDown' || e.key === 'PageUp') {
        // Find → Enable navigation keys gates list arrow navigation while a filter is active.
        if (filterText.trim() && getFindBehavior(config).enableNavigationKeys === false) {
          return;
        }
        e.preventDefault();
        let paneContents = getSortedContentsForActivePane();
        if (paneContents.length === 0) return;

        const pageSize = Math.max(10, Math.floor((document.querySelector('[data-list-body]')?.clientHeight || 400) / 24));
        let idx = paneContents.findIndex((c: any) => c.id === focusedItemId || (activeTab.selectedItems.length > 0 && c.id === activeTab.selectedItems[0]));
        const baseIdx = idx === -1 ? 0 : idx;

        if (e.key === 'Home') idx = 0;
        else if (e.key === 'End') idx = paneContents.length - 1;
        else if (e.key === 'PageDown') idx = Math.min(baseIdx + pageSize, paneContents.length - 1);
        else if (e.key === 'PageUp') idx = Math.max(baseIdx - pageSize, 0);
        else {
          idx = wrapListIndex(baseIdx, e.key === 'ArrowDown' ? 1 : -1, paneContents.length, {
            ...config,
            wrapAroundList: config.wrapAroundList,
          } as typeof config);
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
             // Arrow focus snaps selection to the new item (Settings → selectAllOnItemChange reinforces this).
             if (config.selectAllOnItemChange !== false || !e.ctrlKey) {
               setSelectedItems([nextItem.id], activePaneId);
               scheduleSelectionChrome([nextItem.id], true);
               scheduleQuickActionsBar(true, true);
             }
           }
           scrollListToEntity({
             paneId: activePaneId,
             entityId: String(nextItem.id),
             index: idx,
             rowHeight: settingsRt.ui.rowHeight || 26,
           });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeTab.selectedItems.length > 0) {
           let paneContents = getSortedContentsForActivePane();
           const isGlobal = config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> ');
           if (isGlobal) {
               paneContents = globalSearchResults || [];
           } else if (filterText.trim() !== '' && paneContents.length === 0) {
               paneContents = filterByName(safeGetDirContents(fileSystem, activeTab.path) || [], filterText) as any;
           }
           const selectedItem = paneContents?.find((c: any) => c.id === activeTab.selectedItems[0]) as any;
           if (selectedItem?.type === 'directory') {
               setCurrentPath(resolveEntityPanePath(activeTab.path, selectedItem), activePaneId);
               const findBeh = getFindBehavior(config);
               if (
                 !findBeh.persistAcrossFolders
                 && !findBeh.persistQuickSearchAcrossFolders
                 && !config.persistQuickSearchAcrossFolders
                 && !findBeh.persistentLiveFilters
               ) {
                 setFilterText(''); // Clear filter when opening directory
               }
               omniFilterRef.current?.blur();
           } else if (selectedItem) {
               const target = isGlobal && selectedItem.path
                 ? selectedItem.path
                 : joinPanePath(activeTab.path, selectedItem);
               IPC.executeContextMenuVerb(toWindowsPath(target), 'open');
           }
        }
      }
      
      if (matchesShortcut(e, keyboardMap.delete)) {
         if (getListIxBehavior(config).deleteOnKeyUp) return;
         const activePane = panes.find(p => p.id === activePaneId);
         if (activePane) {
             const tab = activePane.tabs[activePane.activeTabIndex];
             if (tab.selectedItems.length > 0) {
                 const norm = normalizePanePath(tab.path);
                 const dirContents = pathContentsCache[tab.path] || pathContentsCache[norm] || getSortedContentsForActivePane() || [];
                 const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                 if (selectedEntities.length > 0) {
                     handleDeleteRequest(selectedEntities, tab.path, focusedItemId === 'TREE', { permanent: e.shiftKey });
                 }
             }
         }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, keyboardMap.delete)) return;
      if (!getListIxBehavior(config).deleteOnKeyUp) return;
      const activePane = panes.find(p => p.id === activePaneId);
      if (!activePane) return;
      const tab = activePane.tabs[activePane.activeTabIndex];
      if (!tab.selectedItems.length) return;
      const norm = normalizePanePath(tab.path);
      const dirContents = pathContentsCache[tab.path] || pathContentsCache[norm] || getSortedContentsForActivePane() || [];
      const selectedEntities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
      if (selectedEntities.length > 0) {
        handleDeleteRequest(selectedEntities, tab.path, focusedItemId === 'TREE', { permanent: e.shiftKey });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
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
    const rootDriveEntities = navigationDrives.map(d => {
        const normalizedName = d.name.replace(/^\/+/, '/');
        const letter = formatDriveLetter(normalizedName);
        return {
            id: `drive-${normalizedName}`,
            name: formatDriveDisplayName(d.label, normalizedName),
            type: "directory",
            path: normalizedName,
            size: d.totalSpace,
            tags: [],
            typeDescription: `${formatDriveVolumeLabel(d.label, letter) || letter} Drive (${d.format || d.fileSystem || 'Local'})`,
            driveInfo: d
        };
    });

    let activeContents = currentPath === '/' || currentPath === '/this-pc'
      ? rootDriveEntities
      : normalizePanePath(currentPath).toLowerCase() === '/shell:libraries'
        ? libraryListEntities
        : safeGetDirContents(fileSystem, currentPath);
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
        void (async () => {
          const q = filterText.trim() || (await requestNativePrompt({
            title: 'New Finding Tab',
            message: 'Search query',
            defaultValue: '',
          })) || '';
          if (q.trim()) addFindingTab(activePaneId, q.trim());
        })();
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
    const previewTabIndex = fileDragListPreview?.paneId === pane.id
      ? fileDragListPreview.tabIndex
      : null;
    const displayTabIndex = previewTabIndex ?? pane.activeTabIndex;
    const currentTab = pane.tabs[displayTabIndex] ?? resolvePaneTab(pane);
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
    const listFontPx = readSettingNumber(config, 'listFontSize', 0)
      || (typeof document !== 'undefined' && document.documentElement.dataset.bndzShell === 'native-host' ? 14 : 13);
    const configuredRowH = readSettingNumber(config, 'rowHeight', 0);
    // Row height follows Appearance density + list font (Settings → Appearance).
    const detailsRowHeight = configuredRowH > 0
      ? configuredRowH
      : isNeutralDefault
        ? Math.max(compactRowHeight, Math.ceil(listFontPx * 1.85) + 4)
        : detailsMetrics.rowHeight;
    const detailsIconSize = isNeutralDefault ? 14 : detailsMetrics.icon;
    const detailsIconColClass = isNeutralDefault ? 'w-5' : detailsMetrics.iconColClass;
    const detailsPadY = isNeutralDefault
      ? Math.max(2, Math.floor((detailsRowHeight - detailsIconSize) / 2))
      : detailsMetrics.padY;
    const listRt = settingsRt.list;
    const panePath = currentTab.path;
    const isFindingTabActive = isFindingTab(currentTab);
    const isGlobal = isFindingTabActive || (isActive && config.enableGlobalSearchPrefix && filterText.trimStart().startsWith('> '));
    
    const normPanePath = normalizePanePath(panePath);
    const isThisPc = normPanePath === '/' || normPanePath === '/this-pc';
    const isLibraries = normPanePath.toLowerCase() === '/shell:libraries';
    const isGoogleHub = isGoogleDriveHubPath(normPanePath);
    const paneGridMetrics = isThisPc ? thisPcGridMetrics : gridMetrics;
    const paneListMetrics = isThisPc ? thisPcListMetrics : listMetrics;
    const cachedContents = !isThisPc && !isGoogleHub && !isLibraries ? pathContentsCache[normPanePath] : undefined;
    const hasLoadError = !!(pathLoadErrors[normPanePath] || pathLoadErrors[panePath]);
    let contents = isThisPc
      ? rootDriveEntities
      : isLibraries
        ? libraryListEntities
      : isGoogleHub
        ? googleDriveHubEntities(cloudNav.googleAccounts)
        : safeGetDirContents(fileSystem, panePath);
    if (!isThisPc && !isGoogleHub && !isLibraries && cachedContents !== undefined) {
      contents = cachedContents;
    }
    // Failed fetches leave cache undefined (no sticky empty). Show error UI instead of
    // spinning forever / hammering refetchPath every render.
    const isPanePending = !isThisPc && !isGoogleHub && !isLibraries && cachedContents === undefined && !hasLoadError;
    if (isPanePending) {
      if (!refetchInFlightRef.current[normPanePath] && !loadingPaths.has(normPanePath)) {
        void refetchPath(panePath);
      }
      contents = null;
    } else if (!isThisPc && !isGoogleHub && !isLibraries && cachedContents === undefined && hasLoadError) {
      contents = [];
    }
    const isPaneLoading = isPanePending;

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
        contents = sortEntities(filterListEntities(contents, config), {
          ...config,
          keepFoldersOnTop: config.keepFoldersOnTop,
          sortFoldersApart: config.sortFoldersApart,
          sortFilenamesByBase: config.sortFilenamesByBase,
          sortMethod: config.sortMethod,
          sortFoldersAlwaysAscending: config.sortFoldersAlwaysAscending,
          defaultToTreeLikeSortOrder: config.defaultToTreeLikeSortOrder,
          onSortingKeepTaggedItemsOnTop: config.onSortingKeepTaggedItemsOnTop,
          mixedSortOnDateColumns: config.mixedSortOnDateColumns,
          mixedSortOnTagColumns: config.mixedSortOnTagColumns,
          mixedSortOnPathColumns: config.mixedSortOnPathColumns,
          treatHyphensAndApostrophesLikeNormalCharacters: config.treatHyphensAndApostrophesLikeNormalCharacters,
        }, {
            sortColumn: (config.rememberListSettingsPerTab && currentTab.sortColumn) || pane.sortColumn,
            sortDirection: (config.rememberListSettingsPerTab && currentTab.sortDirection) || pane.sortDirection,
            getByteSize: (entity) => resolveEntityByteSize(entity, panePath),
        });
    }

    const listGroupBy: ListGroupBy = isSemanticDeskActive()
      ? 'semantic'
      : (config.listGroupBy as ListGroupBy) || 'none';
    const listRows = contents && computedViewMode === 'details' && listGroupBy !== 'none'
      ? flattenGroupedList(contents, listGroupBy, panePath, {
          sundayIsTheFirstDayOfTheWeek: config.sundayIsTheFirstDayOfTheWeek,
        })
      : (contents || []);
    stickyScrollMetaRef.current[pane.id] = {
      rows: listGroupBy !== 'none' && computedViewMode === 'details' ? (listRows as ListRowItem[]) : [],
      rowHeight: detailsRowHeight,
      enabled: config.stickyGroupHeaders !== false && listGroupBy !== 'none' && computedViewMode === 'details',
    };

    const mouseRt = settingsRt.mouse;
    const listTooltipsEnabled = !!(config.showHoverBox || config.extraFields || config.showPhotoDataInTheHoverBox
      || config.showAudioInfoAndTags || config.showTipsForClippedTreeAndListItems || config.forJunctionsAsWell);

    const buildEntityPath = (ent: any) => resolveEntityPanePath(panePath, ent);

    const openEntity = (entity: any) => {
      const entityPath = buildEntityPath(entity);
      const rawPath = String(entity.path || entityPath || '');
      const winPath = toWindowsPath(entityPath);
      const shellParsing = rawPath.startsWith('::{')
        || rawPath.toLowerCase().startsWith('shell:')
        || !!(entity as any)?.isShellItem;

      // Shell namespace folders (MTP, Control Panel categories): navigate in-pane.
      // Non-folder shell applets: ShellExecute — never fake a folder navigate.
      if (shellParsing && entity.type === 'directory') {
        setCurrentPath(entityPath, pane.id);
        if (isGlobal) {
          setFilterText('');
          omniFilterRef.current?.blur();
        }
        return;
      }
      if (shellParsing) {
        import('../lib/ipcBridge').then(({ IPC }) => {
          const openPath = rawPath.startsWith('::{') || rawPath.toLowerCase().startsWith('shell:')
            ? rawPath
            : winPath;
          IPC.recordPathOpen(openPath);
          IPC.executeContextMenuVerb(openPath, 'open');
        });
        return;
      }

      if (entity.type === 'directory') {
        setCurrentPath(entityPath, pane.id);
        if (isGlobal) {
          setFilterText('');
          omniFilterRef.current?.blur();
        } else {
          const findBeh = getFindBehavior(config);
          if (
            !findBeh.persistAcrossFolders
            && !findBeh.persistQuickSearchAcrossFolders
            && !config.persistQuickSearchAcrossFolders
            && !findBeh.persistentLiveFilters
          ) {
            setFilterText('');
            omniFilterRef.current?.blur();
          }
        }
      } else {
        import('../lib/ipcBridge').then(({ IPC }) => {
          IPC.recordPathOpen(winPath);
        });
        // Open inside BNDZ — select + Quick Preview (not Explorer ShellExecute).
        if (entity?.id) {
          setSelectedItems([entity.id], pane.id);
          setFocusedItemId(entity.id);
        }
        const listing = contents || safeGetDirContents(fileSystem, panePath) || [];
        const idx = listing.findIndex((c: any) => c.id === entity.id || buildEntityPath(c) === entityPath);
        openQuickPreviewRef.current?.(idx >= 0 ? idx : undefined);
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
        // Sticky checkbox mode: plain click toggles membership (Ctrl-like) instead of replacing.
        if (mouseRt.stickyCheckboxSelection || !!config.stickyCheckboxSelection) {
          const next = currentTab.selectedItems.includes(id)
            ? currentTab.selectedItems.filter(x => x !== id)
            : [...currentTab.selectedItems, id];
          const resolved = next.length ? next : [id];
          setSelectedItems(resolved, pane.id);
          scheduleSelectionChrome(resolved, true);
          scheduleQuickActionsBar(resolved.length > 0, true);
          selectionAnchorRef.current = { paneId: pane.id, itemId: id };
          setLastClickData(null);
          return;
        }

        setSelectedItems([id], pane.id);
        scheduleSelectionChrome([id], true);
        scheduleQuickActionsBar(true, false);
        selectionAnchorRef.current = { paneId: pane.id, itemId: id };

        const singleClickOpen = mouseRt.singleClickOpen
          || !!config.singleClickToOpenAnItem
          || !!config.openItemsOnSingleClick;
        const foldersOnlyOpen = mouseRt.foldersOnly || !!config.foldersOnly;
        const openOnIconOnly = mouseRt.openOnIconOnly || !!config.onTheIconOnly;
        const openAllowed = singleClickOpen
          && entity
          && (!foldersOnlyOpen || entity.type === 'directory');
        if (openAllowed) {
          if (openOnIconOnly) {
            const t = e.target as HTMLElement;
            if (!t.closest('.bndz-clipboard-icon-slot, .bndz-list-thumb, img, canvas')) {
              // Select only — open requires an icon hit.
            } else {
              openEntity(entity);
              return;
            }
          } else {
            openEntity(entity);
            return;
          }
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
      if (listClickDeferTimerRef.current) {
        clearTimeout(listClickDeferTimerRef.current);
        listClickDeferTimerRef.current = null;
      }
      clearSlowDoubleClickTimer(renameTimerRef);
      setActivePaneId(pane.id);
      setFocusedItemId(entity.id);
      scheduleSelectionChrome([entity.id], true);
      scheduleQuickActionsBar(false);
      setLastClickData(null);
      setInlineRename(null);
      listEntityDblRef.current = null;
      if (mouseRt.doubleClickOpen) openEntity(entity);
    };
    listEntityDoubleClickRef.current = handleEntityDoubleClicked;

    const handleEntityMiddleClick = (e: React.MouseEvent, entity: any) => {
      // auxclick fires for BOTH middle (1) and right (2) buttons; only act on middle.
      // Right-click must fall through to the context-menu handler, never open a pane.
      if (e.button !== 1) return;
      e.preventDefault();
      // Settings → On middle mouse down (thumbnail/icons): folder contents peek when enabled.
      if (config.onMiddleMouseDown && entity.type === 'directory' && config.folderContentsPreview) {
        void openFolderContentsPeek(buildEntityPath(entity), String(entity.name || ''), e.clientX, e.clientY);
        return;
      }
      // Settings → Enable blow ups on file icons as well → middle-click Quick Look any file.
      if (config.enableBlowUpsOnFileIconsAsWell && entity.type !== 'directory') {
        const idx = (contents || []).findIndex((c: { id: string }) => c.id === entity.id);
        openQuickPreviewRef.current?.(idx >= 0 ? idx : undefined);
        return;
      }
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

    const visibleListColumns = getVisibleListColumns(config, { isGlobalSearch: isGlobal, folderPath: normalizePanePath(currentTab.path) });

    let maxFolderSizeInDir = 0;
    const dirItemsForSize = pathContentsCache[normPanePath] || contents || [];
    for (const ent of dirItemsForSize) {
      if (ent.type !== 'directory') continue;
      const key = toWindowsPath(joinPanePath(normPanePath, ent)).toLowerCase();
      const sz = folderSizeMap[key];
      // Ignore in-flight / denied markers so bars don't thrash while scanning.
      if (typeof sz === 'number' && sz > 0 && sz > maxFolderSizeInDir) maxFolderSizeInDir = sz;
    }
    // Freeze denominator while a scan pass is active so relative bars stay readable.
    if (folderSizeScanActiveRef.current && maxFolderSizeInDir <= 0) {
      maxFolderSizeInDir = 1;
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
        healthBadge?: { severity: 'critical' | 'warning' | 'info'; title: string } | undefined;
      },
    ) => {
      const { isDir, displayName, renameInput, filterResult, filterColor, entityTags, panePath, healthBadge } = opts;
      const textStyle = filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {};
      const mutedColClass = (settingsRt.list.lighterDetailColumns || !!config.lighterTextInDetailsColumns) ? 'bndz-detail-col-muted' : '';
      // Settings → Use empty cell defaults
      const emptyDefault = (value: React.ReactNode): React.ReactNode => {
        if (value !== null && value !== undefined && value !== '') return value;
        return config.useEmptyCellDefaults ? <span className="text-gray-600">—</span> : null;
      };
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
            <div key={colId} data-col-id="name" className="flex items-center min-w-0 h-full w-full">
                              <div
                                data-bndz-clip-tip
                                className="bndz-list-name bndz-list-select-cell px-2 whitespace-nowrap overflow-hidden text-ellipsis shadow-none focus:outline-none flex items-center gap-1.5 min-w-0 shrink max-w-full"
                                style={textStyle}
                              >
                {renameInput || displayName}
                {healthBadge && (
                  <div
                    className="w-2 h-2 rounded-full shrink-0 ring-1 ring-black/50"
                    style={{ backgroundColor: HEALTH_BADGE_COLORS[healthBadge.severity] }}
                    title={healthBadge.title}
                  />
                )}
              </div>
              <div className="bndz-list-marquee-pad" aria-hidden />
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
              showItemCountWithFolderSizes: config.showItemCountWithFolderSizes,
            },
            formatSize,
            typeof (entity as any).childCount === 'number'
              ? (entity as any).childCount
              : typeof (entity as any).itemCount === 'number'
                ? (entity as any).itemCount
                : null,
          ) : formatSize((entity as any).size);
          const barPct = isDir && maxFolderSizeInDir > 0 && typeof folderBytes === 'number' && folderBytes > 0
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
              {emptyDefault(formatFsDateTime(entity.modified))}
            </div>
          );
        case 'created':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`}>
              {emptyDefault(formatFsDateTime((entity as any).created))}
            </div>
          );
        case 'attributes':
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-500 font-mono text-[10px] tracking-wider whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`} title={(entity.attributes || []).join(', ')}>
              {emptyDefault(formatAttributesLabel(entity.attributes))}
            </div>
          );
        case 'tags':
          return (
            <div
              key={colId}
              data-col-id="tags"
              className="bndz-list-select-cell px-2 flex gap-1 h-full items-center overflow-hidden min-w-0"
              onClick={(e) => {
                if (!config.toggleTagsByColumnClick || !config.tags) return;
                e.stopPropagation();
                const last = lastAppliedTagRef.current;
                if (!last) {
                  setToastMessage('Pick a tag from the Tags menu first, then click the Tags column to toggle.');
                  return;
                }
                void applyTagToSelection(last);
              }}
              onContextMenu={(e) => {
                if (!config.popupByTagColumnsRightClick) return;
                e.preventDefault();
                e.stopPropagation();
                // Ensure this row is selected before opening tag popup via menubar Tags.
                if (!currentTab.selectedItems.includes(entity.id)) {
                  if (config.alsoOnFullRowSelect || config.applyTaggingToAllSelectedItems) {
                    /* keep multi-select when applying to all */
                  } else {
                    setSelectedItems([entity.id], pane.id);
                  }
                }
                setToastMessage('Use Tags menu or Command Deck to assign labels.');
              }}
            >
              {(settingsRt.list.showTags || !!config.showTagsInFileList) && config.fileTagging !== false && [...new Set(entityTags)].map(t => (
                <TagBadge key={t} tagKey={t} catalog={availableTags} compact />
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
        case 'path': {
          const rawPath = entity.path || joinPanePath(panePath, entity);
          let shown = formatUiPath(rawPath);
          if (config.showRelativePathInPathColumn) {
            const winFull = toWindowsPath(rawPath);
            const winBase = toWindowsPath(panePath);
            const baseNorm = winBase.replace(/[\\/]+$/, '').toLowerCase();
            const fullNorm = winFull.replace(/[\\/]+$/, '');
            if (baseNorm && fullNorm.toLowerCase().startsWith(baseNorm)) {
              const rel = fullNorm.slice(winBase.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
              if (rel) shown = rel;
            }
          }
          return (
            <div key={colId} className="bndz-list-select-cell px-2 text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis font-mono text-[10px]" title={shown}>
              {shown}
            </div>
          );
        }
        case 'originalLocation': {
          const loc = formatUiPath(String((entity as any).originalLocation || '')) || String((entity as any).originalLocation || '');
          return (
            <div key={colId} className="bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis font-mono text-[10px]" title={loc}>
              {loc || <span className="text-gray-600">—</span>}
            </div>
          );
        }
        case 'originalPath': {
          const op = formatUiPath(String((entity as any).originalPath || '')) || String((entity as any).originalPath || '');
          return (
            <div key={colId} className="bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis font-mono text-[10px]" title={op}>
              {op || <span className="text-gray-600">—</span>}
            </div>
          );
        }
        case 'ghostState': {
          const ghost = !!(entity as any).isGhostLink;
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`} title={ghost ? ((entity as any).linkTarget || 'Ghost link') : ''}>
              {ghost ? (
                <span className="inline-flex items-center gap-1 text-violet-300/90 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400/90" />
                  Ghost
                </span>
              ) : (
                <span className="text-gray-600 text-[11px]">—</span>
              )}
            </div>
          );
        }
        case 'coldTarget': {
          const targetRaw = String((entity as any).linkTarget || '');
          const target = formatUiPath(targetRaw) || targetRaw;
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis font-mono text-[10px] ${mutedColClass}`} title={target}>
              {target || <span className="text-gray-600">—</span>}
            </div>
          );
        }
        case 'ramZone': {
          const fullPath = normalizePanePath(entity.path || joinPanePath(panePath, entity));
          const zoneId = parseBndzRamZoneId(fullPath);
          const label = zoneId || String((entity as any).ramZoneId || (entity as any).ramZone || '');
          return (
            <div key={colId} className={`bndz-list-select-cell px-2 whitespace-nowrap overflow-hidden text-ellipsis ${mutedColClass}`} title={label || undefined}>
              {label ? (
                <span className="inline-flex items-center gap-1 text-sky-300/90 text-[11px] font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400/90" />
                  {label}
                </span>
              ) : (
                <span className="text-gray-600 text-[11px]">—</span>
              )}
            </div>
          );
        }
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
          if (se.fsPath) return String(se.fsPath);
          return isGlobal && se.path ? se.path : joinPanePath(panePath, se);
        }).filter(Boolean) as string[];
      } else {
        paths = [
          (anchorEntity as any).fsPath
            ? String((anchorEntity as any).fsPath)
            : joinPanePath(panePath, anchorEntity),
        ];
      }
      return paths.map(p => canonicalDropPath(p));
    };

    const buildFluidDragItems = (anchorEntityId: string, selectionOverride?: string[]) => {
      const selection = selectionOverride ?? currentTab.selectedItems;
      const ids = selection.includes(anchorEntityId) && selection.length > 0
        ? selection
        : [anchorEntityId];
      return ids.map((sid: string) => {
        const se = contents?.find((c: any) => c.id === sid);
        if (!se) return null;
        const p = isGlobal && se.path ? se.path : joinPanePath(panePath, se);
        const isDir = se.type === 'directory' || se.type === 'folder';
        return {
          path: canonicalDropPath(p),
          name: se.name || 'Item',
          isDirectory: isDir,
        };
      }).filter(Boolean) as Array<{ path: string; name: string; isDirectory: boolean }>;
    };

    return (
      <div 
        key={pane.id}
        data-pane-id={pane.id}
        className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${config.applyColors ? '' : 'bg-[#1c1c1c]'} ${isActive && isDualPane ? 'shadow-[inset_0_0_0_1px_rgba(59,130,246,0.6)] z-10' : ''} relative`}
        style={config.applyColors ? { background: 'var(--list-bg)', color: 'var(--list-text)' } : { background: 'var(--list-bg, #1c1c1c)', color: 'var(--list-text, #d4d4d4)' }}
        onClick={() => { setActivePaneId(pane.id); }}
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
        {/* Tab Strip — dnd-kit horizontal reorder (same pattern as column headers) */}
        <PaneTabStrip
          paneId={pane.id}
          tabs={pane.tabs}
          activeTabIndex={displayTabIndex}
          tabBarHeight={config.tabBarHeight}
          flexibleTabWidth={config.flexibleTabWidth === true}
          resizableTabs={config.resizableTabs === true}
          tabCustomWidths={(config.tabCustomWidths as Record<string, number> | undefined) || {}}
          onTabWidthChange={(pathKey, widthPx) => {
            updateConfig({
              tabCustomWidths: {
                ...((config.tabCustomWidths as Record<string, number> | undefined) || {}),
                [pathKey]: widthPx,
              },
            });
          }}
          makeSelectedTabBold={config.makeSelectedTabBold}
          applyColors={config.applyColors}
          showIconsTabs={config.showIconsTabs}
          showXCloseButtonsOnTabs={config.showXCloseButtonsOnTabs}
          showNewTabButton={config.showNewTabButton}
          showTabListButton={config.showTabListButton}
          tabFontSize={config.tabFontSize}
          buttonsPosition={config.buttonsPositionTabs}
          minimumTabWidthInPixels={config.minimumTabWidthInPixels}
          maximumTabWidthInPixels={config.maximumTabWidthInPixels}
          visualStyleTabs={config.visualStyleTabs}
          getPaneTabLabel={(path) => formatTabCaption(config, path, {
            filterText: isActive ? filterText : undefined,
            filterRegex: pane.filterRegex,
          })}
          onActivate={(idx) => setActiveTab(pane.id, idx)}
          onReorder={(from, to) => reorderTab(pane.id, from, to)}
          onClose={(idx, e) => { void closeTabAt(pane.id, idx, e); }}
          onContextMenu={(idx, e) => {
            e.preventDefault();
            openTabContextMenuAt(pane.id, idx, e.clientX, e.clientY);
          }}
          onMiddleClick={(idx) => {
            dispatchCustomEvent(config, 'middle-click-tab', buildCeaHandlers(pane.id, idx));
          }}
          onAddTab={() => addTab(pane.id, currentTab.path, { preferConfiguredHome: true })}
          allowAddTabsViaDragDrop={getTabLimitBehavior(config).addTabsViaDragAndDropOnTabBar !== false}
          onDropPathAsNewTab={(rawPath) => {
            const norm = normalizePanePath(rawPath.replace(/\\/g, '/'));
            addTab(pane.id, norm);
          }}
          scheduleTabSwitchOnFileDrag={(idx) => scheduleTabSwitchOnFileDrag(pane.id, idx)}
          clearTabFileDragTimer={clearTabFileDragTimer}
          tabFileDropTargetIndex={tabFileDropTarget?.paneId === pane.id ? tabFileDropTarget.tabIndex : null}
          newTabDropActive={newTabDropPaneId === pane.id}
          setNewTabDropActive={(active) => setNewTabDropPaneId(active ? pane.id : null)}
          setTabFileDropTargetIndex={(idx) => {
            if (idx == null) {
              setTabFileDropTarget(null);
              return;
            }
            activateTabForFileDragImmediate(pane.id, idx);
          }}
          dropModifierCopy={(copy) => { dropModifierRef.current.copy = copy; }}
          suspendTabReorder={pointerFileDragActive}
          onPointerFileDragOverTab={(idx) => activateTabForFileDragImmediate(pane.id, idx)}
        />
        
        {/* Breadcrumb Row — Files NavigationToolbar-height address strip under filesHost */}
        <div className={`bndz-files-address-strip flex ${config.applyColors ? '' : 'bg-[#1a1a1a]'} border-b border-[#333] items-center px-1.5 shrink-0 ${isDualPane && !isActive ? 'opacity-90' : ''}`}
             style={config.applyColors
               ? { background: 'var(--breadcrumb-bg)', color: 'var(--breadcrumb-text)' }
               : { background: 'var(--breadcrumb-bg, var(--bndz-surface-chrome))', color: 'var(--breadcrumb-text, var(--text-muted))' }}>
            <ToolbarButton launcherIcon={launcherIconUrl('nav_back')} className={`bndz-files-nav-btn ${currentTab.historyIndex > 0 ? '' : 'opacity-30'}`} onClick={() => goBack(pane.id)} />
            <ToolbarButton launcherIcon={launcherIconUrl('nav_forward')} className={`bndz-files-nav-btn ${currentTab.historyIndex < currentTab.history.length - 1 ? '' : 'opacity-30'}`} onClick={() => goForward(pane.id)} />
            <ToolbarButton launcherIcon={launcherIconUrl('nav_up')} className="bndz-files-nav-btn" onClick={() => goUp(pane.id)} />
            <div 
              className="bndz-breadcrumb-slot bndz-files-address-well flex flex-1 min-w-0 basis-0 items-center text-[13px] px-2 overflow-x-auto overflow-y-hidden whitespace-nowrap cursor-text relative"
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
                            import('../lib/ipcBridge').then(async ({ IPC }) => {
                              const expand = (p: string) => IPC.expandEnvironmentPath(p);
                              // Settings → Honor relative paths
                              const honoredRaw = resolveHonoredPath(config, raw, currentTab.path);

                              // XYplorer-style: path ? filter pattern
                              if (honoredRaw.includes('?')) {
                                const [pathPart, filterPart] = honoredRaw.split('?').map(s => s.trim());
                                const pathFromPart = (await resolveUserPathToPane(pathPart || '', expand))
                                  || parseUserPathToPane(pathPart || '')
                                  || currentTab.path;
                                let newPath = pathFromPart.replace(/\\/g, '/');
                                if (!newPath.startsWith('/')) newPath = '/' + newPath;
                                newPath = resolveShellKnownFolderToFs(newPath, shortcuts);
                                if (isVirtualCatalogPath(newPath)) {
                                  setCurrentPath(newPath, pane.id);
                                  if (filterPart) setFilterText(filterPart);
                                  setEditingAddressBarPaneId(null);
                                  return;
                                }
                                const exists = await IPC.checkPathExists(newPath);
                                if (exists) {
                                  setCurrentPath(newPath, pane.id);
                                  if (filterPart) setFilterText(filterPart);
                                }
                                setEditingAddressBarPaneId(null);
                                return;
                              }

                              const parsedPath = (await resolveUserPathToPane(honoredRaw, expand))
                                || parseUserPathToPane(honoredRaw);
                              if (!parsedPath) {
                                setEditingAddressBarPaneId(null);
                                return;
                              }
                              const newPath = resolveShellKnownFolderToFs(parsedPath, shortcuts);
                              if (isVirtualCatalogPath(newPath)) {
                                setCurrentPath(newPath, pane.id);
                                setEditingAddressBarPaneId(null);
                                return;
                              }
                              const exists = await IPC.checkPathExists(newPath);
                              if (exists) setCurrentPath(newPath, pane.id);
                              setEditingAddressBarPaneId(null);
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
                     // Settings → Select match on drop down: highlight same-named item in the opened folder.
                     if (config.selectMatchOnDropDown) {
                       const leaf = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
                       if (leaf) {
                         queueMicrotask(() => {
                           const items = pathContentsCacheRef.current[normalizePanePath(path)] || [];
                           const hit = items.find((x: any) => String(x.name || '').toLowerCase() === leaf.toLowerCase());
                           if (hit) {
                             setSelectedItems([hit.id], pane.id);
                             setFocusedItemId(hit.id);
                           }
                         });
                       }
                     }
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
              ) : (
                <BreadcrumbTrail
                  segments={getBreadcrumbSegments(currentTab.path, catalogNameMap)}
                  dropTarget={breadcrumbDropTarget}
                  onNavigate={(path, opts) => {
                    if (opts?.newTab) { addTab(pane.id, path); return; }
                    if (isDualPane && pane.id !== activePaneId) setActivePaneId(pane.id);
                    setCurrentPath(path, pane.id);
                  }}
                />
              )}
            </div>
            <ToolbarButton
              launcherIcon={launcherIconUrl('lock_ui')}
              className={`w-5 bndz-view-mode-btn ${currentTab.viewLocked ? 'bndz-view-lock-btn--active text-amber-400' : 'opacity-50'}`}
              title={currentTab.viewLocked ? 'Unlock view (sort/filter frozen)' : 'Lock view'}
              onClick={() => toggleViewLock(pane.id)}
            />
            {/* Views · Group · size slider · Filter — packed tight (no mid-bar gutter). */}
            <div className="bndz-list-views-cluster flex items-center shrink-0 gap-1 ml-0.5 mr-0.5 min-w-0">
            <div className="flex bg-[#222] border border-[#444] rounded-[var(--bndz-radius-sm)] items-center p-[2px] text-[11px] shrink-0 gap-[2px]">
                 <button onMouseDown={e => runWebViewPrimaryAction(e, () => setViewMode('details', pane.id))} className={`bndz-view-mode-btn bndz-view-mode-btn--details w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'details' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Details View (click again for default)">
                     <img src={launcherIconUrl('view_details')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onMouseDown={e => runWebViewPrimaryAction(e, () => setViewMode('grid', pane.id))} className={`bndz-view-mode-btn bndz-view-mode-btn--grid w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'grid' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Grid View (click again for default)">
                     <img src={launcherIconUrl('view_grid')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onMouseDown={e => runWebViewPrimaryAction(e, () => setViewMode('list', pane.id))} className={`bndz-view-mode-btn bndz-view-mode-btn--list w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'list' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="List View (click again for default)">
                     <img src={launcherIconUrl('view_list')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onMouseDown={e => runWebViewPrimaryAction(e, () => setViewMode('columns', pane.id))} className={`bndz-view-mode-btn bndz-view-mode-btn--columns w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'columns' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Columns View (click again for default)">
                     <img src={launcherIconUrl('view_columns')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
                 <button onMouseDown={e => runWebViewPrimaryAction(e, () => setViewMode('size', pane.id))} className={`bndz-view-mode-btn bndz-view-mode-btn--size w-6 h-6 flex items-center justify-center ${currentTab.viewMode === 'size' ? 'bndz-view-mode-btn--active' : 'text-gray-300 hover:bg-[#333]'}`} title="Size map">
                     <img src={launcherIconUrl('folder_size_sync')} alt="" className="w-3 h-3 object-contain pointer-events-none" draggable={false} />
                 </button>
            </div>
              {(currentTab.viewMode === 'details' || (isNeutralDefault && computedViewMode === 'details')) && (
                  <select
                    value={listGroupBy}
                    onChange={e => updateConfig({ listGroupBy: e.target.value as ListGroupBy })}
                    className="bg-[#222] border border-[#444] rounded-[var(--bndz-radius-sm)] text-[10px] px-1.5 py-0.5 w-[100px] shrink-0 text-gray-300"
                    title="Group by"
                  >
                    {LIST_GROUP_BY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>Group: {o.label}</option>
                    ))}
                  </select>
              )}
              {currentTab.viewMode === 'details' && !isNeutralDefault && (
                  <BndzDensitySlider
                    min={12}
                    max={48}
                    value={detailsIconSz}
                    onLiveChange={v => setLiveDensity({ mode: 'details', value: v })}
                    onChange={v => {
                      updateConfig({ detailsIconSize: v });
                    }}
                    title="Details icon size"
                  />
              )}
              {(computedViewMode === 'grid' || computedViewMode === 'list') && (
                <BndzDensitySlider
                  min={12}
                  max={computedViewMode === 'grid' ? 192 : 96}
                  value={computedViewMode === 'grid' ? gridIconSz : listIconSz}
                  onLiveChange={v => setLiveDensity({
                    mode: computedViewMode === 'grid' ? 'grid' : 'list',
                    value: v,
                  })}
                  onChange={v => {
                    if (computedViewMode === 'grid') updateConfig({ gridIconSize: v });
                    else updateConfig({ listIconSize: v });
                  }}
                  title={computedViewMode === 'grid' ? 'Grid icon size' : 'List density (narrow → wide columns)'}
                />
              )}
            <div className="flex bg-[#222] border border-[#444] rounded items-center px-2 py-0.5 text-[11px] shrink-0 w-[140px] focus-within:w-[200px] focus-within:border-[#0078d4] transition-[width,border-color] duration-200">
               <Icons8Icon id="search" size={12} className="mr-1.5 opacity-60" />
               <input
                   type="text"
                   placeholder="Regex Filter..."
                   className="bg-transparent border-none outline-none text-gray-200 flex-1 min-w-0 placeholder:text-gray-600"
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
        </div>

        {(computedViewMode === 'details') && (settingsRt.list.showSortHeaders || config.showSortHeadersInAllViews !== false) && (
        <div
           className={`fs-list-header bndz-list-header-bar flex text-[11px] shrink-0 select-none ${!(settingsRt.list.verticalGridLines || config.verticalGridLinesInDetailsView) ? 'bndz-list-header-bar--no-grid' : ''}`}
           onContextMenu={e => { e.preventDefault(); setColumnPicker({ x: e.clientX, y: e.clientY }); }}
        >
           {/* Must mirror details row chrome (marquee lead + checkbox + icon) or columns drift. */}
           <div className="bndz-list-marquee-lead shrink-0" aria-hidden />
           {listRt.showSelectionCheckboxes && (
             <div className="bndz-list-col-header bndz-list-col-header--gutter w-5 shrink-0" aria-hidden />
           )}
           <div className={`bndz-list-col-header bndz-list-col-header--gutter ${detailsIconColClass}`} aria-hidden />
           <ListColumnHeaderStrip
             columns={getVisibleListColumns(config, { isGlobalSearch: isGlobal, folderPath: normalizePanePath(currentTab.path) })}
             sortColumn={pane.sortColumn ?? (config.rememberListSettingsPerTab ? currentTab.sortColumn : undefined) ?? resolveSortColumn(config, pane)}
             sortDirection={resolveSortDirection(
               pane.sortColumn ?? (config.rememberListSettingsPerTab ? currentTab.sortColumn : undefined) ?? resolveSortColumn(config, pane),
               (config.rememberListSettingsPerTab && currentTab.sortDirection) || pane.sortDirection,
               config,
             )}
             showImplicitSecondarySortOrderArrow={!!config.showImplicitSecondarySortOrderArrow}
             onToggleSort={(colId) => {
               if (columnResizeActiveRef.current) return;
               toggleSort(pane.id, colId);
             }}
             onStartResize={startColumnResize}
             onReorder={(nextVisible) => {
               const full = resolveListColumnOrder(config);
               const visibleSet = new Set(nextVisible);
               const hidden = full.filter(id => !visibleSet.has(id));
               const nextOrder = [...nextVisible, ...hidden];
               if (nextOrder.join('|') !== full.join('|')) {
                 updateConfig({ listColumnOrder: nextOrder });
               }
             }}
           />
        </div>
        )}
        {(computedViewMode !== 'details' && computedViewMode !== 'columns') && (settingsRt.list.showSortHeaders || config.showSortHeadersInAllViews !== false) && (
          <div className="bndz-list-header-bar-spacer shrink-0" aria-hidden />
        )}

        {!!config.showFilterInformationInList && isActive && !isGlobal && !isFindingTabActive && (
          (filterText.trim() && !filterText.trimStart().startsWith('> ')) || !!pane.filterRegex?.trim()
        ) && (
          <div className="bndz-list-filter-info shrink-0 flex items-center gap-2 px-3 py-1 text-[11px] text-sky-200/90 bg-sky-500/[0.07] border-b border-sky-500/15">
            <Icons8Icon id="search" size={12} className="opacity-70" />
            <span className="truncate">
              Filter
              {filterText.trim() && !filterText.trimStart().startsWith('> ') ? `: “${filterText.trim()}”` : ''}
              {pane.filterRegex?.trim() ? ` · regex /${pane.filterRegex.trim()}/` : ''}
              {contents ? ` · ${contents.length} match(es)` : ''}
            </span>
            <button
              type="button"
              className="ml-auto text-[10px] text-sky-300/80 hover:text-white shrink-0"
              onClick={() => {
                setFilterText('');
                const newPanes = [...panes];
                const p = newPanes.find(x => x.id === pane.id);
                if (p) p.filterRegex = '';
                setPanes(newPanes);
              }}
            >
              Clear
            </button>
          </div>
        )}

        {!!config.showSearchInformationInList && (isGlobal || isFindingTabActive) && (
          <div className="bndz-list-search-info shrink-0 flex items-center gap-2 px-3 py-1 text-[11px] text-amber-200/90 bg-amber-500/[0.07] border-b border-amber-500/15">
            <Icons8Icon id="search" size={12} className="opacity-70" />
            <span className="truncate">
              {isFindingTabActive
                ? `Finding: “${currentTab.findingQuery || ''}”`
                : `Search: “${filterText.trimStart().replace(/^>\s*/, '')}”`}
              {contents ? ` · ${contents.length} result(s)` : ''}
              {isGlobal && globalSearchEngine ? ` · ${globalSearchEngine}` : ''}
            </span>
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
            onFolderContextMenu={(e) => {
              if (isBndzWorkspacePath(normPanePath)) return;
              void handleContextMenuRequest(e, panePath, null, true, null, undefined, 'list-background');
            }}
          />
        )}

        {helloGateBlocked[normPanePath] ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0e14]/92 backdrop-blur-sm">
            <HelloGateOverlay
              folderPath={normPanePath}
              gatePath={helloGateBlocked[normPanePath]}
              onUnlocked={() => {
                setHelloGateBlocked(prev => {
                  const next = { ...prev };
                  delete next[normPanePath];
                  return next;
                });
                void refetchPath(normPanePath);
              }}
              onCancel={() => {
                setHelloGateBlocked(prev => {
                  const next = { ...prev };
                  delete next[normPanePath];
                  return next;
                });
                setCurrentPath('/', pane.id);
              }}
            />
          </div>
        ) : null}
        {/* List Items */}
        <div 
           ref={(node) => { paneScrollElsRef.current[pane.id] = node; }}
           data-list-pane-id={pane.id}
           data-list-body
           data-list-row-height={
             computedViewMode === 'grid' ? paneGridMetrics.rowHeight :
             computedViewMode === 'list' ? paneListMetrics.rowHeight :
             detailsRowHeight
           }
           tabIndex={-1}
           className={`flex-1 min-h-0 overflow-y-auto focus:outline-none relative bndz-scrollbar bndz-file-list-scroll cursor-default ${
             computedViewMode === 'details'
               ? (listGroupBy !== 'none' ? 'pb-1 pt-0' : 'py-1')
               : 'p-1'
           }${isBndzWorkspacePath(normPanePath) ? ' bndz-list-body--workspace' : ''}${pointerFileDragActive ? ' bndz-list-body--file-drag' : ''}${
             computedViewMode === 'grid' ? ' bndz-list-body--grid' :
             computedViewMode === 'list' ? ' bndz-list-body--icons-list' : ''
           }`}
           style={{
             ...(config.applyColors ? { color: 'var(--list-text)' } : { color: '#fff' }),
             // Settings → Mouse → Scroll margin: keep focused/selected rows clear of edges
             ...(Number(config.scrollMargin) > 0
               ? {
                   scrollPaddingTop: Number(config.scrollMargin),
                   scrollPaddingBottom: Number(config.scrollMargin),
                 }
               : {}),
           }}
           onScroll={e => handlePaneScroll(pane.id, e)}
           onWheel={(e) => {
             const listIx = getListIxBehavior(config);
             const lines = Math.max(1, Number(listIx.wheelScrollLines) || Number(config.wheelScrollLines) || 3);
             const rowH = Number((e.currentTarget as HTMLElement).getAttribute('data-list-row-height')) || 26;
             if (e.ctrlKey && listIx.ctrlWheelScrollsThroughTheListViews) {
               e.preventDefault();
               const modes: Array<'details' | 'grid' | 'list' | 'columns'> = ['details', 'grid', 'list', 'columns'];
               const cur = (currentTab.viewMode || 'details') as typeof modes[number];
               const idx = modes.indexOf(cur);
               const next = modes[(idx + (e.deltaY > 0 ? 1 : -1) + modes.length) % modes.length];
               setViewMode(next, pane.id);
               return;
             }
             if (e.shiftKey && listIx.shiftWheelScrollsHorizontally) {
               e.preventDefault();
               (e.currentTarget as HTMLElement).scrollLeft += (e.deltaY > 0 ? 1 : -1) * rowH * lines;
               return;
             }
             // Custom line count when not native pixel scrolling dominance
             if (lines !== 3 && Math.abs(e.deltaY) > 0 && e.deltaMode === 1) {
               e.preventDefault();
               (e.currentTarget as HTMLElement).scrollTop += (e.deltaY > 0 ? 1 : -1) * rowH * lines;
             }
           }}
           onPaste={(e) => {
             const findBeh = getFindBehavior(config);
             if (!findBeh.pasteAndFind) return;
             const text = e.clipboardData?.getData('text/plain')?.trim();
             if (!text || text.includes('\n') || text.length > 260) return;
             // Path-looking pastes stay as paste; short queries become find filter.
             if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.startsWith('/')) return;
             e.preventDefault();
             setFilterText(text);
             omniFilterRef.current?.focus();
           }}
           onContextMenu={(e) => {
             if (isBndzWorkspacePath(normPanePath)) return;
             if ((e.target as HTMLElement).closest('[data-bndz-workspace-surface], [data-bndz-workspace-menu], [data-bndz-surface], .react-flow, .bndz-automation, .bndz-spatial-canvas')) return;
             if ((e.target as HTMLElement).closest('.fs-item-wrapper')) return;
             void handleContextMenuRequest(e, panePath, null, true, null, undefined, 'list-background');
           }}
           onClick={(e) => {
              if (isBndzWorkspacePath(normPanePath)) return;
              if (e.defaultPrevented) return;
              if (consumeMarqueeDragOccurred()) return;
              const recentPress = listItemPressGuardRef.current;
              if (recentPress && performance.now() - recentPress.at < 500) return;
              // Row hits own handlers; only true list canvas clears selection.
              if ((e.target as HTMLElement).closest('.fs-item-wrapper')) return;
              setSelectedItems([], pane.id);
              selectionAnchorRef.current = null;
              scheduleSelectionChrome([], true);
              scheduleQuickActionsBar(false);
              setFocusedItemId(null);
              setLastClickData(null);
              setInlineRename(null);
           }}
           onPointerDownCapture={(e) => {
              if (e.button !== 0) return;
              if (isWorkspacePointerTarget(e.target)) return;
              if (isBndzHomePath(normPanePath) || isBndzWorkspacePath(normPanePath) || normPanePath === BNDZ_VIEWS_ROOT) return;
              if ((e.target as HTMLElement).closest('[data-bndz-surface], .react-flow, .bndz-automation, .bndz-spatial-canvas, .bndz-home')) return;
              if ((e.target as HTMLElement).closest('input, textarea, button, select, a')) return;

              const listEl = e.currentTarget as HTMLElement;
              listEl.focus({ preventScroll: true });
              listTypeAheadArmedRef.current = true;
              const ctrlKey = e.ctrlKey || e.metaKey;
              const shiftKey = e.shiftKey;
              setMarqueeDragOccurred(false);

              const buildSelectMeta = (): MarqueeSelectMeta | undefined => {
                const rows = listRows?.length ?? 0;
                // Always use arithmetic hit-test for non-empty lists — O(n) AABB vs O(n×5×elementsFromPoint).
                if (rows === 0) return undefined;
                if (computedViewMode === 'grid' || computedViewMode === 'list') {
                  const minW = computedViewMode === 'list'
                    ? paneListMetrics.tileWidth
                    : ('minWidth' in paneGridMetrics ? paneGridMetrics.minWidth : gridMetrics.minWidth);
                  const stride = computedViewMode === 'list'
                    ? paneListMetrics.stride
                    : ('stride' in paneGridMetrics ? paneGridMetrics.stride : gridMetrics.stride);
                  const gap = computedViewMode === 'list'
                    ? paneListMetrics.gap
                    : ('gap' in paneGridMetrics ? paneGridMetrics.gap : gridMetrics.gap);
                  const style = getComputedStyle(listEl);
                  const padL = parseFloat(style.paddingLeft) || 0;
                  const padR = parseFloat(style.paddingRight) || 0;
                  const padT = parseFloat(style.paddingTop) || 0;
                  const contentW = Math.max(1, (listEl.clientWidth || 800) - padL - padR);
                  const pack = packGridTracks(contentW, minW, gap);
                  return {
                    rowHeight: stride,
                    gridCols: pack.cols,
                    colWidth: pack.tileWidth,
                    colGap: gap,
                    contentOffsetX: padL,
                    contentOffsetY: padT,
                    items: (listRows || []).flatMap((item: any, index: number) =>
                      isGroupHeaderRow(item)
                        ? []
                        : [{ id: item.id, rowIndex: Math.floor(index / pack.cols), colIndex: index % pack.cols }],
                    ),
                  };
                }
                return {
                  rowHeight: detailsRowHeight,
                  items: (listRows || []).flatMap((item: any, rowIndex: number) =>
                    isGroupHeaderRow(item) ? [] : [{ id: item.id, rowIndex }],
                  ),
                };
              };

              const rowEl = (e.target as HTMLElement).closest('.fs-item-wrapper') as HTMLElement | null;
              // Multi-signal hit test (listGestureHit): gutters / empty / row chrome → marquee;
              // icon, name, column cells → item select+drag. Never convert item presses to marquee.
              const gestureIntent = classifyListPointerDown(e.target, e.clientX, e.clientY);
              if (gestureIntent === 'marquee') {
                if (mouseRt.enableSurroundSelection === false) {
                  // Surround selection off — empty-canvas press only clears selection.
                  setSelectedItems([], pane.id);
                  scheduleSelectionChrome([], true);
                  scheduleQuickActionsBar(false);
                  return;
                }
                beginMarqueeGesture(
                  pane.id, listEl, e.clientX, e.clientY,
                  ctrlKey || shiftKey, (ctrlKey || shiftKey) ? [...currentTab.selectedItems] : [],
                  buildSelectMeta(),
                  e.pointerId,
                );
                return;
              }

              // Item hit → select / drag / double-click.
              if (!rowEl) return;
              const entityId = rowEl.getAttribute('data-id');
              if (!entityId) return;
              const wasSelected = currentTab.selectedItems.includes(entityId);
              const selectedOnPress = !wasSelected && !ctrlKey && !shiftKey;
              const startX = e.clientX;
              const startY = e.clientY;
              const capturePointerId = e.pointerId;
              const altKey = e.altKey;

              // Arm drag against the *previous* press timestamp, then stamp this press.
              // Marking first made canStartDragFromList always fail (double-click guard).
              const disallowListDrag = mouseRt.disallowDragFromList || !!config.disallowLeftDraggingFromFileList;
              const mayArmDrag = canStartDragFromList(disallowListDrag);
              // Settings → Allow dragging items by the thumbnail (default off: icon press does not arm drag).
              const hitOnThumb = !!(e.target as HTMLElement).closest('.bndz-clipboard-icon-slot, img, canvas');
              const thumbDragOk = mouseRt.dragByThumbnail || !!config.allowDraggingItemsByTheThumbnail;
              // Settings → Allow dragging from a background window (inactive / unfocused host).
              const bgDragOk = mouseRt.allowDraggingFromBackground
                || !!config.allowDraggingFromABackgroundWindow
                || document.hasFocus();
              const mayArmDragFinal = mayArmDrag && (thumbDragOk || !hitOnThumb) && bgDragOk;
              const cancelDeferredClick = isWithinDoubleClickGuard() && !!listClickDeferTimerRef.current;
              markPointerDown();
              listItemPressGuardRef.current = { entityId, at: performance.now() };

              // Select immediately on press — Explorer feel; don't wait for pointerup/WebView2 onClick.
              if (!ctrlKey && !shiftKey) {
                if (!wasSelected) {
                  setSelectedItems([entityId], pane.id);
                  scheduleSelectionChrome([entityId], true);
                  scheduleQuickActionsBar(true, true);
                  selectionAnchorRef.current = { paneId: pane.id, itemId: entityId };
                }
                setFocusedItemId(entityId);
                setActivePaneId(pane.id);
              }

              listGestureRef.current = {
                paneId: pane.id,
                pointerId: capturePointerId,
                startX, startY,
                entityId,
                wasSelected,
                selectedOnPress,
                ctrlKey,
                shiftKey,
                altKey,
                moved: false,
                mode: 'pending',
                copyDrag: !!ctrlKey,
                dragSelection: wasSelected || ctrlKey || shiftKey
                  ? [...new Set([...currentTab.selectedItems, entityId])]
                  : [entityId],
                listEl,
              };

              if (cancelDeferredClick && listClickDeferTimerRef.current) {
                clearTimeout(listClickDeferTimerRef.current);
                listClickDeferTimerRef.current = null;
              }

              if (mayArmDragFinal) {
                beginDragSession(
                  capturePointerId,
                  startX,
                  startY,
                  wasSelected ? DRAG_DELAY_SELECTED : DRAG_DELAY_DEFAULT,
                );
              }
              let oleDragStarted = false;
              let outsideChromeStreak = 0;
              let keyModBound = false;

              const syncDragModifiers = (e: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
                const copy = isCopyDragModifier(e);
                // Guard: modifier unchanged — no-op to prevent spurious React commits on every move.
                if (dropModifierRef.current.copy === copy) return;
                dropModifierRef.current.copy = copy;
                if (listGestureRef.current?.mode === 'drag') {
                  listGestureRef.current.copyDrag = copy;
                  const dropHint = copy ? 'Drop to copy' : 'Drop to move';
                  const session = getFileDragSession();
                  if (session && session.op !== (copy ? 'copy' : 'move')) {
                    beginFileDragSession({ ...session, op: copy ? 'copy' : 'move' });
                  }
                  if (!fluidDragEnabled) setListDragGhost(g => (g ? { ...g, copy, dropHint } : g));
                  else updateFluidDragMeta({ copy, dropHint });
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
                const millerDest = hitTestMillerDropPathAtPoint(clientX, clientY);
                if (millerDest) {
                  setDragTargetHighlight(millerDest);
                  return { id: millerDest, type: 'directory', name: millerDest.split('/').pop() || millerDest, path: millerDest };
                }
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

              const resolveHoverAtDropPoint = (clientX: number, clientY: number) => {
                resolveTabHoverAtPoint(clientX, clientY);
                let hover = tabFileDragHoverRef.current;
                if (!hover) {
                  const listBody = hitTestListBodyAtPoint(clientX, clientY);
                  const listPaneId = listBody?.getAttribute('data-list-pane-id');
                  const listPane = listPaneId ? panesRef.current.find(p => p.id === listPaneId) : null;
                  if (listPane) {
                    hover = { paneId: listPane.id, tabIndex: listPane.activeTabIndex };
                    tabFileDragHoverRef.current = hover;
                  }
                }
                return hover;
              };

              const resolveBreadcrumbHoverAtPoint = (clientX: number, clientY: number): string | null => {
                const path = hitTestBreadcrumbAtPoint(clientX, clientY);
                setBreadcrumbDropTarget(path);
                return path;
              };

              let dragPointerY: number | null = null;
              // Throttle drop-target hit-tests — only re-run when pointer moves > 2px.
              let lastHitTestX = -999;
              let lastHitTestY = -999;
              // Cached chrome DOMRects for O(1) in-app-chrome check during drag (populated at arm).
              let chromeCacheRects: DOMRect[] = [];
              let cachedNavTreeScroll: HTMLElement | null = null;
              const dragScrollLoop = createDragAutoScrollLoop(
                () => listEl,
                () => dragPointerY,
                { edgePx: 64, maxStepPx: 32 },
              );

              const updateListDragGhost = (ev: PointerEvent) => {
                if (fluidDragEnabled) {
                  fluidDragBridgeSetPointer(listDragGhostElRef.current, ev.clientX, ev.clientY);
                  clearSnapZones();
                  if (dragTargetIdRef.current) setSnapZone('list-folder', true, 0.9);
                  if (tabFileDragHoverRef.current) setSnapZone('tab-drop', true, 0.85);
                  setFluidDragSnapTension(computeSnapTension());
                } else {
                  setDragGhostPosition(listDragGhostElRef.current, ev.clientX, ev.clientY);
                }
              };

              const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== capturePointerId) return;
                if (!listGestureRef.current) return;
                trackDragPointer(ev.clientX, ev.clientY);
                const dx = Math.abs(ev.clientX - startX);
                const dy = Math.abs(ev.clientY - startY);
                const copyHeld = isCopyDragModifier(ev);

                if (listGestureRef.current.mode === 'pending') {
                  // Item presses never convert to marquee (Explorer: marquee is empty/gutter only).
                  if (!hasMetDragThreshold() || !isDragSessionReady()) return;

                  suppressRowClickRef.current = true;
                  setMarqueeDragOccurred(true);

                  if (mouseRt.disallowDragFromList || !!config.disallowLeftDraggingFromFileList) {
                    clearDragSession();
                    return;
                  }

                  const copyDrag = copyHeld;
                  const dragSelection = listGestureRef.current.dragSelection;

                  listGestureRef.current.mode = 'drag';
                  listGestureRef.current.copyDrag = copyDrag;
                  dropModifierRef.current.copy = copyDrag;
                  internalDragRef.current = true;
                  setPointerFileDragActive(true);
                  tabFileDragHoverRef.current = null;

                  // Snapshot chrome zone DOMRects once at arm-time for O(1) point-in-rect
                  // hit-testing during pointermove — avoids elementsFromPoint + closest() thrash.
                  const CHROME_SNAP_SELECTORS = [
                    '[data-pane-id]', '[data-list-body]', '.bndz-chrome-sidebar',
                    '.bndz-chrome-tabstrip', '.bndz-chrome-toolbar', '.bndz-chrome-omnibar',
                    '.bndz-chrome-menubar', '.bndz-chrome-workspace', '.bndz-chrome-bottom',
                    '.bndz-chrome-preview', '.bndz-chrome-statusbar', '[data-breadcrumb-path]',
                    '[data-nav-path]', '.bndz-archive-root', '.sidebar-pin-row',
                    '[data-new-tab-zone]', '[data-bndz-workspace-surface]',
                  ];
                  chromeCacheRects = [];
                  for (const sel of CHROME_SNAP_SELECTORS) {
                    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
                      const r = el.getBoundingClientRect();
                      if (r.width > 0 || r.height > 0) chromeCacheRects.push(r);
                    });
                  }
                  // Also cache the nav-tree scroll element used for auto-scroll.
                  cachedNavTreeScroll = document.querySelector('.nav-tree-scroll') as HTMLElement | null;
                  const anchorEnt = contents?.find((c: any) => c.id === entityId);
                  const dragPaths = buildDragPaths(entityId, dragSelection);
                  beginFileDragSession({
                    paths: dragPaths,
                    op: copyDrag ? 'copy' : 'move',
                    sourcePaneId: pane.id,
                    sourceTabPath: panePath,
                  });
                  if (fluidDragEnabled) {
                    const dragItems = buildFluidDragItems(entityId, dragSelection);
                    fluidDragBridgeSetPointer(listDragGhostElRef.current, ev.clientX, ev.clientY);
                    setMotionDragPhase('arming');
                    armFluidDrag({
                      label: anchorEnt?.name || 'Item',
                      count: dragSelection.length,
                      copy: copyDrag,
                      isDirectory: anchorEnt?.type === 'directory',
                      dropHint: copyDrag ? 'Drop to copy' : 'Drop to move',
                      paths: dragPaths,
                      items: dragItems,
                    }, { x: ev.clientX, y: ev.clientY });
                    setMotionDragPhase('dragging');
                    // Defer thumb prefetch so it does not block the drag-arm tick.
                    setTimeout(() => void prefetchFluidDragThumbs(dragItems, 10), 0);
                  } else {
                    armDragGhost(setListDragGhost, {
                      label: anchorEnt?.name || 'Item',
                      count: dragSelection.length,
                      copy: copyDrag,
                      isDirectory: anchorEnt?.type === 'directory',
                      dropHint: copyDrag ? 'Drop to copy' : 'Drop to move',
                    }, listDragGhostElRef.current, ev.clientX, ev.clientY);
                  }
                  bindKeyModifiers();
                  // Do NOT setPointerCapture during file drag — WebView2 poisons
                  // elementsFromPoint and breaks tab-hover hit testing. Window listeners suffice.
                }

                if (listGestureRef.current.mode === 'pending' && hasMetDragThreshold()) {
                  resolveTabHoverAtPoint(ev.clientX, ev.clientY);
                }

                if (listGestureRef.current.mode === 'drag') {
                  syncDragModifiers(ev);
                  dragPointerY = ev.clientY;
                  dragScrollLoop.start();
                  autoScrollNearEdges(listEl, ev.clientY, { edgePx: 64, maxStepPx: 32 });
                  if (cachedNavTreeScroll) autoScrollNearEdges(cachedNavTreeScroll, ev.clientY, { edgePx: 48, maxStepPx: 24 });
                  const _dragPerfT0 = (window as any).__BNDZ_PERF_DEBUG__ ? performance.now() : 0;
                  updateListDragGhost(ev);

                  // Only re-run expensive hit-tests when pointer moves > 2px.
                  const hitMoved = Math.abs(ev.clientX - lastHitTestX) > 2 || Math.abs(ev.clientY - lastHitTestY) > 2;
                  if (hitMoved) {
                    lastHitTestX = ev.clientX;
                    lastHitTestY = ev.clientY;
                    // Fire hover update (RAF-coalesced via dispatchPointerFileDragMove; stores result
                    // in lastDragHoverStateRef for the gate below).
                    dispatchPointerFileDragMove(ev.clientX, ev.clientY);
                    // tabFileDragHoverRef is already updated synchronously by dispatchPointerFileDragMove above.
                    const hover = tabFileDragHoverRef.current;
                    const hoverPath = hover
                      ? panesRef.current.find(p => p.id === hover.paneId)?.tabs[hover.tabIndex]?.path
                      : null;
                    // Use the last computed hover state (1-frame lag is imperceptible) to decide
                    // whether a folder target exists — avoids repeating the 5-probe elementsFromPoint
                    // calls that already ran in the hover RAF from the previous pointer tick.
                    const lastHover = lastDragHoverStateRef.current?.state;
                    if (!lastHover?.navTreePath && !lastHover?.breadcrumbPath) {
                      resolveDropTarget(ev.clientX, ev.clientY, hoverPath ? contentsForPanePath(hoverPath) : contents);
                    } else {
                      setDragTargetHighlight(null);
                    }
                  }

                  // O(1) chrome-zone check via cached DOMRects (replaces elementsFromPoint + closest() thrash).
                  const cx = ev.clientX, cy = ev.clientY;
                  const overInternalChrome = chromeCacheRects.some(
                    r => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom,
                  );
                  if (overInternalChrome) {
                    outsideChromeStreak = 0;
                  } else {
                    outsideChromeStreak++;
                  }

                  if (!oleDragStarted && getFileDragSession() && outsideChromeStreak >= 2) {
                    const dragPaths = buildDragPaths(entityId, listGestureRef.current.dragSelection);
                    if (dragPaths.length) {
                      const meshPaths = dragPaths.filter(isMeshPath);
                      const localPaths = dragPaths.filter(p => !isMeshPath(p)).map(toWindowsPath);

                      const startOleDrag = (outPaths: string[]) => {
                        if (!outPaths.length || oleDragStarted) return;
                        oleDragStarted = true;
                        nativeOleDragRef.current = true;
                        internalDragRef.current = false;
                        setPointerFileDragActive(false);
                        tabFileDragHoverRef.current = null;
                        stashOleDragSession(getFileDragSession());
                        clearListDragGhost();
                        unbindKeyModifiers();
                        listGestureRef.current = null;
                        dragScrollLoop.stop();
                        window.removeEventListener('pointermove', onMove);
                        IPC.startDrag(outPaths, {
                          extended: !!config.extendedCompatibilityForClipboardAndDragAndDrop
                            || !!settingsRt.shell.extendedClipboardDnD,
                        });
                      };

                      if (meshPaths.length) {
                        void (async () => {
                          const hydrated = meshPaths.length ? await hydrateMeshPathsForDrag(meshPaths) : [];
                          startOleDrag([...localPaths, ...hydrated]);
                        })();
                      } else {
                        startOleDrag(localPaths);
                      }
                    }
                  }
                  if ((window as any).__BNDZ_PERF_DEBUG__) {
                    console.log(`[BNDZ perf] drag onMove work: ${(performance.now() - _dragPerfT0).toFixed(2)}ms`);
                  }
                }
              };

              const onUp = (ev: PointerEvent) => {
                if (ev.pointerId !== capturePointerId) return;
                dragScrollLoop.stop();
                dragPointerY = null;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                unbindKeyModifiers();

                const gesture = listGestureRef.current;

                if (gesture?.mode === 'drag' && !oleDragStarted) {
                  const archiveTarget = hitTestArchiveRootAtPoint(ev.clientX, ev.clientY);
                  if (archiveTarget) {
                    const archivePath = archiveTarget.getAttribute('data-archive-path');
                    const dragPaths = buildDragPaths(entityId, gesture.dragSelection);
                    if (archivePath && dragPaths.length) {
                      void import('../lib/ipcBridge').then(async ({ IPC }) => {
                        const winPaths = dragPaths.map(toWindowsPath);
                        const entryNames = winPaths.map(p => p.split(/[/\\]/).pop() || 'file');
                        const result = await IPC.archiveAddFiles(archivePath, winPaths, entryNames);
                        if (result.success) {
                          setToastMessage(`Added ${winPaths.length} item(s) to archive.`);
                          window.dispatchEvent(new CustomEvent('bndz-archive-reload', { detail: { path: archivePath } }));
                        } else {
                          setToastMessage(result.error || 'Failed to add to archive.');
                        }
                      });
                    }
                    clearFileDragChrome();
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  const newTabPaneId = hitTestNewTabZoneAtPoint(ev.clientX, ev.clientY);
                  if (newTabPaneId) {
                    const targetPaneId = newTabPaneId;
                    const draggedDirs = gesture.dragSelection
                      .map(id => contents?.find((c: any) => c.id === id))
                      .filter((ent: any) => ent?.type === 'directory');
                    const openPath = draggedDirs.length > 0
                      ? joinPanePath(panePath, draggedDirs[0])
                      : (panesRef.current.find(p => p.id === targetPaneId)?.tabs[panesRef.current.find(p => p.id === targetPaneId)!.activeTabIndex]?.path ?? panePath);
                    addTab(targetPaneId, openPath);
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  const navTreeTarget = hitTestNavTreeAtPoint(ev.clientX, ev.clientY);
                  const breadcrumbTarget = navTreeTarget ? null : resolveBreadcrumbHoverAtPoint(ev.clientX, ev.clientY);
                  const favoriteEl = document.elementsFromPoint(ev.clientX, ev.clientY)
                    .map(el => (el as HTMLElement).closest('[data-favorite-path]'))
                    .find(Boolean) as HTMLElement | null;
                  const favoritePath = favoriteEl?.getAttribute('data-favorite-path') || null;
                  const hover = resolveHoverAtDropPoint(ev.clientX, ev.clientY);
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
                  // Dual-pane list-body parity with OLE: prefer hovered list folder path.
                  const htmlTarget = htmlDropTargetRef.current;
                  let resolvedTabPath = dropResolution.tabPath;
                  if (htmlTarget?.tabPath && hover?.paneId === htmlTarget.paneId) {
                    const listBody = hitTestListBodyAtPoint(ev.clientX, ev.clientY);
                    if (listBody && htmlTarget.paneId !== pane.id) {
                      resolvedTabPath = htmlTarget.tabPath;
                    }
                  }
                  if (hover || dropResolution.paneId !== pane.id || dropResolution.tabIndex !== (panesRef.current.find(p => p.id === pane.id)?.activeTabIndex ?? 0)) {
                    flushSync(() => {
                      setActivePaneId(dropResolution.paneId);
                      setPanes(prevPanes => prevPanes.map(p =>
                        p.id === dropResolution.paneId ? { ...p, activeTabIndex: dropResolution.tabIndex } : p,
                      ));
                    });
                  }
                  const targetContents = contentsForPanePath(resolvedTabPath);
                  let dropEnt = dropResolution.folderEnt;
                  const millerDropPath = hitTestMillerDropPathAtPoint(ev.clientX, ev.clientY);
                  if (millerDropPath) {
                    dropEnt = {
                      id: millerDropPath,
                      type: 'directory',
                      name: millerDropPath.split('/').pop() || millerDropPath,
                      path: millerDropPath,
                    };
                  } else if (!dropEnt && !breadcrumbTarget && !navTreeTarget && !favoritePath) {
                    dropEnt = hitTestListFolderAtPoint(ev.clientX, ev.clientY, targetContents ?? undefined);
                  }
                  // Never treat a dragged folder as its own drop target (move-into-self).
                  if (dropEnt && gesture.dragSelection.includes(dropEnt.id)) {
                    dropEnt = null;
                  }
                  const dragPaths = buildDragPaths(entityId, gesture.dragSelection);
                  const workspaceHit = hitTestWorkspaceSurfaceAtPoint(ev.clientX, ev.clientY);
                  if (workspaceHit && dragPaths.length) {
                    if (workspaceHit.closest('.bndz-spatial-canvas')) {
                      window.dispatchEvent(new CustomEvent('bndz-spatial-add', {
                        detail: { paths: dragPaths, clientX: ev.clientX, clientY: ev.clientY },
                      }));
                    }
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  const spatialBoard = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-spatial-board]');
                  if (spatialBoard && dragPaths.length) {
                    window.dispatchEvent(new CustomEvent('bndz-spatial-add', {
                      detail: { paths: dragPaths, clientX: ev.clientX, clientY: ev.clientY },
                    }));
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  const meshDropInbox = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-mesh-drop-inbox]');
                  if (meshDropInbox && dragPaths.length) {
                    executeInternalDrop('copy', dragPaths, MESH_DROP_INBOX_DEST, panePath);
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  const dropStackHit = document.elementsFromPoint(ev.clientX, ev.clientY)
                    .map(el => {
                      const node = el as HTMLElement;
                      return node.closest?.('[data-drop-stack-zone]')
                        || node.closest?.('[data-plugin-tab-id="dropstack"]');
                    })
                    .find(Boolean);
                  if (dropStackHit && dragPaths.length) {
                    appendDropStackPaths(dragPaths);
                    openBottomPlugin('dropstack');
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  if (favoritePath && dragPaths.length) {
                    const destCanon = canonicalDropPath(favoritePath);
                    const op = resolveDropOperation({
                      payloadCopy: gesture.copyDrag,
                      dropModifierCopy: dropModifierRef.current.copy,
                      ctrlKey: ev.ctrlKey || ev.metaKey,
                      altKey: ev.altKey,
                      shiftKey: ev.shiftKey,
                      sourcePaths: dragPaths,
                      destDir: destCanon,
                      sameDriveDefault: config.dragDropSameVolumeAction,
                      crossDriveDefault: config.dragDropCrossVolumeAction,
                    });
                    if (shouldCommitInternalFileDrop({
                      sourcePaths: dragPaths,
                      destDir: destCanon,
                      op,
                      hasForeignTarget: true,
                      pointerTravelPx: Math.hypot(ev.clientX - startX, ev.clientY - startY),
                    })) {
                      executeInternalDrop(op, dragPaths, destCanon, panePath);
                    }
                    setDragTargetHighlight(null);
                    suppressRowClickRef.current = true;
                    internalDragRef.current = false;
                    clearFileDragChrome();
                    clearListDragGhost();
                    endFileDragSession();
                    listGestureRef.current = null;
                    return;
                  }
                  if (dragPaths.length) {
                    const destPath = navTreeTarget || breadcrumbTarget
                      || millerDropPath
                      || (dropEnt && (dropEnt as any).path && String((dropEnt as any).path).startsWith('/')
                        ? String((dropEnt as any).path)
                        : null)
                      || (dropEnt?.name ? joinPanePath(resolvedTabPath, dropEnt as { name: string; path?: string; id?: string }) : resolvedTabPath);
                    const destCanon = canonicalDropPath(destPath);
                    const op = resolveDropOperation({
                      payloadCopy: gesture.copyDrag,
                      dropModifierCopy: dropModifierRef.current.copy,
                      ctrlKey: ev.ctrlKey || ev.metaKey,
                      altKey: ev.altKey,
                      shiftKey: ev.shiftKey,
                      sourcePaths: dragPaths,
                      destDir: destCanon,
                      sameDriveDefault: config.dragDropSameVolumeAction,
                      crossDriveDefault: config.dragDropCrossVolumeAction,
                    });
                    const hasForeignTarget = !!(
                      navTreeTarget
                      || breadcrumbTarget
                      || hover
                      || dropEnt
                      || favoritePath
                      || dropResolution.paneId !== pane.id
                      || resolvedTabPath !== panePath
                    );
                    const pointerTravelPx = Math.hypot(ev.clientX - startX, ev.clientY - startY);
                    if (shouldCommitInternalFileDrop({
                      sourcePaths: dragPaths,
                      destDir: destCanon,
                      op,
                      hasForeignTarget,
                      pointerTravelPx,
                    })) {
                      // Settings → Native drag and drop context menu (Copy / Move / Cancel at drop).
                      if (settingsRt.shell.nativeDragDropContextMenu || !!config.nativeDragAndDropContextMenu) {
                        setDropActionMenu({
                          x: ev.clientX,
                          y: ev.clientY,
                          paths: dragPaths,
                          dest: destCanon,
                          sourcePath: panePath,
                        });
                      } else {
                        executeInternalDrop(op, dragPaths, destCanon, panePath);
                      }
                    }
                  }
                  setDragTargetHighlight(null);
                  suppressRowClickRef.current = true;
                  internalDragRef.current = false;
                  clearFileDragChrome();
                  clearListDragGhost();
                  endFileDragSession();
                } else if (gesture?.mode === 'pending' && !hasMetDragThreshold() && !oleDragStarted) {
                  clearDragSession();
                  const now = performance.now();
                  const priorDbl = listEntityDblRef.current;
                  const isDoubleTap = !!(
                    gesture.entityId
                    && priorDbl
                    && priorDbl.paneId === pane.id
                    && priorDbl.entityId === gesture.entityId
                    && now - priorDbl.at < 450
                    && !gesture.ctrlKey
                    && !gesture.shiftKey
                  );
                  if (isDoubleTap && gesture.entityId) {
                    listEntityDblRef.current = null;
                    const entity = contents?.find((x: any) => x.id === gesture.entityId)
                      || safeGetDirContents(fileSystem, panePath)?.find((x: any) => x.id === gesture.entityId);
                    if (entity) {
                      suppressRowClickRef.current = true;
                      listEntityDoubleClickRef.current?.(entity);
                    }
                  } else if (gesture.entityId) {
                    listEntityDblRef.current = { paneId: pane.id, entityId: gesture.entityId, at: now };
                  }
                  // WebView2 often drops row onClick — commit click side-effects on pointerup.
                  const clickHandler = listGestureClickRef.current;
                  if (!isDoubleTap && clickHandler && gesture.entityId && !gesture.selectedOnPress) {
                    suppressRowClickRef.current = true;
                    clickHandler({
                      stopPropagation: () => {},
                      preventDefault: () => {},
                      ctrlKey: gesture.ctrlKey,
                      shiftKey: gesture.shiftKey,
                      altKey: gesture.altKey,
                      metaKey: false,
                      button: 0,
                      target: rowEl,
                    } as React.MouseEvent, gesture.entityId);
                  } else if (!isDoubleTap && clickHandler && gesture.entityId && gesture.selectedOnPress) {
                    if (gesture.wasSelected) {
                      suppressRowClickRef.current = true;
                      clickHandler({
                        stopPropagation: () => {},
                        preventDefault: () => {},
                        ctrlKey: false,
                        shiftKey: false,
                        altKey: false,
                        metaKey: false,
                        button: 0,
                        target: rowEl,
                      } as React.MouseEvent, gesture.entityId);
                    } else {
                      suppressRowClickRef.current = true;
                    }
                  }
                } else if (gesture?.mode === 'pending') {
                  if (!hasMetDragThreshold()) clearDragSession();
                }

                listGestureRef.current = null;
                if (!oleDragStarted) nativeOleDragRef.current = false;
                htmlDropTargetRef.current = null;
                clearFileDragChrome();
                clearListDragGhost();
                // Clears active session only — pending OLE stash survives for EXTERNAL_FILES_DROPPED.
                endFileDragSession();
              };

              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
           }}
        >
          {streamingPaths.has(normPanePath) && !isPaneLoading && (listRows?.length ?? 0) > 0 && (
            <div className="bndz-dir-stream-bar shrink-0" role="progressbar" aria-label="Loading more items">
              <span className="bndz-dir-stream-bar-glow" />
            </div>
          )}
          {loadingPaths.has(normPanePath) && !isPaneLoading && (listRows?.length ?? 0) > 0 && (
            <div className="sticky top-0 z-10 mx-2 mt-1 mb-1 flex items-center gap-2 rounded border border-sky-500/20 bg-sky-950/40 px-2.5 py-1 text-[10px] text-sky-200/90 pointer-events-none">
              <Icons8Icon id="loading" size={12} spin />
              <span>Loading more items…</span>
            </div>
          )}
          {pathLoadErrors[normPanePath] && !isPaneLoading && (listRows?.length ?? 0) === 0 && (
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
             <ListPaneSkeleton
               label={`Streaming ${formatUiPath(panePath) || panePath.split('/').pop() || panePath}…`}
               rows={16}
             />
          )}
          {!isPaneLoading && isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading)) && (
             <div className="flex flex-col items-center justify-center h-full gap-3 text-amber-400/80 min-h-[200px]">
               <Icons8Icon id="loading" size={22} spin />
               <span className="text-[11px]">Searching{globalSearchEngine === 'indexed' ? ' local cache' : config.enableEverythingSearch !== false ? ' with Everything' : ''}…</span>
             </div>
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && isBndzHomePath(normPanePath) && (
            <BndzHomeView
              onNavigate={p => setCurrentPath(p, pane.id)}
              navigationHistory={config.navigationHistory || []}
              onOpenPath={(p, meta) => {
                const panePathNorm = normalizePanePath(toPanePath(p));
                const isDir = meta?.type === 'directory'
                  || isBndzVirtualPath(panePathNorm)
                  || /^\/[A-Za-z]:$/.test(panePathNorm)
                  || panePathNorm === '/'
                  || panePathNorm === '//';
                if (isDir || meta?.type === 'directory') {
                  setCurrentPath(panePathNorm, pane.id);
                  return;
                }
                if (meta?.type === 'file') {
                  void IPC.executeContextMenuVerb(toWindowsPath(panePathNorm), 'open');
                  return;
                }
                // Untyped (Focus Stage / omnibox): prefer navigate for folder-like leaves, else shell-open.
                const leaf = panePathNorm.split('/').pop() || '';
                if (!leaf.includes('.')) {
                  setCurrentPath(panePathNorm, pane.id);
                  return;
                }
                void IPC.executeContextMenuVerb(toWindowsPath(panePathNorm), 'open');
              }}
              onOpenInNewTab={p => addTab(pane.id, normalizePanePath(toPanePath(p)))}
              onOpenOpposite={p => openFolderInOppositePane(normalizePanePath(toPanePath(p)), pane.id)}
              onRevealFolder={p => setCurrentPath(normalizePanePath(toPanePath(p)), pane.id)}
              onIndexInvite={() => {
                void IPC.reindexBndzDefaults().then(r => {
                  if (r?.ok) setToastMessage('Indexing default libraries…');
                  else setToastMessage(r?.error || 'Could not start indexing.', 'warning');
                });
              }}
              onQuickLook={(items, startIndex) => {
                const mapped = items
                  .filter(it => it.path)
                  .map(it => ({
                    entity: {
                      id: it.path,
                      name: it.name || it.path.split('/').pop() || 'File',
                      type: it.type === 'directory' ? 'directory' : 'file',
                      path: it.path,
                    },
                    path: toPanePath(it.path),
                  }));
                if (!mapped.length) return;
                setHomeQuickPreview({ items: mapped, index: Math.max(0, Math.min(startIndex, mapped.length - 1)) });
                setQuickPreviewOpen(true);
              }}
              focusStage={(() => {
                if (clipboard.items.length > 0) {
                  const cp = clipboard.items[0];
                  const name = String(cp).split(/[/\\]/).pop() || 'Clipboard item';
                  return { path: toPanePath(cp), name, kind: 'clipboard' as const };
                }
                const trail = getGhostTrail()[0];
                if (trail && !isBndzHomePath(trail.path)) {
                  return { path: trail.path, name: trail.name, kind: 'focus' as const };
                }
                return null;
              })()}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && isBndzCanvasPath(normPanePath) && (
            <BndzSpatialCanvasView
              onNavigate={p => setCurrentPath(p, pane.id)}
              onOpenPath={p => {
                const panePathNorm = normalizePanePath(toPanePath(p));
                void IPC.executeContextMenuVerb(toWindowsPath(panePathNorm), 'open');
              }}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && isBndzAutomationPath(normPanePath) && (
            <BndzAutomationView />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && isBndzTwinVolumePath(normPanePath) && (
            <BndzTwinVolumeChessView />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && isBndzTemporalDiffPath(normPanePath) && (
            <BndzTemporalDiffView
              watchFolder={(() => {
                const ap = panes.find(p => p.id === activePaneId);
                const prev = ap?.tabs[Math.max(0, (ap?.activeTabIndex ?? 0) - 1)]?.path
                  ?? ap?.tabs.find(t => isFsDropTargetPath(normalizePanePath(t.path)))?.path;
                return prev && isFsDropTargetPath(normalizePanePath(prev)) ? prev : undefined;
              })()}
              onNavigate={p => setCurrentPath(p, pane.id)}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && normPanePath === BNDZ_VIEWS_ROOT && (
            <BndzHubView
              onNavigate={p => setCurrentPath(p, pane.id)}
              onRefresh={() => void refetchPath(BNDZ_VIEWS_ROOT)}
              onOpenMeshDrop={() => { setMeshDropPaths([]); setShowMeshDropDialog(true); }}
              onOpenGhostLink={() => openBottomPlugin('ghost-link')}
              onOpenRamStaging={() => openBottomPlugin('ram-staging')}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'columns' && normPanePath !== BNDZ_VIEWS_ROOT && !isBndzHomePath(normPanePath) && !isBndzWorkspacePath(normPanePath) && (
            <MillerColumnsView
              rootPath={millerRootForMount(currentTab.millerRootPath, panePath, isThisPc)}
              selectedPath={panePath}
              pathContentsCache={pathContentsCache}
              config={config}
              onNavigate={(p) => setCurrentPath(p, pane.id)}
              onOpen={(entity, colPath) => openEntity({ ...entity, path: joinPanePath(colPath, entity as any) })}
              onPrefetchPath={(p) => void prefetchPathQuiet(p)}
              onMoveOrCopyPaths={(paths, destDir, copy) => {
                executeInternalDrop(copy ? 'copy' : 'move', paths, canonicalDropPath(destDir), panePath);
              }}
            />
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'size' && normPanePath !== BNDZ_VIEWS_ROOT && !isBndzHomePath(normPanePath) && !isBndzWorkspacePath(normPanePath) && (
            (() => {
              const sizeItems = (contents || []).map((ent: any) => {
                const p = buildEntityPath(ent);
                const folderKey = ent.type === 'directory' ? toWindowsPath(p).toLowerCase() : '';
                const isDriveRoot = /^\/[A-Za-z]:$/.test(normalizePanePath(p));
                return {
                  name: isDriveRoot
                    ? formatDriveRootLabel(p)
                    : getDisplayName(ent, config, panePath),
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
                return (
                  <div className="h-full min-h-0 p-2">
                    <SizeView items={sizeItems} onNavigate={p => setCurrentPath(p, pane.id)} onScanFolderSizes={onScanSizes} />
                  </div>
                );
              }
              if (viz === 'treemap') {
                return (
                  <div className="h-full min-h-0 p-2">
                    <FolderSizeTreemap items={sizeItems} onNavigate={p => setCurrentPath(p, pane.id)} onScanFolderSizes={onScanSizes} />
                  </div>
                );
              }
              return (
                <div className="h-full min-h-0 p-2">
                  <FolderSizeListView
                    items={sizeItems}
                    onNavigate={p => setCurrentPath(p, pane.id)}
                    onOpen={p => { void IPC.executeContextMenuVerb(p, 'open'); }}
                    onScanFolderSizes={onScanSizes}
                  />
                </div>
              );
            })()
          )}
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'media' && normPanePath !== BNDZ_VIEWS_ROOT && !isBndzHomePath(normPanePath) && !isBndzWorkspacePath(normPanePath) && (
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
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode === 'recents' && normPanePath !== BNDZ_VIEWS_ROOT && !isBndzHomePath(normPanePath) && !isBndzWorkspacePath(normPanePath) && (
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
          {!isPaneLoading && !(isGlobal && (isGlobalSearchLoading || (isFindingTabActive && currentTab.findingLoading))) && computedViewMode !== 'columns' && computedViewMode !== 'size' && computedViewMode !== 'media' && computedViewMode !== 'recents' && normPanePath !== BNDZ_VIEWS_ROOT && !isBndzHomePath(normPanePath) && !isBndzWorkspacePath(normPanePath) && (
            <>
            {(() => {
              const stickyOn = config.stickyGroupHeaders !== false;
              if (!stickyOn || listGroupBy === 'none' || computedViewMode !== 'details') return null;
              // stickyHeaderKeys forces a re-render only when the active group identity changes.
              void stickyHeaderKeys[pane.id];
              const scrollTop = listScrollTopsRef.current[pane.id] || 0;
              const sticky = resolveStickyGroupHeader(listRows as ListRowItem[], scrollTop, detailsRowHeight);
              if (!sticky || scrollTop <= sticky.index * detailsRowHeight) return null;
              return (
                <div className="sticky top-0 z-20 h-0 overflow-visible pointer-events-none">
                  <div
                    className="absolute top-0 left-0 right-0 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[#99c9f0] bg-[#252526] border-b border-[#454545] shadow-[0_1px_0_rgba(0,0,0,0.35)]"
                    style={{ height: detailsRowHeight }}
                  >
                    <span>{sticky.header.label}</span>
                    <span className="text-gray-500 font-normal normal-case">({sticky.header.count})</span>
                  </div>
                </div>
              );
            })()}
            <PaneListBridgeSync paneId={pane.id} bridge={{
                pane,
                panePath,
                currentTab,
                config,
                settingsRt,
                mouseRt,
                computedViewMode,
                isActive,
                isGlobal,
                contents,
                panes,
                activePaneId,
                inlineRename,
                setInlineRename,
                focusedItemId,
                dragTargetId,
                clipboard,
                cloudProviders,
                folderSizeMap,
                formatSize,
                jobTicketOverdueMap,
                healthProblemMap,
                isSyncMode,
                syncResults,
                debouncedFilterText,
                detailsRowHeight,
                detailsPadY,
                detailsIconSize,
                detailsIconColClass,
                gridMetrics,
                listMetrics,
                paneGridMetrics,
                paneListMetrics,
                thisPcGridMetrics,
                thisPcListMetrics,
                isThisPc,
                visibleListColumns,
                getColumnStyle,
                renderDetailColumn,
                listTooltipsEnabled,
                buildEntityPath,
                handleEntityClicked,
                handleEntityDoubleClicked,
                handleEntityMiddleClick,
                handleContextMenuRequest,
                selectEntityForContextMenu,
                commitRenameForEntity,
                openFolderContentsPeek,
                schedulePrefetchPath,
                setSelectedItems,
                setFocusedItemId,
                setActivePaneId,
                scheduleSelectionChrome,
                scheduleQuickActionsBar,
                setToastMessage,
                suppressRowClickRef,
                listGestureRef,
                listClickDeferTimerRef,
                contextMenuBlockRef,
                suppressNavClickUntilRef,
                selectionAnchorRef,
              } satisfies FileListRowBridge} />
            <VirtualizedFileList
              items={listRows || []}
              enabled={computedViewMode === 'details' || computedViewMode === 'grid' || computedViewMode === 'list'}
              mode={computedViewMode === 'grid' || computedViewMode === 'list' ? 'grid' : 'list'}
              rowHeight={
                computedViewMode === 'grid' ? paneGridMetrics.rowHeight :
                computedViewMode === 'list' ? paneListMetrics.rowHeight :
                detailsRowHeight
              }
              gridMinItemWidth={
                computedViewMode === 'list'
                  ? paneListMetrics.tileWidth
                  : ('minWidth' in paneGridMetrics ? paneGridMetrics.minWidth : gridMetrics.minWidth)
              }
              gridRowHeight={
                computedViewMode === 'list'
                  ? paneListMetrics.stride
                  : ('stride' in paneGridMetrics ? paneGridMetrics.stride : gridMetrics.stride)
              }
              gap={
                computedViewMode === 'grid' ? paneGridMetrics.gap :
                computedViewMode === 'list' ? paneListMetrics.gap :
                0
              }
              className="w-full"
              onVisibleRangeChange={({ startIndex, endIndex }) => {
                const rows = listRows || [];
                if (!rows.length) return;
                const slice = rows
                  .slice(Math.max(0, startIndex), Math.min(rows.length, endIndex + 1))
                  .filter((item: any) => !isGroupHeaderRow(item));
                if (!slice.length) return;
                void prefetchIconsForEntities(slice, panePath, 'shell', Math.min(96, slice.length));
                void prefetchMediaThumbnailsForEntities(slice, panePath, Math.min(48, slice.length), {
                  includeFolders: config.showFolderThumbnails === true,
                });
              }}
              emptyState={
                <div className="flex flex-col items-center justify-center h-full min-h-[160px] text-gray-500 gap-2 px-4 text-center">
                  {pathLoadErrors[normPanePath] && !(listRows?.length ?? 0) ? (
                    <>
                      <Icons8Icon id="warning" size={28} className="opacity-70 text-rose-300" />
                      <span className="text-[12px] text-rose-200/90 max-w-md">
                        {/^IPC timeout:/i.test(pathLoadErrors[normPanePath])
                          ? 'Folder load timed out. The host may be busy — retry in a moment.'
                          : pathLoadErrors[normPanePath]}
                      </span>
                      <button
                        type="button"
                        className="mt-1 px-3 py-1 text-[11px] rounded border border-rose-500/40 text-rose-100 hover:bg-rose-500/10"
                        onClick={() => void refetchPath(normPanePath)}
                      >
                        Retry
                      </button>
                    </>
                  ) : isGlobal && globalSearchEngine === 'indexed-empty' ? (
                    <BndzIndexEmptyState
                      title="No indexed hits for this query"
                      hint="Build or refresh the local search index so global search feels like Everything — without walking the whole disk."
                      onIndexed={() => {
                        void refetchPath(normPanePath);
                      }}
                    />
                  ) : (
                    <>
                      <Icons8Icon id="folder_open_ui" size={28} className="opacity-40" />
                      <span className="text-[11px]">
                        {isFindingTabActive && currentTab.findingError ? currentTab.findingError
                          : isFindingTabActive ? `No results for "${currentTab.findingQuery}".`
                          : isGlobal && globalSearchEngine === 'windows-search'
                            ? 'No Windows Search hits. Try a shorter query or enable the BNDZ index.'
                          : isGlobal && config.enableEverythingSearch === false
                            ? 'No results. Everything is off — enable it in Settings or build the BNDZ index.'
                          : isGlobal ? 'No global search results.'
                          : (config.showMessageWhenListIsEmpty !== false ? 'This folder is empty.' : '')}
                      </span>
                    </>
                  )}
                </div>
              }
              renderItem={(entity, rowIndex) => {
                if (isGroupHeaderRow(entity)) {
                  return (
                    <ListGroupHeaderRow
                      label={entity.label}
                      count={entity.count}
                      rowHeight={detailsRowHeight}
                      sticky={config.stickyGroupHeaders !== false}
                    />
                  );
                }
                const listRt = settingsRt.list;
                const liveMarquee = marqueeLiveSelectionRef.current;
                const isSelected = liveMarquee && liveMarquee.paneId === pane.id
                  ? liveMarquee.ids.has(entity.id)
                  : currentTab.selectedItems.includes(entity.id);
                const showSelectionChrome = isSelected && listRt.showSelectionHighlight;
                const entityWinPath = resolveEntityWindowsPath(panePath, entity);
                const isDir = entity.type === 'directory';
                const realityMissing = isRealityCheckActive() && !isDir && isRealityCheckMissing(entityWinPath);
                const folderPrefetching = isDir && prefetchingPaths.has(normalizePanePath(buildEntityPath(entity)));
                const clipboardMark = getClipboardMarkForEntity(entityWinPath, clipboard);
                const filterResult = applyVisualFilters(entity, config.visualFilters);
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
                      filterColor = '#22c55e';
                    } else if (status === 'Newer') {
                      filterColor = '#3b82f6';
                    } else if (status === 'Conflict' || status === 'Missing') {
                      filterColor = status === 'Conflict' ? '#eab308' : '#ef4444';
                    }
                  }
                }
                const entityPanePath = buildEntityPath(entity);
                const peerShare = liveSharePeers.length ? isPathInPeerSelection(entityPanePath, liveSharePeers) : null;
                const healthBadge = healthProblemMap[entityWinPath.toLowerCase()]
                  || healthProblemMap[toWindowsPath(entityWinPath).toLowerCase()];
                const highlightFilter = isActive
                  ? ((settingsRt.search.highlightMatches !== false ? (debouncedFilterText || pane.filterRegex || '') : ''))
                  : '';
                const inlineRenameActive = inlineRename?.entityId === entity.id && inlineRename?.path === panePath;
                const entityTags: string[] = Array.isArray((entity as any).tags) ? (entity as any).tags : [];
                const entityStamp = `${entity.size ?? ''}|${entity.modified ?? ''}|${entity.name}|${entityTags.length}`;
                return (
                  <FileListRow
                    paneId={pane.id}
                    entity={entity}
                    entityStamp={entityStamp}
                    rowIndex={rowIndex}
                    isSelected={isSelected}
                    showSelectionChrome={showSelectionChrome}
                    isFocused={focusedItemId === entity.id}
                    inlineRenameActive={inlineRenameActive}
                    inlineRenameName={inlineRenameActive ? inlineRename?.currentName : undefined}
                    isDragTarget={dragTargetId === entity.id}
                    highlightFilter={highlightFilter}
                    peerLabel={peerShare ? peerShare.machineName : undefined}
                    syncOpacity={syncOpacity}
                    filterColor={filterColor}
                    clipboardMark={clipboardMark}
                    realityMissing={realityMissing}
                    folderPrefetching={folderPrefetching}
                    filterTintKey={filterResult?.rowTint || filterResult?.hexColor || filterResult?.name || undefined}
                    healthSeverity={healthBadge?.severity}
                  />
                );
              }}
            />
            </>
          )}
          {marquee && marquee.activePane === pane.id && !isBndzWorkspacePath(normPanePath) && (
             <div 
                ref={(el) => {
                  if (el) marqueeRectByPaneRef.current.set(pane.id, el);
                  else marqueeRectByPaneRef.current.delete(pane.id);
                }}
                className="absolute bg-[#094771]/35 border border-[#0078d4] z-50 pointer-events-none"
                style={{
                    left: marquee.startX,
                    top: marquee.startY,
                    width: 0,
                    height: 0,
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
  const currentFolderListing = useMemo(() => {
    const pane = normalizePanePath(currentTab.path);
    // This PC / Libraries synthesize list entities — they are not in pathContentsCache.
    if (pane === '/' || pane === '/this-pc') {
      return navigationDrives.map(d => {
        const normalizedName = d.name.replace(/^\/+/, '/');
        const letter = formatDriveLetter(normalizedName);
        return {
          id: `drive-${normalizedName}`,
          name: formatDriveDisplayName(d.label, normalizedName),
          type: 'directory' as const,
          path: normalizedName,
          size: d.totalSpace,
          tags: [] as string[],
          typeDescription: `${formatDriveVolumeLabel(d.label, letter) || letter} Drive (${d.format || d.fileSystem || 'Local'})`,
          driveInfo: d,
        };
      });
    }
    if (pane.toLowerCase() === '/shell:libraries') return libraryListEntities;
    return pathContentsCache[currentTab.path]
      || pathContentsCache[pane]
      || [];
  }, [pathContentsCache, currentTab.path, navigationDrives, libraryListEntities]);

  /** Prefer the active folder listing so global cache hits from other dirs cannot stick the preview. */
  const resolveInCurrentFolder = (id: string | null) => {
    if (!id) return null;
    return currentFolderListing.find((x: any) => x.id === id) || null;
  };

  const getResolvedEntity = (id: string | null) => {
      if (!id) return null;
      const inFolder = resolveInCurrentFolder(id);
      if (inFolder) return inFolder;
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
  const focusedInCurrentFolder = resolveInCurrentFolder(focusedItemId)
    || (focusedItemId?.startsWith('drive-') ? getResolvedEntity(focusedItemId) : null);
  const focusedFullPath = focusedInCurrentFolder
      ? ((focusedInCurrentFolder as any).path
          ? toPanePath((focusedInCurrentFolder as any).path)
          : joinPanePath(currentTab.path, focusedInCurrentFolder))
      : null;

  const previewEntity = useMemo(() => {
    const selId = currentTab.selectedItems[0] || null;
    const fromSel = resolveInCurrentFolder(selId);
    if (fromSel) return fromSel;
    // Drive / synthetic selection ids must still win over the location entity
    // (pathContentsCache is empty at This PC — without this, Local Disk (C:) stuck on This PC).
    if (selId?.startsWith('drive-') || selId?.startsWith('loc:')) {
      const syn = getResolvedEntity(selId);
      if (syn) return syn;
    }
    const fromFocus = resolveInCurrentFolder(focusedItemId);
    if (fromFocus) return fromFocus;
    if (focusedItemId?.startsWith('drive-')) {
      const syn = getResolvedEntity(focusedItemId);
      if (syn) return syn;
    }
    return getLocationEntityFromPath(currentTab.path);
  }, [currentTab.selectedItems, currentTab.path, focusedItemId, currentFolderListing, navigationDrives, drives]);

  const previewPath = useMemo(() => {
    if (!previewEntity) return currentTab.path;
    if ((previewEntity as any).driveInfo || String(previewEntity.id || '').startsWith('drive-')) {
      return toPanePath((previewEntity as any).path || currentTab.path);
    }
    if ((previewEntity as any).path) return toPanePath((previewEntity as any).path);
    const loc = getLocationEntityFromPath(currentTab.path);
    if (previewEntity === loc || previewEntity?.id === loc?.id) return currentTab.path;
    return joinPanePath(currentTab.path, previewEntity);
  }, [previewEntity, currentTab.path]);

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

  const openQuickPreview = React.useCallback((startIndex?: number) => {
    const idx = startIndex ?? quickPreviewStartIndex;
    const item = quickPreviewItems[idx];
    if (item?.path) {
      const name = item.entity?.name || '';
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
      // Video still pauses/stashes into the floating player. Audio uses a shared
      // decoder — leave it playing so Space pop-out never glitches playback.
      if (isVideoExt(ext)) requestMediaHandoff(item.path);
    }
    setQuickPreviewIndex(idx);
    setQuickPreviewOpen(true);
  }, [quickPreviewItems, quickPreviewStartIndex]);
  openQuickPreviewRef.current = openQuickPreview;

  useEffect(() => {
    const onStudio = (e: Event) => {
      const rawPath = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!rawPath) return;
      const winPath = toWindowsPath(rawPath).toLowerCase();
      const idx = quickPreviewItems.findIndex(it => toWindowsPath(it.path).toLowerCase() === winPath);
      if (idx >= 0) {
        setQuickPreviewIndex(idx);
        setHomeQuickPreview(null);
      } else {
        const name = rawPath.split(/[/\\]/).pop() || 'image';
        const dot = name.lastIndexOf('.');
        setHomeQuickPreview({
          items: [{
            path: rawPath,
            entity: {
              id: winPath,
              name,
              type: 'file',
              extension: dot >= 0 ? name.slice(dot + 1) : '',
            },
          }],
          index: 0,
        });
      }
      setQuickPreviewStudio(true);
      setQuickPreviewOpen(true);
    };
    window.addEventListener('bndz-open-photo-studio', onStudio);
    return () => window.removeEventListener('bndz-open-photo-studio', onStudio);
  }, [quickPreviewItems]);

  const bottomSelectionTargets = useMemo(() => {
    const paths: string[] = [];
    const types: string[] = [];
    for (const id of currentTab.selectedItems || []) {
      const ent = getResolvedEntity(id);
      let path: string;
      if (ent?.fsPath) path = String(ent.fsPath).replace(/\//g, '\\');
      else if (ent) path = entityFsPath(ent, currentTab.path);
      else if (/^[A-Za-z]:/.test(id) || id.startsWith('//') || id.startsWith('\\\\') || id.startsWith('/')) path = toWindowsPath(id);
      else path = toWindowsPath(id);
      // Never feed mangled /bndz/ram virtual paths into FS/clipboard ops
      if (!path || path.toLowerCase().startsWith('bndz\\')) path = ent?.fsPath ? String(ent.fsPath).replace(/\//g, '\\') : '';
      if (!path) continue;
      paths.push(path);
      types.push(
        ent?.type === 'directory' ? 'folder'
        : ent?.type === 'file' ? 'file'
        : (/\.lnk$/i.test(path) ? 'shortcut' : 'folder'),
      );
    }
    return { paths, types };
  }, [currentTab.selectedItems, currentTab.path, pathContentsCache, fileSystem, panes]);

  // Color/theme fills live on documentElement via applySettingsRuntime (fillToBackground).
  // Do NOT dump raw colorConfig JSON onto this node — that clobbered gradients and live preview.

  const fluidDragEnabled = config.fluidDragStacks !== false;

  const commandDeckSignature = useMemo(
    () => deriveSelectionSignature(
      bottomSelectionTargets.paths,
      bottomSelectionTargets.types,
      previewEntity,
    ),
    [bottomSelectionTargets, previewEntity],
  );

  const openPreviewWithTab = React.useCallback((tab: 'preview' | 'media' | 'details') => {
    setIsPreviewPanelOpen(true);
    updateConfig({ previewPanelOpen: true });
    window.dispatchEvent(new CustomEvent('bndz-preview-tab', { detail: { tab } }));
  }, [updateConfig]);

  const handleCommandDeckTool = React.useCallback((id: ContextToolId) => {
    switch (id) {
      case 'properties':
        openBottomPlugin('properties');
        break;
      case 'batch-rename':
        openBottomPlugin('batch-rename');
        break;
      case 'compare':
        openBottomPlugin('compare');
        break;
      case 'mesh-drop':
        setMeshDropPaths(bottomSelectionTargets.paths);
        setShowMeshDropDialog(true);
        break;
      case 'waveform':
        openPreviewWithTab('media');
        openBottomPlugin('metadata');
        break;
      case 'media-tab':
        openPreviewWithTab('media');
        break;
      case 'histogram':
        updateConfig({ inspectionShaderMode: 'histogram' });
        openPreviewWithTab('preview');
        break;
      case 'loupe':
        updateConfig({ inspectionShaderMode: 'loupe' });
        openPreviewWithTab('preview');
        break;
      case 'quick-look':
        openQuickPreview();
        break;
      case 'index-folder': {
        const folderPath = bottomSelectionTargets.paths[0];
        if (!folderPath) break;
        void IPC.indexBndzLocation(folderPath).then(res => {
          setToastMessage(
            res.ok ? 'Indexing folder for BNDZ search…' : (res.error || 'Indexing failed.'),
            res.ok ? 'success' : 'warning',
          );
          if (res.ok) window.dispatchEvent(new CustomEvent('bndz-index-roots-changed'));
        });
        break;
      }
      case 'storage-cleanup':
        openBottomPlugin('storage-cleanup');
        break;
      case 'ghost-link':
        openBottomPlugin('ghost-link');
        break;
      case 'ram-staging':
        if (bottomSelectionTargets.paths.length > 0) {
          // Files selected — open plugin and pass paths for staging.
          openBottomPlugin('ram-staging', { paths: bottomSelectionTargets.paths });
        } else {
          openBottomPlugin('ram-staging');
        }
        break;
      case 'dropstack':
        openBottomPlugin('dropstack');
        break;
      case 'catalog':
        openBottomPlugin('catalog');
        break;
      case 'folder-sync':
        openBottomPlugin('folder-sync');
        break;
      case 'project-sandbox':
        openBottomPlugin('project-sandbox');
        break;
      case 'library-health':
        openBottomPlugin('library-health');
        break;
      case 'capacity-solver':
        openBottomPlugin('capacity-solver');
        break;
      case 'inbound-volume':
        openBottomPlugin('inbound-volume');
        break;
      case 'branching-time':
        openBottomPlugin('branching-time');
        break;
      case 'analyze-audio': {
        const audioPaths = bottomSelectionTargets.paths.filter(p => {
          const ext = p.split('.').pop()?.toLowerCase() ?? '';
          return ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'wma', 'opus', 'aiff', 'ape'].includes(ext);
        });
        if (audioPaths.length === 0) {
          setToastMessage('No audio files selected.', 'warning');
          break;
        }
        setToastMessage(`Analyzing ${audioPaths.length} audio file${audioPaths.length > 1 ? 's' : ''}…`, 'info');
        void IPC.analyzeMusicBatch(audioPaths.map(p => toWindowsPath(p)), true).then(res => {
          if (res.ok) {
            setToastMessage(
              `Analyzed ${res.analyzed ?? audioPaths.length} file${(res.analyzed ?? audioPaths.length) > 1 ? 's' : ''} — BPM + Key written`,
              'success',
            );
            for (const p of audioPaths) invalidateExtendedMetadata(p);
          } else {
            setToastMessage(res.error || 'Analysis failed', 'warning');
          }
        });
        break;
      }
      case 'continuum-compose':
        setCurrentPath(BNDZ_CANVAS);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('bndz-open-continuum'));
        }, 120);
        break;
      case 'work-intent': {
        const order = WORK_INTENT_ORDER;
        const cur = (config.workIntentId || 'browse') as WorkIntentId;
        const idx = order.indexOf(cur);
        const next = order[(idx >= 0 ? idx + 1 : 0) % order.length];
        const { patch, toast } = applyWorkIntentPack(next, { installedPluginIds: installedPluginIdSet });
        updateConfig(patch);
        setToastMessage(toast);
        // Only open when pack resolved an installed plugin — never toast-spam missing ones.
        if (patch.bottomPanelDefaultPlugin) openBottomPlugin(String(patch.bottomPanelDefaultPlugin));
        break;
      }
      case 'flush-ram-zone': {
        const zoneId = parseBndzRamZoneId(bottomSelectionTargets.paths[0] || '')
          || sidebarRamZones[0]?.id;
        if (!zoneId) {
          setToastMessage('No RAM zone to flush.', 'warning');
          break;
        }
        void IPC.ramStagingFlushZone(zoneId).then(r => {
          setToastMessage(r.ok ? `Flushed zone ${zoneId}` : (r.error || 'Flush failed'), r.ok ? 'success' : 'warning');
          if (r.ok) {
            invalidateRamZoneMountCache();
            window.dispatchEvent(new CustomEvent('bndz-ram-zone-changed'));
          }
        });
        break;
      }
      default: {
        const _exhaustive: never = id;
        void _exhaustive;
        break;
      }
    }
  }, [
    openBottomPlugin,
    bottomSelectionTargets.paths,
    openQuickPreview,
    updateConfig,
    openPreviewWithTab,
    setToastMessage,
    setCurrentPath,
    config.workIntentId,
    installedPluginIdSet,
    sidebarRamZones,
  ]);

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
    <WorkstationVisualProvider
      selectedPaths={bottomSelectionTargets.paths}
      selectedTypes={bottomSelectionTargets.types}
      focusedEntity={previewEntity}
      gpuInspection={config.gpuInspection !== false}
    >
    <div
      data-testid="bndz-app"
      style={{
        fontFamily: config.uiFontFamily || undefined,
        fontSize: config.fontSize ? `${config.fontSize}px` : undefined,
        ['--bndz-ui-radius' as string]: uiRadius,
        background: 'var(--bg-main, #0f0f0f)',
        color: 'var(--text-main, #d4d4d4)',
      }}
      className={`flex flex-col h-screen w-full font-sans text-[12px] select-none overflow-hidden ${
        config.compactToolbar ? 'bndz-compact-toolbar' : ''
      } ${config.denseMenubar ? 'bndz-dense-menubar' : ''} ${config.showPanelAccentBorders ? 'bndz-accent-borders' : ''}`}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('[data-bndz-workspace-surface], [data-bndz-workspace-menu]')) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <LicenseBanner refreshKey={licenseEpoch} onRegister={() => setShowRegisterDialog(true)} />
      <TrialExpiredGate
        key={licenseEpoch}
        externalRegisterOpen={showRegisterDialog}
        onActivated={() => {
          setLicenseEpoch(e => e + 1);
          setShowRegisterDialog(false);
          setToastMessage('License activated successfully.');
        }}
      >
      {/* Menu Bar + window controls (replaces native title bar) */}
      {config.showTopMenubar !== false && config.showTopMenuBar !== false && (
      <div
        ref={menubarRef}
        className="bndz-chrome-menubar flex items-stretch h-9 border-b border-[#333] text-[#ccc] shrink-0 select-none z-[200]"
        style={{ background: 'var(--menubar-bg, var(--bndz-surface-chrome))' }}
        onMouseDown={e => {
          e.stopPropagation();
          if (isFilesHostBoot()) return;
          if ((e.target as HTMLElement).closest('[data-window-btn],[data-menu-trigger]')) return;
          if (e.button === 0) import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('drag'));
        }}
        onDoubleClick={() => {
          if (isFilesHostBoot()) return;
          import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('maximize'));
        }}
      >
         <div className="flex items-center gap-2 pl-3 pr-3 border-r border-[#444] shrink-0 h-full">
            <img src={BNDZ_APP_ICON} alt="BNDZ" className={`${isNativeShellHostBoot() ? 'w-7 h-7' : 'w-12 h-12'} rounded-[9px] object-cover object-center drop-shadow-md shrink-0`} draggable={false} />
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
                 onMouseDown={toggleMenubarMenu('File')}
             >File</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'File'} anchorEl={menubarAnchors.current['File']} minWidth={260}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const ents = getMenuSelectedEntities();
                        if (!ents[0]) { setToastMessage('Select an item first.'); return; }
                        import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(joinPanePath(currentTab.path, ents[0])), 'open'));
                    })}><Icons8Icon id="folder_open_ui" size={14} /> Open Selected</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const sel = currentTab.selectedItems[0];
                      if (!sel) { setToastMessage('Select an item first.'); return; }
                      const entity = pathContentsCache[currentTab.path]?.find((x: any) => x.id === sel);
                      const targetPath = entity ? joinPanePath(currentTab.path, entity) : currentTab.path;
                      addTab(activePaneId, targetPath);
                    })}><Icons8Icon id="folder_open_ui" size={14} /> Open in New Tab</div>
                    <MenubarSubmenu label="Open Special" iconId="folder_open_ui">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        if (!focusedItemId) { setToastMessage('No focused item.'); return; }
                        const ent = findEntityInCache(pathContentsCache, focusedItemId)
                          || (pathContentsCache[currentTab.path] || []).find((x: any) => x.id === focusedItemId);
                        if (!ent) { setToastMessage('Focused item not found.'); return; }
                        import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(toWindowsPath(joinPanePath(currentTab.path, ent)), 'open'));
                      })}><Icons8Icon id="folder_open_ui" size={14} /> Open Focused Item <span className="ml-auto text-[10px] text-gray-500">Ctrl+Enter</span></div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                        const { IPC } = await import('../lib/ipcBridge');
                        const files = await IPC.openFileDialog('All files (*.*)|*.*');
                        if (files[0]) {
                          const pane = await import('../lib/displayPath').then(m => m.resolveUserPathToPane(files[0], p => IPC.expandEnvironmentPath(p)));
                          if (pane) setCurrentPath(pane);
                          else setToastMessage('Could not open that path.');
                        }
                      })}><Icons8Icon id="folder_open_ui" size={14} /> Open… <span className="ml-auto text-[10px] text-gray-500">Ctrl+O</span></div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => runShellVerbOnSelection('openas'))}>
                        <Icons8Icon id="folder_open_ui" size={14} /> Open with… <span className="ml-auto text-[10px] text-gray-500">Ctrl+Alt+Enter</span>
                      </div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        void (async () => {
                          const p = getMenuPrimaryPath();
                          if (!p) { setToastMessage('Select an item first.'); return; }
                          const args = await requestNativePrompt({
                            title: 'Open with arguments',
                            message: 'Command-line arguments',
                            defaultValue: '',
                          });
                          if (args == null) return;
                          const win = toWindowsPath(p);
                          const workDir = win.replace(/[\\/][^\\/]+$/, '');
                          const { IPC } = await import('../lib/ipcBridge');
                          IPC.shellExecute('runCommand', `"${win}" ${args}`, workDir);
                        })();
                      })}><Icons8Icon id="cmd" size={14} /> Open with Arguments…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        addTab(activePaneId, currentTab.path);
                        setToastMessage('Opened a throw-away clone tab.');
                      })}><Icons8Icon id="folder_open_ui" size={14} /> Open Throw Away Clone</div>
                    </MenubarSubmenu>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const sel = currentTab.selectedItems[0];
                      if (!sel) { setToastMessage('Select an item to rename.'); return; }
                      const entity = pathContentsCache[currentTab.path]?.find((x: any) => x.id === sel);
                      if (entity) beginInlineRename(currentTab.path, sel, entity);
                    })}><Icons8Icon id="pencil_ui" size={14} /> Rename</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => openBottomPlugin('batch-rename'))}><Icons8Icon id="batch_rename" size={14} /> Batch / Smart Rename…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'cut');
                    })}><Icons8Icon id="cut" size={14} /> Cut</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setClipboardState(getSelectedEntityPaths(), 'copy');
                    })}><Icons8Icon id="copy" size={14} /> Copy</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => void executePaste(currentTab.path))}><Icons8Icon id="clipboard" size={14} /> Paste</div>
                    <MenubarSubmenu label="To Clipboard" iconId="clipboard">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const paths = getSelectedEntityPaths();
                        if (!paths[0]) { setToastMessage('Select an item first.'); return; }
                        void copyTextToClipboard(toWindowsPath(paths[0]), 'Path copied.');
                      })}><Icons8Icon id="copy" size={14} /> Copy Path</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const ents = getMenuSelectedEntities();
                        if (!ents[0]) { setToastMessage('Select an item first.'); return; }
                        void copyTextToClipboard(ents[0].name || '', 'Name copied.');
                      })}><Icons8Icon id="copy" size={14} /> Copy Name</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        void copyTextToClipboard(toWindowsPath(currentTab.path), 'Location copied.');
                      })}><Icons8Icon id="copy" size={14} /> Copy Location</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void duplicateSelectedItems(); })}><Icons8Icon id="copy" size={14} /> Duplicate</div>
                    </MenubarSubmenu>
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
                    <MenubarSubmenu label="New" iconId="new_folder">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                               void createNewItemInActivePane('New folder', 'dir');
                            })}><Icons8Icon id="new_folder" size={14} /> New Folder</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                               void createNewItemInActivePane('New Text Document.txt', 'file');
                            })}><Icons8Icon id="new_file" size={14} /> New Text Document</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                              const paths = getSelectedEntityPaths();
                              if (!paths.length) { setToastMessage('Select files to archive.'); return; }
                              const dest = `${toWindowsPath(currentTab.path)}\\Archive-${Date.now()}.zip`;
                              const { IPC } = await import('../lib/ipcBridge');
                              const res = await IPC.createArchive(paths.map(toWindowsPath), dest, 'zip');
                              setToastMessage(isQueuedIpcResult(res) ? 'Archive queued — see transfer panel.' : (res.ok ? 'Archive created.' : (res.error || 'Archive failed.')));
                            })}>ZIP Archive</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                              const paths = getSelectedEntityPaths();
                              if (paths.length !== 1) { setToastMessage('Select one item for a shortcut.'); return; }
                              const { IPC } = await import('../lib/ipcBridge');
                              const target = toWindowsPath(paths[0]);
                              const res = await IPC.createLink(`${target}.lnk`, target, 'shortcut');
                              setToastMessage(isQueuedIpcResult(res) ? 'Shortcut queued — see transfer panel.' : (res.success ? 'Shortcut created.' : (res.error || 'Failed to create shortcut.')));
                            })}>Shortcut</div>
                            {fileMenuShellNewItems.length > 0 && (
                              <>
                                <div className="h-[1px] bg-[#444] my-1" />
                                <div className="px-3 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 select-none">Windows New</div>
                                {fileMenuShellNewItems.map((item, i) => {
                                  if (item.separator) return <div key={`shell-new-sep-${i}`} className="h-[1px] bg-[#444] my-1" />;
                                  if (item.children?.length) return null;
                                  const verb = resolveNativeItemVerb(item);
                                  if (!verb) return null;
                                  const label = item.label || item.id || verb;
                                  return (
                                    <div
                                      key={`shell-new-${item.id || verb || i}`}
                                      className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200"
                                      onMouseDown={menuAct(() => {
                                        const folder = toWindowsPath(currentTab.path);
                                        import('../lib/ipcBridge').then(({ IPC }) => IPC.executeContextMenuVerb(folder, verb));
                                      })}
                                    >
                                      {label}
                                    </div>
                                  );
                                })}
                              </>
                            )}
                    </MenubarSubmenu>

                    <MenubarSubmenu label="Copy / Move / Backup" iconId="copy_to">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void copyOrMoveToTarget('copy'); })}><Icons8Icon id="copy_to" size={14} /> Copy To…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void copyOrMoveToTarget('move'); })}><Icons8Icon id="cut" size={14} /> Move To…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const other = panes.find(p => p.id !== activePaneId);
                        const dest = other?.tabs[other.activeTabIndex]?.path;
                        if (dest) void copyOrMoveToTarget('copy', dest);
                        else void copyOrMoveToTarget('copy');
                      })}><Icons8Icon id="copy" size={14} /> Backup To… (copy)</div>
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const paths = getSelectedEntityPaths();
                      if (!paths[0]) return;
                      let win = toWindowsPath(paths[0]);
                      win = applyWebPathMap(config, win);
                      import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('copyPath', win));
                    })}><Icons8Icon id="copy" size={14} /> Copy Path</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const items = getSortedContentsForActivePane() as any[];
                      if (!items?.length) {
                        setToastMessage('Nothing to export in this folder.');
                        return;
                      }
                      const report = buildListReportCsv(config, items.map((e: any) => ({
                        name: e.name,
                        type: e.type,
                        size: e.size,
                        modified: e.modified,
                        path: e.path || joinPanePath(currentPath, e),
                        extension: e.extension,
                        isDirectory: e.type === 'directory',
                      })), { folderPath: currentPath });
                      let body = report.csv;
                      if (config.appendToExistingFile) {
                        try {
                          const { readClipboardText } = await import('../lib/clipboardSafe');
                          const prev = await readClipboardText();
                          if (prev?.trim()) body = `${prev.replace(/\s+$/, '')}\n${report.csv.split('\n').slice(1).join('\n')}`;
                        } catch { /* ignore */ }
                      }
                      const { writeClipboardText } = await import('../lib/clipboardSafe');
                      const ok = await writeClipboardText(body);
                      if (ok) {
                        setToastMessage(`Exported ${report.filename} to clipboard (${config.csvFieldSeparator || 'system'} separator).`);
                      } else {
                        setToastMessage('Could not write CSV to clipboard.');
                      }
                    })}><Icons8Icon id="download" size={14} /> Export List as CSV</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => refreshWorkspace())}><Icons8Icon id="refresh" size={14} /> Refresh</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                        const entities = getMenuSelectedEntities();
                        if (!entities.length) {
                          // Folder properties when nothing selected
                          if (currentTab.path && currentTab.path !== '/') {
                            runShellVerbOnSelection('properties', false);
                            return;
                          }
                          setToastMessage('Select an item first.');
                          return;
                        }
                        runShellVerbOnSelection('properties');
                    })}>
                       <Icons8Icon id="properties" size={14} /> Properties
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => openBottomPlugin('metadata'))}>
                      <Icons8Icon id="info_ui" size={14} /> Metadata <span className="ml-auto text-[10px] text-gray-500">Shift+Enter</span>
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      if (!isPreviewPanelOpen) togglePreviewPanel();
                    })}><Icons8Icon id="toggle_preview" size={14} /> Quick File View <span className="ml-auto text-[10px] text-gray-500">Ctrl+Q</span></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      if (!focusedItemId && !(currentTab.selectedItems?.length)) {
                        setToastMessage('Select or focus an item first.');
                        return;
                      }
                      openQuickPreview();
                    })}><Icons8Icon id="eye_ui" size={14} /> Floating Preview <span className="ml-auto text-[10px] text-gray-500">Space</span></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => runShellVerbOnSelection('share'))}><Icons8Icon id="share" size={14} /> Share…</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}><Icons8Icon id="config" size={14} /> Configuration...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsToolbarConfigOpen(true))}><Icons8Icon id="wrench" size={14} /> Customize Toolbar...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      await import('../data/configContext').then(m => m.flushPendingSettingsSave());
                      setToastMessage('Settings saved.');
                    })}><Icons8Icon id="check" size={14} /> Save Settings</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      await import('../lib/settingsExport').then(m => m.exportSettingsBundle(config as Record<string, unknown>));
                      setToastMessage('Settings exported.');
                    })}><Icons8Icon id="download" size={14} /> Export Settings…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const r = await import('../lib/settingsExport').then(m => m.importSettingsBundle(s => updateConfig(s as any)));
                      setToastMessage(r.message);
                    })}><Icons8Icon id="upload" size={14} /> Import Settings…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void navigateToAppDataFolder('ini'); })}><Icons8Icon id="config" size={14} /> Open Configuration File</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#e81123]/80 cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const tab = currentTab;
                      if (tab.selectedItems.length > 0) {
                        const dirContents = pathContentsCache[tab.path] || pathContentsCache[normalizePanePath(tab.path)] || [];
                        const entities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                        if (entities.length > 0) handleDeleteRequest(entities, tab.path);
                      } else setToastMessage('Select item(s) to delete.');
                    })}><Icons8Icon id="delete" size={14} /> Delete <span className="ml-auto text-[10px] text-gray-500">Del</span></div>
                    <MenubarSubmenu label="Exit" iconId="close">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                        await import('../data/configContext').then(m => m.discardPendingSettingsSave());
                        import('../lib/ipcBridge').then(({ IPC }) => IPC.requestClose('restart-without-saving'));
                      })}><Icons8Icon id="refresh" size={14} /> Restart without Saving</div>
                      <div className="px-3 py-1 hover:bg-[#e81123]/80 cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                        await import('../data/configContext').then(m => m.discardPendingSettingsSave());
                        import('../lib/ipcBridge').then(({ IPC }) => IPC.requestClose('exit-without-saving'));
                      })}><Icons8Icon id="close" size={14} /> Exit without Saving <span className="ml-auto text-[10px] text-gray-500">Ctrl+Alt+F4</span></div>
                      <div className="h-[1px] bg-[#444] my-1"></div>
                      <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                        await flushSessionBeforeClose();
                        import('../lib/ipcBridge').then(({ IPC }) => IPC.requestClose('menu'));
                      })}>
                        <Icons8Icon id="close" size={14} /> Exit <span className="ml-auto text-[10px] text-gray-500">Alt+F4</span>
                      </div>
                    </MenubarSubmenu>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Edit')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Edit"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Edit' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('Edit')}
             >Edit</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Edit'} anchorEl={menubarAnchors.current['Edit']} minWidth={240}>
                    <MenubarSubmenu label="New">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        void createNewItemInActivePane('New folder', 'dir');
                      })}>New Folder</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        void createNewItemInActivePane('New Text Document.txt', 'file');
                      })}>New Text Document</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                        const paths = getSelectedEntityPaths();
                        if (paths.length !== 1) { setToastMessage('Select one item for a shortcut.'); return; }
                        const { IPC } = await import('../lib/ipcBridge');
                        const target = toWindowsPath(paths[0]);
                        const res = await IPC.createLink(`${target}.lnk`, target, 'shortcut');
                        setToastMessage(isQueuedIpcResult(res) ? 'Shortcut queued — see transfer panel.' : (res.success ? 'Shortcut created.' : (res.error || 'Failed.')));
                      })}>New Shortcut</div>
                    </MenubarSubmenu>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setClipboardState(getSelectedEntityPaths(), 'cut'))}>
                      <Icons8Icon id="cut" size={14} /> Cut
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setClipboardState(getSelectedEntityPaths(), 'copy'))}>
                      <Icons8Icon id="copy" size={14} /> Copy
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => void executePaste(currentTab.path))}>
                      <Icons8Icon id="clipboard" size={14} /> Paste
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const ents = getMenuSelectedEntities();
                      if (!ents.length) { setToastMessage('Select item(s) first.'); return; }
                      const names = ents.map((e: any) => e.name).join('\n');
                      try {
                        const prev = await (await import('../lib/clipboardSafe')).readClipboardText();
                        await navigator.clipboard.writeText(prev ? `${prev}\n${names}` : names);
                        setToastMessage('Appended names to clipboard.');
                      } catch {
                        setToastMessage('Could not append to clipboard.', 'warning');
                      }
                    })}>Append</div>

                    <MenubarSubmenu label="Paste Special">
                      {(() => {
                        const fileClip = hasFileClipboard();
                        const act = (fn: () => void | Promise<void>) => (fileClip ? menuAct(fn) : undefined);
                        const actAlways = (fn: () => void | Promise<void>) => menuAct(fn);
                        const fileRow = (label: React.ReactNode, fn: () => void | Promise<void>, shortcut?: string) => (
                          <div
                            key={String(label)}
                            className={fileClip ? 'px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2' : 'px-3 py-1 text-sm text-gray-500 cursor-default select-none'}
                            onMouseDown={act(fn)}
                          >
                            {label}
                            {shortcut ? <span className="ml-auto text-[10px] text-gray-500 pl-3">{shortcut}</span> : null}
                          </div>
                        );
                        return (
                          <>
                            {fileRow('Paste Here to New Subfolder…', () => { void pasteIntoNewSubfolder(); }, 'Ctrl+Shift+V')}
                            {fileRow('Paste Here with Path…', () => {
                              void executePaste(currentTab.path, { recreateSourceStructure: true });
                            })}
                            {fileRow('Paste Here As…', () => { void pasteHereAs(); })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Paste (Move)', () => { void executePaste(currentTab.path, { forceAction: 'cut' }); })}
                            {fileRow('Paste (Copy)', () => { void executePaste(currentTab.path, { forceAction: 'copy' }); })}
                            {fileRow('Paste (Backup)', () => {
                              void executePaste(currentTab.path, { forceAction: 'copy' });
                              setToastMessage('Backup paste (copy) started.');
                            })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Paste As Shortcut(s)', () => { void pasteAsLinksFromClipboard('shortcut'); })}
                            {fileRow('Paste As Hard Link(s)', () => { void pasteAsLinksFromClipboard('hardlink'); })}
                            {fileRow('Paste As Symbolic Link(s)', () => { void pasteAsLinksFromClipboard('symlink'); })}
                            {fileRow('Paste As Junction(s)', () => { void pasteAsLinksFromClipboard('junction'); })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Paste Extracted', () => { void pasteExtractedFromClipboard(); })}
                            {fileRow('Paste Zipped', () => { void pasteZippedFromClipboard(); })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Paste Folder Structure', () => { void pasteFolderStructureOnly(); })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={actAlways(() => { void pasteTextAsItems(); })}>Paste Text As Item(s)</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={actAlways(() => { void pasteTextIntoNewFile(); })}>
                              Paste Text Into New File <span className="ml-auto text-[10px] text-gray-500 pl-3">Ctrl+Alt+V</span>
                            </div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={actAlways(() => { void pasteImageIntoNewPng(); })}>
                              Paste Image Into New PNG File <span className="ml-auto text-[10px] text-gray-500 pl-3">Ctrl+Shift+Alt+V</span>
                            </div>
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Mark Files in Clipboard as \'Cut\'', () => {
                              setClipboardState(clipboard.items, 'cut');
                              setToastMessage('Clipboard marked as Cut.');
                            })}
                            {fileRow('Mark Files in Clipboard as \'Copied\'', () => {
                              setClipboardState(clipboard.items, 'copy');
                              setToastMessage('Clipboard marked as Copied.');
                            })}
                            <div className="h-[1px] bg-[#444] my-1" />
                            {fileRow('Edit Clipboard…', () => { void editClipboardPaths(); })}
                            <div
                              className={clipboardHistory.length ? 'px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2' : 'px-3 py-1 text-sm text-gray-500 cursor-default select-none'}
                              onMouseDown={clipboardHistory.length ? actAlways(() => {
                                if (restorePreviousClipboard()) setToastMessage('Previous clipboard restored.');
                              }) : undefined}
                            >Restore Previous Clipboard</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={actAlways(() => {
                              clearClipboard();
                              setToastMessage('Clipboard cleared.');
                            })}>Clear Clipboard</div>
                          </>
                        );
                      })()}
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>

                    <MenubarSubmenu label="Select">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        const items = pathContentsCache[currentTab.path] || [];
                        setSelectedItems(items.map((x: any) => x.id), activePaneId);
                      })}>Select All</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setSelectedItems([], activePaneId))}>Select None</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => invertSelectionInActivePane())}>Invert Selection</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        const items = (pathContentsCache[currentTab.path] || []).filter((x: any) => x.type === 'directory');
                        setSelectedItems(items.map((x: any) => x.id), activePaneId);
                      })}>Select Folders</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        const items = (pathContentsCache[currentTab.path] || []).filter((x: any) => x.type !== 'directory');
                        setSelectedItems(items.map((x: any) => x.id), activePaneId);
                      })}>Select Files</div>
                    </MenubarSubmenu>

                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const items = pathContentsCache[currentTab.path] || [];
                      setSelectedItems(items.map((x: any) => x.id), activePaneId);
                    })}><Icons8Icon id="checksquare_ui" size={14} /> Select All</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>

                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void runUndoRedo(false); })}>
                      <Icons8Icon id="undo" size={14} /> Undo <span className="ml-auto text-[10px] text-gray-500">Ctrl+Z</span>
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void runUndoRedo(true); })}>
                      <Icons8Icon id="redo" size={14} /> Redo <span className="ml-auto text-[10px] text-gray-500">Ctrl+Y</span>
                    </div>
                    {config.logActionsAndEnableUndoRedo !== false && (
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setShowHistoryDialog(true))}>
                        <Icons8Icon id="clock_ui" size={14} /> History…
                      </div>
                    )}
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setShowHistoryDialog(true))}>
                      <Icons8Icon id="clock_ui" size={14} /> Action Log / Recent Ops…
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const ents = getMenuSelectedEntities();
                      if (!ents[0]) { setToastMessage('Select an item first.'); return; }
                      import('../lib/ipcBridge').then(({ IPC }) => IPC.shellExecute('copyPath', toWindowsPath(joinPanePath(currentTab.path, ents[0]))));
                    })}><Icons8Icon id="copy" size={14} /> Copy Path</div>

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

                    <MenubarSubmenu label="Backup To…">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        const other = panes.find(p => p.id !== activePaneId);
                        const dest = other?.tabs[other.activeTabIndex]?.path;
                        if (dest) void copyOrMoveToTarget('copy', dest);
                        else void copyOrMoveToTarget('copy');
                      })}>Other Pane (copy)</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { void copyOrMoveToTarget('copy'); })}>Browse…</div>
                    </MenubarSubmenu>

                    <MenubarSubmenu label="Compare">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => startFolderCompare())}>Compare / Sync Folders</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => openBottomPlugin('find'))}>Find Differences…</div>
                    </MenubarSubmenu>

                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => openBottomPlugin('batch-rename'))}>
                      <Icons8Icon id="sparkles_ui" size={14} /> Smart Rename
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => openBottomPlugin('find'))}>
                      <Icons8Icon id="file_search_ui" size={14} /> Find Files…
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { omniFilterRef.current?.focus(); })}>Find Now / Quick Search</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      void (async () => {
                        const q = filterText.trim() || (await requestNativePrompt({
                          title: 'Global search',
                          message: 'Search query',
                          defaultValue: '',
                        })) || '';
                        if (!q.trim()) return;
                        setFilterText(q.startsWith('> ') ? q : `> ${q.trim()}`);
                        omniFilterRef.current?.focus();
                      })();
                    })}>Global Search…</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const tab = currentTab;
                      if (tab.selectedItems.length > 0) {
                        const dirContents = pathContentsCache[tab.path] || pathContentsCache[normalizePanePath(tab.path)] || [];
                        const entities = dirContents.filter((x: any) => tab.selectedItems.includes(x.id));
                        if (entities.length > 0) handleDeleteRequest(entities, tab.path);
                      } else setToastMessage('Select item(s) to delete.');
                    })}><Icons8Icon id="delete" size={14} /> Delete Selected</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('View')}>
             <div 
                 data-menu-trigger
                 data-menu-id="View"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'View' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('View')}
             >View</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
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
                 onMouseDown={toggleMenubarMenu('Go')}
             >Go</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Go'} anchorEl={menubarAnchors.current['Go']} minWidth={260}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goBack())}>
                       <Icons8Icon id="nav_back" size={14} /> Back
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goForward())}>
                       <Icons8Icon id="nav_forward" size={14} /> Forward
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goBack())}>
                       Previous Location
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const items = pathContentsCache[currentTab.path] || [];
                      if (!items.length) return;
                      const ids = items.map((x: any) => x.id);
                      const cur = focusedItemId && ids.includes(focusedItemId) ? focusedItemId : (currentTab.selectedItems[0] || ids[0]);
                      const idx = Math.max(0, ids.indexOf(cur));
                      const prev = items[Math.max(0, idx - 1)];
                      if (prev) {
                        setFocusedItemId(prev.id);
                        setSelectedItems([prev.id], activePaneId);
                      }
                    })}>Previous Item</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const other = panes.find(p => p.id !== activePaneId);
                      const dest = other?.tabs[other.activeTabIndex]?.path;
                      if (dest) setCurrentPath(dest);
                      else if (currentTab.history.length > 1) {
                        const i = Math.max(0, currentTab.historyIndex - 1);
                        setCurrentPath(currentTab.history[i]);
                      } else setToastMessage('No last target available.');
                    })}>Last Target</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goUp())}>
                       <Icons8Icon id="nav_up" size={14} /> Up One Level
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goToDriveRoot())}>Top (Drive Root)</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => goUp())}>Up</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => enterFocusedOrSelectedFolder())}>Down (Enter Folder)</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => focusAddressBar())}>Breadcrumb / Address Bar</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(BNDZ_HOME))}>
                       <Icons8Icon id="home" size={14} /> Home
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      setCurrentPath(BNDZ_CANVAS);
                      window.dispatchEvent(new CustomEvent('bndz-open-continuum'));
                    })}>
                       <Icons8Icon id="view_grid" size={14} /> Continuum
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(homeTreePath))}>
                       <Icons8Icon id="home" size={14} /> {(windowsUsername && windowsUsername !== 'Public') ? windowsUsername : 'Profile'}
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(BNDZ_CANVAS))}>
                       <Icons8Icon id="view_grid" size={14} /> Spatial Canvas
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath(BNDZ_AUTOMATION))}>
                       <Icons8Icon id="zap_ui" size={14} /> Automation
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/'))}>
                       <Icons8Icon id="this_pc" size={14} /> This PC
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Desktop'))}><Icons8Icon id="monitor_ui" size={14} /> Desktop</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Personal'))}><Icons8Icon id="file_ui" size={14} /> Documents</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setCurrentPath('/shell:Downloads'))}><Icons8Icon id="arrow_down_circle_ui" size={14} /> Downloads</div>
                    <MenubarSubmenu label="Drives">
                      {(navigationDrives || []).length === 0 ? (
                        <div className="px-3 py-1 text-sm text-gray-500 italic">(No drives)</div>
                      ) : (
                        navigationDrives.map((d: any) => (
                          <div
                            key={d.name}
                            className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200"
                            onMouseDown={menuAct(() => setCurrentPath(d.name))}
                          >
                            {formatDriveDisplayName(d.label, d.name)}
                          </div>
                        ))
                      )}
                    </MenubarSubmenu>
                    <MenubarSubmenu label="Recent Locations">
                      {((config.navigationHistory as any[]) || []).slice(0, 12).length === 0 ? (
                        <div className="px-3 py-1 text-sm text-gray-500 italic">(Empty)</div>
                      ) : (
                        ((config.navigationHistory as any[]) || []).slice(0, 12).map((v: any, i: number) => {
                          const p = typeof v === 'string' ? v : (v?.path || '');
                          if (!p) return null;
                          return (
                            <div key={`${p}-${i}`} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 truncate max-w-[320px]" title={p} onMouseDown={menuAct(() => setCurrentPath(p))}>
                              {formatAddressBarPath(p)}
                            </div>
                          );
                        })
                      )}
                    </MenubarSubmenu>
                    <MenubarSubmenu label="Hotlist (Rapid access)">
                      {rapidAccessItems.length === 0 ? (
                        <div className="px-3 py-1 text-sm text-gray-500 italic">(Empty)</div>
                      ) : (
                        rapidAccessItems.slice(0, 16).map((s) => (
                          <div key={s.path} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 truncate max-w-[320px]" title={formatUiPath(s.path)} onMouseDown={menuAct(() => setCurrentPath(s.path))}>
                            {s.name || formatUiPath(s.path)}
                          </div>
                        ))
                      )}
                    </MenubarSubmenu>
                    <MenubarSubmenu label="Tablist">
                      {currentPane?.tabs?.length ? currentPane.tabs.map((t: any, i: number) => (
                        <div key={t.id || i} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 truncate max-w-[320px]" title={formatUiPath(t.path)} onMouseDown={menuAct(() => {
                          setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, activeTabIndex: i } : p));
                        })}>
                          {getPaneTabLabel(t.path) || formatUiPath(t.path) || `Tab ${i + 1}`}
                        </div>
                      )) : (
                        <div className="px-3 py-1 text-sm text-gray-500 italic">(No tabs)</div>
                      )}
                    </MenubarSubmenu>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setShowHistoryDialog(true))}>History…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      // Native FM: jump straight into the address bar — never browser prompt().
                      focusAddressBar();
                    })}>Go to… / Go Now</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void navigateToAppDataFolder('app'); })}>Application Folder</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { void navigateToAppDataFolder('appdata'); })}>AppData Folder</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => addTab(activePaneId, currentTab.path))}><Icons8Icon id="folder_open_ui" size={14} /> Open Location in New Tab</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      void (async () => {
                        const q = filterText.trim() || (await requestNativePrompt({
                          title: 'New Finding Tab',
                          message: 'Search query',
                          defaultValue: '',
                        })) || '';
                        if (q.trim()) addFindingTab(activePaneId, q.trim());
                        closeMenu();
                      })();
                    })}><Icons8Icon id="file_search_ui" size={14} /> New Finding Tab…</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Tools')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Tools"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Tools' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('Tools')}
             >Tools</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Tools'} anchorEl={menubarAnchors.current['Tools']} minWidth={260}>
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
                        import('../lib/ipcBridge').then(async ({ IPC }) => {
                            await IPC.clearIconCache();
                            updateConfig({ iconCacheBuster: Date.now() });
                            const contents = pathContentsCache[currentTab.path] || [];
                            if (contents.length) {
                              const { prefetchIconsForEntities, prefetchMediaThumbnailsForEntities } = await import('../lib/nativeIconService');
                              await prefetchIconsForEntities(contents, currentTab.path, 'shell', 160);
                              await prefetchMediaThumbnailsForEntities(contents, currentTab.path, 192, {
                                includeFolders: config.showFolderThumbnails === true,
                              });
                            }
                            setToastMessage("Icon cache rebuilt for current folder.");
                            refreshWorkspace();
                        });
                    })}>
                       <Icons8Icon id="refresh" size={14} /> Rebuild Icon Cache
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => setIsPluginStoreOpen(true))}>
                       <Icons8Icon id="extension_hub" size={14} /> Extension Hub
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { setIsTagManagerOpen(true); closeMenu(); })}><Icons8Icon id="tag_manager" size={14} /> Manage Tags...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { setBottomPluginTab('batch-rename'); if (!isBottomPanelOpen) toggleBottomPanel(); closeMenu(); })}><Icons8Icon id="batch_rename" size={14} /> Batch Rename</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <MenubarSubmenu label="Intent">
                      {WORK_INTENT_ORDER.map(id => {
                        const pack = WORK_INTENT_PACKS[id];
                        const active = (config.workIntentId || 'browse') === id;
                        return (
                          <div
                            key={id}
                            className={`px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm flex items-center gap-2 ${active ? 'text-amber-200' : 'text-gray-200'}`}
                            onMouseDown={menuAct(() => {
                              const { patch, toast } = applyWorkIntentPack(id, { installedPluginIds: installedPluginIdSet });
                              updateConfig(patch);
                              setToastMessage(toast);
                              if (patch.bottomPanelDefaultPlugin) {
                                openBottomPlugin(String(patch.bottomPanelDefaultPlugin));
                              }
                            })}
                          >
                            <span className="flex-1">{pack.label}</span>
                            {active && <span className="text-[10px] uppercase tracking-wide text-amber-300/80">active</span>}
                          </div>
                        );
                      })}
                    </MenubarSubmenu>
                    <MenubarSubmenu label="Customize">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { void navigateToAppDataFolder('ini'); })}>Open Configuration File</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        setConfigInitialTab('Keyboard Shortcuts');
                        setIsConfigDialogOpen(true);
                      })}>Keyboard Shortcuts…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        setConfigInitialTab('Refresh, Icons, History');
                        setIsConfigDialogOpen(true);
                      })}>File Icons…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setIsToolbarConfigOpen(true))}>Toolbar…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        setConfigInitialTab('Tree and List');
                        setIsConfigDialogOpen(true);
                      })}>Tree…</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                        setConfigInitialTab('Tabs');
                        setIsConfigDialogOpen(true);
                      })}>List / Tabs…</div>
                    </MenubarSubmenu>
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
                 onMouseDown={toggleMenubarMenu('Favorites')}
             >Rapid access</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Favorites'} anchorEl={menubarAnchors.current['Favorites']} minWidth={260}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { toggleFavoriteFolder(); closeMenu(); }}><Icons8Icon id="zap_ui" size={14} /> Toggle Rapid access pin</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const path = collapseKnownFolderShadowPath(
                        resolveShellKnownFolderToFs(normalizePanePath(currentTab.path), shortcuts),
                        shortcuts,
                      );
                      if (!path || path === '/') {
                        setToastMessage('Navigate to a folder to pin to Rapid access.');
                        return;
                      }
                      const pinned = config.pinnedFavorites || [];
                      const exists = pinned.some((p: any) =>
                        collapseKnownFolderShadowPath(
                          resolveShellKnownFolderToFs(normalizePanePath(p.path), shortcuts),
                          shortcuts,
                        ) === path);
                      if (exists) {
                        setToastMessage('Current folder is already pinned.');
                        return;
                      }
                      const name = path.split('/').filter(Boolean).pop() || 'Folder';
                      updateConfig({ pinnedFavorites: dedupePinnedFavorites([...pinned, { name, path, icon: 'folder' }], shortcuts) });
                      setToastMessage('Pinned current folder to Rapid access.');
                    })}><Icons8Icon id="folder_open_ui" size={14} /> Add Current Folder</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    {rapidAccessItems.length === 0 ? (
                      <div className="px-3 py-1 text-sm text-gray-500 italic">(No Rapid access items)</div>
                    ) : (
                      rapidAccessItems.map((s) => (
                        <div
                          key={s.path}
                          className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 truncate max-w-[340px] flex items-center gap-2"
                          title={formatUiPath(s.path)}
                          onMouseDown={menuAct(() => setCurrentPath(s.path))}
                        >
                          <Icons8Icon id="zap_ui" size={12} />
                          <span className="truncate">{s.name || formatUiPath(s.path)}</span>
                        </div>
                      ))
                    )}
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <MenubarSubmenu label="Special System Folders">
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:Desktop'))}>Desktop</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:Personal'))}>Documents</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:Downloads'))}>Downloads</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:My Pictures'))}>Pictures</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:My Music'))}>Music</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:My Video'))}>Videos</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath('/shell:Libraries'))}>Libraries</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setCurrentPath(CONTROL_PANEL_PATH))}>Control Panel</div>
                      <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { void navigateToAppDataFolder('appdata'); })}>AppData</div>
                    </MenubarSubmenu>
                    <MenubarSubmenu label="Manage Rapid access">
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}>Organize pins...</div>
                            <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                              updateConfig({ pinnedFavorites: [] });
                              setToastMessage('Cleared custom Rapid access pins (defaults remain).');
                            })}>Clear custom pins</div>
                    </MenubarSubmenu>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Tags')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Tags"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Tags' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('Tags')}
             >Tags</div>
             {config.fileTaggingFeature !== false && config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Tags'} anchorEl={menubarAnchors.current['Tags']} minWidth={240}>
                    <MenubarSubmenu label="Labels">
                      {availableTags.length === 0 ? (
                        <div className="px-3 py-1 text-sm text-gray-500 italic">(No labels)</div>
                      ) : (
                        availableTags.map(tag => {
                          const tagColor = tag.color || '#FACC15';
                          return (
                            <div key={tag.name || tag.label} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2"
                                 onClick={() => void applyTagToSelection(tag)}>
                              <TagGlyph color={tagColor} size={12} />
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagColor }} />
                              {tag.label || tag.name}
                            </div>
                          );
                        })
                      )}
                    </MenubarSubmenu>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => {
                      const tag = lastAppliedTagRef.current;
                      if (!tag) { setToastMessage('No previous label — apply a tag first.'); return; }
                      void applyTagToSelection(tag);
                    })}>Apply Last Label</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const paths = getSelectedEntityPaths().map(toWindowsPath);
                      if (!paths.length) { setToastMessage('Select an item first.'); return; }
                      const comment = await requestNativePrompt({
                        title: 'Tag comment',
                        message: 'Comment for selected item(s)',
                        defaultValue: '',
                      });
                      if (comment == null) return;
                      const { IPC } = await import('../lib/ipcBridge');
                      const sidecars = await Promise.all(paths.map(p => IPC.getTagSidecar(p)));
                      await IPC.setTagMetaBatchItems(paths.map((path, i) => ({
                        path,
                        label: sidecars[i]?.label,
                        comment,
                        tags: Array.isArray(sidecars[i]?.tags) ? sidecars[i]!.tags : [],
                      })));
                      setToastMessage(comment ? 'Comment saved.' : 'Comment cleared.');
                      refreshWorkspace();
                    })}>Comment…</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    {availableTags.map(tag => {
                        const tagColor = tag.color || '#FACC15';
                        return (
                        <div key={tag.name || tag.label} className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" 
                             onClick={() => void applyTagToSelection(tag)}>
                            <TagGlyph color={tagColor} size={12} />
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagColor }} />
                            {tag.label || tag.name}
                        </div>
                        );
                    })}
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { setTagAssignmentActive(true); closeMenu(); }}>
                      <TagGlyph color="#9CA3AF" size={12} /> Tag assignment mode…
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onClick={() => { setIsTagManagerOpen(true); closeMenu(); }}>
                      <TagGlyph color="#9CA3AF" size={12} /> Manage Tags...
                    </div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const { IPC } = await import('../lib/ipcBridge');
                      const tags = await IPC.getTagsConfig();
                      const blob = new Blob([JSON.stringify(tags, null, 2)], { type: 'application/json' });
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `bndz-tags-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                      setToastMessage('Tags database exported.');
                    })}>Export Tags Database…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'application/json,.json';
                      input.onchange = async () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        try {
                          const parsed = JSON.parse(await file.text());
                          if (!Array.isArray(parsed)) throw new Error('Expected a tags array');
                          const { IPC } = await import('../lib/ipcBridge');
                          await IPC.saveTagsConfig(parsed);
                          setAvailableTags(parsed);
                          setToastMessage(`Imported ${parsed.length} tag(s).`);
                        } catch (err: any) {
                          setToastMessage(err?.message || 'Import failed.', 'warning');
                        }
                      };
                      input.click();
                    })}>Import Tags Database…</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(async () => {
                      const { IPC } = await import('../lib/ipcBridge');
                      const tags = await IPC.getTagsConfig();
                      setAvailableTags(tags);
                      setToastMessage(`Reloaded ${tags.length} tag(s).`);
                    })}>Reload Tags Database</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('User')}>
             <div 
                 data-menu-trigger
                 data-menu-id="User"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'User' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('User')}
             >User</div>
             {config.userDefinedCommands !== false && config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
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
                 onMouseDown={toggleMenubarMenu('Scripting')}
             >Scripting</div>
             {config.scripting !== false && config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
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
                 onMouseDown={toggleMenubarMenu('Panes')}
             >Panes</div>
             {config.dualPaneFeature !== false && config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
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
                 onMouseDown={toggleMenubarMenu('Tabsets')}
             >Tabsets</div>
             {config.tabsets !== false && config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
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
                 onMouseDown={toggleMenubarMenu('Window')}
             >Window</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Window'} anchorEl={menubarAnchors.current['Window']} minWidth={200}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onClick={() => {
                      void (async () => {
                        const name = await requestNativePrompt({
                          title: 'Save window layout',
                          message: 'Layout preset name',
                          defaultValue: 'My Layout',
                        });
                        if (!name?.trim()) return;
                        const preset = { id: `wl-${Date.now()}`, name: name.trim(), outer: config.workspaceLayoutOuter, inner: config.workspaceLayoutInner, dualPane: isDualPane };
                        updateConfig({ workspaceLayoutPresets: [...(config.workspaceLayoutPresets || []), preset] });
                        setToastMessage(`Saved layout: ${name.trim()}`);
                        closeMenu();
                      })();
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
                    <div className="h-[1px] bg-[#444] my-1" />
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                      const next = !config.alwaysOnTop;
                      updateConfig({ alwaysOnTop: next });
                      import('../lib/ipcBridge').then(({ IPC }) => IPC.setAlwaysOnTop(next));
                      setToastMessage(next ? 'Always on top enabled.' : 'Always on top disabled.');
                    })}>Always on Top</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('minimize')); })}>Minimize</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('maximize')); })}>Maximize / Restore</div>
                    <div className="px-3 py-1 hover:bg-[#e81123] cursor-pointer text-sm text-gray-200 flex items-center gap-2" onMouseDown={menuAct(() => { import('../lib/ipcBridge').then(({ IPC }) => IPC.windowChrome('close')); })}>Close</div>
                 </MenubarPortalMenu>
             )}
         </div>
         <div className="relative shrink-0" ref={bindMenuAnchor('Help')}>
             <div 
                 data-menu-trigger
                 data-menu-id="Help"
                 className={`px-2.5 py-1 cursor-pointer bndz-menubar-trigger ${openMenuId === 'Help' ? 'bndz-menubar-trigger-active' : 'hover:bg-white/[0.06]'}`}
                 onMouseDown={toggleMenubarMenu('Help')}
             >Help</div>
             {config.enableSubmenus !== false && config.enableContextSubmenus !== false && (
                 <MenubarPortalMenu open={openMenuId === 'Help'} anchorEl={menubarAnchors.current['Help']} minWidth={220}>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setShowHelpTopics(true))}>Help Topics</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                      setConfigInitialTab('Keyboard Shortcuts');
                      setIsConfigDialogOpen(true);
                    })}>Keyboard Shortcuts</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setIsConfigDialogOpen(true))}>Settings Reference...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                      await import('../lib/settingsExport').then(m => m.exportSettingsBundle(config as Record<string, unknown>));
                      setToastMessage('Settings exported.');
                    })}>Export Settings...</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(async () => {
                      const r = await import('../lib/settingsExport').then(m => m.importSettingsBundle(s => updateConfig(s as any)));
                      setToastMessage(r.message);
                    })}>Import Settings...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1.5 hover:bg-emerald-700/80 cursor-pointer text-sm text-emerald-100 flex items-center gap-2" onMouseDown={menuAct(() => setShowRegisterDialog(true))}>
                      <Icons8Icon id="lock_ui" size={13} className="opacity-80" /> Register Product...
                    </div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => {
                      setToastMessage('Checking for updates…');
                      void IPC.checkForUpdates(config.updateCheckUrl, !!config.includeBetaVersions).then(r => {
                        if (r.error) setToastMessage(`Update check failed: ${r.error}`);
                        else if (r.updateAvailable) setToastMessage(`Update available: v${r.latestVersion}. See About BNDZ to download.`);
                        else setToastMessage(`You are on the latest version (v${r.currentVersion}).`);
                      });
                    })}>Check for Updates...</div>
                    <div className="h-[1px] bg-[#444] my-1"></div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('eula').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open EULA.'); }))}>License Agreement (EULA)</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('privacy').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open Privacy Policy.'); }))}>Privacy Policy</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => void IPC.openLegalDoc('third-party').then(r => { if (!r.ok) setToastMessage(r.error || 'Could not open third-party licenses.'); }))}>Third-Party Licenses</div>
                    <div className="px-3 py-1 hover:bg-[#007acc] cursor-pointer text-sm text-gray-200" onMouseDown={menuAct(() => setShowAboutDialog(true))}>About BNDZ</div>
                 </MenubarPortalMenu>
             )}
         </div>
         </div>
         {!isFilesHostBoot() && !isNativeShellHostBoot() && !isNativeShellCraftIslandBoot() && <WindowControls />}
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
         <div key={rowIndex} className="bndz-chrome-toolbar flex items-center px-1 py-0.5 overflow-visible min-h-[28px]" style={{ background: 'var(--toolbar-bg, var(--bndz-surface-chrome))' }}>
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
                     launcherIcon={item.id.startsWith('tag__') ? undefined : launcherIconUrl(item.id)}
                     tagColor={item.id.startsWith('tag__') ? (def.color || '#FACC15') : undefined}
                     title={toolbarTitle}
                     disabled={toolbarDisabled}
                     onContextMenu={(e) => {
                       // Settings → Show last actions in toolbar button menu
                       if ((item.id !== 'undo' && item.id !== 'redo') || !config.showLastActionsInToolbarButtonMenu) return;
                       e.preventDefault();
                       setShowHistoryDialog(true);
                       if (config.showOptionsInMenu) {
                         setToastMessage(
                           config.allowOnlySingleStepUndoRedo === 'Allow multi-step undo/redo'
                             ? 'Action history (multi-step undo/redo enabled).'
                             : 'Action history (single-step undo/redo).',
                         );
                       }
                     }}
                     onClick={() => {
                         switch(item.id) {
                           case 'nav_back': goBack(activePaneId); break;
                           case 'nav_forward': goForward(activePaneId); break;
                           case 'nav_up': goUp(activePaneId); break;
                           case 'go_home': {
                             setCurrentPath(BNDZ_HOME);
                             if (config.goingHomeAlsoRestoresTheListLayout) {
                               setViewMode('details', activePaneId);
                               setPanes(prev => prev.map(p =>
                                 p.id === activePaneId
                                   ? { ...p, sortColumn: 'name', sortDirection: 'asc' as const }
                                   : p,
                               ));
                             }
                             break;
                           }
                          case 'refresh': {
                              IPC.getSystemDrives().then(d => setDrives(Array.isArray(d) ? d : []));
                              IPC.getCloudProviders().then(p => setCloudProviders(Array.isArray(p) ? p : []));
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
                                   const contents = getCachedPaneContents(tab.path);
                                   let paneTarget = tab.path;
                                   if (tab.selectedItems.length > 0) {
                                       const sel = contents.find((c: any) => c.id === tab.selectedItems[0]);
                                       if (sel) paneTarget = joinPanePath(tab.path, sel);
                                   }
                                   const shellPath = resolveShellPropertiesPath(paneTarget);
                                   IPC.executeContextMenuVerb(shellPath, 'properties');
                               }
                               break;
                           }
                           case 'new_folder': {
                               void createNewItemInActivePane('New folder', 'dir');
                               break;
                           }
                           case 'new_file': {
                               void createNewItemInActivePane('New Text Document.txt', 'file');
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
                                   const dirContents = getCachedPaneContents(tab.path);
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
                                  const dirContents = getCachedPaneContents(delTab.path);
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
                                  const dirContents = getCachedPaneContents(tab.path);
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
                                   const contents = getCachedPaneContents(tab.path);
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

         <div className="bndz-chrome-toolbar flex items-center px-1 py-0.5 overflow-visible min-h-[28px]" style={{ background: 'var(--toolbar-bg, var(--bndz-surface-chrome))' }}>
         {/* Drive letters scoped to active pane (always show at end for fast access) */}
         <div className="w-[1px] h-4 bg-[#444] mx-2"></div>
         <div className="flex text-[10px] items-center gap-[2px] mx-1 font-mono">
            {navigationDrives.map(d => (
                <span key={d.name} className="bg-[#333] px-1.5 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444] hover:border-[#0078d4]/40 transition-colors" onClick={() => setCurrentPath(d.name)} title={d.label || formatDriveRootLabel(d.name)}>{formatDriveRootLabel(d.name)}</span>
            ))}
            {!navigationDrives.length && (
              <><span className="bg-[#333] px-1 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444]" onClick={() => setCurrentPath('/')}>Root</span><span className="bg-[#333] px-1 py-[1px] rounded border border-[#555] cursor-pointer hover:bg-[#444]" onClick={() => setCurrentPath('/workspace')}>Workspace</span></>
            )}
         </div>
         <div className="w-[1px] h-4 bg-[#444] mx-2"></div>
         {config.dualPaneFeature !== false && (
            <ToolbarButton launcherIcon={launcherIconUrl('toggle_dual_pane')} className="ml-1" title="Toggle Dual Pane View" onClick={toggleDualPane} />
         )}
         <div className="flex-1"></div>
         <ToolbarButton launcherIcon={launcherIconUrl('extension_hub')} title="Extension Hub (Plugin Marketplace)" onClick={() => setIsPluginStoreOpen(true)} />
         <ToolbarButton launcherIcon={launcherIconUrl('toggle_bottom')} title={workspaceToolActive ? 'Bottom panel hidden in workspace tools' : (uiRuntime.bottomPanel ? 'Toggle Bottom Plugin Panel' : 'Bottom panel disabled in settings')} onClick={toggleBottomPanel} className={!uiRuntime.bottomPanel || workspaceToolActive ? 'opacity-40 pointer-events-none' : ''} />
         <ToolbarButton launcherIcon={launcherIconUrl('toggle_preview')} title={uiRuntime.previewPanel ? "Toggle Right Side Preview Panel" : "Preview panel disabled in settings"} onClick={togglePreviewPanel} className={!uiRuntime.previewPanel ? 'opacity-40 pointer-events-none' : ''} />
         </div>
      </div>

      {/* Omni-Filter Bar + docked selection actions (opt-in via Appearance) */}
      <div className="shrink-0 relative z-30">
      <div data-tutorial="omnibar" className="bndz-chrome-omnibar flex px-2 py-1 items-center border-b border-[#333] shrink-0 gap-2" style={{ background: 'var(--toolbar-bg, var(--bndz-surface-chrome))' }}>
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
            onFocus={(e) => {
              listTypeAheadArmedRef.current = false;
              if (getListIxBehavior(config).selectAllOnFocusByMouse) {
                try { e.currentTarget.select(); } catch { /* */ }
              }
            }}
            onKeyDown={(e) => {
               if (e.key === 'Escape') {
                   setFilterText('');
                   omniFilterRef.current?.blur();
               } else if (e.key === 'Enter' && getFindBehavior(config).toggleOnSameFilter) {
                 const v = (e.target as HTMLInputElement).value;
                 if (v && v === debouncedFilterText) {
                   e.preventDefault();
                   setFilterText('');
                 }
               } else if (getListIxBehavior(config).selectAllOnFocusByKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                 e.preventDefault();
                 try { (e.target as HTMLInputElement).select(); } catch { /* */ }
               }
            }}
         />
         {filterText && (
             <button onClick={() => setFilterText('')} className="ml-2 hover:bg-[#333] text-gray-400 hover:text-white px-2 py-[2px] rounded border border-transparent hover:border-[#555] transition-colors">
                <CloseGlyph size={14} />
             </button>
         )}
      </div>
      {findLocationSuggestions.length > 0 && (
        <div className="absolute left-8 right-8 top-full z-[80]">
          <AddressAutocompleteDropdown
            suggestions={findLocationSuggestions}
            selectedIndex={findSuggestIndex}
            onSelect={(path) => {
              setCurrentPath(path, activePaneId);
              setFilterText('');
              setFindSuggestIndex(0);
              if (config.selectMatchOnDropDown) {
                const leaf = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
                if (leaf) {
                  queueMicrotask(() => {
                    const items = pathContentsCacheRef.current[normalizePanePath(path)] || [];
                    const hit = items.find((x: any) => String(x.name || '').toLowerCase() === leaf.toLowerCase());
                    if (hit) {
                      setSelectedItems([hit.id], activePaneId);
                      setFocusedItemId(hit.id);
                    }
                  });
                }
              }
            }}
            onHover={setFindSuggestIndex}
          />
        </div>
      )}
      {config.showQuickActionsBar === true && (
        <QuickActionsBar
          enabled
          visible={showQuickActionsBar && activeTab.selectedItems.length > 1}
          placement="dock"
          count={activeTab.selectedItems.length}
          actions={buildDefaultQuickActions({
            onQuickLook: () => openQuickPreview(),
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
            onPaste: () => { void pasteIntoActivePane(); },
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
            onMeshDrop: () => {
              setMeshDropPaths(bottomSelectionTargets.paths);
              setShowMeshDropDialog(true);
            },
            onRamStaging: () => openBottomPlugin('ram-staging'),
            onGhostLink: () => openBottomPlugin('ghost-link'),
            onTag: () => setTagAssignmentActive(true),
            onCompare: () => openBottomPlugin('compare'),
            canPaste: !!clipboard.items?.length && !!clipboard.action,
          })}
        />
      )}
      </div>

      {/* Main Split Architecture */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
         <ResizablePanelGroup
             key={`workspace-outer-v${config.workspaceLayoutVersion ?? WORKSPACE_LAYOUT_VERSION}-${previewDockedInWorkspace ? 'd' : 'c'}`}
             id="workspace-outer"
             direction="horizontal"
             defaultLayout={outerLayoutLive}
             onLayoutChanged={saveOuterLayout}
         >
            {/* Sidebar Tree */}
            <ResizablePanel
              id="sidebar"
              data-tutorial="sidebar"
              defaultSize={panelPct(outerLayoutLive.sidebar!)}
              minSize={panelPct(MIN_SIDEBAR_SIZE)}
              maxSize={panelPct(MAX_SIDEBAR_SIZE)}
              className="bndz-chrome-sidebar bndz-files-modern-sidebar border-r border-[#282830] overflow-hidden flex flex-col min-h-0"
              style={config.applyColors
                ? { background: 'var(--tree-bg)', color: 'var(--tree-text)' }
                : { background: 'var(--sidebar-bg, var(--bndz-surface-chrome))', color: 'var(--tree-text, var(--text-main))' }}
            >
               <LeftSidebar
                  sidebarOrder={config.sidebarOrder}
                  showMiniTree={config.showMiniTree !== false}
                  onSectionOrderChange={(order: string[]) => updateConfig({ sidebarOrder: order })}
                  onBackgroundClick={() => { setSelectedItems([], activePaneId); scheduleSelectionChrome([], true); scheduleQuickActionsBar(false); setFocusedItemId(null); setLastClickData(null); setInlineRename(null); }}
                  drivesContent={
                    navigationDrives.length > 0 ? (
                      navigationDrives.map(drive => (
                     <div
                        key={drive.name}
                        onClick={() => guardedSetCurrentPath(drive.name)}
                        onContextMenu={(e) => handleContextMenuRequest(e, drive.name, drive.name, true, drive.label, undefined, 'sidebar-item')}
                     >
                        <DriveCard drive={{ ...drive, path: drive.name }} layout="compact" selected={isSidebarDriveActive(drive.name)} />
                     </div>
                      ))
                    ) : (
                      <div className="mx-3 my-2 px-3 py-3 text-center rounded-md border border-dashed border-[#333] bg-[#151515]/80">
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          {drivesReady ? 'No local drives detected.' : 'Scanning local drives…'}
                        </p>
                        {drivesReady && (
                          <button
                            type="button"
                            className="mt-2 text-[10px] px-2 py-0.5 rounded border border-white/15 text-gray-400 hover:text-white hover:bg-white/5"
                            onClick={() => {
                              setDrivesReady(false);
                              void IPC.getSystemDrives().then(d => {
                                setDrives(Array.isArray(d) ? d : []);
                                setDrivesReady(true);
                              }).catch(() => {
                                setDrives([]);
                                setDrivesReady(true);
                              });
                            }}
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )
                  }
                  quickAccessContent={
                     rapidAccessItems.length > 0 ? (
                        rapidAccessItems.map((s) => {
                           const qaPath = normalizePanePath(s.path);
                           const iconFetch = s.iconPath || qaPath;
                           const isRenaming = !s.isDefault && renamingFavoritePath && normalizePanePath(renamingFavoritePath) === qaPath;
                           const isFavoriteDropTarget = (favoriteDrag?.overPath === qaPath && favoriteDrag.sourcePath !== qaPath)
                             || fileDragFavoriteTarget === qaPath;
                           const dropBefore = isFavoriteDropTarget && !favoriteDrag?.insertAfter;
                           const dropAfter = isFavoriteDropTarget && !!favoriteDrag?.insertAfter;
                           const isQaSelected = panePathsEqual(sidebarActiveNorm, qaPath);
                           return (
                              <div 
                                 key={qaPath}
                                 data-favorite-path={qaPath}
                                 data-favorite-default={s.isDefault ? 'true' : 'false'}
                                 className={`sidebar-pin-row group/pin relative flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[#ccc] hover:text-white border-l-2 transition-all mx-1 ${isQaSelected ? 'sidebar-pin-row-selected' : ''} ${favoriteDrag?.sourcePath === qaPath ? 'opacity-40' : ''} ${isFavoriteDropTarget ? 'bg-amber-400/15 border-amber-400/80 text-white' : isQaSelected ? '' : 'border-transparent hover:border-amber-400/70'}`}
                                 onClick={() => {
                                   if (isRenaming) return;
                                   const target = collapseKnownFolderShadowPath(s.path, shortcuts);
                                   // Settings → Open favorite files directly
                                   if (config.openFavoriteFilesDirectly) {
                                     const looksFile = /\.[A-Za-z0-9]{1,8}$/.test(target.split(/[/\\]/).pop() || '')
                                       && !target.toLowerCase().includes('/shell:');
                                     if (looksFile) {
                                       void import('../lib/ipcBridge').then(({ IPC }) => {
                                         IPC.executeContextMenuVerb(toFsPathWithOverlongSupport(config, toWindowsPath(target)), 'open');
                                       });
                                       return;
                                     }
                                   }
                                   if (config.expandInTree) {
                                     window.dispatchEvent(new CustomEvent('bndz-expand-tree-path', { detail: { path: target } }));
                                   }
                                   guardedSetCurrentPath(target);
                                 }}
                                 onDoubleClick={() => { if (!s.isDefault) setRenamingFavoritePath(qaPath); }}
                                 onContextMenu={(e) => {
                                   handleContextMenuRequest(e, s.path, s.path, true, s.name, undefined, 'sidebar-item');
                                 }}
                              >
                                 {dropBefore && <span className="absolute left-2 right-2 top-0 h-[2px] bg-amber-400/80 rounded-full pointer-events-none" />}
                                 {dropAfter && <span className="absolute left-2 right-2 bottom-0 h-[2px] bg-amber-400/80 rounded-full pointer-events-none" />}
                                 <div
                                   className="shrink-0 opacity-30 group-hover/pin:opacity-60 hover:!opacity-90 cursor-grab active:cursor-grabbing p-0.5 rounded"
                                   title="Drag to reorder"
                                   onPointerDown={e => beginFavoriteReorder(qaPath, s.name, e)}
                                 >
                                   <DragHandleGlyph size={10} />
                                 </div>
                                 <ShellNativeIcon
                                    path={iconFetch}
                                    isDir={iconFetch.toLowerCase().includes('/shell:') || shellIconIsDirectory(iconFetch)}
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
                                   <span className="bndz-sidebar-pin-label text-[11px] font-medium truncate">{s.name}</span>
                                 )}
                              </div>
                           );
                        })
                     ) : (
                        <div className="mx-3 my-2 px-3 py-4 text-center rounded-md border border-dashed border-[#333] bg-[#151515]/80">
                           <Icons8Icon id="zap_ui" size={16} className="mx-auto mb-2 opacity-50" />
                           <p className="text-[10px] text-gray-500 leading-relaxed">Pin folders from the<br />context menu</p>
                        </div>
                     )
                  }
                  cloudProvidersContent={
                    cloudDriveItems.length > 0 ? (
                      cloudDriveItems.map((item: { label: string; path?: string; syncStatus?: string; leaf?: boolean; icon?: string; shellIconPath?: string }, idx: number) => {
                        const cloudPath = item.path ? normalizePanePath(item.path) : '';
                        const isCloudSelected = !!cloudPath && panePathsEqual(sidebarActiveNorm, cloudPath);
                        return (
                        <div
                          key={`${item.path || item.label}-${idx}`}
                          role="button"
                          tabIndex={0}
                          className={`sidebar-pin-row relative flex items-center gap-2.5 px-3 py-1.5 cursor-pointer text-[#ccc] hover:text-white border-l-2 transition-all mx-1 ${isCloudSelected ? 'sidebar-pin-row-selected' : 'border-transparent'}`}
                          onClick={() => item.path && guardedSetCurrentPath(item.path)}
                          onKeyDown={(e) => {
                            if ((e.key === 'Enter' || e.key === ' ') && item.path) {
                              e.preventDefault();
                              guardedSetCurrentPath(item.path);
                            }
                          }}
                          onContextMenu={(e) => item.path && handleContextMenuRequest(e, item.path, item.path, true, item.label, undefined, 'sidebar-item')}
                        >
                          <CloudNavIcon
                            path={item.shellIconPath || item.path}
                            fallbackIcon={item.icon || 'cloud_drive'}
                            size={14}
                          />
                          <span className="bndz-sidebar-pin-label text-[11px] font-medium truncate flex-1">{item.label}</span>
                          {item.syncStatus && item.syncStatus !== 'available' && (
                            <span className={`text-[9px] uppercase shrink-0 ${
                              item.syncStatus === 'online-only' ? 'text-amber-400' :
                              item.syncStatus === 'pinned' ? 'text-emerald-400' : 'text-gray-500'
                            }`}>
                              {cloudSidebarStatusLabel(item.syncStatus)}
                            </span>
                          )}
                        </div>
                        );
                      })
                    ) : (
                      <div className="mx-3 my-2 px-3 py-4 text-center rounded-md border border-dashed border-[#333] bg-[#151515]/80">
                        <Icons8Icon id="cloud_drive" size={16} className="mx-auto mb-2 opacity-40" />
                        <p className="text-[10px] text-gray-500 leading-relaxed">No cloud drives detected</p>
                      </div>
                    )
                  }
                  miniTreeContent={
                    config.showMiniTree !== false ? (
                      <MiniTreePanel nodes={miniTreeLiveNodes} activePath={currentPath} onNavigate={guardedSetCurrentPath} />
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
                      onPrefetchPath={schedulePrefetchPath}
                      treeScrollKey={currentTab?.id}
                      onFolderContentsPeek={(path, label, x, y) => {
                        void openFolderContentsPeek(path, label, x, y);
                      }}
                      onNavigate={guardedSetCurrentPath}
                      onContextMenu={(e, path, name) => path && handleContextMenuRequest(e, path, path, true, name, undefined, 'tree-item')}
                      onBackgroundContextMenu={(e) => handleContextMenuRequest(e, currentPath, null, true, null, undefined, 'tree-background')}
                      inlineRename={inlineRename}
                      setInlineRename={setInlineRename}
                      navTreeOrder={config.navTreeOrder}
                      onTreeOrderChange={(order) => updateConfig({ navTreeOrder: order })}
                      disallowDragFromTree={settingsRt.mouse.disallowDragFromTree || !!config.disallowLeftDraggingFromFolderTree}
                      clipboard={clipboard}
                      onFileDrop={async (payload, destPath, op) => {
                        const destCanon = canonicalDropPath(destPath);
                        const sourcePaths = payload.paths.map(p => canonicalDropPath(p));
                        const shellRt = settingsRt.shell;
                        if (shellRt.confirmDrag || !!config.confirmDragAndDrop) {
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
                        executeInternalDrop(op, sourcePaths, destCanon, payload.sourcePath);
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
              defaultSize={panelPct(outerLayoutLive.workspace!)}
              minSize={panelPct(35)}
              className="bndz-chrome-workspace bndz-gpu-layer min-h-0 overflow-hidden"
            >
               <div className="relative h-full w-full min-h-0 overflow-hidden flex flex-col">
               <ResizablePanelGroup
                   key={`workspace-inner-v${config.workspaceLayoutVersion ?? WORKSPACE_LAYOUT_VERSION}`}
                   id="workspace-inner"
                   groupRef={innerGroupRef}
                   direction="vertical"
                   className={`flex-1 min-h-0${workspaceToolActive ? ' bndz-workspace-inner--tools' : ''}`}
                   defaultLayout={innerDefaultLayout}
                   onLayout={(layout) => {
                     const bottom = Number((layout as Record<string, number>).bottom ?? 0);
                     if (!bottomImmersive && layoutBottomOpen && bottom >= BOTTOM_IMMERSIVE_TRIGGER) {
                       enterBottomImmersive();
                     }
                   }}
                   onLayoutChanged={saveInnerLayout}
               >
                  {/* Main row: classic = list only; docked = list | preview above bottom plugins */}
                  <ResizablePanel
                    id="main"
                    defaultSize={panelPct(innerDefaultLayout.main!)}
                    minSize={panelPct(20)}
                    className="min-h-0 overflow-hidden"
                  >
                    {(() => {
                      const workspaceListChrome = (
                     <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-[#202020] relative">
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
                           {config.dualPaneFeature !== false && isDualPane && panes[1] ? (
                             <ResizablePanelGroup
                               id="dual-pane"
                               orientation="horizontal"
                               className="flex-1 min-h-0 min-w-0"
                               defaultLayout={dualPaneLayoutLive}
                               onLayoutChanged={saveDualPaneLayout}
                             >
                               <ResizablePanel
                                 id="pane1"
                                 defaultSize={panelPct(dualPaneLayoutLive.pane1!)}
                                 minSize={panelPct(20)}
                                 className="flex flex-col min-w-0 min-h-0 overflow-hidden"
                               >
                                 {renderPane(panes[0], 0)}
                               </ResizablePanel>
                               <ResizableHandle
                                 direction="horizontal"
                                 withHandle
                                 className="bndz-resize-handle w-1.5 bg-[#282830] transition-colors hover:bg-[#555] cursor-col-resize shrink-0 z-30"
                               />
                               <ResizablePanel
                                 id="pane2"
                                 defaultSize={panelPct(dualPaneLayoutLive.pane2!)}
                                 minSize={panelPct(20)}
                                 className="flex flex-col min-w-0 min-h-0 overflow-hidden"
                               >
                                 <div ref={dualPaneSecondRef} className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
                                   {renderPane(panes[1], 1)}
                                 </div>
                               </ResizablePanel>
                             </ResizablePanelGroup>
                           ) : (
                             renderPane(panes[0], 0)
                           )}
                        </div>
                        {config.commandDeck === true && commandDeckSignature.kind !== 'empty' && (
                          <div className="bndz-command-deck-float" aria-label="Context tools">
                            <CommandDeckShell
                              signature={commandDeckSignature}
                              onTool={handleCommandDeckTool}
                              installedPluginIds={installedPluginIds}
                              currentPath={currentPath}
                            />
                          </div>
                        )}
                     </div>
                      );
                      if (!previewDockedInWorkspace) return workspaceListChrome;
                      return (
                    <ResizablePanelGroup
                      key={`main-row-v${config.workspaceLayoutVersion ?? WORKSPACE_LAYOUT_VERSION}-${effectivePreviewOpen ? 'p' : 'n'}`}
                      id="main-row"
                      direction="horizontal"
                      className="h-full min-h-0"
                      defaultLayout={mainRowDefaultLayout}
                      onLayoutChanged={saveMainRowLayout}
                    >
                      <ResizablePanel
                        id="list"
                        defaultSize={panelPct(mainRowDefaultLayout.list!)}
                        minSize={panelPct(35)}
                        className="min-h-0 overflow-hidden"
                      >
                        {workspaceListChrome}
                      </ResizablePanel>

                      <ResizableHandle
                        direction="horizontal"
                        disabled={!effectivePreviewOpen}
                        className="bndz-resize-handle w-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-col-resize shrink-0 z-20"
                      />
                      <ResizablePanel
                        id="preview"
                        panelRef={previewPanelRef}
                        defaultSize={panelPct(mainRowDefaultLayout.preview!)}
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
                            key={`preview-${previewPath || ''}-${previewEntity?.id || ''}`}
                            entity={previewEntity}
                            path={previewPath}
                            pathContentsCache={pathContentsCache}
                            onNavigate={p => setCurrentPath(p)}
                            onToast={(msg, tone) => setToastMessage(msg, tone)}
                            selectionPaths={(currentTab.selectedItems || []).map(id => {
                              const ent = (pathContentsCache[currentTab.path] || pathContentsCache[normalizePanePath(currentTab.path)] || [])
                                .find((x: any) => x.id === id);
                              return ent ? joinPanePath(currentTab.path, ent) : id;
                            }).filter(Boolean)}
                            onSelectPath={p => {
                              const ent = (pathContentsCache[currentTab.path] || pathContentsCache[normalizePanePath(currentTab.path)] || [])
                                .find((x: any) => joinPanePath(currentTab.path, x) === p || x.path === p || x.id === p);
                              if (ent?.id) {
                                setFocusedItemId(ent.id);
                                setSelectedItems([ent.id], activePaneId);
                              }
                            }}
                            onOpenFloatingPreview={() => {
                              if (!focusedItemId && !(currentTab.selectedItems?.length)) {
                                setToastMessage('Select or focus an item first.');
                                return;
                              }
                              openQuickPreview();
                            }}
                          />
                        </div>
                      </ResizablePanel>
                    </ResizablePanelGroup>
                      );
                    })()}
                  </ResizablePanel>

                  <ResizableHandle
                     direction="vertical"
                     disabled={!layoutBottomOpen || bottomImmersive}
                     className={`bndz-resize-handle h-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-row-resize shrink-0 z-20 ${
                       bottomImmersive ? 'opacity-0 pointer-events-none' : ''
                     }`}
                     title="Drag to resize · Double-click to reset default height"
                     onDoubleClick={(e) => {
                       e.preventDefault();
                       e.stopPropagation();
                       resetBottomPanelLayout();
                     }}
                  />
                  {/* Bottom Plugin Panel — always mounted; collapsed via panelRef when hidden */}
                  <ResizablePanel
                     id="bottom"
                     panelRef={bottomPanelRef}
                     defaultSize={panelPct(innerDefaultLayout.bottom!)}
                     minSize={panelPct(5)}
                     maxSize={panelPct(MAX_BOTTOM_DOCKED)}
                     collapsible
                     collapsedSize={0}
                     className={`bndz-chrome-bottom border-t border-[#282830] flex min-h-0 min-w-0 overflow-hidden z-30 ${
                       bottomImmersive ? 'bndz-chrome-bottom--immersive-dock' : ''
                     }`}
                  >
                     <div
                       className={`flex-1 overflow-hidden h-full flex flex-col min-h-0 ${
                         bottomImmersive ? 'bndz-bottom-dock-while-immersive' : ''
                       }`}
                     >
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
                           immersive={bottomImmersive}
                           onExitImmersive={exitBottomImmersive}
                           onEnterImmersive={enterBottomImmersive}
                           onCommandDeckTool={handleCommandDeckTool}
                        />
                     </div>
                  </ResizablePanel>
               </ResizablePanelGroup>
               <div
                 id="bndz-bottom-immersive-host"
                 ref={immersiveShellRef}
                 className={`bndz-bottom-immersive-host ${bottomImmersive ? 'is-open' : ''}`}
                 aria-hidden={!bottomImmersive}
               />
               </div>
            </ResizablePanel>

            {!previewDockedInWorkspace && (
              <>
                <ResizableHandle
                  direction="horizontal"
                  disabled={!effectivePreviewOpen}
                  className="bndz-resize-handle w-1 bg-[#282830] transition-colors hover:bg-[#555] cursor-col-resize shrink-0 z-20"
                />
                <ResizablePanel
                  id="preview"
                  panelRef={previewPanelRef}
                  defaultSize={panelPct(outerLayoutLive.preview!)}
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
                      key={`preview-${previewPath || ''}-${previewEntity?.id || ''}`}
                      entity={previewEntity}
                      path={previewPath}
                      pathContentsCache={pathContentsCache}
                      onNavigate={p => setCurrentPath(p)}
                      onToast={(msg, tone) => setToastMessage(msg, tone)}
                      selectionPaths={(currentTab.selectedItems || []).map(id => {
                        const ent = (pathContentsCache[currentTab.path] || pathContentsCache[normalizePanePath(currentTab.path)] || [])
                          .find((x: any) => x.id === id);
                        return ent ? joinPanePath(currentTab.path, ent) : id;
                      }).filter(Boolean)}
                      onSelectPath={p => {
                        const ent = (pathContentsCache[currentTab.path] || pathContentsCache[normalizePanePath(currentTab.path)] || [])
                          .find((x: any) => joinPanePath(currentTab.path, x) === p || x.path === p || x.id === p);
                        if (ent?.id) {
                          setFocusedItemId(ent.id);
                          setSelectedItems([ent.id], activePaneId);
                        }
                      }}
                      onOpenFloatingPreview={() => {
                        if (!focusedItemId && !(currentTab.selectedItems?.length)) {
                          setToastMessage('Select or focus an item first.');
                          return;
                        }
                        openQuickPreview();
                      }}
                    />
                  </div>
                </ResizablePanel>
              </>
            )}
         </ResizablePanelGroup>
      </div>

      {/* Transfer queue (native background jobs) */}
      <FileTransferQueuePanel enabled={fileOpsRt.showTransferPanel || config.showTransferQueuePanel !== false} />

      {/* Footer Status Bar scoped to active pane metrics */}
      {uiRuntime.showStatusBar && (
      <div
        className="bndz-chrome-statusbar bndz-status-bar-tree-tab bndz-sidebar-section-header bndz-sidebar-section-drives px-3 py-1.5 pl-4 flex items-center justify-between shrink-0 gap-3 min-h-[26px] text-[11px]"
        title="Right-click for folder menu"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('button, a, input')) return;
          const pane = panes.find(p => p.id === activePaneId);
          const tab = pane?.tabs[pane.activeTabIndex];
          if (!tab?.path) return;
          e.preventDefault();
          e.stopPropagation();
          void handleContextMenuRequest(e, tab.path, null, true, null, undefined, 'list-background');
        }}
      >
         <div className="truncate">
           {config.useStatusBarTemplate && config.statusBarTemplate ? (
             <span>{renderStatusBarTemplate(String(config.statusBarTemplate), {
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
             }, config)}</span>
           ) : (
             <>
               {activeContents ? `${activeContents.length} item(s)` : `${drives.length} drive(s)`}
               {activeTab.selectedItems.length > 0 ? ` | ${selectionSummaryLine || `${activeTab.selectedItems.length} selected`}` : ''}
             </>
           )}
           {getListIxBehavior(config).showDragStatusBox && (pointerFileDragActive || !!listDragGhost) && (
             <span className="text-sky-300/90 ml-2 font-medium">
               {listDragGhost?.copy || listDragGhost?.dropHint?.toLowerCase().includes('copy')
                 ? 'Dragging — drop to copy'
                 : 'Dragging — drop to move'}
             </span>
           )}
           {isGlobal && isGlobalSearchLoading && (
             <span className="text-amber-400/90 ml-2">Searching…</span>
           )}
           {isGlobal && !isGlobalSearchLoading && globalSearchEngine && (
             <span className="text-amber-400/70 ml-2">
               Global · {globalSearchEngine === 'indexed' ? 'Indexed search'
                 : globalSearchEngine === 'indexed-empty' ? 'Index (no hits)'
                 : globalSearchEngine === 'windows-search' ? 'Windows Search'
                 : globalSearchEngine === 'everything' ? 'Everything'
                 : 'Filesystem'}
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
           {layoutBottomOpen && activeBottomPluginLabel && (
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
          {/* Settings → Tabsets can revert after saving settings */}
          {config.tabsetsCanRevertAfterSavingSettings && getTabsetRevertSnapshot() && (
            <button
              type="button"
              className="w-full mb-3 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-100 text-left text-[12px] hover:bg-amber-500/15 transition-colors"
              onClick={() => {
                const snap = getTabsetRevertSnapshot();
                if (!snap) return;
                updateConfig({
                  savedTabsets: JSON.parse(JSON.stringify(snap.savedTabsets)),
                  lastActiveTabsetId: snap.lastActiveTabsetId,
                });
                const preferred = snap.savedTabsets.find(t => t.id === snap.lastActiveTabsetId)
                  || snap.savedTabsets[0];
                if (preferred?.panes?.length) {
                  setPanes(JSON.parse(JSON.stringify(preferred.panes)));
                  setIsDualPane((preferred.panes as PaneState[]).length > 1);
                }
                clearTabsetRevertSnapshot();
                setIsLoadTabsetOpen(false);
                setToastMessage('Reverted tabsets to the snapshot from before the last settings save.');
              }}
            >
              Revert tabsets to before last settings save
            </button>
          )}
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
            initialTab={configInitialTab || (config as any).configurationLastTab || 'Menus & Context'}
            onClose={() => { setConfigInitialTab(undefined); setIsConfigDialogOpen(false); }}
          />
        </Suspense>
      )}

      {showHistoryDialog && (
        <Suspense fallback={null}>
          <ActionHistoryDialog
            open={showHistoryDialog}
            onClose={() => setShowHistoryDialog(false)}
          />
        </Suspense>
      )}

      </TrialExpiredGate>

      <AnimatePresence>
        {showAboutDialog && (
          <Suspense fallback={null}>
            <AboutDialog
              onClose={() => setShowAboutDialog(false)}
              updateCheckUrl={config.updateCheckUrl}
              includeBetaVersions={!!config.includeBetaVersions}
            />
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
        {showMeshDropDialog && (
          <MeshDropDialog
            paths={meshDropPaths}
            onClose={() => { setShowMeshDropDialog(false); setMeshDropPaths([]); }}
          />
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
            onTearOff={() => {
              const p = tab.path;
              setTabContextMenu(null);
              void IPC.openPathInNewWindow(p).then(r => {
                if (!r.ok) setToastMessage(r.error || 'Could not open Stage window.', 'warning');
                else setToastMessage('Opened in a new Stage window.');
              });
            }}
            onSetColor={(color) => setTabColor(tabContextMenu.paneId, tabContextMenu.tabIndex, color)}
            onCloseMenu={() => setTabContextMenu(null)}
          />
        );
      })()}

      {folderContentsPeek && (
        <FolderContentsPeek
          peek={folderContentsPeek}
          onClose={() => setFolderContentsPeek(null)}
          onOpen={(childPath) => {
            setFolderContentsPeek(null);
            guardedSetCurrentPath(childPath);
          }}
        />
      )}

      {dropActionMenu && (
        <ClampedFixedMenu
          x={dropActionMenu.x}
          y={dropActionMenu.y}
          className="z-[99985] min-w-[180px] rounded-xl border border-white/12 bg-[#161a22]/96 py-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-md"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[#e8ecf4] hover:bg-[#2a3344]"
            onClick={() => {
              executeInternalDrop('copy', dropActionMenu.paths, dropActionMenu.dest, dropActionMenu.sourcePath);
              setDropActionMenu(null);
            }}
          >
            Copy here
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[#e8ecf4] hover:bg-[#2a3344]"
            onClick={() => {
              executeInternalDrop('move', dropActionMenu.paths, dropActionMenu.dest, dropActionMenu.sourcePath);
              setDropActionMenu(null);
            }}
          >
            Move here
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-[12px] text-[#9aa3b5] hover:bg-[#2a3344]"
            onClick={() => setDropActionMenu(null)}
          >
            Cancel
          </button>
        </ClampedFixedMenu>
      )}

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
            const visibility = resolveListColumnVisibility(config, {
              isGlobalSearch: isGlobal,
              folderPath: normalizePanePath(currentTab.path),
            });
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
                    const current = resolveListColumnVisibility(config, {
                      isGlobalSearch: isGlobal,
                      folderPath: normalizePanePath(currentTab.path),
                    });
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
          onOpenMeshDrop={(paths) => { setMeshDropPaths(paths); setShowMeshDropDialog(true); }}
          onGhostLinkOffload={async (paths) => {
            const { IPC: ipc } = await import('../lib/ipcBridge');
            const cold = config.ghostLinkColdStorageRoot || '';
            if (!cold.trim()) {
              setToastMessage('Set a Ghost-Link cold storage root in Workspace Tools first.', 'warning');
              openBottomPlugin('ghost-link');
              return;
            }
            const r = await ipc.ghostLinkOffloadPaths(paths, cold.trim());
            setToastMessage(r.ok ? 'Ghost-Link offload queued — see transfer panel.' : (r.error || 'Offload failed.'), r.ok ? 'success' : 'warning');
          }}
          onGhostLinkRestore={async (path) => {
            const { IPC: ipc } = await import('../lib/ipcBridge');
            const r = await ipc.ghostLinkRestore(path);
            setToastMessage(r.ok ? 'Ghost link restored.' : (r.error || 'Restore failed.'), r.ok ? 'success' : 'warning');
            void refetchPath(currentPath);
          }}
          onStageToRam={(paths) => {
            openBottomPlugin('ram-staging', { paths });
          }}
          setIsSmartToolsOpen={setIsSmartToolsOpen}
          setToastMessage={setToastMessage}
          setInlineRename={setInlineRename}
          setClipboardState={setClipboardState}
          executePaste={(dir, opts) => {
            // Prefer explicit target dirs from context menu; otherwise honor paste-to-selected-folder.
            if (dir && dir !== currentPath && dir !== activeTab.path) return executePaste(dir, opts);
            return pasteIntoActivePane(opts);
          }}
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
          onSetSortDirection={dir => {
            setPanes(prev => prev.map(p => p.id === activePaneId ? { ...p, sortDirection: dir } : p));
            updateConfig({ listSortDirection: dir });
          }}
          listGroupBy={(config.listGroupBy as ListGroupBy) || 'none'}
          onGroupByChange={value => updateConfig({ listGroupBy: value })}
          onRenameFavorite={path => setRenamingFavoritePath(path)}
          onOpenFind={() => openBottomPlugin('find')}
          onNavigateUp={() => goUp(activePaneId)}
          onGoBack={() => goBack(activePaneId)}
          onGoForward={() => goForward(activePaneId)}
          onOpenInBndz={(panePaths, opts) => {
            const target = panePaths[0];
            if (!target) return;
            if (opts.isDirectory) {
              setCurrentPath(target, activePaneId);
              return;
            }
            const parent = target.replace(/[/\\][^/\\]+$/, '') || '/';
            const parentPane = toPanePath(parent.startsWith('/') || /^[A-Za-z]:/.test(parent) ? parent : `/${parent}`);
            const normParent = normalizePanePath(parentPane);
            const listing = pathContentsCache[normParent] || pathContentsCache[currentTab.path] || [];
            const leaf = target.split(/[/\\]/).pop()?.toLowerCase() || '';
            const ent = listing.find((c: any) => {
              const p = (c.path ? toPanePath(c.path) : joinPanePath(normParent, c)).replace(/\\/g, '/').toLowerCase();
              return p === normalizePanePath(target).replace(/\\/g, '/').toLowerCase()
                || String(c.name || '').toLowerCase() === leaf;
            });
            if (ent?.id) {
              setSelectedItems([ent.id], activePaneId);
              setFocusedItemId(ent.id);
            }
            import('../lib/ipcBridge').then(({ IPC }) => {
              IPC.recordPathOpen(toWindowsPath(target));
            });
            const idx = listing.findIndex((c: any) => c.id === ent?.id);
            // Ensure we're in the folder, then open Quick Preview of the file.
            if (normalizePanePath(currentTab.path) !== normParent && !ent) {
              setCurrentPath(normParent, activePaneId);
            }
            window.setTimeout(() => {
              openQuickPreviewRef.current?.(idx >= 0 ? idx : undefined);
            }, ent ? 0 : 80);
          }}
          onRestoreRecycleItems={async paths => {
            const { IPC } = await import('../lib/ipcBridge');
            const result = await IPC.restoreRecycleItems(paths);
            if (isQueuedIpcResult(result)) {
              setToastMessage('Restore queued — see transfer panel.');
              return;
            }
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
          onPurgeRecycleItems={paths => { requestPermanentPurge(paths); }}
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
        onQuit={(remember) => {
          void (async () => {
            setQuitDialogOpen(false);
            await flushSessionBeforeClose(
              remember
                ? { xCloseAction: 'quit', minimizeToTrayOnXClose: false }
                : undefined,
            );
            const { IPC } = await import('../lib/ipcBridge');
            IPC.windowCloseResolve('quit');
          })();
        }}
        onMinimizeToTray={(remember) => {
          void (async () => {
            setQuitDialogOpen(false);
            await flushSessionBeforeClose(
              remember
                ? { xCloseAction: 'tray', minimizeToTrayOnXClose: true, minimizeToTray: true }
                : undefined,
            );
            const { IPC } = await import('../lib/ipcBridge');
            IPC.windowCloseResolve('tray', !!remember);
          })();
        }}
      />

      <TutorialOverlay forceShow={showTutorial} onClose={() => setShowTutorial(false)} />
      <DropMagnetStrip
        externalDragActive={externalDragActive}
        pendingPaths={externalDragPaths}
        onApplied={() => {
          setExternalDragActive(false);
          setExternalDragPaths([]);
        }}
      />
      <BndzQuickPreview
        open={quickPreviewOpen && ((homeQuickPreview?.items.length ?? 0) > 0 || quickPreviewItems.length > 0)}
        items={homeQuickPreview?.items?.length ? homeQuickPreview.items : quickPreviewItems}
        index={homeQuickPreview?.items?.length
          ? Math.min(homeQuickPreview.index, Math.max(0, homeQuickPreview.items.length - 1))
          : Math.min(quickPreviewIndex, Math.max(0, quickPreviewItems.length - 1))}
        onClose={() => {
          setQuickPreviewOpen(false);
          setQuickPreviewStudio(false);
          setHomeQuickPreview(null);
        }}
        onIndexChange={ix => {
          if (homeQuickPreview?.items?.length) {
            setHomeQuickPreview(prev => prev ? { ...prev, index: ix } : prev);
          } else {
            setQuickPreviewIndex(ix);
          }
        }}
        onNavigate={p => setCurrentPath(p)}
        startInStudioEdit={quickPreviewStudio}
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
      {fluidDragEnabled ? (
        <FluidDragOrchestrator enabled />
      ) : (
        <ListDragGhost ghost={listDragGhost} ghostRef={listDragGhostElRef} />
      )}
      {favoriteReorderGhost && (
        <div
          className="fixed z-[300] pointer-events-none"
          style={{ left: favoriteReorderGhost.x + 12, top: favoriteReorderGhost.y + 8 }}
        >
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--bndz-radius-md)] border border-[#454545] shadow-lg"
            style={{ background: 'rgba(37, 37, 38, 0.96)' }}
          >
            <Icons8Icon id="explorer" size={14} />
            <div className="text-[11px] font-semibold text-white/95 truncate max-w-[180px]">{favoriteReorderGhost.label}</div>
          </div>
        </div>
      )}
      <FloatingTooltipHost />
      <DropDebugOverlay />
    </div>
    </WorkstationVisualProvider>
  );
}
