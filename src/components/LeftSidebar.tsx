import React, { useState, useEffect, useMemo } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { dropSideFromPointer, computeReorderInsertIndex, reorderArrayMove } from '../lib/reorderOnDrop';

const SECTION_KEY_MAP: Record<string, string> = {
    storage: 'drives',
    quick: 'quickAccess',
    cloud: 'cloud',
    ram: 'ramStaging',
    miniTree: 'miniTree',
    tree: 'tree',
};

const REVERSE_SECTION_MAP: Record<string, string> = {
    quickAccess: 'quick',
    cloud: 'cloud',
    ramStaging: 'ram',
    drives: 'storage',
    miniTree: 'miniTree',
    tree: 'tree',
};

const DEFAULT_SECTION_ORDER = ['drives', 'quickAccess', 'cloud', 'ramStaging', 'tree', 'miniTree'];

function mapSidebarOrder(sidebarOrder?: string[], includeMiniTree?: boolean) {
    const mapped = (sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])
        .map((k: string) => SECTION_KEY_MAP[k] || k)
        .filter((k: string) => DEFAULT_SECTION_ORDER.includes(k));
    let order = mapped.length ? mapped : DEFAULT_SECTION_ORDER.filter(k => k !== 'miniTree');
    if (!order.includes('tree')) order = [...order, 'tree'];
    if (includeMiniTree && !order.includes('miniTree')) {
        const treeIdx = order.indexOf('tree');
        order = treeIdx >= 0
            ? [...order.slice(0, treeIdx + 1), 'miniTree', ...order.slice(treeIdx + 1)]
            : [...order, 'miniTree'];
    }
    if (!includeMiniTree) order = order.filter(k => k !== 'miniTree');
    return order;
}

