import React from 'react';

/** Fire menubar actions on mouseDown (WebView2 capture-phase dismiss safe). */
export function runMenubarAction(handler: () => void) {
  return (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handler();
  };
}
