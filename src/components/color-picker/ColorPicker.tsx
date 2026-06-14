import React from 'react';
import { ColorPicker as AriaColorPicker } from './src/ColorPicker';
import { parseColor, Color } from 'react-aria-components';

export default function ColorPicker({ value, onChange }: { value: string, onChange: (color: string) => void }) {
  // Safe color parsing
  let colorValue;
  try {
    colorValue = value ? parseColor(value) : parseColor('#000000');
  } catch (e) {
    colorValue = parseColor('#000000');
  }

  return (
    <AriaColorPicker
      value={colorValue}
      onChange={(color: Color) => onChange(color.toString('hex'))}
    />
  );
}
