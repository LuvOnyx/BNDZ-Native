export interface NavTreeSourceNode {
  label: string;
  path?: string;
  /** Override path used only for native shell icon fetch */
  iconPath?: string;
  /** Icons8 launcher icon id from toolbarLauncherIcons */
  icon?: string;
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
  icon?: string;
  iconColor?: string;
  isDynamic?: boolean;
  useShellIcon?: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  isPlaceholder?: boolean;
  selected?: boolean;
  /** Ancestor on the path to the active folder (tree path tracing). */
  pathTrace?: boolean;
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
  markIntermediateNodes?: boolean;
  /** When true, hide expand chevron once we know a folder has no children. */
  checkExistence?: boolean;
  pathsEqual?: (a?: string, b?: string) => boolean;
  isPathAncestor?: (ancestor?: string, descendant?: string) => boolean;
}

function defaultPathsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function defaultIsPathAncestor(ancestor?: string, descendant?: string): boolean {
  if (!ancestor || !descendant) return false;
  const a = ancestor.replace(/\\/g, '/').replace(/\/+$/, '');
  const d = descendant.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!a || !d || a === d) return false;
  return d.startsWith(`${a}/`);
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

    const knownEmpty =
      !!ctx.checkExistence
      && isDynamicFolder
      && !!node.path
      && Array.isArray(ctx.dynamicState[node.path!]?.children)
      && (ctx.dynamicState[node.path!]?.children?.length ?? 0) === 0
      && !ctx.dynamicState[node.path!]?.loading;
    const hasChildren = !node.leaf && !knownEmpty && (isDynamicFolder || isStaticBranch);
    const id = nodeId(node, index, prefix);
    const pathsEqual = ctx.pathsEqual ?? defaultPathsEqual;
    const isPathAncestor = ctx.isPathAncestor ?? defaultIsPathAncestor;
    const isSelected =
      node.selected ||
      (node.path && pathsEqual(node.path, ctx.currentPath)) ||
      false;
    const pathTrace = !!(
      ctx.markIntermediateNodes
      && node.path
      && ctx.currentPath
      && !isSelected
      && isPathAncestor(node.path, ctx.currentPath)
    );

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
      pathTrace,
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
