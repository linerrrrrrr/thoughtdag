import { useLayoutEffect, useState, type CSSProperties } from 'react';

/** Canvas tools share the format inspector's dock, including wrapped headers. */
export function useCanvasPanelPosition(open = true): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ top: 82, right: 16 });
  useLayoutEffect(() => {
    if (!open) return;
    const header = document.querySelector<HTMLElement>('[data-canvas-header]');
    const toolbar = header?.querySelector<HTMLElement>('[data-top-toolbar]');
    const measure = () => {
      const bounds = header?.getBoundingClientRect();
      const top = (bounds?.bottom ?? 66) + 16;
      const right = Math.max(16, window.innerWidth - (toolbar?.getBoundingClientRect().right ?? window.innerWidth - 16));
      // CSS viewport units constrain the surface during resize, before observers run.
      const next = { top, right, maxWidth: `max(0px, calc(100vw - ${right + 16}px))`, maxHeight: `max(0px, calc(100dvh - ${top + 16}px))`, '--canvas-tools-top': `${top}px` };
      setPosition((previous) => Object.entries(next).every(([key, value]) => previous[key as keyof CSSProperties] === value) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);
  return position;
}

/** Keep preview and locate actions in the larger unobscured canvas region. */
export function canvasToolViewport(canvas: HTMLElement, panel: HTMLElement) {
  const canvasBounds = canvas.getBoundingClientRect();
  const panelBounds = panel.getBoundingClientRect();
  const readerBounds = document.querySelector<HTMLElement>('[data-focus-panel]')?.getBoundingClientRect();
  const canvasRight = readerBounds && window.innerWidth >= 960 ? Math.min(canvasBounds.right, readerBounds.left - 16) : canvasBounds.right;
  const top = Math.max(16, (document.querySelector('[data-canvas-header]')?.getBoundingClientRect().bottom ?? 66) - canvasBounds.top + 16);
  const beside = { x: 16, y: top, width: Math.max(0, panelBounds.left - canvasBounds.left - 32), height: Math.max(0, canvasBounds.height - top - 16) };
  const belowTop = panelBounds.bottom - canvasBounds.top + 16;
  const below = { x: 16, y: belowTop, width: Math.max(0, canvasRight - canvasBounds.left - 32), height: Math.max(0, canvasBounds.height - belowTop - 16) };
  return beside.width * beside.height >= below.width * below.height ? beside : below;
}
