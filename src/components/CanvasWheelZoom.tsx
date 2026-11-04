import { useEffect } from 'react';
import { useReactFlow, useStore, useStoreApi } from '@xyflow/react';

/** Capture modified wheel gestures before node scroll regions or the minimap. */
export default function CanvasWheelZoom() {
  const canvas = useStore((state) => state.domNode);
  const store = useStoreApi();
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Native, non-passive capture also prevents browser zoom over `nowheel`.
      event.preventDefault();
      event.stopImmediatePropagation();
      const { minZoom, maxZoom } = store.getState();
      const current = getViewport();
      const delta = event.deltaY || event.deltaX;
      const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
      const zoom = Math.max(minZoom, Math.min(maxZoom, current.zoom * 2 ** (-delta * unit)));
      if (zoom === current.zoom) return;
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      const ratio = zoom / current.zoom;
      void setViewport({ x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio, zoom });
    };
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => canvas.removeEventListener('wheel', onWheel, { capture: true });
  }, [canvas, store, getViewport, setViewport]);
  return null;
}
