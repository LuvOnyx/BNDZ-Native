/** Shared tab types for BNDZ file manager */

import type { SortColumnId } from '../lib/listColumns';

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  selectedItems: string[];
  viewMode?: 'details' | 'grid' | 'list' | 'columns' | 'size' | 'recents' | 'media';
  /**
   * Frozen left edge for Columns (Miller) view. Selected path may deepen to the right;
   * this stays put so columns cascade L→R instead of collapsing to one column.
   */
  millerRootPath?: string;
  /** When Settings → Remember list settings per tab is on, sort sticks to the tab. */
  sortColumn?: SortColumnId;
  sortDirection?: 'asc' | 'desc';
  locked?: boolean;
  color?: string;
  /** XYplorer-style persistent search tab */
  kind?: 'folder' | 'finding';
  findingQuery?: string;
  findingRoot?: string;
  findingResults?: any[];
  findingLoading?: boolean;
  findingEngine?: 'everything' | 'indexed' | 'indexed+everything' | null;
  findingError?: string;
  findingScope?: 'library' | 'folder' | 'location';
  findingUseRegex?: boolean;
  findingSearchContent?: boolean;
  findingBooleanMode?: boolean;
  /** Locks sort, filter, and view mode for this tab (XYplorer view lock) */
  viewLocked?: boolean;
  lockedView?: {
    sortColumn?: SortColumnId;
    sortDirection?: 'asc' | 'desc';
    filterRegex?: string;
    liveFilter?: string;
    viewMode?: 'details' | 'grid' | 'list' | 'columns' | 'size' | 'recents' | 'media';
  };
}
