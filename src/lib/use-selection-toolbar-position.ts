import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';

/** Selection controls share the right card dock, independent of canvas geometry. */
export function useSelectionToolbarPosition(ref: RefObject<HTMLDivElement | null>, visible: boolean) {
  const canvas = useFlowStore(state => state.domNode);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    const control = ref.current;
    if (!visible || !canvas || !control) return;
    const header = document.querySelector('[data-canvas-header]');
    const toolbar = header?.querySelector('[data-top-toolbar]');
    const measure = () => {
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-canvas-inset'));
      const canvasBounds = canvas.getBoundingClientRect();
      const headerBounds = header?.getBoundingClientRect();
      const toolbarBounds = toolbar?.getBoundingClientRect();
      const right = Math.max(16, window.innerWidth - (toolbarBounds?.right ?? window.innerWidth - 16));
      const next = {
        left: Math.max(canvasBounds.left + 16, window.innerWidth - right - control.offsetWidth) - canvasBounds.left,
        top: (headerBounds?.bottom ?? 66) + gap - canvasBounds.top,
        ready: true,
      };
      setPosition(previous => previous.left === next.left && previous.top === next.top && previous.ready ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [canvas, control, header, toolbar].forEach(element => { if (element) observer.observe(element); });
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [canvas, ref, visible]);
  return { left: position.left, top: position.top, visibility: position.ready ? undefined : 'hidden' } as CSSProperties;
}
