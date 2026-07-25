// @ts-nocheck
'use client';
import {
  ColorSlider as AriaColorSlider,
  ColorSliderProps as AriaColorSliderProps,
  SliderOutput,
  SliderTrack
} from 'react-aria-components';
import {Label} from './Form';
import {ColorThumb} from './ColorThumb';
import './ColorSlider.css';

export interface ColorSliderProps extends AriaColorSliderProps {
  label?: string;
}

export function ColorSlider({ label, channel, className, ...props }: ColorSliderProps) {
  const isOpacity = channel === 'alpha';
  return (
    (
      <AriaColorSlider
        channel={channel}
        className={[className, isOpacity ? 'bndz-opacity-slider' : null].filter(Boolean).join(' ') || undefined}
        {...props}
      >
        <Label>{label}</Label>
        <SliderOutput />
        <div className={isOpacity ? 'bndz-opacity-track-inset' : undefined}>
          <SliderTrack
            style={({ defaultStyle }) => ({
              background: `${defaultStyle.background},
              repeating-conic-gradient(#CCC 0% 25%, white 0% 50%) 50% / 16px 16px`
            })}
          >
            <ColorThumb />
          </SliderTrack>
        </div>
      </AriaColorSlider>
    )
  );
}
