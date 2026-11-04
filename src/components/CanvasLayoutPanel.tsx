import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { useCanvasEditing } from '../lib/canvas-editing';
import { planCanvasLayout, type CanvasLayoutOptions } from '../lib/canvas-layout';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { nodesRect } from '../lib/frames';
import { useUiStore } from '../lib/ui-store';
import { useProjects } from '../store/projects';
import { isImeComposing } from '../utils';
import type { ThoughtNode, ThoughtEdge } from '../types';
import './CanvasLayoutPanel.css';
import { canvasToolViewport, useCanvasPanelPosition } from '../lib/use-canvas-panel-position';

const KEY = 'thoughtdag.canvasLayout';
const DEFAULTS: CanvasLayoutOptions = { method: 'chains', direction: 'vertical', density: 'standard', route: 'curve' };
function initialOptions(): CanvasLayoutOptions {
  let stored: Partial<CanvasLayoutOptions> = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* Use defaults. */ }
  const state = useStore.getState();
  const first = state.nodes.find((node) => state.selectedNodeIds.includes(node.id) && node.data.stepKind !== 'frame')
    ?? state.nodes.find((node) => node.data.stepKind !== 'frame');
  return {
    method: ['manual', 'chains', 'layers'].includes(stored.method ?? '') ? stored.method! : DEFAULTS.method,
    direction: first?.data.layoutDirection ?? (stored.direction === 'horizontal' ? 'horizontal' : 'vertical'),
    density: ['compact', 'standard', 'relaxed'].includes(stored.density ?? '') ? stored.density! : DEFAULTS.density,
    route: (first?.data.edgeRouteDefault ?? stored.route) === 'orthogonal' ? 'orthogonal' : 'curve',
  };
}

