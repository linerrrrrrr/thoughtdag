import { createContext } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { useStore } from '../store';
import { t, type MessageKey } from '../i18n';
import type { ThoughtEdge, ThoughtNode } from '../types';
import type { CanvasLayoutOptions } from './canvas-layout';
import { useCanvasEditing } from './canvas-editing';
import { frameContentIds, isFrameNode, type Rect } from './frames';
import { nodeHeight } from './layout';
import { NODE_CSS_WIDTH } from './constants';
import { toast } from './ui-store';
import { canvasToolViewport } from './use-canvas-panel-position';
import { useProjects } from '../store/projects';

const KEY = 'thoughtdag.canvasLayout';
let pendingFit = 0;
const viewportInputKey = (nodes: ThoughtNode[]) => JSON.stringify(nodes.map((node) => [node.id, node.position.x,
  node.position.y, node.width, node.height]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Only committed preferences drive a quick layout; open panel drafts stay drafts. */
export function readCanvasLayoutOptions(selectedIds?: string[]): CanvasLayoutOptions {
  let stored: Partial<CanvasLayoutOptions> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { /* Use defaults. */ }
  const state = useStore.getState();
  const scope = selectedIds ?? state.selectedNodeIds;
  const selected = new Set([...scope, ...frameContentIds(state.nodes, scope)]);
  const first = state.nodes.find((node) => selected.has(node.id) && node.data.stepKind !== 'frame')
    ?? state.nodes.find((node) => node.data.stepKind !== 'frame');
  return {
    method: ['manual', 'chains', 'layers'].includes(stored.method ?? '') ? stored.method! : 'chains',
    direction: first?.data.layoutDirection ?? (stored.direction === 'horizontal' ? 'horizontal' : 'vertical'),
    density: ['compact', 'standard', 'relaxed'].includes(stored.density ?? '') ? stored.density! : 'standard',
    route: (first?.data.edgeRouteDefault ?? stored.route) === 'orthogonal' ? 'orthogonal' : 'curve',
  };
}

export function saveCanvasLayoutOptions(options: CanvasLayoutOptions) {
  try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* Graph preferences are still saved. */ }
}

export function canvasLayoutErrorKey(error?: string): MessageKey {
  return error === 'empty-selection' ? 'canvasLayout.emptySelection'
    : error === 'cycle' ? 'canvasLayout.cycleBlocked'
    : error === 'obstacle-conflict' ? 'canvasLayout.obstacleBlocked'
    : error === 'frame-conflict' ? 'canvasLayout.frameBlocked'
    : error === 'stale-layout' ? 'canvasLayout.stale'
    : error === 'layout-failed' ? 'canvasLayout.failed' : 'canvasLayout.boundaryBlocked';
}

/** One explicit request owns the busy state. Changing its scope or canvas
 * invalidates it even if the user later returns to the original selection. */
export function beginCanvasLayoutTask() {
  const editing = useCanvasEditing.getState();
  if (editing.layoutBusy) return undefined;
  const request = editing.beginLayout();
  const project = useProjects.getState().activeId;
  const selection = [...useStore.getState().selectedNodeIds].sort().join('\0');
  const isCurrent = () => useCanvasEditing.getState().layoutRequest === request;
  const cancel = () => { if (isCurrent()) useCanvasEditing.getState().cancelLayout(); };
  const stopSelection = useStore.subscribe((state) => {
    if ([...state.selectedNodeIds].sort().join('\0') !== selection) cancel();
  });
  const stopProject = useProjects.subscribe((state) => { if (state.activeId !== project) cancel(); });
  return { request, isCurrent, cancel, finish: () => {
    stopSelection(); stopProject(); useCanvasEditing.getState().finishLayout(request);
  } };
}

/** Fitting uses the same full-size footprint as layout, not thumbnail measurements. */
export function canvasLayoutBounds(nodes: ThoughtNode[]): Rect | undefined {
  if (!nodes.length) return undefined;
  const x = Math.min(...nodes.map((node) => node.position.x));
  const y = Math.min(...nodes.map((node) => node.position.y));
  return {
    x, y,
    width: Math.max(...nodes.map((node) => node.position.x + (node.width ?? node.measured?.width ?? NODE_CSS_WIDTH))) - x,
    height: Math.max(...nodes.map((node) => node.position.y + (isFrameNode(node)
      ? node.height ?? node.measured?.height ?? 420 : nodeHeight(node)))) - y,
  };
}

export async function quickCanvasLayout(flow?: ReactFlowInstance<ThoughtNode, ThoughtEdge> | null, selectedIds?: string[]) {
  const task = beginCanvasLayoutTask();
  if (!task) return;
  const state = useStore.getState();
  const ids = selectedIds ?? (state.selectedNodeIds.length ? state.selectedNodeIds : undefined);
  const saved = readCanvasLayoutOptions(ids);
  const options = { ...saved, method: saved.method === 'manual' ? 'chains' as const : saved.method };
  let applied;
  try { applied = await state.applyCanvasLayout(options, ids, task.isCurrent); }
  catch { if (task.isCurrent()) toast('info', t('canvasLayout.failed')); return; }
  finally { task.finish(); }
  if (!task.isCurrent()) return;
  if (!applied.ok) { toast('info', t(canvasLayoutErrorKey(applied.error))); return; }
  useCanvasEditing.getState().setLayoutOpen(false);
  fitCanvasLayout(flow, ids);
}

/** Reused after quick layout and an explicit settings-panel application. */
export function fitCanvasLayout(flow?: ReactFlowInstance<ThoughtNode, ThoughtEdge> | null, ids?: string[]) {
  const selected = ids ? new Set(ids) : null;
  const shown = useStore.getState().nodes.filter((node) => !selected || selected.has(node.id));
  const bounds = canvasLayoutBounds(shown);
  if (!bounds || !flow) return;
  const project = useProjects.getState().activeId;
  // ResizeObserver measurements settle after committing frame dimensions;
  // those updates must not cancel fitting. User movement/resizing still does.
  const input = viewportInputKey(useStore.getState().nodes);
  cancelAnimationFrame(pendingFit);
  const startedAt = performance.now();
  const fit = () => {
    const current = useStore.getState();
    if (useProjects.getState().activeId !== project || viewportInputKey(current.nodes) !== input) {
      pendingFit = 0;
      return;
    }
    const canvas = document.querySelector<HTMLElement>('.react-flow');
    const panel = [...document.querySelectorAll<HTMLElement>('[data-selection-toolbar], [data-focus-panel]')]
      .find((element) => element.getClientRects().length > 0);
    // The format card mounts 300ms after selection / closing layout settings.
    // Let that card appear before choosing the unobscured canvas rectangle.
    if (!panel && selected?.size && performance.now() - startedAt < 350) {
      pendingFit = requestAnimationFrame(fit);
      return;
    }
    pendingFit = 0;
    if (canvas && panel) {
      const viewport = canvasToolViewport(canvas, panel);
      // Keep the left creation tools and timeline rail clear as well.
      const inset = Math.min(80, viewport.width / 5);
      const { y } = viewport;
      // Export / resume actions remain at the bottom of the canvas.
      const height = Math.max(80, viewport.height - 80);
      const x = viewport.x + inset, width = viewport.width - inset;
      const zoom = Math.max(0.04, Math.min(1, (width - 48) / bounds.width, (height - 32) / bounds.height));
      void flow.setViewport({ x: x + width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: y + height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }, { duration: 250 });
    } else void flow.fitBounds(bounds, { duration: 250, padding: 0.22 });
  };
  pendingFit = requestAnimationFrame(fit);
}

/** The format card lives outside React Flow, so its menu receives the canvas action. */
export const CanvasQuickLayoutContext = createContext<(ids?: string[]) => void>((ids) => quickCanvasLayout(undefined, ids));
