import React, { useState, useEffect, useMemo } from 'react';
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
    if (includeMiniTree && !order.includes('miniTree')) {
        const treeIdx = order.indexOf('tree');
        // Mini Tree sits below Navigation Tree with breathing room for scrollbars.
        order = treeIdx >= 0
            ? [...order.slice(0, treeIdx + 1), 'miniTree', ...order.slice(treeIdx + 1)]
            : [...order, 'miniTree'];
    }
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
  const dragOrderRef = React.useRef(order);

  useEffect(() => {
    dragOrderRef.current = order;
  }, [order]);

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
  };

  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem || draggedItem === id) {
      setDraggedItem(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = order.indexOf(draggedItem);
    const toIdx = order.indexOf(id);
    if (fromIdx >= 0 && toIdx >= 0) {
      const insertIdx = computeReorderInsertIndex(fromIdx, toIdx, dropSide === 'after');
      const next = reorderArrayMove(order, fromIdx, insertIdx);
      setOrder(next);
      dragOrderRef.current = next;
      onSectionOrderChange?.(next.map(k => REVERSE_SECTION_MAP[k] || k));
    }
    setDraggedItem(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverId(null);
  };

    const sections = {
        quickAccess: { content: quickAccessContent, label: "Rapid access", icon: 'star_ui', iconColor: "text-emerald-400" },
        cloud: { content: cloudProvidersContent, label: "Cloud Drives", icon: 'cloud_ui', iconColor: "text-[#7eb8e8]" },
        drives: { content: drivesContent, label: "Drives", icon: 'disk_mgmt', iconColor: "text-gray-400" },
        miniTree: { content: miniTreeContent, label: "Mini Tree", icon: 'mini_tree', iconColor: "text-violet-400" },
        tree: { content: treeContent, label: "Navigation Tree", icon: 'shell_menus', iconColor: "text-emerald-500" },
    };

    return (
        <div 
            className="w-full h-full flex flex-col py-2 select-none z-10 bg-inherit text-inherit min-h-0"
            onClick={onBackgroundClick}
            onContextMenu={e => e.preventDefault()}
        >
            {order.map((key, idx) => {
                const sec = (sections as any)[key];
                if (!sec.content) return null;
                const prevKey = order.slice(0, idx).reverse().find(k => !!(sections as any)[k]?.content);
                const nextKey = order.slice(idx + 1).find(k => !!(sections as any)[k]?.content);
                const gapBeforeTreePair =
                    (key === 'miniTree' && prevKey === 'tree')
                    || (key === 'tree' && prevKey === 'miniTree');
                const gapAfterTreePair =
                    (key === 'miniTree' && nextKey === 'tree')
                    || (key === 'tree' && nextKey === 'miniTree');

                const sectionSpacing = key === 'tree'
                    ? `flex-[3] flex flex-col min-h-[min(560px,52vh)] ${gapAfterTreePair ? 'mb-4' : 'mb-1'} ${gapBeforeTreePair ? 'mt-3' : ''}`
                    : key === 'miniTree'
                    ? `shrink-0 max-h-[160px] overflow-hidden flex flex-col ${gapAfterTreePair ? 'mb-4' : 'mb-3'} ${gapBeforeTreePair ? 'mt-3' : ''}`
                    : 'mb-3 shrink-0';

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
                            className={`sidebar-section-header bndz-sidebar-section-header bndz-sidebar-section-${key} flex items-center justify-between pl-4 pr-3 py-1.5 cursor-pointer text-gray-400 group mx-1 shrink-0`}
                            onClick={(e) => { e.stopPropagation(); toggleSection(key); }}
                        >
                            <div className="flex items-center gap-1.5">
                                <Icons8Icon
                                  id={expandedSections[key as keyof typeof expandedSections] ? 'chevron_down' : 'chevron_right'}
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
                        {expandedSections[key as keyof typeof expandedSections] && (
                            <div className={`flex flex-col mt-1 min-h-0 ${key === 'tree' ? 'flex-1' : ''}`}>
                                {sec.content}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
