import { createContext, useLayoutEffect, useRef } from 'react';

export const CanvasToolbarOverflowContext = createContext<{ target: HTMLElement | null; close: () => void }>({ target: null, close: () => {} });

const densities = ['full', 'compact', 'overflow', 'minimal'] as const;

/** A tool can outlive its inline trigger when the header becomes narrower. */
export function restoreCanvasToolbarFocus(trigger: HTMLElement | null) {
  queueMicrotask(() => {
    const target = trigger?.getClientRects().length ? trigger : document.querySelector<HTMLElement>('[data-toolbar-more]');
    target?.focus({ preventScroll: true });
  });
}

/** Fit the actual controls, including translated labels and transient status chips. */
export function useResponsiveCanvasHeader() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    let frame = 0;
    let disposed = false;
    const fit = () => {
      const project = header.querySelector<HTMLElement>('[data-project-switcher]');
      const toolbar = header.querySelector<HTMLElement>('[data-top-toolbar]');
      for (const density of densities) {
        header.dataset.toolbarDensity = density;
        const gap = project ? parseFloat(getComputedStyle(header).columnGap) : 0;
        const width = (project?.getBoundingClientRect().width ?? 0) + (toolbar?.getBoundingClientRect().width ?? 0) + gap;
        if (width <= header.clientWidth) break;
      }
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const resize = new ResizeObserver(schedule);
    resize.observe(header);
    for (const child of header.children) resize.observe(child);
    // Watch content, not attributes: density changes must not retrigger themselves.
    const content = new MutationObserver(schedule);
    content.observe(header, { childList: true, characterData: true, subtree: true });
    void document.fonts.ready.then(schedule);
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); content.disconnect(); };
  }, []);
  return ref;
}
