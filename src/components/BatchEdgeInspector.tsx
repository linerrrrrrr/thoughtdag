import { useId, useMemo, useRef, useState } from 'react';
import { LockKeyhole, RotateCcw, Tag, Trash2, X } from 'lucide-react';
import type { ThoughtEdge } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { applyBatchEdgeSettings, edgeEditRestriction, readEdgeSettings, type EdgeEditSettings, type EdgeEditError } from '../lib/edge-edit';
import { useSessionDraft } from '../lib/use-session-draft';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useCanvasEditing } from '../lib/canvas-editing';
import { confirmDialog, useUiStore } from '../lib/ui-store';
import { useT, fmt } from '../i18n';
import { isImeComposing } from '../utils';
import { EdgeRelationOptions, EdgeRouteOptions } from './EdgeInspectorControls';
import './EdgeInspector.css';

function BatchEdgeForm({ selected, draftKey }: { selected: ThoughtEdge[]; draftKey: string }) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const position = useCanvasPanelPosition();
  const [text, setText] = useSessionDraft(draftKey, '{}');
  const patch = useMemo(() => JSON.parse(text) as Partial<EdgeEditSettings>, [text]);
  const [error, setError] = useState<string | null>(null);
  const ids = selected.map(edge => edge.id);
  const dirty = Object.keys(patch).length > 0;
  const result = applyBatchEdgeSettings(nodes, edges, ids, patch);
  const continuationCheck = applyBatchEdgeSettings(nodes, edges, ids, { ...patch, relation: 'continue' });
  const restricted = selected.some(edge => edgeEditRestriction(edge, nodes));
  const clear = () => { useUiStore.getState().setDraft(draftKey, ''); setError(null); };
  const close = () => {
    useCanvasEditing.getState().setSelectionRegion(null);
    useStore.setState(state => ({ edges: state.edges.map(edge => ({ ...edge, selected: false })) }));
  };
  const { isTopLayer } = useDismissableLayer({ open: true, refs: [ref], dismissOnOutside: false,
    onDismiss: () => { if (dirty) clear(); else close(); } });
  const change = <K extends keyof EdgeEditSettings>(key: K, value: EdgeEditSettings[K] | undefined) => {
    const next = { ...patch, [key]: value };
    if (value === undefined) delete next[key];
    setText(JSON.stringify(next)); setError(null);
  };
  const value = <K extends keyof EdgeEditSettings>(key: K): EdgeEditSettings[K] | '' => {
    if (patch[key] !== undefined) return patch[key];
    const values = selected.map(edge => readEdgeSettings(edge)[key]);
    return values.every(item => item === values[0]) ? values[0] : '';
  };
  const routes = selected.map(edge => {
    const route = patch.route ?? readEdgeSettings(edge).route;
    const effective = route === 'inherit' ? nodes.find(node => node.id === edge.source)?.data.edgeRouteDefault : route;
    return effective === 'orthogonal' ? 'orthogonal' : 'curve';
  });
  const routeValue = routes.every(route => route === routes[0]) ? routes[0] : '';
  const relationValue = value('relation');
  const mixedLabels = patch.label === undefined && selected.some(edge => readEdgeSettings(edge).label !== readEdgeSettings(selected[0]).label);
  const message = (code: string) => t(`edgeEditor.error.${code === 'missing-node' ? 'missingNode' : code === 'self-loop' ? 'selfLoop' : code === 'invalid-settings' ? 'invalidSettings' : code as Exclude<EdgeEditError, 'missing-node' | 'self-loop' | 'invalid-settings'>}`);
  const apply = () => {
    const saved = useStore.getState().updateSelectedEdges(ids, patch);
    if (saved.ok) clear(); else setError(saved.error ? message(saved.error) : t('edgeEditor.error.saveFailed'));
  };
  const resetField = (field: keyof EdgeEditSettings) => patch[field] !== undefined && <button type="button"
    className="edge-inspector-inherit" data-batch-edge-reset={field} onClick={() => change(field, undefined)}>
    <RotateCcw size={12} aria-hidden="true" />{t('selection.keepEach')}
  </button>;
  const mixed = <span className="edge-inspector-mixed">{t('selection.mixedValue')}</span>;
  return <aside ref={ref} style={position} className="canvas-tool-panel edge-inspector nodrag nopan nowheel" data-batch-edge-inspector aria-labelledby={titleId}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (isImeComposing(event)) { event.stopPropagation(); return; }
      if (event.key === 'Escape') return;
      event.stopPropagation();
      if (isTopLayer() && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && dirty && result.ok) { event.preventDefault(); apply(); }
    }}>
    <header className="edge-inspector-header"><div><h2 id={titleId}>{t('selection.editEdges')}</h2><p className="edge-inspector-summary">{fmt(t('selection.edgesSelected'), { n: selected.length })}</p></div>
      <button type="button" className="edge-inspector-icon" onClick={close} title={t('common.close')} aria-label={t('common.close')}><X size={17} /></button>
    </header>
    <div className="edge-inspector-body" data-batch-edge-inspector-fields>
      <p className="edge-inspector-batch-hint">{t('selection.batchEdgeHint')}</p>
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.relation')}{!restricted && !relationValue && mixed}</legend>
        {restricted ? <div className="edge-inspector-fixed-purpose">
          <LockKeyhole size={16} aria-hidden="true" /><div><strong>{t('selection.keepEach')}</strong><p>{t('selection.restrictedEdges')}</p></div>
        </div> : <>
          <EdgeRelationOptions batch value={relationValue} canContinue={continuationCheck.ok} onChange={relation => change('relation', relation)} />
          {!continuationCheck.ok && <p className="edge-inspector-hint">{message(continuationCheck.error)}</p>}
        </>}
        {resetField('relation')}
      </fieldset>
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.route')}{!routeValue && mixed}</legend>
        <EdgeRouteOptions batch value={routeValue} onChange={route => change('route', route)} />
        {resetField('route')}
      </fieldset>
      <div className="edge-inspector-note-section">
        <label className="edge-inspector-note"><span><Tag size={13} aria-hidden="true" />{t('edgeEditor.label')}{mixedLabels && mixed}</span>
          <input data-batch-edge-label value={value('label')} maxLength={120}
            placeholder={t(mixedLabels ? 'selection.keepEach' : 'edgeEditor.labelPlaceholder')} onChange={event => change('label', event.target.value)} />
        </label>
        <div className="edge-inspector-note-actions">
          <button type="button" className="edge-inspector-inherit" data-batch-edge-clear-label onClick={() => change('label', '')}>{t('selection.clearLabels')}</button>
          {resetField('label')}
        </div>
      </div>
    </div>
    <footer className="edge-inspector-footer">
      {(error || !result.ok) && <p role="alert" className="edge-inspector-error">{error || (!result.ok && message(result.error))}</p>}
      <div className="edge-inspector-actions">
        <button type="button" className="edge-inspector-delete" onClick={() => {
          void confirmDialog({ title: t('selection.deleteEdges'), message: fmt(t('selection.deleteEdgesConfirm'), { n: ids.length }), confirmLabel: t('common.delete'), danger: true })
            .then(ok => { if (ok) { useStore.getState().deleteEdges(ids); clear(); } });
        }}><Trash2 size={14} aria-hidden="true" />{t('common.delete')}</button>
        <button type="button" className="edge-inspector-cancel" disabled={!dirty} onClick={clear}>{t('common.cancel')}</button>
        <button type="button" data-batch-edge-apply className="edge-inspector-apply" disabled={!dirty || !result.ok} onClick={apply}>{t('edgeEditor.apply')}</button>
      </div>
    </footer>
  </aside>;
}

export default function BatchEdgeInspector({ selected }: { selected: ThoughtEdge[] }) {
  const project = useProjects(state => state.activeId);
  const draftKey = `batch-edge-editor:${project}:${JSON.stringify(selected.map(edge => edge.id).sort())}`;
  return <BatchEdgeForm key={draftKey} selected={selected} draftKey={draftKey} />;
}