export default function CanvasLayoutPanel({ flow: rf }: { flow: ReactFlowInstance<ThoughtNode, ThoughtEdge> }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedIds = useStore((s) => s.selectedNodeIds);
  const draftKey = `canvas-layout:${useProjects((state) => state.activeId)}`;
  const panel = useRef<HTMLDivElement>(null);
  const panelPosition = useCanvasPanelPosition();
  const originalViewport = useRef(rf.getViewport());
  const [options, setOptions] = useState(() => {
    try {
      const draft = JSON.parse(useUiStore.getState().drafts[draftKey] ?? 'null');
      if (draft && ['manual', 'chains', 'layers'].includes(draft.method) && ['vertical', 'horizontal'].includes(draft.direction)
        && ['compact', 'standard', 'relaxed'].includes(draft.density) && ['auto', 'curve', 'orthogonal'].includes(draft.route)) {
        return { ...draft, route: draft.route === 'orthogonal' ? 'orthogonal' : 'curve' } as CanvasLayoutOptions;
      }
    } catch { /* Ignore obsolete session drafts. */ }
    return initialOptions();
  });
  const [scope, setScope] = useState<'all' | 'selection'>(selectedIds.length > 1 ? 'selection' : 'all');
  const [error, setError] = useState<string>();
  const ids = scope === 'selection' ? selectedIds : undefined;
  const result = useMemo(() => planCanvasLayout(nodes, edges, options, ids), [nodes, edges, options, ids]);
  const close = () => {
    useCanvasEditing.getState().setLayoutOpen(false);
    void rf.setViewport(originalViewport.current, { duration: 150 });
  };
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); close(); };
  useDismissableLayer({ open: true, refs: [panel], onDismiss: cancel, dismissOnOutside: false });
  useEffect(() => () => useCanvasEditing.getState().setLayoutPreview(null), []);
  const change = <K extends keyof CanvasLayoutOptions>(key: K, value: CanvasLayoutOptions[K]) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    useUiStore.getState().setDraft(draftKey, JSON.stringify(next), true);
    setError(undefined);
    useCanvasEditing.getState().setLayoutPreview(null);
  };
  const show = (planned: ThoughtNode[], reservePanel = true) => {
    const shown = ids ? planned.filter((node) => ids.includes(node.id)) : planned;
    if (!shown.length) return;
    const bounds = nodesRect(shown);
    if (!bounds) return;
    const canvas = document.querySelector<HTMLElement>('.react-flow');
    if (reservePanel && canvas && panel.current) {
      const { x, y, width, height } = canvasToolViewport(canvas, panel.current);
      const zoom = Math.max(0.04, Math.min(1, (width - 48) / bounds.width, (height - 32) / bounds.height));
      void rf.setViewport({ x: x + width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: y + height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }, { duration: 250 });
    } else void rf.fitBounds(bounds, { duration: 250, padding: 0.22 });
  };
  const preview = () => {
    if (result.error) { setError(result.error); return; }
    setError(undefined);
    useCanvasEditing.getState().setLayoutPreview(result.nodes);
    show(result.nodes);
  };
  const apply = () => {
    const applied = useStore.getState().applyCanvasLayout(options, ids);
    if (!applied.ok) { setError(applied.error); return; }
    try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* Graph preferences are still saved. */ }
    useUiStore.getState().setDraft(draftKey, '');
    useCanvasEditing.getState().setLayoutOpen(false);
    show(useStore.getState().nodes, false);
  };
  const errorMessage = t(error === 'grouped-nodes' ? 'canvasLayout.groupBlocked'
    : error === 'empty-selection' ? 'canvasLayout.emptySelection' : error === 'cycle' ? 'canvasLayout.cycleBlocked'
    : error === 'obstacle-conflict' ? 'canvasLayout.obstacleBlocked' : 'canvasLayout.boundaryBlocked');
  return <div ref={panel} style={panelPosition} className="canvas-tool-panel canvas-layout-panel nodrag nopan nowheel" role="dialog" aria-labelledby="canvas-layout-title" data-canvas-layout-panel
    onKeyDown={(event) => { if (event.key !== 'Escape' || isImeComposing(event)) event.stopPropagation(); }}>
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 id="canvas-layout-title" className="text-sm font-medium">{t('canvasLayout.title')}</h2>
      <button type="button" onClick={close} className="p-1 rounded-control hover:bg-wash" aria-label={t('common.close')}><X size={16} /></button>
    </div>
    <div className="canvas-layout-fields">
    <label>{t('canvasLayout.scope')}<select value={scope} data-layout-scope onChange={(event) => {
      setScope(event.target.value as typeof scope); setError(undefined); useCanvasEditing.getState().setLayoutPreview(null);
    }}><option value="all">{t('canvasLayout.all')}</option><option value="selection" disabled={!selectedIds.length}>{t('canvasLayout.selection')}</option></select></label>
    <label>{t('canvasLayout.method')}<select value={options.method} data-layout-method onChange={(event) => change('method', event.target.value as CanvasLayoutOptions['method'])}>
      <option value="manual">{t('canvasLayout.manual')}</option><option value="chains">{t('canvasLayout.chains')}</option><option value="layers">{t('canvasLayout.layers')}</option>
    </select></label>
    <label>{t('canvasLayout.direction')}<select value={options.direction} data-layout-direction onChange={(event) => change('direction', event.target.value as CanvasLayoutOptions['direction'])}>
      <option value="vertical">{t('canvasLayout.vertical')}</option><option value="horizontal">{t('canvasLayout.horizontal')}</option>
    </select></label>
    <label>{t('canvasLayout.density')}<select value={options.density} disabled={options.method === 'manual'} data-layout-density onChange={(event) => change('density', event.target.value as CanvasLayoutOptions['density'])}>
      <option value="compact">{t('canvasLayout.compact')}</option><option value="standard">{t('canvasLayout.standard')}</option><option value="relaxed">{t('canvasLayout.relaxed')}</option>
    </select></label>
    <label>{t('canvasLayout.route')}<select value={options.route} data-layout-route onChange={(event) => change('route', event.target.value as CanvasLayoutOptions['route'])}>
      <option value="curve">{t('canvasLayout.curve')}</option><option value="orthogonal">{t('canvasLayout.orthogonal')}</option>
    </select></label>
    {error && <p className="text-xs text-red-600" role="alert">{errorMessage}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
      <button type="button" className="px-3 py-1.5 rounded-control border border-line hover:bg-wash text-xs" onClick={cancel} data-layout-cancel>{t('canvasLayout.cancel')}</button>
      <button type="button" className="px-3 py-1.5 rounded-control border border-line hover:bg-wash text-xs" onClick={preview} data-layout-preview>{t('canvasLayout.preview')}</button>
      <button type="button" className="px-3 py-1.5 rounded-control bg-action text-white text-xs hover:bg-action-strong" onClick={apply} data-layout-apply>{t('canvasLayout.apply')}</button>
    </div>
  </div>;
}
