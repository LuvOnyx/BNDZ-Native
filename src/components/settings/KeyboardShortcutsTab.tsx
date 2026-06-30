import React from 'react';

const SHORTCUTS = [
  { keys: 'Alt+Space', desc: 'Open BNDZ Launcher' },
  { keys: 'Ctrl+Shift+P', desc: 'Command palette (file manager)' },
  { keys: 'Space', desc: 'Quick Look / Inspector (on selection)' },
  { keys: 'Ctrl+I', desc: 'Toggle Inspector panel' },
  { keys: 'Ctrl+\\', desc: 'Toggle dual pane' },
  { keys: 'Ctrl+Tab', desc: 'Switch active pane' },
  { keys: 'F5', desc: 'Refresh folder / finding tab' },
  { keys: 'F2', desc: 'Rename selection' },
  { keys: 'Ctrl+C / X / V', desc: 'Copy / cut / paste' },
  { keys: 'Ctrl+Z / Y', desc: 'Undo / redo' },
  { keys: 'Delete', desc: 'Delete selection' },
  { keys: '/', desc: 'Focus filter bar' },
  { keys: 'Ctrl+Enter', desc: 'Open file in BNDZ (launcher)' },
  { keys: '::help', desc: 'Address bar quick scripts' },
  { keys: 'path ? filter', desc: 'Navigate + filter (XYplorer)' },
];

export default function KeyboardShortcutsTab() {
  return (
    <div className="p-4 space-y-3 max-w-2xl">
      <p className="text-[12px] text-gray-400 mb-4">
        Keyboard reference for BNDZ File Manager and Launcher. Rebind support coming in a future update.
      </p>
      <div className="rounded-lg border border-[#333] overflow-hidden">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-[#1a1a1a] text-gray-500 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="px-3 py-2 w-40">Shortcut</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(row => (
              <tr key={row.keys} className="border-t border-[#2a2a2a] hover:bg-[#1a1a1a]">
                <td className="px-3 py-2 font-mono text-sky-400">{row.keys}</td>
                <td className="px-3 py-2 text-gray-300">{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
