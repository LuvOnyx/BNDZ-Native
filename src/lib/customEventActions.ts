/** XYplorer Custom Event Actions — trigger → action (+ optional script) */

export type CeaAction =
  | 'none'
  | 'go-up'
  | 'new-tab'
  | 'close-tab'
  | 'open-opposite-pane'
  | 'open-background-tab'
  | 'refresh'
  | 'run-script'
  | 'open-favorites'
  | 'edit-menu'
  | 'small-menu'
  | 'autosize-columns';

export type CustomEventAction = {
  id: string;
  event: string;
  action: CeaAction;
  script?: string;
  shell?: 'powershell' | 'cmd';
};

export const DEFAULT_CUSTOM_EVENT_ACTIONS: CustomEventAction[] = [
  { id: 'cea-dbl-white-tree', event: 'double-click-white-tree', action: 'go-up' },
  { id: 'cea-dbl-white-list', event: 'double-click-white-list', action: 'go-up' },
  { id: 'cea-dbl-white-tab', event: 'double-click-white-tab', action: 'new-tab' },
  { id: 'cea-mid-tab', event: 'middle-click-tab', action: 'close-tab' },
  { id: 'cea-mid-folder', event: 'middle-click-folder', action: 'open-opposite-pane' },
  { id: 'cea-rc-white-tree', event: 'right-click-white-tree', action: 'open-favorites' },
  { id: 'cea-rc-white-list', event: 'right-click-white-list', action: 'edit-menu' },
  { id: 'cea-rc-tab', event: 'right-click-tab', action: 'small-menu' },
  { id: 'cea-dbl-linenum', event: 'double-click-line-numbers-header', action: 'autosize-columns' },
];

export const CEA_ACTION_LABELS: Record<CeaAction, string> = {
  none: 'None',
  'go-up': 'Go up',
  'new-tab': 'New tab',
  'close-tab': 'Close tab',
  'open-opposite-pane': 'Open in opposite pane',
  'open-background-tab': 'Open in new background tab',
  refresh: 'Refresh',
  'run-script': 'Run script',
  'open-favorites': 'Pop up favorite folders',
  'edit-menu': 'Pop up Edit menu',
  'small-menu': 'Small menu',
  'autosize-columns': 'Autosize columns now',
};

export const CEA_EVENT_GROUPS: { title: string; events: { id: string; label: string }[] }[] = [
  {
    title: 'Clicking on White',
    events: [
      { id: 'double-click-white-tree', label: 'Double-click on white in folder tree' },
      { id: 'double-click-white-list', label: 'Double-click on white in file list' },
      { id: 'double-click-white-tab', label: 'Double-click on white in tab bar' },
      { id: 'double-click-white-breadcrumb', label: 'Double-click on white in breadcrumb bar' },
      { id: 'middle-click-white-tree', label: 'Middle-click on white in folder tree' },
      { id: 'middle-click-white-list', label: 'Middle-click on white in file list' },
      { id: 'middle-click-white-tab', label: 'Middle-click on white in tab bar' },
      { id: 'right-click-white-tree', label: 'Right-click on white in folder tree' },
      { id: 'right-click-white-list', label: 'Right-click on white in file list' },
    ],
  },
  {
    title: 'Clicking on Tabs',
    events: [
      { id: 'double-click-tab', label: 'Double-click on tab' },
      { id: 'middle-click-tab', label: 'Middle-click on tab' },
      { id: 'right-click-tab', label: 'Right-click on tab' },
    ],
  },
  {
    title: 'Clicking on Items',
    events: [
      { id: 'middle-click-folder', label: 'Middle-click on folder' },
      { id: 'double-click-line-numbers-header', label: 'Double-click on line numbers header' },
    ],
  },
];

export function mergeCustomEventActions(custom?: CustomEventAction[]): CustomEventAction[] {
  const map = new Map(DEFAULT_CUSTOM_EVENT_ACTIONS.map(a => [a.event, { ...a }]));
  for (const row of custom || []) {
    if (!row.event) continue;
    map.set(row.event, { ...map.get(row.event), ...row, id: row.id || `cea-${row.event}` });
  }
  return Array.from(map.values());
}

export function getCeaAction(config: { customEventActions?: CustomEventAction[] }, eventKey: string): CustomEventAction | undefined {
  return mergeCustomEventActions(config.customEventActions).find(a => a.event === eventKey);
}

export type CeaHandlers = {
  goUp: () => void;
  newTab: () => void;
  closeTab: () => void;
  openOppositePane: (path: string) => void;
  openBackgroundTab: (path: string) => void;
  refresh: () => void;
  openFavorites: () => void;
  openEditMenu: () => void;
  openSmallTabMenu: (x: number, y: number) => void;
  autosizeColumns: () => void;
  runScript: (shell: string, script: string) => void;
  toast: (msg: string) => void;
};

export function dispatchCustomEvent(
  config: { customEventActions?: CustomEventAction[] },
  eventKey: string,
  handlers: CeaHandlers,
  ctx?: { path?: string; x?: number; y?: number },
): boolean {
  const row = getCeaAction(config, eventKey);
  if (!row || row.action === 'none') return false;
  switch (row.action) {
    case 'go-up': handlers.goUp(); return true;
    case 'new-tab': handlers.newTab(); return true;
    case 'close-tab': handlers.closeTab(); return true;
    case 'open-opposite-pane':
      if (ctx?.path) handlers.openOppositePane(ctx.path);
      return true;
    case 'open-background-tab':
      if (ctx?.path) handlers.openBackgroundTab(ctx.path);
      return true;
    case 'refresh': handlers.refresh(); return true;
    case 'open-favorites': handlers.openFavorites(); return true;
    case 'edit-menu': handlers.openEditMenu(); return true;
    case 'small-menu': handlers.openSmallTabMenu(ctx?.x ?? 0, ctx?.y ?? 0); return true;
    case 'autosize-columns': handlers.autosizeColumns(); return true;
    case 'run-script':
      if (row.script?.trim()) handlers.runScript(row.shell || 'powershell', row.script);
      return true;
    default: return false;
  }
}
