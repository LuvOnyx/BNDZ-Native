import React, { useState, useEffect, useMemo } from 'react';
import { Icons8Icon, DragHandleGlyph } from './Icons8Icon';

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

const DEFAULT_SECTION_ORDER = ['drives', 'quickAccess', 'cloud', 'miniTree', 'tree'];

function mapSidebarOrder(sidebarOrder?: string[], includeMiniTree?: boolean) {
    const mapped = (sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])
        .map((k: string) => SECTION_KEY_MAP[k] || k)
        .filter((k: string) => DEFAULT_SECTION_ORDER.includes(k));
    let order = mapped.length ? mapped : DEFAULT_SECTION_ORDER.filter(k => k !== 'miniTree');
    if (includeMiniTree && !order.includes('miniTree')) {
        const treeIdx = order.indexOf('tree');
        order = treeIdx >= 0
            ? [...order.slice(0, treeIdx), 'miniTree', ...order.slice(treeIdx)]
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
    setDragOverId(id);
    setOrder(prev => {
      const newOrder = [...prev];
      const draggedIdx = newOrder.indexOf(draggedItem);
      const targetIdx = newOrder.indexOf(id);
      if (draggedIdx < 0 || targetIdx < 0 || draggedIdx === targetIdx) return prev;
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedItem);
      return newOrder;
    });
  };

  const handleDragEnd = () => {
    if (draggedItem && onSectionOrderChange) {
      onSectionOrderChange(dragOrderRef.current.map(k => REVERSE_SECTION_MAP[k] || k));
    }
    setDraggedItem(null);
    setDragOverId(null);
  };

    const sections = {
        quickAccess: { content: quickAccessContent, label: "Rapid access", icon: 'star_ui', iconColor: "text-emerald-400" },
        cloud: { content: cloudProvidersContent, label: "Cloud Drives", icon: 'go_network', iconColor: "text-sky-400" },
        drives: { content: drivesContent, label: "Drives", icon: 'disk_mgmt', iconColor: "text-gray-400" },
        miniTree: { content: miniTreeContent, label: "Mini Tree", icon: 'dropstack', iconColor: "text-violet-400" },
        tree: { content: treeContent, label: "Navigation Tree", icon: 'shell_menus', iconColor: "text-emerald-500" },
    };

    return (
        <div 
            className="w-full h-full flex flex-col py-2 select-none z-10 bg-inherit text-inherit min-h-0"
            onClick={onBackgroundClick}
            onContextMenu={e => e.preventDefault()}
        >
            {order.map(key => {
                const sec = (sections as any)[key];
                if (!sec.content) return null;

                return (
                    <div 
                        key={key} 
                        id={`section-${key}`}
                        className={`transition-[transform,opacity] duration-150 ease-out ${draggedItem === key ? 'opacity-40 scale-[0.98]' : ''} ${dragOverId === key && draggedItem !== key ? 'ring-1 ring-sky-500/30' : ''} ${key === 'tree' ? 'flex-[3] flex flex-col min-h-[min(560px,52vh)] mb-1' : key === 'miniTree' ? 'mb-2 shrink-0 max-h-[160px] overflow-hidden flex flex-col' : 'mb-3 shrink-0'}`}
                        onDragOver={e => handleDragOver(e, key)}
                    >
                        <div 
                            className="sidebar-section-header flex items-center justify-between px-4 py-1.5 cursor-pointer text-gray-400 group mx-1 rounded-md shrink-0"
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
