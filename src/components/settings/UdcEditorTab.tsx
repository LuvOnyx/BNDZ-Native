import React from 'react';
import type { UserCommandDef } from '../../lib/userCommands';
import { BUILTIN_USER_COMMANDS } from '../../lib/userCommands';
import { SettingsTabHeader, SettingsSection } from './SettingsPrimitives';
import { Icons8Icon } from '../Icons8Icon';

type Props = {
  commands: UserCommandDef[];
  onChange: (commands: UserCommandDef[]) => void;
};

const BUILTIN_ACTIONS = [
  { value: 'dual', label: 'Toggle dual pane' },
  { value: 'inspector', label: 'Toggle inspector' },
  { value: 'findtab', label: 'New finding tab' },
  { value: 'tabset', label: 'Save tabset' },
  { value: 'refresh', label: 'Refresh folder' },
  { value: 'find', label: 'Open find plugin' },
  { value: 'script', label: 'Run PowerShell script' },
];

export default function UdcEditorTab({ commands, onChange }: Props) {
  const custom = commands.filter(c => !BUILTIN_USER_COMMANDS.some(b => b.id === c.id));

  const update = (idx: number, patch: Partial<UserCommandDef>) => {
    const next = [...custom];
    next[idx] = { ...next[idx], ...patch };
    onChange([...BUILTIN_USER_COMMANDS, ...next]);
  };

  const add = () => {
    const id = `udc-${Date.now()}`;
    onChange([...BUILTIN_USER_COMMANDS, ...custom, { id, label: 'New command', action: 'refresh' }]);
  };

  const remove = (idx: number) => {
    const next = custom.filter((_, i) => i !== idx);
    onChange([...BUILTIN_USER_COMMANDS, ...next]);
  };

  return (
    <div>
      <SettingsTabHeader
        title="User-Defined Commands"
        icon="zap_ui"
        description="Custom palette and :: address-bar commands. Built-ins are always available."
      />
      <SettingsSection title="Built-in commands" description="Shipped with BNDZ — not editable.">
        <div className="space-y-1 text-[11px] text-gray-400 font-mono">
          {BUILTIN_USER_COMMANDS.map(c => (
            <div key={c.id}>::{c.action} — {c.label}</div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="Custom commands">
        {custom.map((cmd, idx) => (
          <div key={cmd.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center border-b border-[#333] pb-2 mb-2">
            <input
              value={cmd.label}
              onChange={e => update(idx, { label: e.target.value })}
              placeholder="Label"
              className="bg-[#111] border border-[#444] rounded px-2 py-1 text-[12px] text-white outline-none"
            />
            <select
              value={cmd.action.startsWith('script:') ? 'script' : cmd.action}
              onChange={e => {
                const v = e.target.value;
                update(idx, { action: v === 'script' ? 'script:' : v, hint: v === 'script' ? 'PowerShell' : undefined });
              }}
              className="bg-[#111] border border-[#444] rounded px-2 py-1 text-[12px] text-white outline-none"
            >
              {BUILTIN_ACTIONS.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <input
              value={cmd.action.startsWith('script:') ? cmd.action.slice(7) : (cmd.hint || '')}
              onChange={e => {
                if (cmd.action.startsWith('script:') || BUILTIN_ACTIONS.find(a => a.value === 'script')?.value === 'script') {
                  update(idx, { action: `script:${e.target.value}`, hint: 'PowerShell' });
                } else {
                  update(idx, { hint: e.target.value });
                }
              }}
              placeholder={cmd.action.startsWith('script:') ? 'PowerShell script' : 'Hint / keywords'}
              className="bg-[#111] border border-[#444] rounded px-2 py-1 text-[12px] text-white outline-none font-mono"
            />
            <button type="button" onClick={() => remove(idx)} className="p-1.5 text-red-400 hover:bg-red-950/30 rounded">
              <Icons8Icon id="trash_ui" size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 text-[12px] text-[#7eb8e8] hover:underline mt-2"
        >
          <Icons8Icon id="plus_ui" size={14} /> Add command
        </button>
      </SettingsSection>
    </div>
  );
}
