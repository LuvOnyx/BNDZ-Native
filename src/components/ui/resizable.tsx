import {
    Panel,
    Group,
    Separator,
    type Layout,
    type GroupImperativeHandle,
    type PanelImperativeHandle,
    useGroupRef,
    usePanelRef,
} from 'react-resizable-panels';
import React, { useCallback } from 'react';
import {
    beginPanelResizeGuard,
    clearChromeDragCursor,
    endPanelResizeGuard,
} from '../../lib/workspace/workspaceCursorGuard';

export type { Layout, GroupImperativeHandle, PanelImperativeHandle };
export { useGroupRef, usePanelRef };

type Orientation = 'horizontal' | 'vertical';

interface ResizablePanelGroupProps extends Omit<React.ComponentProps<typeof Group>, 'orientation' | 'onLayoutChanged'> {
    /** @deprecated Use orientation. Kept for backward compatibility. */
    direction?: Orientation;
    orientation?: Orientation;
    onLayout?: (layout: Layout) => void;
    onLayoutChanged?: (layout: Layout) => void;
}

export const ResizablePanelGroup = ({
    children,
    direction,
    orientation,
    className,
    onLayout,
    onLayoutChanged,
    groupRef,
    ...props
}: ResizablePanelGroupProps & { groupRef?: React.Ref<GroupImperativeHandle> }) => {
    const resolvedOrientation = orientation ?? direction ?? 'horizontal';
    // min-h-0 + overflow-hidden keep nested scroll regions independent
    // (list vs bottom panel) instead of growing the group past the viewport.
    const resolvedClassName = className && className !== 'undefined'
        ? `${className} h-full w-full min-h-0 min-w-0 overflow-hidden`
        : 'h-full w-full min-h-0 min-w-0 overflow-hidden';

    return (
        <Group
            groupRef={groupRef}
            orientation={resolvedOrientation}
            className={resolvedClassName}
            onLayoutChange={onLayout}
            onLayoutChanged={onLayoutChanged}
            {...props}
        >
            {children}
        </Group>
    );
};

interface ResizablePanelProps extends React.ComponentProps<typeof Panel> {}

/**
 * react-resizable-panels v4 defaults each panel's inner wrapper to
 * `overflow: auto`. That makes the workspace panel scroll the list +
 * bottom plugin as one unit. Override to hidden so only nested regions
 * (file list, plugin body) scroll.
 */
export const ResizablePanel = ({ children, className, style, ...props }: ResizablePanelProps) => (
    <Panel
        className={
            className
                ? `bndz-resizable-panel min-h-0 min-w-0 ${className}`
                : 'bndz-resizable-panel min-h-0 min-w-0'
        }
        style={{ overflow: 'hidden', ...style }}
        {...props}
    >
        {children}
    </Panel>
);

interface ResizableHandleProps extends React.ComponentProps<typeof Separator> {
    direction?: Orientation;
    withHandle?: boolean;
}

function endResizeCursor(el: EventTarget | null) {
    const node = el as HTMLElement | null;
    if (node) {
        try {
            for (let i = 0; i < 16; i++) {
                if (node.hasPointerCapture?.(i)) node.releasePointerCapture(i);
            }
        } catch { /* ignore */ }
    }
    endPanelResizeGuard();
    clearChromeDragCursor();
}

export const ResizableHandle = ({
    className,
    direction,
    withHandle = false,
    disabled,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    style,
    ...props
}: ResizableHandleProps) => {
    const isVertical = direction === 'vertical' || className?.includes('cursor-row-resize');
    const defaultClassName = isVertical
        ? 'h-1.5 bg-[#282830] transition-colors hover:bg-[#3b82f6] flex items-center justify-center cursor-row-resize z-[80] touch-none data-[disabled]:opacity-0 data-[disabled]:pointer-events-none'
        : 'w-1 bg-[#282830] transition-colors hover:bg-[#3b82f6] flex items-center justify-center cursor-col-resize z-[80] touch-none data-[disabled]:opacity-0 data-[disabled]:pointer-events-none';

    const finish = useCallback((e: React.PointerEvent) => {
        endResizeCursor(e.currentTarget);
    }, []);

    return (
        <Separator
            {...props}
            className={`${className || defaultClassName} bndz-resize-handle`}
            disabled={disabled}
            style={{ touchAction: 'none', ...style }}
            onPointerDown={(e) => {
                // Capture + global guard so the list behind the bottom resize bar
                // cannot scroll, marquee, or steal the drag.
                e.stopPropagation();
                e.preventDefault();
                beginPanelResizeGuard();
                try {
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                } catch { /* ignore */ }
                onPointerDown?.(e);
            }}
            onPointerUp={(e) => {
                e.stopPropagation();
                finish(e);
                onPointerUp?.(e);
            }}
            onPointerCancel={(e) => {
                e.stopPropagation();
                finish(e);
                onPointerCancel?.(e);
            }}
            onLostPointerCapture={(e) => {
                finish(e);
                onLostPointerCapture?.(e);
            }}
        >
            {withHandle && (
                <div className="w-0.5 h-6 bg-[#555] rounded-full" />
            )}
        </Separator>
    );
};
