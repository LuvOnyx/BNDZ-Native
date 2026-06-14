import type { LucideIcon } from 'lucide-react';

export interface NavTreeSourceNode {
  label: string;
  path?: string;
  /** Override path used only for native shell icon fetch */
  iconPath?: string;
  icon?: LucideIcon;
  iconColor?: string;
  isDynamic?: boolean;
  useShellIcon?: boolean;
  expanded?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onClick?: () => void;
  childrenItems?: NavTreeSourceNode[];
  /** When true, node has no expandable children (e.g. Recycle Bin). */
  leaf?: boolean;
  /** Stable key for root-level drag reorder persistence */
  treeKey?: string;
  /** Allow user drag reorder (root-level nodes only) */
  draggable?: boolean;
}

export interface DynamicTreeState {
  expanded: boolean;
  children: NavTreeSourceNode[] | null;
  loading?: boolean;
}

export interface FlatNavRow {
  id: string;
  label: string;
  depth: number;
  path?: string;
  iconPath?: string;
  icon?: LucideIcon;
  iconColor?: string;
  isDynamic?: boolean;
  useShellIcon?: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  isPlaceholder?: boolean;
  selected?: boolean;
  staticToggle?: () => void;
  staticClick?: () => void;
  treeKey?: string;
  draggable?: boolean;
}

export function dirEntryToTreeNode(entry: { name: string; path?: string }, parentIsDynamic: boolean): NavTreeSourceNode {
  const p = entry.path?.startsWith('/') ? entry.path : entry.path ? `/${entry.path.replace(/\\/g, '/')}` : undefined;
  return {
    label: entry.name,
    path: p,
    isDynamic: parentIsDynamic || !!p,
    useShellIcon: true,
  };
}

interface FlattenContext {
  dynamicState: Record<string, DynamicTreeState>;
  currentPath?: string;
}

function nodeId(node: NavTreeSourceNode, index: number, prefix: string): string {
  if (node.path) return `path:${node.path}`;
  return `${prefix}:${node.label}:${index}`;
}

export function flattenNavTree(
  nodes: NavTreeSourceNode[],
  ctx: FlattenContext,
  depth = 0,
  prefix = 'root',
): FlatNavRow[] {
  const rows: FlatNavRow[] = [];

  nodes.forEach((node, index) => {
    const hasStaticChildren = !!(node.childrenItems && node.childrenItems.length > 0);
    const isDynamicFolder = !!(node.isDynamic && node.path);
    const isStaticBranch = hasStaticChildren && !isDynamicFolder;

    let isExpanded = false;
    let childNodes: NavTreeSourceNode[] = [];

    if (isDynamicFolder && node.path) {
      const state = ctx.dynamicState[node.path];
      isExpanded = !!state?.expanded;
      if (state?.children) {
        childNodes = state.children;
      }
    } else if (isStaticBranch) {
      isExpanded = !!node.expanded;
      childNodes = node.childrenItems!;
    }

    const hasChildren = !node.leaf && (isDynamicFolder || isStaticBranch);
    const id = nodeId(node, index, prefix);
    const isSelected =
      node.selected ||
      (node.path && ctx.currentPath === node.path) ||
      false;

    rows.push({
      id,
      label: node.label,
      depth,
      path: node.path,
      iconPath: node.iconPath,
      icon: node.icon,
      iconColor: node.iconColor,
      isDynamic: node.isDynamic,
      useShellIcon: node.useShellIcon,
      hasChildren,
      isExpanded,
      isPlaceholder: !node.path && node.label === 'Pin folders here',
      selected: isSelected,
      staticToggle: isStaticBranch ? node.onToggle : undefined,
      staticClick: !isDynamicFolder ? node.onClick : undefined,
      treeKey: node.treeKey,
      draggable: depth === 0 && !!node.draggable && !!node.treeKey,
    });

    if (isExpanded && childNodes.length > 0) {
      rows.push(...flattenNavTree(childNodes, ctx, depth + 1, id));
    }
  });

  return rows;
}

export function shouldExpandOnBrowse(
  path: string,
  currentPath: string | undefined,
  lockState: boolean,
  expandOnBrowse: boolean,
): boolean {
  if (lockState || !expandOnBrowse || !currentPath || !path) return false;
  return currentPath.startsWith(path) && currentPath !== path;
}
