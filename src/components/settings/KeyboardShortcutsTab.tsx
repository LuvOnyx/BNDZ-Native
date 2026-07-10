import React, { useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { CloseGlyph } from '../ChromeGlyphs';
import {
  KEYBINDING_ACTIONS,
  KEYBINDING_CATEGORIES,
  resolveShortcut,
  findKeybindingConflicts,
  type KeybindingActionDef,
} from '../../lib/keybindings';
import { eventToShortcut, formatShortcut } from '../../lib/keyboardShortcuts';
import {
  MOUSE_BINDING_LABELS,
  MOUSE_ACTION_LABELS,
  mergeMouseBindings,
  type MouseBindingKey,
  type MouseItemAction,
  type MouseBindingsConfig,
} from '../../lib/mouseBindings';

interface Props {
  localConfig: Record<string, any>;
  updateLocalConfig: (updates: Record<string, any>) => void;
}

const REFERENCE_ROWS = [
  { keys: 'Space', desc: 'Quick Look / Inspector on selection' },
  { keys: 'Ctrl+Tab', desc: 'Switch active pane' },
  { keys: '/', desc: 'Focus filter bar' },
  { keys: '::help', desc: 'Address bar quick scripts' },
  { keys: 'path ? filter', desc: 'Navigate + filter (XYplorer)' },
];

function KeybindingRow({
  action,
  value,
  conflict,
  onCapture,
  onReset,
  onClear,
}: {
  action: KeybindingActionDef;
  value: string;
  conflict: boolean;
  onCapture: (shortcut: string) => void;
  onReset: () => void;
  onClear: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      btnRef.current?.blur();
      return;
    }
    const shortcut = eventToShortcut(e.nativeEvent);
    if (!shortcut) return; // still holding modifiers
    onCapture(shortcut);
    setRecording(false);
    btnRef.current?.blur();
  };

  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="text-[12px] text-gray-300 flex-1 min-w-0 truncate">{action.label}</span>
      <button
        ref={btnRef}
        onClick={() => setRecording(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        className={[
          'font-mono text-[11px] rounded-sm px-3 py-1 min-w-[130px] text-center border transition-colors',
          recording
            ? 'border-[#0078d4] bg-[#0078d4]/10 text-[#99c9f0] animate-pulse'
            : conflict
              ? 'border-red-500/60 bg-red-500/10 text-red-300'
              : 'border-[#444] bg-[#1a1a1a] text-[#7eb8e8] hover:bg-[#222]',
        ].join(' ')}
        title={conflict ? 'Conflicts with another action' : 'Click, then press a key combination'}
      >
        {recording ? 'Press keys…' : formatShortcut(value)}
      </button>
      <button
        onClick={onReset}
        className="p-1 rounded-sm text-gray-500 hover:text-white hover:bg-[#2a2a2a]"
        title={`Reset to default (${action.default})`}
      >
        <Icons8Icon id="reset_ui" size={13} />
      </button>
      <button
        onClick={onClear}
        className="p-1 rounded-sm text-gray-500 hover:text-white hover:bg-[#2a2a2a]"
        title="Unbind"
      >
        <CloseGlyph size={13} />
      </button>
    </div>
  );
}

export default function KeyboardShortcutsTab({ localConfig, updateLocalConfig }: Props) {
  const conflicts = useMemo(() => findKeybindingConflicts(localConfig), [localConfig]);
  const conflictIds = useMemo(() => new Set(Object.values(conflicts).flat()), [conflicts]);

  const mouseBindings = useMemo(
    () => mergeMouseBindings(localConfig.mouseBindings as MouseBindingsConfig | undefined),
    [localConfig.mouseBindings],
  );

  const setShortcut = (action: KeybindingActionDef, shortcut: string) => {
    updateLocalConfig({ [action.configKey]: shortcut });
  };

  const setMouseBinding = (key: MouseBindingKey, act: MouseItemAction) => {
    const next: MouseBindingsConfig = {
      ...(localConfig.mouseBindings as MouseBindingsConfig | undefined),
      [key]: act,
    };
    updateLocalConfig({ mouseBindings: next });
  };

  const resetAll = () => {
    const updates: Record<string, any> = {};
    for (const a of KEYBINDING_ACTIONS) updates[a.configKey] = a.default;
    updateLocalConfig(updates);
  };

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icons8Icon id="keyboard_ui" size={15} />
          <h1 className="text-[16px] font-bold text-white">Keyboard Shortcuts</h1>
        </div>
        <button
          onClick={resetAll}
          className="text-[11px] text-gray-400 hover:text-white border border-[#444] rounded-sm px-3 py-1 hover:bg-[#2a2a2a]"
        >
          Reset all to defaults
        </button>
      </div>
      <p className="text-[12px] text-gray-400 -mt-3">
        Click a shortcut, then press the key combination you want. Press Esc to cancel. Conflicts are highlighted in red.
      </p>

      {Object.keys(conflicts).length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          Some shortcuts are assigned to more than one action. Resolve the highlighted rows to avoid ambiguous behavior.
        </div>
      )}

      {KEYBINDING_CATEGORIES.map(category => {
        const rows = KEYBINDING_ACTIONS.filter(a => a.category === category);
        if (rows.length === 0) return null;
        return (
          <div key={category}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{category}</h3>
            <div className="rounded-lg border border-[#333] bg-[#141414] px-3 py-1.5 divide-y divide-[#222]">
              {rows.map(action => (
                <KeybindingRow
                  key={action.id}
                  action={action}
                  value={resolveShortcut(localConfig, action)}
                  conflict={conflictIds.has(action.id)}
                  onCapture={s => setShortcut(action, s)}
                  onReset={() => setShortcut(action, action.default)}
                  onClear={() => setShortcut(action, '')}
                />
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icons8Icon id="mouse_ui" size={13} />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Mouse bindings</h3>
        </div>
        <div className="rounded-lg border border-[#333] bg-[#141414] px-3 py-1.5 divide-y divide-[#222]">
          {(Object.keys(MOUSE_BINDING_LABELS) as MouseBindingKey[]).map(key => (
            <div key={key} className="flex items-center gap-2 py-[3px]">
              <span className="text-[12px] text-gray-300 flex-1 min-w-0 truncate">{MOUSE_BINDING_LABELS[key]}</span>
              <select
                value={mouseBindings[key] || 'default'}
                onChange={e => setMouseBinding(key, e.target.value as MouseItemAction)}
                className="text-[11px] bg-[#1a1a1a] border border-[#444] rounded-sm px-2 py-1 text-gray-200 min-w-[220px]"
              >
                {(Object.keys(MOUSE_ACTION_LABELS) as MouseItemAction[]).map(act => (
                  <option key={act} value={act}>{MOUSE_ACTION_LABELS[act]}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Reference (not rebindable)</h3>
        <div className="rounded-lg border border-[#333] overflow-hidden">
          <table className="w-full text-left text-[12px]">
            <tbody>
              {REFERENCE_ROWS.map(row => (
                <tr key={row.keys} className="border-t border-[#2a2a2a] first:border-t-0 hover:bg-[#1a1a1a]">
                  <td className="px-3 py-2 font-mono text-gray-400 w-40">{row.keys}</td>
                  <td className="px-3 py-2 text-gray-400">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
