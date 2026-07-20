import type { Layout } from 'react-resizable-panels';

export const OUTER_PANEL_IDS = ['sidebar', 'workspace', 'preview'] as const;
export const INNER_PANEL_IDS = ['main', 'bottom'] as const;

export type OuterPanelId = (typeof OUTER_PANEL_IDS)[number];
export type InnerPanelId = (typeof INNER_PANEL_IDS)[number];

/**
 * Bump when default layout changes or persisted layouts need repair.
 * Compared to `config.workspaceLayoutVersion` in BNDZUI upgrade effect.
 */
export const WORKSPACE_LAYOUT_VERSION = 29;

/**
 * Balanced three-pane layout (percentages, sum = 100).
 * Preview default ~50% narrower than v27 (12% vs 25%).
 */
export const DEFAULT_OUTER_LAYOUT: Layout = {
    sidebar: 17,
    workspace: 71,
    preview: 12,
};

/** Bottom panel sized so the General tab bar sits gently on the status bar. */
export const DEFAULT_INNER_LAYOUT: Layout = {
    main: 78,
    bottom: 22,
};

export const DUAL_PANE_IDS = ['pane1', 'pane2'] as const;
export type DualPaneId = (typeof DUAL_PANE_IDS)[number];

export const DEFAULT_DUAL_PANE_LAYOUT: Layout = {
    pane1: 50,
    pane2: 50,
};

export const MIN_DUAL_PANE_LAYOUT: Layout = {
    pane1: 20,
    pane2: 20,
};

export const MIN_OUTER_LAYOUT: Layout = {
    sidebar: 12,
    workspace: 35,
    preview: 18,
};

export const MAX_OUTER_LAYOUT: Layout = {
    sidebar: 24,
    workspace: 70,
    preview: 40,
};

export const MIN_INNER_LAYOUT: Layout = {
    main: 50,
    bottom: 5,
};

/** ResizablePanel min/max props (percent of outer group). */
export const MIN_SIDEBAR_SIZE = MIN_OUTER_LAYOUT.sidebar!;
export const MAX_SIDEBAR_SIZE = MAX_OUTER_LAYOUT.sidebar!;
export const MIN_PREVIEW_SIZE = MIN_OUTER_LAYOUT.preview!;
export const MAX_PREVIEW_SIZE = MAX_OUTER_LAYOUT.preview!;

/** Bare numbers on Panel size props are pixels in react-resizable-panels v4 — always use %. */
export function panelPct(n: number): string {
    return `${n}%`;
}

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
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
 * Repair persisted outer layouts — fixes sidebar too wide / preview too thin
 * from earlier migrations. Always returns values that sum to 100.
 */
export function normalizeOuterLayout(raw: unknown): Layout {
    const base = { ...DEFAULT_OUTER_LAYOUT };
    let sidebar = base.sidebar!;
    let preview = base.preview!;
    let workspace = base.workspace!;

    if (isLayoutObject(raw)) {
        if (typeof raw.sidebar === 'number' && !Number.isNaN(raw.sidebar)) sidebar = raw.sidebar;
        if (typeof raw.preview === 'number' && !Number.isNaN(raw.preview)) preview = raw.preview;
        if (typeof raw.workspace === 'number' && !Number.isNaN(raw.workspace)) workspace = raw.workspace;
    } else if (Array.isArray(raw)) {
        const fromArr = layoutFromArray(OUTER_PANEL_IDS, raw, DEFAULT_OUTER_LAYOUT);
        sidebar = fromArr.sidebar ?? sidebar;
        preview = fromArr.preview ?? preview;
        workspace = fromArr.workspace ?? workspace;
    }

    // Hard repair: bad migrations, collapsed sliver sizes, or sidebar hogging space.
    const clearlyBroken =
        sidebar > MAX_SIDEBAR_SIZE + 2
        || preview < MIN_PREVIEW_SIZE
        || (sidebar > 0 && sidebar < 8)
        || (preview > 0 && preview < 12)
        || Math.abs(sidebar + preview + workspace - 100) > 1;

    if (clearlyBroken) {
        sidebar = DEFAULT_OUTER_LAYOUT.sidebar!;
        preview = DEFAULT_OUTER_LAYOUT.preview!;
        workspace = DEFAULT_OUTER_LAYOUT.workspace!;
    } else {
        sidebar = clamp(sidebar, MIN_SIDEBAR_SIZE, MAX_SIDEBAR_SIZE);
        preview = clamp(preview, MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE);
        workspace = 100 - sidebar - preview;
        if (workspace < MIN_OUTER_LAYOUT.workspace!) {
            const deficit = MIN_OUTER_LAYOUT.workspace! - workspace;
            const fromPreview = Math.min(deficit, preview - MIN_PREVIEW_SIZE);
            preview -= fromPreview;
            const fromSidebar = Math.min(deficit - fromPreview, sidebar - MIN_SIDEBAR_SIZE);
            sidebar -= fromSidebar;
            workspace = 100 - sidebar - preview;
        }
    }

    return {
        sidebar: Math.round(sidebar * 10) / 10,
        workspace: Math.round(workspace * 10) / 10,
        preview: Math.round(preview * 10) / 10,
    };
}

