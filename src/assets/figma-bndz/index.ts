/**
 * Staged imports from Figma file BNDZ-ASSETS
 * https://www.figma.com/design/dPUE5dJeIpm5KKwIxJkUN3/BNDZ-ASSETS
 *
 * Not wired into the live FM yet — decide placement later.
 */

import searchAiPanelsUrl from './search-ai-panels.svg';
import imageViewerUrl from './image-viewer.svg';
import transferProgressUrl from './transfer-progress.svg';

export type FigmaBndzAssetId =
  | 'search-ai-panels'
  | 'image-viewer'
  | 'transfer-progress';

export type FigmaBndzAsset = {
  id: FigmaBndzAssetId;
  /** Human label for review / tooling */
  label: string;
  /** Figma node id in BNDZ-ASSETS */
  nodeId: string;
  /** Approximate role once we place these */
  role: string;
  /** Bundled SVG URL (Vite) */
  url: string;
  width: number;
  height: number;
};

export const FIGMA_BNDZ_ASSETS: FigmaBndzAsset[] = [
  {
    id: 'search-ai-panels',
    label: 'Search + AI Assistant panels',
    nodeId: '2:31',
    role: 'Later: richer AI / semantic search UX (omnibar-adjacent). Not scheduled yet.',
    url: searchAiPanelsUrl,
    width: 1820,
    height: 430,
  },
  {
    id: 'image-viewer',
    label: 'Quick image editor',
    nodeId: '2:263',
    role: 'Quick crop / markup / edit. Candidate home: floating image viewer (features TBD).',
    url: imageViewerUrl,
    width: 1077,
    height: 902,
  },
  {
    id: 'transfer-progress',
    label: 'Background transfer progress',
    nodeId: '3:425',
    role: 'Background processing / file transfer queue progress chip.',
    url: transferProgressUrl,
    width: 609,
    height: 46,
  },
];

export const FIGMA_BNDZ_ASSET_BY_ID = Object.fromEntries(
  FIGMA_BNDZ_ASSETS.map((a) => [a.id, a]),
) as Record<FigmaBndzAssetId, FigmaBndzAsset>;

/** Remaining Figma nodes not yet exported (MCP rate limit). Re-run download when ready. */
export const FIGMA_BNDZ_PENDING_NODES = [
  { nodeId: '2:16', note: 'Small 160×44 frame' },
  { nodeId: '2:410', note: 'Card / group 298×348' },
  { nodeId: '4:436', note: 'Small 68×44 frame' },
] as const;
