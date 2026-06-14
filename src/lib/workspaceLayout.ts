import type { Layout } from 'react-resizable-panels';

export const OUTER_PANEL_IDS = ['sidebar', 'workspace', 'preview'] as const;
export const INNER_PANEL_IDS = ['main', 'bottom'] as const;

export type OuterPanelId = (typeof OUTER_PANEL_IDS)[number];
export type InnerPanelId = (typeof INNER_PANEL_IDS)[number];

/** Comfortable defaults — slim preview strip, compact bottom plugin row */
export const WORKSPACE_LAYOUT_VERSION = 12;

export const DEFAULT_OUTER_LAYOUT: Layout = {
    sidebar: 14,
    workspace: 83,
    preview: 3,
};

export const DEFAULT_INNER_LAYOUT: Layout = {
    main: 93,
    bottom: 7,
};

/** Minimum sensible sizes when persisted values are too small */
export const MIN_OUTER_LAYOUT: Layout = {
    sidebar: 12,
    workspace: 30,
    preview: 2,
};

export const MIN_INNER_LAYOUT: Layout = {
    main: 50,
    bottom: 5,
};

function clampLayout(ids: readonly string[], layout: Layout, mins: Layout, defaults: Layout): Layout {
    const out: Layout = { ...defaults };
    for (const id of ids) {
        const v = layout[id];
        const min = mins[id] ?? 0;
        const def = defaults[id] ?? 0;
        if (typeof v === 'number' && !Number.isNaN(v) && v >= min) out[id] = v;
        else if (v != null && v < min) out[id] = Math.max(min, def);
    }
    return out;
}

function isLayoutObject(value: unknown): value is Layout {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function layoutFromArray(ids: readonly string[], sizes: number[] | undefined, defaults: Layout): Layout {
    const layout: Layout = { ...defaults };
    ids.forEach((id, index) => {
        if (typeof sizes?.[index] === 'number' && !Number.isNaN(sizes[index])) {
            layout[id] = sizes[index];
        }
    });
    return layout;
}

/** Normalize persisted config into a v4 Layout map for the outer workspace group. */
export function getOuterDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        const merged = layoutFromArray(OUTER_PANEL_IDS, OUTER_PANEL_IDS.map((id) => raw[id]), DEFAULT_OUTER_LAYOUT);
        return clampLayout(OUTER_PANEL_IDS, merged, MIN_OUTER_LAYOUT, DEFAULT_OUTER_LAYOUT);
    }
    if (Array.isArray(raw)) {
        // Legacy 2-panel layout (preview was conditionally unmounted)
        if (raw.length === 2) {
            return { sidebar: raw[0], workspace: raw[1], preview: 0 };
        }
        return layoutFromArray(OUTER_PANEL_IDS, raw, DEFAULT_OUTER_LAYOUT);
    }
    return { ...DEFAULT_OUTER_LAYOUT };
}

/** Normalize persisted config into a v4 Layout map for the inner workspace group. */
export function getInnerDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        const merged = layoutFromArray(INNER_PANEL_IDS, INNER_PANEL_IDS.map((id) => raw[id]), DEFAULT_INNER_LAYOUT);
        return clampLayout(INNER_PANEL_IDS, merged, MIN_INNER_LAYOUT, DEFAULT_INNER_LAYOUT);
    }
    if (Array.isArray(raw)) {
        if (raw.length === 1) {
            return { main: raw[0], bottom: 0 };
        }
        return layoutFromArray(INNER_PANEL_IDS, raw, DEFAULT_INNER_LAYOUT);
    }
    return { ...DEFAULT_INNER_LAYOUT };
}

export function layoutToArray(ids: readonly string[], layout: Layout): number[] {
    return ids.map((id) => layout[id] ?? 0);
}
