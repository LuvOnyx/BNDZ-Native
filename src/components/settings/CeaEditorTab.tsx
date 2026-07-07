import React from 'react';
import {
  CEA_ACTION_LABELS,
  CEA_EVENT_GROUPS,
  type CeaAction,
  type CustomEventAction,
  mergeCustomEventActions,
} from '../../lib/customEventActions';
import { SettingsTabHeader } from './SettingsPrimitives';

type Props = {
  actions: CustomEventAction[];
  onChange: (actions: CustomEventAction[]) => void;
};

export default function CeaEditorTab({ actions, onChange }: Props) {
  const merged = mergeCustomEventActions(actions);
  const byEvent = new Map(merged.map(a => [a.event, a]));

  const setAction = (event: string, patch: Partial<CustomEventAction>) => {
    const existing = byEvent.get(event) || { id: `cea-${event}`, event, action: 'none' as CeaAction };
    const next = merged.map(a => (a.event === event ? { ...a, ...patch } : a));
    if (!merged.some(a => a.event === event)) {
      next.push({ ...existing, ...patch });
    }
    onChange(next);
  };

  return (
    <div>
      <SettingsTabHeader
        title="Custom Event Actions"
        icon="pointer_click_ui"
        description="Map mouse events to actions or PowerShell scripts. Changes apply after OK."
      />
      <p className="text-[12px] text-[#e0e0e0] mb-3">Click cells to edit action or script.</p>
      <div className="border border-[#444] rounded-sm overflow-hidden mb-6 max-h-[460px] bg-[#111] flex flex-col">
        <div className="flex bg-[#2a2a2a] text-[#ddd] text-[12px] py-1 border-b border-[#444] shrink-0">
          <div className="flex-[3] pl-2">Event</div>
          <div className="flex-[2] pl-2 border-l border-[#444]">Action</div>
          <div className="flex-[2] pl-2 border-l border-[#444]">Script</div>
        </div>
        <div className="overflow-y-auto flex-1 text-[12px] styled-scrollbar">
          {CEA_EVENT_GROUPS.map(group => (
            <div key={group.title}>
              <div className="bg-[#1e1e1e] text-white font-bold px-2 py-1 sticky top-0 z-10">{group.title}</div>
              {group.events.map(ev => {
                const row = byEvent.get(ev.id) || { id: `cea-${ev.id}`, event: ev.id, action: 'none' as CeaAction };
                return (
                  <div key={ev.id} className="flex hover:bg-[#264f78] text-[#ccc] border-b border-[#222]/50">
                    <div className="flex-[3] pl-6 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={ev.label}>
                      {ev.label}
                    </div>
                    <div className="flex-[2] pl-1 py-0.5 border-l border-[#222]">
                      <select
                        value={row.action}
                        onChange={e => setAction(ev.id, { action: e.target.value as CeaAction })}
                        className="w-full bg-transparent text-[12px] text-[#ccc] outline-none cursor-pointer"
                      >
                        {Object.entries(CEA_ACTION_LABELS).map(([val, label]) => (
                          <option key={val} value={val} className="bg-[#1e1e1e]">{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-[2] pl-1 py-0.5 border-l border-[#222]">
                      <input
                        value={row.script || ''}
                        disabled={row.action !== 'run-script'}
                        onChange={e => setAction(ev.id, { script: e.target.value, shell: 'powershell' })}
                        placeholder={row.action === 'run-script' ? 'PowerShell…' : ''}
                        className="w-full bg-transparent text-[11px] font-mono text-[#aaa] outline-none disabled:opacity-30 px-1"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
