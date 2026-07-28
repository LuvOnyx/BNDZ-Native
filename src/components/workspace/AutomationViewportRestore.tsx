import { useEffect, useRef } from 'react';
import { useReactFlow, type Viewport } from '@xyflow/react';
import type { AutomationViewport } from '../../lib/automationStore';

type Props = {
  viewport: AutomationViewport;
};

/** Applies saved pan/zoom after graph load — React Flow only reads defaultViewport on first mount. */
export default function AutomationViewportRestore({ viewport }: Props) {
  const { setViewport } = useReactFlow();
  const lastKey = useRef('');

  useEffect(() => {
    const key = `${viewport.x}|${viewport.y}|${viewport.zoom}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    const vp: Viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    void setViewport(vp, { duration: 0 });
  }, [viewport.x, viewport.y, viewport.zoom, setViewport, viewport]);

  return null;
}
