import { useUiStore } from './ui-store';
import { useCanvasEditing } from './canvas-editing';
import { useStore } from '../store';
import { PANEL_INSET } from './constants';

/** Horizontal screen-pixel shift that recenters a node in the strip of
    canvas the focus panel leaves visible — without it, "center on node"
    parks the node underneath the panel. The reader remains open while
    selecting other objects; narrow screens stack it below the toolbar.
    Screen pixels: divide by zoom for world units, and the visual center
    of the visible strip sits half the shift left of the screen center. */
export function panelShift(nodeId: string): number {
  const nodes = useStore.getState().nodes;
  if (!nodes.some((node) => node.id === nodeId)) return 0;
  if (useCanvasEditing.getState().edgeId) {
    const inspector = document.querySelector<HTMLElement>('[data-edge-inspector]');
    return inspector && window.innerWidth >= 768 ? window.innerWidth - inspector.getBoundingClientRect().left + PANEL_INSET : 0;
  }
  const ui = useUiStore.getState();
  if (!ui.panelOpen || !ui.panelNodeId || window.innerWidth < 960 || !nodes.some((node) => node.id === ui.panelNodeId)) return 0;
  const panel = document.querySelector<HTMLElement>('[data-focus-panel]');
  return panel ? window.innerWidth - panel.getBoundingClientRect().left + PANEL_INSET : ui.panelWidth + PANEL_INSET * 2;
}
