import React, { useState } from 'react';
import {
  CUSTOM_COLUMN_PROPERTY_OPTIONS,
  createCustomColumnRow,
  moveCustomColumnRow,
  resolveCustomColumns,
  type CustomColumnDef,
} from '../../lib/customColumns';
import { requestNativePrompt } from '../../lib/nativeDialog';

const ActionBtn = ({ label, className = '', onClick, disabled, title }: any) => (
  <button
    type="button"
    disabled={disabled}
    title={title}
    className={`bg-[#2a2a2a] hover:bg-[#444] border border-[#555] rounded-sm text-[12px] px-4 py-1 text-white disabled:opacity-45 disabled:cursor-not-allowed ${className}`}
    onClick={onClick}
  >
    {label}
  </button>
);

export default function CustomColumnsTabContent({
  localConfig,
  updateLocalConfig,
}: {
  localConfig: any;
  updateLocalConfig: (patch: any) => void;
}) {
  const columns = resolveCustomColumns(localConfig);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const saveColumns = (next: CustomColumnDef[]) => updateLocalConfig({ customColumns: next });

  const selected = columns[selectedIdx];

  const editLabel = () => {
    if (!selected) return;
    void (async () => {
      const next = await requestNativePrompt({
        title: 'Custom column',
        message: 'Column label',
        defaultValue: selected.label,
      });
      if (next == null || !next.trim()) return;
      const copy = [...columns];
      copy[selectedIdx] = { ...selected, label: next.trim() };
      saveColumns(copy);
    })();
  };

  const editPattern = () => {
    if (!selected) return;
    void (async () => {
      const next = await requestNativePrompt({
        title: 'Custom column',
        message: 'File pattern (e.g. *.jpg;{Photo};*.*)',
        defaultValue: selected.pattern,
      });
      if (next == null || !next.trim()) return;
      const copy = [...columns];
      copy[selectedIdx] = { ...selected, pattern: next.trim() };
      saveColumns(copy);
    })();
  };

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      <h1 className="text-[20px] font-bold text-white mb-2 leading-tight">Custom Columns</h1>
      <p className="text-[12px] text-[#b0b0b0] mb-4 leading-relaxed max-w-[640px]">
        Special-property columns read Windows shell metadata (EXIF, media tags, version info).
        Enable a column to show it in Details view for matching file types.
      </p>

      <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 border border-[#444] bg-[#0c0c0c] overflow-y-auto styled-scrollbar p-1">
          {columns.map((col, i) => (
            <div
              key={col.id}
              onClick={() => setSelectedIdx(i)}
              className={`flex items-center gap-2 text-[12px] px-2 py-1.5 rounded cursor-pointer ${
                i === selectedIdx ? 'bg-[#094771]/45 ring-1 ring-[#0078d4]/50 text-white' : 'text-[#ccc] hover:bg-[#222]'
              }`}
            >
              <input
                type="checkbox"
                checked={col.enabled}
                onChange={e => {
                  const copy = [...columns];
                  copy[i] = { ...col, enabled: e.target.checked };
                  saveColumns(copy);
                }}
                onClick={e => e.stopPropagation()}
                className="accent-[#0078d4]"
              />
              <span className="w-5 text-right text-[#666]">{i + 1}</span>
              <span className="font-medium truncate">{col.label}</span>
              <span className="text-[#888] truncate ml-auto font-mono text-[10px]">{col.pattern}</span>
            </div>
          ))}
        </div>

        <div className="w-[120px] flex flex-col gap-2 shrink-0">
          <ActionBtn label="New" className="w-full py-1" onClick={() => {
            const next = [...columns, createCustomColumnRow(columns)];
            saveColumns(next);
            setSelectedIdx(next.length - 1);
          }} />
          <ActionBtn label="Edit" className="w-full py-1" onClick={editLabel} disabled={!selected} />
          <ActionBtn label="Pattern" className="w-full py-1" onClick={editPattern} disabled={!selected} />
          <ActionBtn label="Delete" className="w-full py-1" onClick={() => {
            if (!selected) return;
            const next = columns.filter((_, i) => i !== selectedIdx);
            saveColumns(next);
            setSelectedIdx(Math.max(0, Math.min(selectedIdx, next.length - 1)));
          }} disabled={!selected} />
          <div className="h-2" />
          <ActionBtn label="Up" className="w-full py-1" onClick={() => {
            const next = moveCustomColumnRow(columns, selectedIdx, -1);
            saveColumns(next);
            setSelectedIdx(Math.max(0, selectedIdx - 1));
          }} disabled={selectedIdx <= 0} />
          <ActionBtn label="Down" className="w-full py-1" onClick={() => {
            const next = moveCustomColumnRow(columns, selectedIdx, 1);
            saveColumns(next);
            setSelectedIdx(Math.min(columns.length - 1, selectedIdx + 1));
          }} disabled={selectedIdx >= columns.length - 1} />
        </div>
      </div>

      {selected && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-[#333] pt-4">
          <label className="text-[11px] text-[#aaa]">
            Property
            <select
              className="mt-1 w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-1 rounded"
              value={selected.propertyKey}
              onChange={e => {
                const copy = [...columns];
                copy[selectedIdx] = { ...selected, propertyKey: e.target.value };
                saveColumns(copy);
              }}
            >
              {CUSTOM_COLUMN_PROPERTY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-[#aaa]">
            Width (px)
            <input
              type="number"
              min={48}
              max={480}
              className="mt-1 w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-1 rounded"
              value={selected.widthPx || 120}
              onChange={e => {
                const copy = [...columns];
                copy[selectedIdx] = { ...selected, widthPx: Math.max(48, parseInt(e.target.value, 10) || 120) };
                saveColumns(copy);
              }}
            />
          </label>
          <label className="text-[11px] text-[#aaa]">
            Pattern
            <input
              type="text"
              className="mt-1 w-full bg-[#1e1e1e] border border-[#555] text-white text-[12px] px-2 py-1 rounded font-mono"
              value={selected.pattern}
              onChange={e => {
                const copy = [...columns];
                copy[selectedIdx] = { ...selected, pattern: e.target.value };
                saveColumns(copy);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
