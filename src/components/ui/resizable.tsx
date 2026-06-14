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
import React from 'react';

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
    const resolvedClassName = className && className !== 'undefined'
        ? `${className} h-full w-full`
        : 'h-full w-full';

    return (
        <Group
            groupRef={groupRef}
            orientation={resolvedOrientation}
            className={resolvedClassName}
            onLayoutChanged={onLayoutChanged ?? onLayout}
            {...props}
        >
            {children}
        </Group>
    );
};

interface ResizablePanelProps extends React.ComponentProps<typeof Panel> {}

export const ResizablePanel = ({ children, className, ...props }: ResizablePanelProps) => (
    <Panel className={className} {...props}>
        {children}
    </Panel>
);

interface ResizableHandleProps extends React.ComponentProps<typeof Separator> {
    direction?: Orientation;
    withHandle?: boolean;
}

export const ResizableHandle = ({
    className,
    direction,
    withHandle = false,
    disabled,
    ...props
}: ResizableHandleProps) => {
    const isVertical = direction === 'vertical' || className?.includes('cursor-row-resize');
    const defaultClassName = isVertical
        ? 'h-1 bg-[#282830] transition-colors hover:bg-[#3b82f6] flex items-center justify-center cursor-row-resize z-50 data-[disabled]:opacity-0 data-[disabled]:pointer-events-none'
        : 'w-1 bg-[#282830] transition-colors hover:bg-[#3b82f6] flex items-center justify-center cursor-col-resize z-50 data-[disabled]:opacity-0 data-[disabled]:pointer-events-none';

    return (
        <Separator
            className={className || defaultClassName}
            disabled={disabled}
            {...props}
        >
            {withHandle && (
                <div className="w-0.5 h-6 bg-[#555] rounded-full" />
            )}
        </Separator>
    );
};
