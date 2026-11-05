import { useEffect, useRef, useState } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { LayoutGrid, Loader2, X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { useCanvasEditing } from '../lib/canvas-editing';
import { canvasLayoutInputKey, planCanvasLayout, type CanvasLayoutOptions } from '../lib/canvas-layout';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { restoreCanvasToolbarFocus } from '../lib/use-responsive-canvas-header';
import { useUiStore } from '../lib/ui-store';
import { useProjects } from '../store/projects';
import { isImeComposing } from '../utils';
import type { ThoughtNode, ThoughtEdge } from '../types';
import './CanvasLayoutPanel.css';
import { canvasToolViewport, useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { beginCanvasLayoutTask, canvasLayoutBounds, canvasLayoutErrorKey, fitCanvasLayout, readCanvasLayoutOptions, saveCanvasLayoutOptions } from '../lib/canvas-layout-preferences';

export default function CanvasLayoutPanel({ flow: rf }: { flow: ReactFlowInstance<ThoughtNode, ThoughtEdge> }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedIds = useStore((s) => s.selectedNodeIds);
  const projectId = useProjects((state) => state.activeId);
  const draftKey = `canvas-layout:${projectId}`;
  const busy = useCanvasEditing((state) => state.layoutBusy);
  const pending = useRef<ReturnType<typeof beginCanvasLayoutTask>>(undefined);
  const previewInput = useRef<string | undefined>(undefined);
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
    return readCanvasLayoutOptions();
  });
  const [scope, setScope] = useState<'all' | 'selection'>(selectedIds.length ? 'selection' : 'all');
  const [error, setError] = useState<string>();
  const ids = scope === 'selection' ? selectedIds : undefined;
  const selectionKey = [...selectedIds].sort().join('\0');
  const invalidate = () => {
    pending.current?.cancel();
    pending.current = undefined;
    previewInput.current = undefined;
    useCanvasEditing.getState().setLayoutPreview(null);
  };
  const close = () => {
    invalidate();
    useCanvasEditing.getState().setLayoutOpen(false);
    void rf.setViewport(originalViewport.current, { duration: 150 });
  };
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); close(); };
  useDismissableLayer({ open: true, refs: [panel], onDismiss: reason => {
    cancel();
    if (reason === 'escape') restoreCanvasToolbarFocus(null);
  }, dismissOnOutside: false, restoreFocus: false });
  useEffect(() => {
    pending.current?.cancel();
    pending.current = undefined;
    previewInput.current = undefined;
    useCanvasEditing.getState().setLayoutPreview(null);
  }, [selectionKey, projectId]);
  useEffect(() => {
    if (previewInput.current && previewInput.current !== canvasLayoutInputKey(nodes, edges)) {
      previewInput.current = undefined;
      useCanvasEditing.getState().setLayoutPreview(null);
    }
  }, [nodes, edges]);
  useEffect(() => () => {
    pending.current?.cancel();
    useCanvasEditing.getState().setLayoutPreview(null);
  }, []);
  const change = <K extends keyof CanvasLayoutOptions>(key: K, value: CanvasLayoutOptions[K]) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    useUiStore.getState().setDraft(draftKey, JSON.stringify(next), true);
    setError(undefined);
    invalidate();
  };
  const show = (planned: ThoughtNode[], reservePanel = true) => {
    const shown = ids ? planned.filter((node) => ids.includes(node.id)) : planned;
    if (!shown.length) return;
    const bounds = canvasLayoutBounds(shown);
    if (!bounds) return;
    const canvas = document.querySelector<HTMLElement>('.react-flow');
    if (reservePanel && canvas && panel.current) {
      const { x, y, width, height } = canvasToolViewport(canvas, panel.current);
      const zoom = Math.max(0.04, Math.min(1, (width - 48) / bounds.width, (height - 32) / bounds.height));
      void rf.setViewport({ x: x + width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: y + height / 2 - (bounds.y + bounds.height / 2) * zoom, zoom }, { duration: 250 });
    } else void rf.fitBounds(bounds, { duration: 250, padding: 0.22 });
  };
  const preview = async () => {
    const task = beginCanvasLayoutTask();
    if (!task) return;
    pending.current = task;
    const state = useStore.getState();
    const input = canvasLayoutInputKey(state.nodes, state.edges);
    let stale = false;
    const stop = useStore.subscribe((next) => {
      if (next.history !== state.history || next.historyIndex !== state.historyIndex
        || canvasLayoutInputKey(next.nodes, next.edges) !== input) stale = true;
    });
    setError(undefined);
    try {
      const result = await planCanvasLayout(state.nodes, state.edges, options, ids);
      if (!task.isCurrent()) return;
      if (stale) { setError('stale-layout'); return; }
      if (result.error) { setError(result.error); return; }
      previewInput.current = input;
      useCanvasEditing.getState().setLayoutPreview(result.nodes);
      show(result.nodes);
    } catch { if (task.isCurrent()) setError('layout-failed'); }
    finally { stop(); task.finish(); if (pending.current === task) pending.current = undefined; }
  };
  const apply = async (quick = false) => {
    const task = beginCanvasLayoutTask();
    if (!task) return;
    pending.current = task;
    setError(undefined);
    const appliedIds = quick ? (selectedIds.length ? selectedIds : undefined) : ids;
    const saved = quick ? readCanvasLayoutOptions(appliedIds) : options;
    const appliedOptions = quick && saved.method === 'manual' ? { ...saved, method: 'chains' as const } : saved;
    try {
      const applied = await useStore.getState().applyCanvasLayout(appliedOptions, appliedIds, task.isCurrent);
      if (!task.isCurrent()) return;
      if (!applied.ok) { setError(applied.error); return; }
      if (!quick) {
        saveCanvasLayoutOptions(options);
        useUiStore.getState().setDraft(draftKey, '');
      }
      useCanvasEditing.getState().setLayoutOpen(false);
      fitCanvasLayout(rf, appliedIds);
    } catch { if (task.isCurrent()) setError('layout-failed'); }
    finally { task.finish(); if (pending.current === task) pending.current = undefined; }
  };
  const errorMessage = t(canvasLayoutErrorKey(error));
  return <div ref={panel} style={panelPosition} className="canvas-tool-panel canvas-layout-panel nodrag nopan nowheel" role="dialog" aria-labelledby="canvas-layout-title" aria-busy={busy} data-canvas-layout-panel
    onKeyDown={(event) => { if (event.key !== 'Escape' || isImeComposing(event)) event.stopPropagation(); }}>
    <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 id="canvas-layout-title" className="text-sm font-medium">{t('canvasLayout.title')}</h2>
      <button type="button" onClick={close} className="p-1 rounded-control hover:bg-wash" aria-label={t('common.close')}><X size={16} /></button>
    </div>
    <div className="shrink-0 border-b border-line px-4 py-3 space-y-2">
      <button type="button" data-layout-quick disabled={busy} onClick={() => apply(true)}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-control bg-action text-white text-xs hover:bg-action-strong disabled:opacity-50 disabled:cursor-wait">
        <LayoutGrid size={14} aria-hidden="true" />{t('canvasLayout.quick')}
      </button>
      <p className="text-xs text-ink-muted leading-relaxed">{t(selectedIds.length ? 'canvasLayout.quickSelection' : 'canvasLayout.quickAll')}</p>
    </div>
    <div className="canvas-layout-fields">
    <p className="text-xs text-ink-muted leading-relaxed">{t('canvasLayout.hint')}</p>
    <label>{t('canvasLayout.scope')}<select value={scope} data-layout-scope onChange={(event) => {
      setScope(event.target.value as typeof scope); setError(undefined); invalidate();
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
    {busy && <p className="flex items-center gap-2 text-xs text-ink-muted" role="status"><Loader2 size={14} className="animate-spin" />{t('canvasLayout.busy')}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
      <button type="button" className="px-3 py-1.5 rounded-control border border-line hover:bg-wash text-xs" onClick={cancel} data-layout-cancel>{t('canvasLayout.cancel')}</button>
      <button type="button" disabled={busy} className="px-3 py-1.5 rounded-control border border-line hover:bg-wash text-xs disabled:opacity-50" onClick={preview} data-layout-preview>{t('canvasLayout.preview')}</button>
      <button type="button" disabled={busy} className="px-3 py-1.5 rounded-control bg-action text-white text-xs hover:bg-action-strong disabled:opacity-50" onClick={() => apply()} data-layout-apply>{t('canvasLayout.apply')}</button>
    </div>
  </div>;
}
