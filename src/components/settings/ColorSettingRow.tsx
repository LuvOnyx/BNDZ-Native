import React from 'react';
import { ColorPicker } from '../color-picker';
import type { ColorFillMode } from '../../data/colorConfigSchema';
import { fillPreviewLabelColor, fillToBackground } from '../../lib/colorFill';

interface ColorSettingRowProps {
  label: string;
  value: string;
  defaultValue: string;
  previewTextColor?: string;
  fillMode?: ColorFillMode;
  minStops?: number;
  onChange: (serialized: string) => void;
}

/** One row: live fill preview + single color picker (solid/gradient steps live inside the picker). */
export function ColorSettingRow({
  label,
  value,
  defaultValue,
  previewTextColor,
  fillMode = 'any',
  minStops = 2,
  onChange,
}: ColorSettingRowProps) {
  const raw = value || defaultValue;
  const previewBg = fillToBackground(raw);
  const textColor = previewTextColor || fillPreviewLabelColor(raw, previewTextColor);

  return (
    <div className="border border-[#444] bg-[#1a1a1a] rounded-md overflow-hidden">
      <div className="flex items-stretch min-h-[34px]">
        <div
          className="flex-1 text-[12px] text-center font-medium py-[7px] px-3 flex items-center justify-center"
          style={{ background: previewBg, color: textColor }}
        >
          {label}
        </div>
        <div className="border-l border-[#444] flex items-center px-1.5 bg-[#111]">
          <ColorPicker
            value={raw}
            onChange={onChange}
            fillMode={fillMode}
            minStops={minStops}
          />
        </div>
      </div>
    </div>
  );
}