/** @deprecated Use normalizeOuterLayout */
export const rebalanceOuterLayoutForSlimPreview = normalizeOuterLayout;

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

/** Normalize persisted config into a Layout map for the outer workspace group. */
export function getOuterDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        return normalizeOuterLayout(raw);
    }
    if (Array.isArray(raw)) {
        if (raw.length === 2) {
            return normalizeOuterLayout({ sidebar: raw[0], workspace: raw[1], preview: 0 });
        }
        return normalizeOuterLayout(layoutFromArray(OUTER_PANEL_IDS, raw, DEFAULT_OUTER_LAYOUT));
    }
    return { ...DEFAULT_OUTER_LAYOUT };
}

/** Live three-pane layout when tree/preview toggles hide panels (0% width). */
export function computeVisibleOuterLayout(
    saved: Layout,
    treeOpen: boolean,
    previewOpen: boolean,
): Layout {
    const base = normalizeOuterLayout(saved);
    let sidebar = treeOpen ? base.sidebar! : 0;
    let preview = previewOpen ? base.preview! : 0;
    let workspace = 100 - sidebar - preview;

    if (workspace < MIN_OUTER_LAYOUT.workspace!) {
        const deficit = MIN_OUTER_LAYOUT.workspace! - workspace;
        const fromPreview = previewOpen
            ? Math.min(deficit, Math.max(0, preview - MIN_PREVIEW_SIZE))
            : 0;
        preview -= fromPreview;
        const fromSidebar = treeOpen
            ? Math.min(deficit - fromPreview, Math.max(0, sidebar - MIN_SIDEBAR_SIZE))
            : 0;
        sidebar -= fromSidebar;
        workspace = 100 - sidebar - preview;
    }

    return {
        sidebar: Math.round(sidebar * 10) / 10,
        workspace: Math.round(workspace * 10) / 10,
        preview: Math.round(preview * 10) / 10,
    };
}

export function normalizeInnerLayout(raw: unknown): Layout {
    const base = getInnerDefaultLayout(raw);
    let main = base.main ?? DEFAULT_INNER_LAYOUT.main!;
    let bottom = base.bottom ?? DEFAULT_INNER_LAYOUT.bottom!;
    const sum = main + bottom;

    if (sum <= 0 || Math.abs(sum - 100) > 1) {
        return { ...DEFAULT_INNER_LAYOUT };
    }

    if (Math.abs(sum - 100) > 0.05) {
        main = (main / sum) * 100;
        bottom = (bottom / sum) * 100;
    }

    main = clamp(main, MIN_INNER_LAYOUT.main!, 95);
    bottom = clamp(bottom, MIN_INNER_LAYOUT.bottom!, 50);
    if (main + bottom > 100) {
        bottom = Math.max(MIN_INNER_LAYOUT.bottom!, 100 - main);
    }

    return {
        main: Math.round(main * 10) / 10,
        bottom: Math.round(bottom * 10) / 10,
    };
}

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

export function getDualPaneDefaultLayout(raw: unknown): Layout {
    if (isLayoutObject(raw)) {
        const p1 = typeof raw.pane1 === 'number' ? raw.pane1 : DEFAULT_DUAL_PANE_LAYOUT.pane1!;
        const p2 = typeof raw.pane2 === 'number' ? raw.pane2 : DEFAULT_DUAL_PANE_LAYOUT.pane2!;
        const sum = p1 + p2;
        if (sum <= 0) return { ...DEFAULT_DUAL_PANE_LAYOUT };
        let a = (p1 / sum) * 100;
        let b = (p2 / sum) * 100;
        a = clamp(a, MIN_DUAL_PANE_LAYOUT.pane1!, 80);
        b = 100 - a;
        if (b < MIN_DUAL_PANE_LAYOUT.pane2!) {
            b = MIN_DUAL_PANE_LAYOUT.pane2!;
            a = 100 - b;
        }
        return { pane1: Math.round(a * 10) / 10, pane2: Math.round(b * 10) / 10 };
    }
    return { ...DEFAULT_DUAL_PANE_LAYOUT };
}