export function LeftSidebar({
    onBackgroundClick,
    drivesContent,
    quickAccessContent,
    cloudProvidersContent,
    miniTreeContent,
    ramStagingContent,
    treeContent,
    sidebarOrder,
    showMiniTree,
    onSectionOrderChange,
}: any) {
    const [expandedSections, setExpandedSections] = useState({
        quickAccess: true,
        cloud: true,
        drives: true,
        miniTree: true,
        ramStaging: true,
        tree: true,
    });

    const mappedOrder = useMemo(
        () => mapSidebarOrder(sidebarOrder, showMiniTree === true || !!miniTreeContent),
        [sidebarOrder, showMiniTree, miniTreeContent],
    );
    const [order, setOrder] = useState(mappedOrder);
    const [draggedItem, setDraggedItem] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [dropSide, setDropSide] = useState<'before' | 'after'>('before');

    useEffect(() => {
        setOrder(mappedOrder);
    }, [mappedOrder]);

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({ ...prev, [section]: !(prev as any)[section] }));
    };

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.stopPropagation();
        setDraggedItem(id);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `sidebar-section:${id}`);
        if (e.dataTransfer.setDragImage) {
            const ghost = document.createElement('div');
            ghost.className = 'fixed pointer-events-none opacity-0';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 0, 0);
            requestAnimationFrame(() => ghost.remove());
        }
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedItem || draggedItem === id) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const side = dropSideFromPointer(e.clientX, e.clientY, rect, 'y');
        setDragOverId(id);
        setDropSide(side);
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedItem || draggedItem === id) {
            setDraggedItem(null);
            setDragOverId(null);
            return;
        }
        const from = order.indexOf(draggedItem);
        const to = order.indexOf(id);
        if (from < 0 || to < 0) return;
        const insertAt = computeReorderInsertIndex(from, to, dropSide);
        const next = reorderArrayMove(order, from, insertAt);
        setOrder(next);
        onSectionOrderChange?.(next.map((k: string) => REVERSE_SECTION_MAP[k] || k));
        setDraggedItem(null);
        setDragOverId(null);
    };

    const handleDragEnd = () => {
        setDraggedItem(null);
        setDragOverId(null);
    };

    const sections = {
        quickAccess: { content: quickAccessContent, label: 'Rapid access', icon: 'zap_ui', iconColor: 'text-emerald-400' },
        cloud: { content: cloudProvidersContent, label: 'Cloud Drives', icon: 'cloud_drive', iconColor: 'text-[#7eb8e8]' },
        ramStaging: { content: ramStagingContent, label: 'RAM Staging', icon: 'hard_drive_ui', iconColor: 'text-violet-400' },
        drives: { content: drivesContent, label: 'Drives', icon: 'disk_mgmt', iconColor: 'text-gray-400' },
        miniTree: { content: miniTreeContent, label: 'Mini Tree', icon: 'mini_tree', iconColor: 'text-violet-400' },
        tree: { content: treeContent, label: 'Navigation Tree', icon: 'shell_menus', iconColor: 'text-emerald-500' },
    };

    return (
        <div
            className="w-full h-full min-h-0 flex flex-col py-2 select-none z-10 bg-inherit text-inherit overflow-y-auto overflow-x-hidden styled-scrollbar"
            onClick={onBackgroundClick}
            onContextMenu={e => e.preventDefault()}
        >
            {order.map((key, idx) => {
                const sec = (sections as any)[key];
                if (!sec || !sec.content) return null;

                const prevKey = order.slice(0, idx).reverse().find(k => {
                    const s = (sections as any)[k];
                    return s?.content;
                });
                const nextKey = order.slice(idx + 1).find(k => {
                    const s = (sections as any)[k];
                    return s?.content;
                });
                const gapBeforeTreePair =
                    (key === 'miniTree' && prevKey === 'tree')
                    || (key === 'tree' && prevKey === 'miniTree');
                const gapAfterTreePair =
                    (key === 'miniTree' && nextKey === 'tree')
                    || (key === 'tree' && nextKey === 'miniTree');

                // Natural height modules — the LEFT SIDEBAR scrolls as one panel.
                // Mini Tree / Navigation Tree get extra margin when adjacent.
                const sectionSpacing = key === 'miniTree' || key === 'tree'
                    ? `shrink-0 ${gapAfterTreePair ? 'mb-4' : 'mb-3'} ${gapBeforeTreePair ? 'mt-3' : ''}`
                    : 'shrink-0 mb-3';

                const isExpanded = expandedSections[key as keyof typeof expandedSections];

                return (
                    <div
                        key={key}
                        id={`section-${key}`}
                        className={`transition-opacity duration-150 ease-out ${draggedItem === key ? 'opacity-40' : ''} ${dragOverId === key && draggedItem !== key ? (dropSide === 'before' ? 'bndz-sidebar-drop-before' : 'bndz-sidebar-drop-after') : ''} ${sectionSpacing}`}
                        onDragOver={e => handleDragOver(e, key)}
                        onDrop={e => handleDrop(e, key)}
                    >
                        <div
                            data-section={key}
                            className={`sidebar-section-header bndz-sidebar-section-header bndz-sidebar-section-${key} flex items-center justify-between pl-4 pr-3 py-1.5 cursor-pointer text-gray-400 group mx-1`}
                            onClick={(e) => { e.stopPropagation(); toggleSection(key); }}
                        >
                            <div className="flex items-center gap-1.5">
                                <Icons8Icon
                                    id={isExpanded ? 'chevron_down' : 'chevron_right'}
                                    size={10}
                                    className="opacity-60 cursor-pointer transition-transform"
                                />
                                <Icons8Icon id={sec.icon} size={12} className="opacity-70 group-hover:opacity-100 transition-opacity" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-[#888] group-hover:text-gray-100 transition-colors">{sec.label}</span>
                            </div>
                            <div
                                draggable
                                onDragStart={e => handleDragStart(e, key)}
                                onDragEnd={handleDragEnd}
                                className="opacity-0 group-hover:opacity-50 hover:opacity-100 cursor-grab active:cursor-grabbing p-1 transition-opacity"
                                title="Drag to reorder module"
                            >
                                <DragHandleGlyph size={12} />
                            </div>
                        </div>
                        {isExpanded && (
                            <div className="mt-1">
                                {sec.content}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
