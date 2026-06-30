/** XYplorer-style configurable mouse bindings on file list items */

import { dispatchCustomEvent, type CeaHandlers } from './customEventActions';

export type MouseItemAction =
  | 'default'
  | 'open'
  | 'open-opposite-pane'
  | 'open-background-tab'
  | 'properties'
  | 'select-toggle';

export type MouseBindingKey =
  | 'middle'
  | 'middleCtrl'
  | 'middleAlt'
  | 'leftAlt'
  | 'leftCtrlShift'
  | 'leftAltShift';

export type MouseBindingsConfig = Partial<Record<MouseBindingKey, MouseItemAction>>;

export const DEFAULT_MOUSE_BINDINGS: MouseBindingsConfig = {
  middle: 'open-opposite-pane',
  leftAlt: 'open-background-tab',
};

export const MOUSE_BINDING_LABELS: Record<MouseBindingKey, string> = {
  middle: 'Middle-click item',
  middleCtrl: 'Ctrl + middle-click item',
  middleAlt: 'Alt + middle-click item',
  leftAlt: 'Alt + left-click item',
  leftCtrlShift: 'Ctrl + Shift + left-click item',
  leftAltShift: 'Alt + Shift + left-click item',
};

export const MOUSE_ACTION_LABELS: Record<MouseItemAction, string> = {
  default: 'Default (select / single-click open)',
  open: 'Open item',
  'open-opposite-pane': 'Open in opposite pane',
  'open-background-tab': 'Open in new background tab',
  properties: 'Show properties',
  'select-toggle': 'Toggle selection',
};

export function mergeMouseBindings(custom?: MouseBindingsConfig): MouseBindingsConfig {
  return { ...DEFAULT_MOUSE_BINDINGS, ...(custom || {}) };
}

export function resolveMouseBindingKey(
  button: number,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean },
): MouseBindingKey | null {
  const { ctrl, alt, shift } = modifiers;
  if (button === 1) {
    if (ctrl && !alt && !shift) return 'middleCtrl';
    if (alt && !ctrl && !shift) return 'middleAlt';
    if (!ctrl && !alt && !shift) return 'middle';
    return null;
  }
  if (button === 0) {
    if (alt && shift && !ctrl) return 'leftAltShift';
    if (ctrl && shift && !alt) return 'leftCtrlShift';
    if (alt && !ctrl && !shift) return 'leftAlt';
    return null;
  }
  return null;
}

export type MouseItemHandlers = {
  openEntity: (entity: any) => void;
  openOppositePane: (path: string) => void;
  openBackgroundTab: (path: string) => void;
  showProperties: () => void;
  toggleSelect: (id: string) => void;
  buildPath: (entity: any) => string | null;
};

export function dispatchMouseItemBinding(
  config: { mouseBindings?: MouseBindingsConfig; customEventActions?: any[] },
  bindingKey: MouseBindingKey,
  entity: any,
  handlers: MouseItemHandlers,
  ceaHandlers?: CeaHandlers,
): boolean {
  const action = mergeMouseBindings(config.mouseBindings)[bindingKey] || 'default';
  if (action === 'default') return false;

  const path = handlers.buildPath(entity);

  switch (action) {
    case 'open':
      handlers.openEntity(entity);
      return true;
    case 'open-opposite-pane':
      if (path) {
        if (ceaHandlers && dispatchCustomEvent(config, 'middle-click-folder', ceaHandlers, { path })) return true;
        handlers.openOppositePane(path);
        return true;
      }
      return false;
    case 'open-background-tab':
      if (path) handlers.openBackgroundTab(path);
      return true;
    case 'properties':
      handlers.showProperties();
      return true;
    case 'select-toggle':
      if (entity?.id) handlers.toggleSelect(entity.id);
      return true;
    default:
      return false;
  }
}

export function getMouseBindingAction(
  config: { mouseBindings?: MouseBindingsConfig },
  bindingKey: MouseBindingKey,
): MouseItemAction {
  return mergeMouseBindings(config.mouseBindings)[bindingKey] || 'default';
}
