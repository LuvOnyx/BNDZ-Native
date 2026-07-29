import React from 'react';
import FluidDragStack from './FluidDragStack';

type Props = {
  enabled?: boolean;
};

export default function FluidDragOrchestrator({ enabled = true }: Props) {
  return <FluidDragStack enabled={enabled} />;
}
