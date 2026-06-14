import React from 'react';
import { ColorPicker } from '../color-picker';

interface ColorSettingRowProps {
  label: string;
  value: string;
  defaultValue: string;
  previewTextColor?: string;
  onChange: (hex: string) => void;
}

export function ColorSettingRow({ label, value, defaultValue, previewTextColor, onChange }: ColorSettingRowProps) {
  const hex = value || defaultValue;
  const textColor = previewTextColor || (isLight(hex) ? '#000000' : '#ffffff');

  return (
    <div className="border border-[#444] bg-[#1a1a1a] rounded-sm overflow-hidden">
      <div className="flex items-stretch min-h-[32px]">
        <div
          className="flex-1 text-[12px] text-center font-medium py-[6px] px-3 flex items-center justify-center"
          style={{ backgroundColor: hex, color: textColor }}
        >
          {label}
        </div>
        <div className="border-l border-[#444] flex items-center px-1 bg-[#111]">
          <ColorPicker value={hex} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

function isLight(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}
