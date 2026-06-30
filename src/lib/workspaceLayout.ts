import type { Layout } from 'react-resizable-panels';

export const OUTER_PANEL_IDS = ['sidebar', 'workspace', 'preview'] as const;

export const INNER_PANEL_IDS = ['main', 'bottom'] as const;

export type OuterPanelId = (typeof OUTER_PANEL_IDS)[number];

export type InnerPanelId = (typeof INNER_PANEL_IDS)[number];

/**
 * Bump this number whenever the default layout changes in a way that
 * should invalidate persisted user layouts. The persisted version is
 * compared against this and, if lower, the defaults are re-applied
 * (the persisted layout is discarded, not merged).
 */
export const WORKSPACE_LAYOUT_VERSION = 23;

/**
 * Comfortable defaults — balanced three-pane layout.
 *
 * `react-resizable-panels` `Layout` values are percentages that must
 * sum to 100 for a horizontal/vertical group.
 *
 *   sidebar   = 16%  (tree panel — slim but readable)
 *   workspace = 59%  (main file area — the star of the show)
 *   preview   = 25%  (right preview — genuinely usable width)
 */
export const DEFAULT_OUTER_LAYOUT: Layout = {
    sidebar: 16,
    workspace: 59,
    preview: 25,
};

/** Comfortable defaults — generous main area with a compact bottom plugin row. */
export const DEFAULT_INNER_LAYOUT: Layout = {
    main: 82,
    bottom: 18,
};

/** Minimum sensible sizes (percentages) when persisted values are too small. */
export const MIN_OUTER_LAYOUT: Layout = {
    sidebar: 10,
    workspace: 30,
    preview: 15,
};

export const MIN_INNER_LAYOUT: Layout = {
    main: 50,
    bottom: 5,
};

/**
 * Preview panel size constraints (percentages of the outer group width).
 * Used by the ResizablePanel minSize/maxSize props so users can't
 * collapse the preview to nothing or let it eat the whole workspace.
 */
export const MIN_PREVIEW_SIZE = 15;
export const MAX_PREVIEW_SIZE = 45;

function clampLayout(
    ids: readonly string[],
    layout: Layout,
    mins: Layout,
    defaults: Layout,
): Layout {
    const out: Layout = { ...defaults };

    for (const id of ids) {
        const v = layout[id];
        const min = mins[id] ?? 0;
        const def = defaults[id] ?? 0;

        if (typeof v === 'number' && !Number.isNaN(v)) {
            out[id] = v >= min ? v : Math.max(min, def);
        }
    }

    return out;
}

function isLayoutObject(value: unknown): value is Layout {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function layoutFromArray(
    ids: readonly string[],
    sizes: number[] | undefined,
    defaults: Layout,
): Layout {
    const layout: Layout = { ...defaults };

    ids.forEach((id, index) => {
        const s = sizes?.[index];
        if (typeof s === 'number' && !Number.isNaN(s)) {
            layout[id] = s;
        }
    });

    return layout;
}

/**
 * Rebalance an outer layout so the three panels sum to 100 and each
 * panel sits at a usable size. Used as a safety net after a version
 * bump; the primary migration is to discard the persisted layout
 * entirely (handled in BNDZUI.tsx's upgrade effect).
 */
export function rebalanceOuterLayoutForSlimPreview(layout: Layout): Layout {
    const sidebar = typeof layout.sidebar === 'number' && !Number.isNaN(layout.sidebar)
        ? Math.max(MIN_OUTER_LAYOUT.sidebar, layout.sidebar)
        : DEFAULT_OUTER_LAYOUT.sidebar;

    const preview = typeof layout.preview === 'number' && !Number.isNaN(layout.preview)
        ? Math.min(MAX_PREVIEW_SIZE, Math.max(MIN_PREVIEW_SIZE, layout.preview))
        : DEFAULT_OUTER_LAYOUT.preview;

    const workspace = Math.max(
        MIN_OUTER_LAYOUT.workspace,
        100 - sidebar - preview,
    );

    // If workspace had to be clamped up, shrink the sidebar to make room.
    const overflow = (sidebar + preview + workspace) - 100;
    const adjustedSidebar = overflow > 0
        ? Math.max(MIN_OUTER_LAYOUT.sidebar, sidebar - overflow)
        : sidebar;
    const adjustedWorkspace = Math.max(
        MIN_OUTER_LAYOUT.workspace,
        100 - adjustedSidebar - preview,
    );

    return {
        sidebar: adjustedSidebar,
        workspace: adjustedWorkspace,
        preview,
    };
}

/** Normalize persisted config into a Layout map for the outer workspace group. */
export function getOuterDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        const merged = layoutFromArray(
            OUTER_PANEL_IDS,
            OUTER_PANEL_IDS.map((id) => raw[id]),
            DEFAULT_OUTER_LAYOUT,
        );
        return clampLayout(OUTER_PANEL_IDS, merged, MIN_OUTER_LAYOUT, DEFAULT_OUTER_LAYOUT);
    }

    if (Array.isArray(raw)) {
        // Legacy 2-panel layout (preview was conditionally unmounted).
        if (raw.length === 2) {
            return { sidebar: raw[0], workspace: raw[1], preview: 0 };
        }
        return layoutFromArray(OUTER_PANEL_IDS, raw, DEFAULT_OUTER_LAYOUT);
    }

    return { ...DEFAULT_OUTER_LAYOUT };
}

/** Normalize persisted config into a Layout map for the inner workspace group. */
export function getInnerDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        const merged = layoutFromArray(
            INNER_PANEL_IDS,
            INNER_PANEL_IDS.map((id) => raw[id]),
            DEFAULT_INNER_LAYOUT,
        );
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