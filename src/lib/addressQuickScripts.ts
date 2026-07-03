/** XYplorer-style `::command` quick scripts for the address bar */

import { tryNavigateCatalogSlug } from './catalogNavigation';

export type QuickScriptHandlers = {
  paneId: string;
  tabPath: string;
  refresh: () => void;
  toggleDualPane: () => void;
  openInspector: () => void;
  openFindPlugin: () => void;
  openBatchRename: () => void;
  syncPanes: () => void;
  saveTabset: () => void;
  focusFilter: () => void;
  openSettings: () => void;
  newFindingTab: (query: string) => void;
  navigate: (path: string) => void;
  setFilter: (text: string) => void;
  toast: (msg: string) => void;
};

type ScriptDef = {
  names: string[];
  hint: string;
  run: (args: string, h: QuickScriptHandlers) => void;
};

const SCRIPTS: ScriptDef[] = [
  { names: ['refresh', 'reload', 'r'], hint: 'Reload active folder', run: (_, h) => { h.refresh(); h.toast('Folder refreshed.'); } },
  { names: ['dual', 'dualpane', 'dp'], hint: 'Toggle dual pane', run: (_, h) => h.toggleDualPane() },
  { names: ['preview', 'inspector', 'i'], hint: 'Open inspector panel', run: (_, h) => h.openInspector() },
  { names: ['find'], hint: 'Open fast search plugin', run: (_, h) => h.openFindPlugin() },
  { names: ['rename'], hint: 'Open batch rename', run: (_, h) => h.openBatchRename() },
  { names: ['sync'], hint: 'Sync both panes to same folder', run: (_, h) => h.syncPanes() },
  { names: ['tabset', 'save-tabset'], hint: 'Save workspace tabset', run: (_, h) => h.saveTabset() },
  { names: ['filter', 'f'], hint: 'Focus omnibar filter', run: (_, h) => h.focusFilter() },
  { names: ['settings', 'config'], hint: 'Open settings', run: (_, h) => h.openSettings() },
  {
    names: ['findtab', 'finding', 'searchtab'],
    hint: 'New finding tab — ::findtab photos',
    run: (args, h) => {
      const q = args.trim();
      if (!q) { h.toast('Usage: ::findtab <query>'); return; }
      h.newFindingTab(q);
      h.toast(`Finding tab: ${q}`);
    },
  },
  {
    names: ['go', 'cd'],
    hint: 'Navigate — ::go C:/Users',
    run: (args, h) => {
      const p = args.trim().replace(/\\/g, '/');
      if (!p) { h.toast('Usage: ::go <path>'); return; }
      h.navigate(p.startsWith('/') ? p : `/${p}`);
    },
  },
  {
    names: ['filter-set', 'grep'],
    hint: 'Set list filter — ::grep .pdf',
    run: (args, h) => {
      h.setFilter(args.trim());
      if (args.trim()) h.toast(`Filter: ${args.trim()}`);
    },
  },
  {
    names: ['help', '?'],
    hint: 'List quick scripts',
    run: (_, h) => {
      const list = SCRIPTS.map(s => `::${s.names[0]} — ${s.hint}`).join(' · ');
      h.toast(list.slice(0, 240) + (list.length > 240 ? '…' : ''));
    },
  },
  {
    names: ['vf', 'catalog', 'collection'],
    hint: 'Open catalog — ::vf photos',
    run: (args, h) => {
      const slug = args.trim();
      if (!slug) {
        h.navigate('/vf');
        return;
      }
      h.navigate(`/vf/${slug}`);
      h.toast(`Catalog: ${slug}`);
    },
  },
  {
    names: ['run', 'ps', 'script'],
    hint: 'Run PowerShell — ::run Get-Date',
    run: (args, h) => {
      if (!args.trim()) { h.toast('Usage: ::run <powershell>'); return; }
      void import('./ipcBridge').then(({ IPC }) => {
        IPC.runUserScript('powershell', args.trim()).then(res => {
          h.toast(res.ok ? (res.output.slice(0, 220) || 'OK') : res.output.slice(0, 220));
        });
      });
    },
  },
  {
    names: ['devices', 'mtp', 'phone'],
    hint: 'Browse portable / MTP devices',
    run: (_, h) => {
      h.navigate('/shell:PortableDevices');
      h.toast('Portable Devices');
    },
  },
  {
    names: ['updates', 'update'],
    hint: 'Check for BNDZ updates',
    run: (_, h) => {
      void import('./ipcBridge').then(({ IPC }) => {
        IPC.checkForUpdates().then(r => {
          if (r.updateAvailable) h.toast(`Update available: v${r.latestVersion}`);
          else h.toast(r.error || 'You are on the latest version.');
        });
      });
    },
  },
  {
    names: ['undo'],
    hint: 'Undo last file operation',
    run: (_, h) => {
      void import('./ipcBridge').then(({ IPC }) => {
        IPC.executeUndo().then(ok => h.toast(ok ? 'Undo complete' : 'Nothing to undo'));
      });
    },
  },
  {
    names: ['redo'],
    hint: 'Redo last undone operation',
    run: (_, h) => {
      void import('./ipcBridge').then(({ IPC }) => {
        IPC.executeRedo().then(ok => h.toast(ok ? 'Redo complete' : 'Nothing to redo'));
      });
    },
  },
];

export function listQuickScriptHints(): string[] {
  return SCRIPTS.map(s => `::${s.names[0]}`);
}

export function runAddressQuickScript(raw: string, handlers: QuickScriptHandlers): boolean {
  if (!raw.startsWith('::')) return false;
  const body = raw.slice(2).trim();
  if (!body) {
    handlers.toast('Type ::help for quick scripts');
    return true;
  }
  const space = body.indexOf(' ');
  const cmd = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const args = space === -1 ? '' : body.slice(space + 1);

  const script = SCRIPTS.find(s => s.names.includes(cmd));
  if (!script) {
    if (tryNavigateCatalogSlug(cmd, handlers)) return true;
    handlers.toast(`Unknown: ::${cmd} — try ::help`);
    return true;
  }
  script.run(args, handlers);
  return true;
}
