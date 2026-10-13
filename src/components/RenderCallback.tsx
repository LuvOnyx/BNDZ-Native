import React from 'react';

/** Calls a render callback during its own render, so an error boundary around it can catch the throw. */
export default function RenderCallback({ render }: { render: () => React.ReactNode }) {
  return <>{render()}</>;
}
