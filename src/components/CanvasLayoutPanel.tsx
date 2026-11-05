import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { Loader2, X } from 'lucide-react';
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

const actionClass = 'min-h-8 px-2.5 rounded-control text-control text-ink-muted hover:bg-wash transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';
type LayoutDraft = CanvasLayoutOptions & { scope: 'all' | 'selection' };
export interface CanvasLayoutPanelHandle { close: () => void }

function LayoutChoices<V extends string>({ name, label, value, choices, disabled, onChange }: {
  name: string;
  label: string;
  value: V;
  choices: { value: V; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange: (value: V) => void;
}) {
  const groupName = useId();
  return <fieldset className="canvas-layout-field" disabled={disabled} {...{ [`data-layout-${name}`]: '' }}>
    <legend>{label}</legend>
    <div className="canvas-layout-choices" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
      {choices.map((choice) => <label key={choice.value} className="canvas-layout-choice">
        <input type="radio" name={groupName} value={choice.value} checked={value === choice.value}
          disabled={choice.disabled} onChange={() => onChange(choice.value)} />
        <span>{choice.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

export default function CanvasLayoutPanel({ flow: rf, ref }: {
  flow: ReactFlowInstance<ThoughtNode, ThoughtEdge>;
  ref?: Ref<CanvasLayoutPanelHandle>;
}) {
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
  const [draft, setDraft] = useState<LayoutDraft>(() => {
    const defaultScope = selectedIds.length ? 'selection' : 'all';
    try {
      const draft = JSON.parse(useUiStore.getState().drafts[draftKey] ?? 'null');
      if (draft && ['manual', 'chains', 'layers'].includes(draft.method) && ['vertical', 'horizontal'].includes(draft.direction)
        && ['compact', 'standard', 'relaxed'].includes(draft.density) && ['auto', 'curve', 'orthogonal'].includes(draft.route)) {
        return { method: draft.method, direction: draft.direction, density: draft.density,
          route: draft.route === 'orthogonal' ? 'orthogonal' : 'curve',
          scope: draft.scope === 'all' || draft.scope === 'selection' ? draft.scope : defaultScope };
      }
    } catch { /* Ignore obsolete session drafts. */ }
    return { ...readCanvasLayoutOptions(), scope: defaultScope };
  });
  const { scope, ...options } = draft;
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
  useImperativeHandle(ref, () => ({ close }));
  const cancel = () => { useUiStore.getState().setDraft(draftKey, ''); close(); };
  useDismissableLayer({ open: true, refs: [panel], onDismiss: reason => {
    cancel();
    if (reason === 'escape') restoreCanvasToolbarFocus(document.querySelector('[data-layout-entry]'));
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
  const change = <K extends keyof LayoutDraft>(key: K, value: LayoutDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
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
  const apply = async () => {
    const task = beginCanvasLayoutTask();
    if (!task) return;
    pending.current = task;
    setError(undefined);
    try {
      const applied = await useStore.getState().applyCanvasLayout(options, ids, task.isCurrent);
      if (!task.isCurrent()) return;
      if (!applied.ok) { setError(applied.error); return; }
      saveCanvasLayoutOptions(options);
      useUiStore.getState().setDraft(draftKey, '');
      useCanvasEditing.getState().setLayoutOpen(false);
      fitCanvasLayout(rf, ids);
    } catch { if (task.isCurrent()) setError('layout-failed'); }
    finally { task.finish(); if (pending.current === task) pending.current = undefined; }
  };
  const errorMessage = t(canvasLayoutErrorKey(error));
  return <div ref={panel} style={panelPosition} className="canvas-tool-panel canvas-layout-panel nodrag nopan nowheel" role="dialog" aria-labelledby="canvas-layout-title" aria-busy={busy} data-canvas-layout-panel
    onKeyDown={(event) => { if (event.key !== 'Escape' || isImeComposing(event)) event.stopPropagation(); }}>
    <div className="canvas-layout-header flex shrink-0 items-center justify-between gap-3 px-4 py-3 border-b border-line">
      <h2 id="canvas-layout-title" className="text-title font-semibold">{t('canvasLayout.title')}</h2>
      <button type="button" onClick={close} className="flex h-7 w-7 -mr-1 items-center justify-center rounded-control text-ink-muted hover:bg-wash hover:text-ink transition-colors focus-visible:outline-2 focus-visible:outline-accent" aria-label={t('common.close')}><X size={16} /></button>
    </div>
    <div className="canvas-layout-fields">
      <LayoutChoices name="scope" label={t('canvasLayout.scope')} value={scope} onChange={(value) => change('scope', value)} choices={[
        { value: 'all', label: t('canvasLayout.all') },
        { value: 'selection', label: t('canvasLayout.selection'), disabled: !selectedIds.length },
      ]} />
      <LayoutChoices name="method" label={t('canvasLayout.method')} value={options.method} onChange={(value) => change('method', value)} choices={[
        { value: 'manual', label: t('canvasLayout.manual') },
        { value: 'chains', label: t('canvasLayout.chains') },
        { value: 'layers', label: t('canvasLayout.layers') },
      ]} />
      <LayoutChoices name="direction" label={t('canvasLayout.direction')} value={options.direction} onChange={(value) => change('direction', value)} choices={[
        { value: 'vertical', label: t('canvasLayout.vertical') },
        { value: 'horizontal', label: t('canvasLayout.horizontal') },
      ]} />
      <LayoutChoices name="density" label={t('canvasLayout.density')} value={options.density} disabled={options.method === 'manual'} onChange={(value) => change('density', value)} choices={[
        { value: 'compact', label: t('canvasLayout.compact') },
        { value: 'standard', label: t('canvasLayout.standard') },
        { value: 'relaxed', label: t('canvasLayout.relaxed') },
      ]} />
      <LayoutChoices name="route" label={t('canvasLayout.route')} value={options.route} onChange={(value) => change('route', value)} choices={[
        { value: 'curve', label: t('canvasLayout.curve') },
        { value: 'orthogonal', label: t('canvasLayout.orthogonal') },
      ]} />
    {error && <p className="text-control text-red-600" role="alert">{errorMessage}</p>}
    {busy && <p className="flex items-center gap-2 text-control text-ink-muted" role="status"><Loader2 size={14} className="animate-spin" />{t('canvasLayout.busy')}</p>}
    </div>
    <div className="canvas-layout-footer flex shrink-0 flex-wrap justify-end gap-1 border-t border-line px-2 py-2">
      <button type="button" className={actionClass} onClick={cancel} data-layout-cancel>{t('canvasLayout.cancel')}</button>
      <button type="button" disabled={busy} className={actionClass} onClick={preview} data-layout-preview>{t('canvasLayout.preview')}</button>
      <button type="button" disabled={busy} className="text-control bg-action text-white px-3 min-h-8 rounded-control hover:bg-action-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => apply()} data-layout-apply>{t('canvasLayout.apply')}</button>
    </div>
  </div>;
}
