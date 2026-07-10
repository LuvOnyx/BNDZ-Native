/**
 * Central registry of rebindable keyboard actions. This is the single source of
 * truth consumed by both the runtime dispatch (buildKeyboardMap in
 * settingsWiring.ts) and the interactive Keybindings settings tab, so the two
 * can never drift apart. Every action listed here is actually wired to a
 * keydown handler in BNDZUI.tsx.
 */

export interface KeybindingActionDef {
  /** Short id used as the key in the runtime keyboard map. */
  id: string;
  /** Config key persisted in settings (e.g. "copyShortcut"). */
  configKey: string;
  /** User-facing label. */
  label: string;
  /** Default shortcut string. */
  default: string;
  /** Grouping for the settings UI. */
  category: 'General' | 'Edit' | 'View' | 'Navigation';
}

export const KEYBINDING_ACTIONS: KeybindingActionDef[] = [
  { id: 'commandPalette', configKey: 'commandPaletteShortcut', label: 'Open command palette', default: 'Ctrl+Shift+P', category: 'General' },
  { id: 'search', configKey: 'searchShortcut', label: 'Focus filter / search', default: 'Ctrl+F', category: 'General' },
  { id: 'inspector', configKey: 'inspectorShortcut', label: 'Toggle inspector / preview panel', default: 'Ctrl+I', category: 'View' },
  { id: 'dualPane', configKey: 'dualPaneShortcut', label: 'Toggle dual pane', default: 'Ctrl+\\', category: 'View' },
  { id: 'refresh', configKey: 'refreshShortcut', label: 'Refresh folder', default: 'F5', category: 'View' },
  { id: 'openInNewPane', configKey: 'openInNewPaneShortcut', label: 'Open selection in opposite pane', default: 'Alt+P', category: 'Navigation' },
  { id: 'rename', configKey: 'renameShortcut', label: 'Rename selection', default: 'F2', category: 'Edit' },
  { id: 'copy', configKey: 'copyShortcut', label: 'Copy', default: 'Ctrl+C', category: 'Edit' },
  { id: 'cut', configKey: 'cutShortcut', label: 'Cut', default: 'Ctrl+X', category: 'Edit' },
  { id: 'paste', configKey: 'pasteShortcut', label: 'Paste', default: 'Ctrl+V', category: 'Edit' },
  { id: 'undo', configKey: 'undoShortcut', label: 'Undo', default: 'Ctrl+Z', category: 'Edit' },
  { id: 'redo', configKey: 'redoShortcut', label: 'Redo', default: 'Ctrl+Y', category: 'Edit' },
  { id: 'newFolder', configKey: 'newFolderShortcut', label: 'New folder', default: 'Ctrl+Shift+N', category: 'Edit' },
  { id: 'delete', configKey: 'deleteShortcut', label: 'Delete selection', default: 'Delete', category: 'Edit' },
];

export const KEYBINDING_CATEGORIES: KeybindingActionDef['category'][] = [
  'General', 'Navigation', 'View', 'Edit',
];

/** Resolve the effective shortcut for an action from a config-like object. */
export function resolveShortcut(
  values: Record<string, unknown>,
  action: KeybindingActionDef,
): string {
  const v = values[action.configKey];
  if (typeof v === 'string') return v;
  return action.default;
}

/**
 * Map every stored shortcut to the set of action ids that use it. Any entry
 * with more than one action id is a conflict. Case-insensitive; blank
 * (unbound) shortcuts are ignored.
 */
export function findKeybindingConflicts(values: Record<string, unknown>): Record<string, string[]> {
  const byShortcut: Record<string, string[]> = {};
  for (const action of KEYBINDING_ACTIONS) {
    const raw = resolveShortcut(values, action).trim().toLowerCase();
    if (!raw) continue;
    (byShortcut[raw] ||= []).push(action.id);
  }
  const conflicts: Record<string, string[]> = {};
  for (const [shortcut, ids] of Object.entries(byShortcut)) {
    if (ids.length > 1) conflicts[shortcut] = ids;
  }
  return conflicts;
}
