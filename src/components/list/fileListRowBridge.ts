import type React from 'react';
import type { AppConfig, VisualFilter } from '../../data/configContext';
import type { TabState } from '../tabTypes';
import type { SettingsRuntimeContext } from '../../lib/settingsRuntime';
import type { ListColumnDef, ListColumnId } from '../../lib/listColumns';
import type { ToastKind } from '../ToastHost';
import type { CloudProvider } from '../../lib/cloudStatus';
import type { ContextMenuSurface } from '../../lib/contextMenuActions';
import type { HealthSeverity } from '../../lib/useHealthProblemMap';

export type FileListRowBridge = {
  pane: { id: string };
  panePath: string;
  currentTab: TabState;
  config: AppConfig;
  settingsRt: SettingsRuntimeContext;
  mouseRt: SettingsRuntimeContext['mouse'];
  computedViewMode: string;
  isActive: boolean;
  isGlobal: boolean;
  contents: any[] | null;
  panes: Array<{ id: string; tabs: TabState[]; activeTabIndex: number }>;
  activePaneId: string;
  inlineRename: { path: string; entityId: string; currentName: string } | null;
  setInlineRename: React.Dispatch<React.SetStateAction<{ path: string; entityId: string; currentName: string } | null>>;
  focusedItemId: string | null;
  dragTargetId: string | null;
  clipboard: { mode?: string; paths?: string[] } | null;
  cloudProviders: CloudProvider[];
  folderSizeMap: Record<string, number>;
  formatSize: (bytes: number | null | undefined) => string;
  jobTicketOverdueMap: Record<string, { count: number; title?: string }>;
  healthProblemMap: Record<string, { severity: HealthSeverity; title: string }>;
  isSyncMode: boolean;
  syncResults: Record<string, { id: string; statusA?: string; statusB?: string; status?: string; path?: string }> | null;
  debouncedFilterText: string;
  detailsRowHeight: number;
  detailsPadY: number;
  detailsIconSize: number;
  detailsIconColClass: string;
  gridMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').gridTileMetrics>;
  listMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').listTileMetrics>;
  paneGridMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').gridTileMetrics> | ReturnType<typeof import('../../lib/viewModeMetrics').driveGridMetrics>;
  paneListMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').listTileMetrics> | ReturnType<typeof import('../../lib/viewModeMetrics').driveListMetrics>;
  thisPcGridMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').driveGridMetrics>;
  thisPcListMetrics: ReturnType<typeof import('../../lib/viewModeMetrics').driveListMetrics>;
  isThisPc: boolean;
  visibleListColumns: ListColumnDef[];
  getColumnStyle: (col: ListColumnDef) => React.CSSProperties;
  renderDetailColumn: (
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
      healthBadge?: { severity: HealthSeverity; title: string } | undefined;
    },
  ) => React.ReactNode;
  listTooltipsEnabled: boolean;
  buildEntityPath: (ent: any) => string;
  handleEntityClicked: (e: React.MouseEvent, id: string) => void;
  handleEntityDoubleClicked: (entity: any) => void;
  handleEntityMiddleClick: (e: React.MouseEvent, entity: any) => void;
  handleContextMenuRequest: (
    e: React.MouseEvent,
    targetPath: string,
    entityId: string | null,
    isDirectory: boolean,
    entityName: string | null,
    selectedPaths?: string[],
    surface?: ContextMenuSurface,
    entityExtension?: string | null,
  ) => void;
  selectEntityForContextMenu: (entityId: string) => void;
  commitRenameForEntity: (entity: any, panePath: string, targetName: string) => Promise<boolean>;
  openFolderContentsPeek: (folderPath: string, folderName: string, clientX: number, clientY: number) => Promise<void>;
  schedulePrefetchPath: (rawPath: string) => void;
  setSelectedItems: (items: string[] | ((prev: string[]) => string[]), paneId?: string) => void;
  setFocusedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setActivePaneId: React.Dispatch<React.SetStateAction<string>>;
  scheduleSelectionChrome: (ids: string[], immediate: boolean) => void;
  scheduleQuickActionsBar: (show: boolean, immediate?: boolean) => void;
  setToastMessage: (message: string, kind?: ToastKind, title?: string, opts?: { native?: boolean }) => void;
  suppressRowClickRef: React.MutableRefObject<boolean>;
  /** After gesture double-tap open, ignore the trailing native dblclick (avoids folder+1 / dual ShellExecute). */
  suppressNativeDblUntilRef: React.MutableRefObject<number>;
  listGestureRef: React.MutableRefObject<{ moved?: boolean; mode?: string } | null>;
  listClickDeferTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  contextMenuBlockRef: React.MutableRefObject<boolean>;
  suppressNavClickUntilRef: React.MutableRefObject<number>;
  selectionAnchorRef: React.MutableRefObject<{ paneId: string; itemId: string } | null>;
};

export const paneFileListBridgeRegistry = new Map<string, FileListRowBridge>();

export function setPaneFileListBridge(paneId: string, bridge: FileListRowBridge): void {
  paneFileListBridgeRegistry.set(paneId, bridge);
}

export function getPaneFileListBridge(paneId: string): FileListRowBridge | undefined {
  return paneFileListBridgeRegistry.get(paneId);
}

/** Sync per-pane row bridge before virtualized children render. */
export function PaneListBridgeSync({ paneId, bridge }: { paneId: string; bridge: FileListRowBridge }) {
  setPaneFileListBridge(paneId, bridge);
  return null;
}
