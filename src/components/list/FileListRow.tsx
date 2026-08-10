import React from 'react';
import {
  consumeMarqueeDragOccurred,
  clearDragSession,
  markPointerDown,
  isMarqueeActive,
} from '../../lib/dragController';
import { createEntityTooltipHandlers } from '../../lib/entityTooltip';
import { shouldSuppressNativeEntityTitle } from '../../lib/tooltipSettings';
import { highlightNameMatch } from '../../lib/liveFilterHighlight';
import { cloudBadgeForPath } from '../../lib/cloudStatus';
import { protectDirectionalFormatting } from '../../lib/bidiProtection';
import {
  evaluateColorFilter,
  getDisplayName,
  getRenameInitialValue,
} from '../../lib/settingsRuntime';
import { localizedEntityName } from '../../lib/startupTabsSettings';
import { applyVisualFilters } from '../../lib/visualFilterEngine';
import {
  getClipboardMarkForEntity,
  resolveEntityWindowsPath,
} from '../../lib/clipboardVisual';
import { joinPanePath, toWindowsPath } from '../../lib/pathUtils';
import { resolveThumbnailCaptionLines } from '../../lib/thumbnailCaptions';
import { HEALTH_BADGE_COLORS } from '../../lib/useHealthProblemMap';
import DriveCard from '../DriveCard';
import { ThumbnailIcon } from '../ThumbnailIcon';
import ClipboardMarkBadge from '../ClipboardMarkBadge';
import FolderColorIcon from '../FolderColorIcon';
import { EmblemIcon } from '../EmblemIcon';
import { JobTicketOverdueBadge } from '../preview/JobTicketPanel';
import { InlineRenameInput } from './InlineRenameInput';
import { getPaneFileListBridge } from './fileListRowBridge';

const EMPTY_TOOLTIP_HANDLERS = { onMouseEnter: () => {}, onMouseMove: () => {}, onMouseLeave: () => {} };

export type FileListRowProps = {
  paneId: string;
  entity: any;
  /** Bumps when list metadata changes so memoized rows still refresh sizes/icons. */
  entityStamp: string;
  rowIndex: number;
  isSelected: boolean;
  showSelectionChrome: boolean;
  isFocused: boolean;
  inlineRenameActive: boolean;
  inlineRenameName?: string;
  isDragTarget: boolean;
  highlightFilter: string;
  peerLabel?: string;
  syncOpacity: boolean;
  filterColor?: string;
  clipboardMark?: 'copy' | 'cut' | null;
  realityMissing: boolean;
  folderPrefetching: boolean;
  filterTintKey?: string;
  healthSeverity?: string;
};

function arePropsEqual(prev: FileListRowProps, next: FileListRowProps): boolean {
  if (prev.inlineRenameActive || next.inlineRenameActive) {
    if (prev.inlineRenameName !== next.inlineRenameName) return false;
  }
  return (
    prev.entity.id === next.entity.id
    && prev.entityStamp === next.entityStamp
    && prev.rowIndex === next.rowIndex
    && prev.isSelected === next.isSelected
    && prev.showSelectionChrome === next.showSelectionChrome
    && prev.isFocused === next.isFocused
    && prev.inlineRenameActive === next.inlineRenameActive
    && prev.isDragTarget === next.isDragTarget
    && prev.highlightFilter === next.highlightFilter
    && prev.peerLabel === next.peerLabel
    && prev.syncOpacity === next.syncOpacity
    && prev.filterColor === next.filterColor
    && prev.clipboardMark === next.clipboardMark
    && prev.realityMissing === next.realityMissing
    && prev.folderPrefetching === next.folderPrefetching
    && prev.filterTintKey === next.filterTintKey
    && prev.healthSeverity === next.healthSeverity
  );
}

