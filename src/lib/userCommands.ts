/** User-defined commands (XYplorer UDC lite) — palette + :: address bar */

import type { PaletteAction } from '../components/CommandPalette';
import type { QuickScriptHandlers } from './addressQuickScripts';
import { runAddressQuickScript } from './addressQuickScripts';

export type UserCommandDef = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  action: string;
  shell?: 'powershell' | 'cmd';
};

export const BUILTIN_USER_COMMANDS: UserCommandDef[] = [
  { id: 'udc-dual', label: 'Toggle Dual Pane', action: 'dual', keywords: ['split'] },
  { id: 'udc-inspector', label: 'Toggle Inspector', action: 'inspector', keywords: ['preview'] },
  { id: 'udc-finding', label: 'New Finding Tab', action: 'findtab', hint: 'Prompts for query' },
  { id: 'udc-tabset', label: 'Save Tabset', action: 'tabset' },
  { id: 'udc-refresh', label: 'Refresh Folder', action: 'refresh' },
];

export function mergeUserCommands(custom: UserCommandDef[] | undefined): UserCommandDef[] {
  const ids = new Set(BUILTIN_USER_COMMANDS.map(c => c.id));
  const extra = (custom || []).filter(c => c.id && !ids.has(c.id));
  return [...BUILTIN_USER_COMMANDS, ...extra];
}

export function runUserCommandAction(action: string, handlers: QuickScriptHandlers, arg = '') {
  if (action.startsWith('script:')) {
    const script = action.slice(7).trim();
    if (!script) {
      handlers.toast('Empty script');
      return;
    }
    void import('./ipcBridge').then(({ IPC }) => {
      IPC.runUserScript('powershell', script).then(res => {
        if (res.ok) handlers.toast(res.output.slice(0, 200) || 'Script finished');
        else handlers.toast(`Script error: ${res.output.slice(0, 200)}`);
      });
    });
    return;
  }
  const script = action.startsWith('::') ? action : `::${action}${arg ? ` ${arg}` : ''}`;
  runAddressQuickScript(script, handlers);
}

export function userCommandsToPalette(
  commands: UserCommandDef[],
  handlers: QuickScriptHandlers,
): PaletteAction[] {
  return commands.map(cmd => ({
    id: `udc-${cmd.id}`,
    label: cmd.label,
    hint: cmd.hint || `User command · ${cmd.action}`,
    icon: 'zap_ui',
    keywords: cmd.keywords,
    onRun: () => {
      if (cmd.action === 'findtab') {
        const q = prompt('Finding tab search query:') || '';
        if (q) handlers.newFindingTab(q);
        return;
      }
      if (cmd.action.startsWith('script:')) {
        runUserCommandAction(cmd.action, handlers);
        return;
      }
      runUserCommandAction(cmd.action, handlers);
    },
  }));
}
