import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, HardDrive, Star, Cloud, FolderTree, GitBranch, GripVertical } from 'lucide-react';

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

function mapSidebarOrder(sidebarOrder?: string[]) {
    const mapped = (sidebarOrder || ['storage', 'quick', 'cloud', 'tree'])
        .map((k: string) => SECTION_KEY_MAP[k] || k)
        .filter((k: string) => DEFAULT_SECTION_ORDER.includes(k));
    return mapped.length ? mapped : DEFAULT_SECTION_ORDER.filter(k => k !== 'miniTree');
}

export function LeftSidebar({
    onBackgroundClick,
    drivesContent,
    quickAccessContent,
    cloudProvidersContent,
    miniTreeContent,
    treeContent,
    sidebarOrder,
    onSectionOrderChange,
}: any) {
    const [expandedSections, setExpandedSections] = useState({
        quickAccess: true,
        cloud: true,
        drives: true,
        miniTree: true,
        tree: true,
    });

    const mappedOrder = useMemo(() => mapSidebarOrder(sidebarOrder), [sidebarOrder]);
    const [order, setOrder] = useState(mappedOrder);
    const [draggedItem, setDraggedItem] = useState<string | null>(null);

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
        setTimeout(() => {
            const dragEl = document.getElementById(`section-${id}`);
            if (dragEl) dragEl.classList.add('opacity-50');
        }, 0);
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedItem || draggedItem === id) return;
        
        setOrder(prev => {
            const newOrder = [...prev];
            const draggedIdx = newOrder.indexOf(draggedItem);
            const targetIdx = newOrder.indexOf(id);
            newOrder.splice(draggedIdx, 1);
            newOrder.splice(targetIdx, 0, draggedItem);
            return newOrder;
        });
    };

    const handleDragEnd = (e: React.DragEvent) => {
        if (draggedItem) {
            const dragEl = document.getElementById(`section-${draggedItem}`);
            if (dragEl) dragEl.classList.remove('opacity-50');
        }
        if (draggedItem && onSectionOrderChange) {
            onSectionOrderChange(order.map(k => REVERSE_SECTION_MAP[k] || k));
        }
        setDraggedItem(null);
    };

    const sections = {
        quickAccess: { content: quickAccessContent, label: "Rapid access", icon: Star, iconColor: "text-emerald-400" },
        cloud: { content: cloudProvidersContent, label: "Cloud Drives", icon: Cloud, iconColor: "text-sky-400" },
        drives: { content: drivesContent, label: "Drives", icon: HardDrive, iconColor: "text-gray-400" },
        miniTree: { content: miniTreeContent, label: "Mini Tree", icon: GitBranch, iconColor: "text-violet-400" },
        tree: { content: treeContent, label: "Navigation Tree", icon: FolderTree, iconColor: "text-emerald-500" },
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
                const Icon = sec.icon;

                return (
                    <div 
                        key={key} 
                        id={`section-${key}`}
                        className={`transition-transform duration-200 ${key === 'tree' ? 'flex-1 flex flex-col min-h-[320px] mb-2' : 'mb-4 shrink-0'}`}
                        onDragOver={e => handleDragOver(e, key)}
                    >
                        <div 
                            className="sidebar-section-header flex items-center justify-between px-4 py-1.5 cursor-pointer text-gray-400 group mx-1 rounded-md shrink-0"
                            onClick={(e) => { e.stopPropagation(); toggleSection(key); }}
                        >
                            <div className="flex items-center gap-1.5">
                                {expandedSections[key as keyof typeof expandedSections] ? <ChevronDown size={12} className="opacity-60 cursor-pointer transition-transform" /> : <ChevronRight size={12} className="opacity-60 cursor-pointer transition-transform" />}
                                <Icon size={12} className={`${sec.iconColor} opacity-70 group-hover:opacity-100 transition-opacity`} />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-[#888] group-hover:text-gray-100 transition-colors">{sec.label}</span>
                            </div>
                            <div
                                draggable
                                onDragStart={e => handleDragStart(e, key)}
                                onDragEnd={handleDragEnd}
                                className="opacity-0 group-hover:opacity-50 hover:opacity-100 cursor-grab active:cursor-grabbing p-1 transition-opacity"
                                title="Drag to reorder module"
                            >
                                <GripVertical size={12} />
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