function FileListRow(props: FileListRowProps) {
  const {
    paneId,
    entity,
    rowIndex,
    isSelected,
    showSelectionChrome,
    isFocused,
    inlineRenameActive,
    isDragTarget,
    highlightFilter,
    peerLabel,
    syncOpacity,
    filterColor: filterColorProp,
    clipboardMark,
    realityMissing,
    folderPrefetching,
  } = props;

  const bridge = getPaneFileListBridge(paneId);
  if (!bridge) return null;

  const {
    pane,
    panePath,
    currentTab,
    config,
    settingsRt,
    mouseRt,
    computedViewMode,
    contents,
    panes,
    activePaneId,
    inlineRename,
    setInlineRename,
    folderSizeMap,
    formatSize,
    jobTicketOverdueMap,
    healthProblemMap,
    cloudProviders,
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
  } = bridge;

  const listRt = settingsRt.list;
  const entityTags: string[] = Array.isArray((entity as any).tags) ? (entity as any).tags : [];
  const isDir = entity.type === 'directory';
  const isDrive = !!(entity as any).driveInfo;
  const drive = (entity as any).driveInfo;
  const entityWinPath = resolveEntityWindowsPath(panePath, entity);

  const iconDimClass = [
    clipboardMark && (listRt.dimmedIcons || !!config.dimmedIcons) ? 'bndz-icon-dimmed' : '',
    showSelectionChrome && (listRt.dimSelectedIcons || !!config.drawSelectedListIconsDimmed) ? 'bndz-icon-dimmed' : '',
    (entity.attributes || []).includes('hidden') && (listRt.ghostHiddenIcons || !!config.drawHiddenIconsGhosted) ? 'bndz-icon-ghosted' : '',
  ].filter(Boolean).join(' ');

  const filterResult = applyVisualFilters(entity, config.visualFilters);
  const colorFilterResult = (config.enableColorFilters !== false && config.applyColorFiltersToTheList !== false)
    ? evaluateColorFilter(entity, config.colorFilters, config)
    : null;
  const filterColor = filterColorProp ?? filterResult?.hexColor;

  const displayName = protectDirectionalFormatting(
    localizedEntityName(
      config,
      entity,
      getDisplayName(entity, {
        ...config,
        truncateFilenamesInTheMiddle: config.truncateFilenamesInTheMiddle,
        showLocalizedFolderNames: config.showLocalizedFolderNames,
      }, panePath),
    ),
    config,
  );
  const cloudBadge = cloudBadgeForPath(toWindowsPath(joinPanePath(panePath, entity)), cloudProviders);
  const jobTicketOverdue = isDir ? jobTicketOverdueMap[entityWinPath.toLowerCase()] : undefined;
  const healthBadge = healthProblemMap[entityWinPath.toLowerCase()]
    || healthProblemMap[toWindowsPath(entityWinPath).toLowerCase()];

  const commitInlineRename = () => {
    if (!inlineRename || inlineRename.entityId !== entity.id || inlineRename.path !== panePath) return;
    void commitRenameForEntity(entity, panePath, inlineRename.currentName).then(ok => {
      if (ok) setInlineRename(null);
    });
  };

  const handleSerialRenameNavigate = (direction: 'prev' | 'next') => {
    if (!inlineRename || inlineRename.entityId !== entity.id) return;
    const activePane = panes.find(p => p.id === activePaneId);
    const tab = activePane?.tabs[activePane.activeTabIndex];
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

  const renameInput = inlineRenameActive && inlineRename ? (
    <InlineRenameInput
      value={inlineRename.currentName}
      entity={entity}
      config={config}
      showNameLength={settingsRt.rename.showNameLength || !!config.showNameLengthWhileRenaming}
      serialRename={settingsRt.rename.serialRename || !!config.serialRenameWithUpAndDownKeys}
      onSerialNavigate={handleSerialRenameNavigate}
      onChange={value => setInlineRename({ ...inlineRename, currentName: value })}
      onCommit={commitInlineRename}
      onCancel={() => setInlineRename(null)}
    />
  ) : null;

  const displayLabel = renameInput
    ? renameInput
    : (highlightFilter ? highlightNameMatch(displayName, highlightFilter) : displayName);

  const tipHandlers = listTooltipsEnabled
    ? createEntityTooltipHandlers(
        entity,
        panePath,
        config,
        folderSizeMap,
        formatSize,
        { context: 'list', disabled: inlineRenameActive },
      )
    : EMPTY_TOOLTIP_HANDLERS;
  const suppressNativeTitle = shouldSuppressNativeEntityTitle(config);

  const zebraAlt = (!!config.listZebraStyle || listRt.zebraRows) && config.listZebraStyle !== 'Solid Color' && !showSelectionChrome && rowIndex % 2 === 1;
  const isGridMode = computedViewMode === 'grid';
  const isListMode = computedViewMode === 'list';
  const isDetailsMode = !isGridMode && !isListMode;
  const gridCaptionLines = isGridMode ? resolveThumbnailCaptionLines(config.thumbnailCaptionLines) : 2;
  const gridDenseHideCaption = isGridMode && !isDrive && !!gridMetrics.dense;
  const listDenseChrome = isListMode && !isDrive && !!listMetrics.dense;

  return (
    <div
      id={`fs-item-${entity.id}`}
      data-id={entity.id}
      data-peer-label={peerLabel || undefined}
      className={`fs-item-wrapper ${isGridMode ? `fs-grid-item${isDrive ? '' : ' bndz-view-grid'}${gridDenseHideCaption ? ' bndz-tile--dense' : ''}` : isListMode ? `fs-list-item${isDrive ? '' : ' bndz-view-list'}${listDenseChrome ? ' bndz-tile--dense' : ''}` : `fs-list-item bndz-view-details flex items-center ${isDrive ? 'mb-1 p-1' : ''}`} ${isGridMode ? 'flex flex-col items-stretch justify-start w-full' : isListMode ? 'flex items-center w-full min-w-0' : ''} border border-transparent cursor-default
        ${showSelectionChrome ? `fs-item-selected ${listRt.underlineSelected || !!config.underlineSelectedRows ? 'underline decoration-[#007acc]' : ''}` : (mouseRt.highlightHovered || config.highlightHoveredItems !== false) ? ((isGridMode || isListMode) && !isDrive ? 'bndz-tile--hoverable' : (isDetailsMode ? 'bndz-tile--hoverable' : (!isDrive ? 'hover:bg-[#2a2d2e]' : ''))) : ''}
        ${isFocused && !showSelectionChrome ? 'ring-1 ring-inset ring-white/30' : ''}
        ${peerLabel ? 'fs-item-wrapper--peer-share' : ''}
        ${isDragTarget && isDir ? 'ring-2 ring-inset ring-[#0078d4] bg-[#094771]/30' : ''}
        ${clipboardMark === 'copy' ? 'fs-item-clipboard-copy' : clipboardMark === 'cut' ? 'fs-item-clipboard-cut' : ''}
        ${config.coloredLines && clipboardMark ? 'fs-item-clipboard-colored-line' : ''}
        ${colorFilterResult?.className || ''}
        ${config.coloredLines && colorFilterResult && !clipboardMark ? 'border-l-2 border-l-[#0078d4]/50' : ''}
        ${syncOpacity ? 'opacity-50' : ''}
        ${realityMissing ? 'bndz-reality-missing' : ''}
        ${folderPrefetching ? 'bndz-prefetch-warm' : ''}`}
      data-sel-chrome={config.listSelectionChrome || 'fullRow'}
      style={{
        ...(isGridMode ? {
          height: isDrive ? paneGridMetrics.rowHeight : gridMetrics.rowHeight,
          minHeight: isDrive ? paneGridMetrics.rowHeight : gridMetrics.rowHeight,
          maxHeight: isDrive ? paneGridMetrics.rowHeight : gridMetrics.rowHeight,
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          padding: isDrive ? 0 : gridMetrics.padding,
          boxSizing: 'border-box' as const,
          overflow: 'hidden',
        } : {}),
        ...(isListMode ? {
          width: '100%',
          maxWidth: '100%',
          height: isDrive ? paneListMetrics.rowHeight : listMetrics.rowHeight,
          minHeight: isDrive ? paneListMetrics.rowHeight : listMetrics.rowHeight,
          maxHeight: isDrive ? paneListMetrics.rowHeight : listMetrics.rowHeight,
          paddingLeft: isDrive ? paneListMetrics.padX ?? paneListMetrics.gap : (listMetrics.padX ?? Math.max(4, listMetrics.gap)),
          paddingRight: isDrive ? paneListMetrics.padX ?? paneListMetrics.gap : (listMetrics.padX ?? Math.max(4, listMetrics.gap)),
          boxSizing: 'border-box' as const,
          overflow: 'hidden',
        } : {}),
        ...(!isGridMode && !isListMode ? {
          height: detailsRowHeight,
          minHeight: detailsRowHeight,
          maxHeight: detailsRowHeight,
          paddingTop: detailsPadY,
          paddingBottom: detailsPadY,
          boxSizing: 'border-box' as const,
        } : {}),
        ...(showSelectionChrome
          && (config.listSelectionChrome || 'fullRow') === 'fullRow'
          && config.listSelectionHighlightColor
          ? { background: config.listSelectionHighlightColor }
          : showSelectionChrome
            && (config.listSelectionChrome || 'fullRow') === 'fullRow'
            && config.applyColors
            ? { background: 'var(--list-selected-bg)' }
            : {}),
        ...(zebraAlt && !showSelectionChrome && !filterResult?.rowTint && !filterColor && !colorFilterResult?.inlineStyle
          ? { background: 'var(--list-alt-bg, rgba(255,255,255,0.045))' }
          : {}),
        ...(filterResult?.rowTint && !showSelectionChrome ? { background: filterResult.rowTint } : filterColor && !showSelectionChrome ? { background: `${filterColor}1A` } : {}),
        ...(!showSelectionChrome && colorFilterResult?.inlineStyle ? colorFilterResult.inlineStyle : {}),
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
      }}
      onClick={(e) => {
        if (suppressRowClickRef.current) {
          suppressRowClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (consumeMarqueeDragOccurred()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if ((mouseRt.fullRowSelect || !!config.fullNameColumnSelect) && computedViewMode === 'details') {
          const t = e.target as HTMLElement;
          const inName = !!t.closest('.bndz-list-columns > div:first-child, .bndz-clipboard-icon-slot, [data-col-id="name"]');
          if (!inName) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        if (mouseRt.pointToSelect && (mouseRt.onTheIconOnly || !!config.toTheIconOnly)) {
          const t = e.target as HTMLElement;
          if (!t.closest('.bndz-clipboard-icon-slot, img, canvas')) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        markPointerDown();
        handleEntityClicked(e, entity.id);
      }}
      onDoubleClick={() => {
        if (listClickDeferTimerRef.current) {
          clearTimeout(listClickDeferTimerRef.current);
          listClickDeferTimerRef.current = null;
        }
        clearDragSession();
        handleEntityDoubleClicked(entity);
      }}
      onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); handleEntityMiddleClick(e, entity); }}
      onMouseEnter={(e) => {
        tipHandlers.onMouseEnter?.(e);
        if (isDir) schedulePrefetchPath(buildEntityPath(entity));
        if (listGestureRef.current || isMarqueeActive()) return;
        if ((mouseRt.hoverSelect || mouseRt.pointToSelect || !!config.selectListItemsOnMouseHover) && !inlineRename) {
          setFocusedItemId(entity.id);
          setSelectedItems([entity.id], pane.id);
          scheduleSelectionChrome([entity.id], true);
          scheduleQuickActionsBar(true, true);
        }
      }}
      onMouseMove={tipHandlers.onMouseMove}
      onMouseUp={(e) => {
        if (!isDir || !config.folderContentsPreview || !config.inList) return;
        const leftOk = e.button === 0 && !!config.onLeftMouseUp;
        const rightOk = e.button === 2 && !!config.onRightMouseUp;
        if (!leftOk && !rightOk) return;
        const hitIcon = !!(e.target as HTMLElement).closest('.bndz-clipboard-icon-slot, img, canvas');
        if (!hitIcon) return;
        if (listGestureRef.current?.moved) return;
        e.preventDefault();
        e.stopPropagation();
        void openFolderContentsPeek(buildEntityPath(entity), String(entity.name || displayName), e.clientX, e.clientY);
      }}
      onMouseLeave={tipHandlers.onMouseLeave}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenuBlockRef.current = true;
        suppressNavClickUntilRef.current = Date.now() + 800;
        if ((e.ctrlKey || e.metaKey) && !!config.holdCtrlToInvertTheAboveSelection && contents?.length) {
          const allIds = contents.map((c: { id: string }) => c.id);
          const selected = new Set(currentTab.selectedItems);
          const inverted = allIds.filter((id: string) => !selected.has(id));
          setSelectedItems(inverted, pane.id);
          scheduleSelectionChrome(inverted, true);
        }
        const isPart = currentTab.selectedItems.includes(entity.id);
        if (!isPart) {
          selectEntityForContextMenu(entity.id);
        } else {
          setActivePaneId(pane.id);
        }
        let selectedIds = isPart ? currentTab.selectedItems : [entity.id];
        let contextPaths = selectedIds.map(sid => {
          const se = contents?.find(c => c.id === sid);
          if (!se) return toWindowsPath(sid);
          return joinPanePath(panePath, se);
        }).filter(Boolean) as string[];
        if (!contextPaths.length) {
          contextPaths = [joinPanePath(panePath, entity)];
        }
        if (config.holdCtrlToShowCellContextMenu && computedViewMode === 'details' && !(e.ctrlKey || e.metaKey)) {
          const t = e.target as HTMLElement;
          const inName = !!t.closest('[data-col-id="name"], .bndz-list-name, .bndz-clipboard-icon-slot');
          if (!inName) {
            const cell = t.closest('.bndz-list-select-cell');
            const text = cell?.textContent?.trim();
            if (text) {
              void import('../../lib/clipboardSafe').then(({ writeClipboardText }) =>
                writeClipboardText(text).then(ok => {
                  setToastMessage(ok
                    ? 'Copied cell. Hold Ctrl+right-click for the full context menu.'
                    : 'Hold Ctrl+right-click for the full context menu.');
                }),
              );
            } else {
              setToastMessage('Hold Ctrl+right-click for the full context menu.');
            }
            return;
          }
        }
        const entityIsDir = entity.type === 'directory';
        void handleContextMenuRequest(
          e,
          panePath,
          entity.id,
          entityIsDir,
          entity.name,
          contextPaths,
          'list-item',
          entity.extension || null,
        );
      }}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
      }}
    >
      {isDrive && drive && computedViewMode !== 'details' ? (
        computedViewMode === 'grid' ? (
          <DriveCard
            drive={{
              ...drive,
              path: entity.path || drive.name,
              skipFreeSpace: !!config.skipCalculationOfFreeDiskSpaceForMappedNetworkDriv
                && (/network/i.test(String(drive.type || drive.format || ''))
                  || String(entity.path || drive.name || '').startsWith('//')
                  || String(entity.path || drive.name || '').startsWith('\\\\')),
            }}
            layout="grid"
            selected={showSelectionChrome}
            iconSize={isThisPc ? thisPcGridMetrics.icon : gridMetrics.icon}
          />
        ) : (
          <DriveCard
            drive={{
              ...drive,
              path: entity.path || drive.name,
              skipFreeSpace: !!config.skipCalculationOfFreeDiskSpaceForMappedNetworkDriv
                && (/network/i.test(String(drive.type || drive.format || ''))
                  || String(entity.path || drive.name || '').startsWith('//')
                  || String(entity.path || drive.name || '').startsWith('\\\\')),
            }}
            layout="list"
            selected={showSelectionChrome}
            iconSize={isThisPc ? thisPcListMetrics.icon : listMetrics.icon}
          />
        )
      ) : (
        <>
          {computedViewMode === 'grid' ? (
            <>
              <div
                className="bndz-list-select-cell bndz-grid-tile-inner flex flex-col items-center w-full h-full min-w-0 relative overflow-hidden"
                style={gridMetrics.cardChrome ? {
                  paddingLeft: gridMetrics.cardPadX,
                  paddingRight: gridMetrics.cardPadX,
                  paddingTop: gridMetrics.cardPadTop,
                  paddingBottom: gridMetrics.cardPadBottom,
                  gap: 4,
                } : undefined}
              >
                <div
                  className={`bndz-grid-icon-well flex items-center justify-center relative shrink-0 ${iconDimClass}`}
                  style={{
                    width: '100%',
                    height: gridMetrics.iconSlot,
                    minHeight: gridMetrics.iconSlot,
                    padding: gridMetrics.thumbMargin ?? 12,
                    boxSizing: 'border-box',
                  }}
                >
                  <div className="bndz-clipboard-icon-slot bndz-grid-icon-stage relative flex items-center justify-center w-full h-full min-h-0">
                    {isDir && colorFilterResult?.folderIcon ? (
                      <FolderColorIcon folderIconId={colorFilterResult.folderIcon} size={Math.max(16, gridMetrics.iconSlot - 2 * (gridMetrics.thumbMargin ?? 12))} title={entity.name} />
                    ) : (
                      <ThumbnailIcon entity={entity} isDir={isDir} path={joinPanePath(panePath, entity)} size={Math.max(16, gridMetrics.iconSlot - 2 * (gridMetrics.thumbMargin ?? 12))} />
                    )}
                    {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
                    {filterResult?.badgeColor && (
                      <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full ring-1 ring-black/70 shadow-sm" style={{ backgroundColor: filterResult.badgeColor }} title={filterResult.name} />
                    )}
                    {healthBadge && (
                      <div
                        className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full ring-1 ring-black/80 shadow-sm"
                        style={{ backgroundColor: HEALTH_BADGE_COLORS[healthBadge.severity] }}
                        title={healthBadge.title}
                      />
                    )}
                  </div>
                </div>
                <div
                  className={`bndz-grid-caption text-center w-full min-w-0 shrink-0 ${
                    gridDenseHideCaption || gridCaptionLines === 0 ? 'hidden' :
                    gridCaptionLines === 1 ? 'bndz-grid-caption--clamp-1' :
                    gridCaptionLines === 3 ? 'bndz-grid-caption--clamp-3' :
                    gridCaptionLines >= 4 ? 'bndz-grid-caption--clamp-4' :
                    'bndz-grid-caption--clamp-2'
                  }`}
                  style={{
                    height: gridDenseHideCaption || gridCaptionLines === 0 ? 0 : gridMetrics.labelBlock,
                    minHeight: gridDenseHideCaption || gridCaptionLines === 0 ? 0 : gridMetrics.labelBlock,
                    maxHeight: gridDenseHideCaption || gridCaptionLines === 0 ? 0 : gridMetrics.labelBlock,
                    ...(filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {}),
                  }}
                  title={suppressNativeTitle ? undefined : entity.name}
                >
                  {displayLabel}
                  {!!config.showPhotoDataInTheLargeTilesView && !isDir && gridMetrics.iconSlot >= 140 && (
                    <div className="bndz-grid-caption-meta truncate">
                      {typeof entity.size === 'number' ? formatSize(entity.size) : ''}
                      {(entity as any).width && (entity as any).height
                        ? ` · ${(entity as any).width}×${(entity as any).height}`
                        : ''}
                    </div>
                  )}
                </div>
                <div
                  className="bndz-list-marquee-pad w-full shrink-0"
                  style={{ height: gridMetrics.marqueePad || 0, minHeight: gridMetrics.marqueePad || 0, flex: 'none' }}
                  aria-hidden
                />
              </div>
            </>
          ) : computedViewMode === 'list' ? (
            <>
              <div className="bndz-list-tile-row flex items-center min-w-0 flex-1">
                <div className="bndz-list-marquee-lead shrink-0" aria-hidden />
                <div className="bndz-list-select-cell bndz-list-tile-inner flex items-center min-w-0 shrink max-w-full">
                  <div
                    className={`bndz-list-icon-well bndz-clipboard-icon-slot flex items-center justify-center shrink-0 ${iconDimClass}`}
                    style={{ width: listMetrics.iconSlot, height: listMetrics.iconSlot }}
                  >
                    {isDir && colorFilterResult?.folderIcon ? (
                      <FolderColorIcon folderIconId={colorFilterResult.folderIcon} size={listMetrics.icon} title={entity.name} />
                    ) : (
                      <ThumbnailIcon
                        entity={entity}
                        isDir={isDir}
                        path={joinPanePath(panePath, entity)}
                        size={listMetrics.icon}
                        forceShellOnly={config.showThumbnailsInTitlesViews === false}
                      />
                    )}
                    {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
                  </div>
                  <div
                    className="bndz-list-caption min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis shadow-none focus:outline-none"
                    style={filterResult?.textColor ? { color: filterResult.textColor } : filterColor ? { color: filterColor } : {}}
                  >
                    {displayLabel}
                  </div>
                </div>
                <div className="bndz-list-marquee-trail" aria-hidden />
              </div>
              {cloudBadge && (
                <span className={`text-[10px] mr-1 shrink-0 ${cloudBadge.tone === 'amber' ? 'text-amber-400' : cloudBadge.tone === 'emerald' ? 'text-emerald-400' : 'text-[#7eb8e8]'}`} title={cloudBadge.title}>{cloudBadge.label}</span>
              )}
              {(entity as any).isGhostLink && (
                <span className="bndz-ghostlink-emblem inline-flex items-center mr-1 shrink-0" title={(entity as any).linkTarget || 'Ghost link'}>
                  <EmblemIcon id="emblem-symbolic-link" size={12} />
                </span>
              )}
              {jobTicketOverdue && (
                <JobTicketOverdueBadge count={jobTicketOverdue.count} title={jobTicketOverdue.title} />
              )}
              {healthBadge && (
                <div
                  className="w-2 h-2 rounded-full mr-2 shrink-0 ring-1 ring-black/50"
                  style={{ backgroundColor: HEALTH_BADGE_COLORS[healthBadge.severity] }}
                  title={healthBadge.title}
                />
              )}
              {filterResult?.badgeColor && (
                <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: filterResult.badgeColor }} title={filterResult.name} />
              )}
            </>
          ) : (
            <>
              <div className="bndz-list-marquee-lead shrink-0" aria-hidden />
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
                      if (mouseRt.stickyCheckboxSelection) {
                        selectionAnchorRef.current = { paneId: pane.id, itemId: entity.id };
                      }
                    }}
                    className="accent-[#0078d4] cursor-pointer"
                  />
                </div>
              )}
              <div className={`${detailsIconColClass} bndz-list-select-cell bndz-clipboard-icon-slot flex justify-center shrink-0 ${iconDimClass}`}>
                {isDir && colorFilterResult?.folderIcon ? (
                  <FolderColorIcon folderIconId={colorFilterResult.folderIcon} size={detailsIconSize} title={entity.name} />
                ) : (
                  <ThumbnailIcon entity={entity} isDir={isDir} path={joinPanePath(panePath, entity)} size={detailsIconSize} />
                )}
                {clipboardMark && <ClipboardMarkBadge mode={clipboardMark} compact />}
              </div>
              <div className="flex-1 flex items-center min-w-0 bndz-list-columns">
                {visibleListColumns.map((col, colIdx) => (
                  <React.Fragment key={col.id}>
                    {colIdx > 0 && (
                      <div className="bndz-list-col-gutter shrink-0 self-stretch min-h-[20px]" aria-hidden />
                    )}
                    <div className={col.widthClass || 'shrink-0'} data-col-id={col.id} style={getColumnStyle(col)}>
                      {renderDetailColumn(col.id, entity, {
                        isDir, displayName: displayLabel, renameInput, filterResult, filterColor, entityTags, panePath,
                        healthBadge,
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
}

export default React.memo(FileListRow, arePropsEqual);
