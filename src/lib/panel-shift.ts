import { useUiStore } from './ui-store';
import { useCanvasToolCards } from './use-canvas-tool-card';
import { useStore } from '../store';
import { PANEL_INSET, PANEL_MIN_WINDOW_WIDTH } from './constants';

/** Horizontal screen-pixel shift that recenters a node in the strip of
    canvas the focus panel leaves visible — without it, "center on node"
    parks the node underneath the panel. The reader remains open while
    selecting other objects; narrow screens collapse it automatically.
    Screen pixels: divide by zoom for world units, and the visual center
    of the visible strip sits half the shift left of the screen center. */
export function panelShift(nodeId: string): number {
  const nodes = useStore.getState().nodes;
  if (!nodes.some((node) => node.id === nodeId)) return 0;
  if (useCanvasToolCards.getState().active?.name === 'selection-properties' && useStore.getState().edges.some(edge => edge.selected)) {
    const inspector = document.querySelector<HTMLElement>('[data-selection-properties]');
    return inspector && window.innerWidth >= 768 ? window.innerWidth - inspector.getBoundingClientRect().left + PANEL_INSET : 0;
  }
  const ui = useUiStore.getState();
  if (!ui.panelOpen || !ui.panelNodeId || window.innerWidth < PANEL_MIN_WINDOW_WIDTH || !nodes.some((node) => node.id === ui.panelNodeId)) return 0;
  const panel = document.querySelector<HTMLElement>('[data-focus-panel]');
  return panel ? window.innerWidth - panel.getBoundingClientRect().left + PANEL_INSET : ui.panelWidth + PANEL_INSET * 2;
}
