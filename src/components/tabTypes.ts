/** Shared tab types for BNDZ file manager */

import type { SortColumnId } from '../lib/listColumns';

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  selectedItems: string[];
  viewMode?: 'details' | 'grid' | 'list' | 'columns' | 'size' | 'recents' | 'media';
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
