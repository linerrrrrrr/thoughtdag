import { useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { PANEL_MIN_WINDOW_WIDTH } from './constants';
import { useCanvasEditing } from './canvas-editing';
import { uiRect, uiViewport, uiToScreen, UI_SCALE } from './ui-scale';

const hasFocusPanelSpace = () => uiViewport().width >= PANEL_MIN_WINDOW_WIDTH;
const subscribeToFocusPanelSpace = (onChange: () => void) => {
  const media = window.matchMedia(`(min-width: ${PANEL_MIN_WINDOW_WIDTH * UI_SCALE}px)`);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

/** Hide the reader before paint when the canvas no longer has room beside it. */
export function useFocusPanelSpace() {
  return useSyncExternalStore(subscribeToFocusPanelSpace, hasFocusPanelSpace);
}

/** Tool cards dock below their toolbar; geometry inspectors keep the right dock. */
export function useCanvasPanelPosition(open = true, side: 'left' | 'right' = 'right'): CSSProperties {
  const hasSelectionToolbar = useCanvasEditing(state => !!state.selectionRegion
    && state.selectionRegion.nodeIds.length + state.selectionRegion.edgeIds.length + state.selectionRegion.frameIds.length > 0);
  const [position, setPosition] = useState<CSSProperties>({ top: 82, [side]: 16 });
  useLayoutEffect(() => {
    if (!open) return;
    const header = document.querySelector<HTMLElement>('[data-canvas-header]');
    const toolbar = header?.querySelector<HTMLElement>(side === 'left' ? '[data-project-switcher]' : '[data-top-toolbar]');
    const measure = () => {
      const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-canvas-inset'));
      const bounds = header ? uiRect(header) : undefined;
      const viewport = uiViewport();
      const selectionToolbar = document.querySelector<HTMLElement>('[data-selection-target-control]');
      // Right cards always sit below the selection controls. Narrow left cards
      // share that row too, since they would otherwise overlap the right dock.
      const selectionInset = hasSelectionToolbar && (side === 'right' || bounds && bounds.width < 640)
        ? (selectionToolbar?.offsetHeight ?? 50) + gap : 0;
      const top = (bounds?.bottom ?? 66) + gap + selectionInset;
      const toolbarBounds = toolbar ? uiRect(toolbar) : undefined;
      const left = side === 'left' ? Math.max(16, toolbarBounds?.left ?? bounds?.left ?? 16) : undefined;
      const right = side === 'right' ? Math.max(16, viewport.width - (toolbarBounds?.right ?? viewport.width - 16)) : undefined;
      const oppositeInset = side === 'left' ? Math.max(16, viewport.width - (bounds?.right ?? viewport.width - 16)) : 16;
      const horizontalInsets = (left ?? right ?? 16) + oppositeInset;
      // CSS viewport units constrain the surface during resize, before observers run.
      const next = { top, left, right, maxWidth: `max(0px, calc(100 * var(--ui-vw) - ${horizontalInsets}px))`, maxHeight: `max(0px, calc(100 * var(--ui-dvh) - ${top + 16}px))`, '--canvas-tools-top': `${top}px` };
      setPosition((previous) => Object.entries(next).every(([key, value]) => previous[key as keyof CSSProperties] === value) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (toolbar) observer.observe(toolbar);
    const selectionToolbar = document.querySelector('[data-selection-target-control]');
    if (selectionToolbar) observer.observe(selectionToolbar);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [open, side, hasSelectionToolbar]);
  return position;
}

/** Keep preview and locate actions in the larger unobscured canvas region. */
export function canvasToolViewport(canvas: HTMLElement, panel: HTMLElement) {
  const gap = uiToScreen(16);
  const canvasBounds = canvas.getBoundingClientRect();
  const panelBounds = panel.getBoundingClientRect();
  const readerBounds = document.querySelector<HTMLElement>('[data-focus-panel]')?.getBoundingClientRect();
  const canvasRight = readerBounds && hasFocusPanelSpace() ? Math.min(canvasBounds.right, readerBounds.left - gap) : canvasBounds.right;
  const top = Math.max(gap, (document.querySelector('[data-canvas-header]')?.getBoundingClientRect().bottom ?? uiToScreen(66)) - canvasBounds.top + gap);
  const beside = { x: gap, y: top, width: Math.max(0, panelBounds.left - canvasBounds.left - gap * 2), height: Math.max(0, canvasBounds.height - top - gap) };
  const belowTop = panelBounds.bottom - canvasBounds.top + gap;
  const below = { x: gap, y: belowTop, width: Math.max(0, canvasRight - canvasBounds.left - gap * 2), height: Math.max(0, canvasBounds.height - belowTop - gap) };
  return beside.width * beside.height >= below.width * below.height ? beside : below;
}
