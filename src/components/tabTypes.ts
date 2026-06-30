/** Shared tab types for BNDZ file manager */

export interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  selectedItems: string[];
  viewMode?: 'details' | 'grid' | 'list' | 'columns';
  locked?: boolean;
  color?: string;
  /** XYplorer-style persistent search tab */
  kind?: 'folder' | 'finding';
  findingQuery?: string;
  findingRoot?: string;
  findingResults?: any[];
  findingLoading?: boolean;
  findingEngine?: 'everything' | 'indexed' | null;
  /** Locks sort, filter, and view mode for this tab (XYplorer view lock) */
  viewLocked?: boolean;
  lockedView?: {
    sortColumn?: 'name' | 'type' | 'size' | 'modified' | 'created';
    sortDirection?: 'asc' | 'desc';
    filterRegex?: string;
    liveFilter?: string;
    viewMode?: 'details' | 'grid' | 'list' | 'columns';
  };
}
