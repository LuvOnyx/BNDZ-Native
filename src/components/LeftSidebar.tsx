import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';
import { dropSideFromPointer, computeReorderInsertIndex, reorderArrayMove } from '../lib/reorderOnDrop';

const SECTION_KEY_MAP: Record<string, string> = {
    storage: 'drives',
    quick: 'quickAccess',
    cloud: 'cloud',
    miniTree: 'miniTree',
    tree: 'tree',
};

const REVERSE_SECTION_MAP: Record<string, string> = {
    quickAccess: 'quick',
    cloud: 'cloud',
    drives: 'storage',
    miniTree: 'miniTree',
    tree: 'tree',
};

const DEFAULT_SECTION_ORDER = ['drives', 'quickAccess', 'cloud', 'tree', 'miniTree'];

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

    const handleGripPointerDown = useCallback((e: React.PointerEvent, id: string) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const gripEl = e.currentTarget as HTMLElement;
        const captureId = e.pointerId;
        try { gripEl.setPointerCapture(captureId); } catch { /* ignore */ }
        setDraggedItem(id);

        const resolveTarget = (clientX: number, clientY: number) => {
            const hit = document.elementsFromPoint(clientX, clientY)
                .map(el => (el as HTMLElement).closest('[data-section-id]'))
                .find(Boolean) as HTMLElement | null;
            const targetId = hit?.getAttribute('data-section-id');
            if (!targetId || targetId === id) return;
            const rect = hit!.getBoundingClientRect();
            setDragOverId(targetId);
            setDropSide(dropSideFromPointer(clientX, clientY, rect, 'y'));
        };

        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== captureId) return;
            resolveTarget(ev.clientX, ev.clientY);
        };

        const finish = (ev: PointerEvent) => {
            if (ev.pointerId !== captureId) return;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            try { gripEl.releasePointerCapture(captureId); } catch { /* ignore */ }

            const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
                .map(el => (el as HTMLElement).closest('[data-section-id]'))
                .find(Boolean) as HTMLElement | null;
            const targetId = hit?.getAttribute('data-section-id');
            if (targetId && targetId !== id) {
                const from = order.indexOf(id);
                const to = order.indexOf(targetId);
                if (from >= 0 && to >= 0) {
                    const rect = hit!.getBoundingClientRect();
                    const side = dropSideFromPointer(ev.clientX, ev.clientY, rect, 'y');
                    const insertAt = computeReorderInsertIndex(from, to, side);
                    const next = reorderArrayMove(order, from, insertAt);
                    setOrder(next);
                    onSectionOrderChange?.(next.map((k: string) => REVERSE_SECTION_MAP[k] || k));
                }
            }
            setDraggedItem(null);
            setDragOverId(null);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
    }, [order, onSectionOrderChange]);

    const sections = {
        quickAccess: { content: quickAccessContent, label: 'Rapid access', icon: 'zap_ui', iconColor: 'text-emerald-400' },
        cloud: { content: cloudProvidersContent, label: 'Cloud Drives', icon: 'cloud_drive', iconColor: 'text-[#7eb8e8]' },
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
                        data-section-id={key}
                        className={`transition-opacity duration-150 ease-out ${draggedItem === key ? 'opacity-40' : ''} ${dragOverId === key && draggedItem !== key ? (dropSide === 'before' ? 'bndz-sidebar-drop-before' : 'bndz-sidebar-drop-after') : ''} ${sectionSpacing}`}
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
                                <span className="bndz-sidebar-section-title text-[10px] font-bold uppercase tracking-widest transition-colors">{sec.label}</span>
                            </div>
                            <div
                                className="opacity-0 group-hover:opacity-50 hover:opacity-100 cursor-grab active:cursor-grabbing p-1 transition-opacity touch-none"
                                title="Drag to reorder module"
                                onPointerDown={e => handleGripPointerDown(e, key)}
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
