import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ArrowDown, LocateFixed, LockKeyhole, RotateCcw, Tag, Trash2 } from 'lucide-react';
import type { ThoughtEdge } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { applyBatchEdgeSettings, edgeEditRestriction, readEdgeSettings, type EdgeEditSettings, type EdgeEditError } from '../lib/edge-edit';
import { useSessionDraft } from '../lib/use-session-draft';
import { useSelectionDraftBoundary } from '../lib/selection-panel-context';
import { useCanvasEditing } from '../lib/canvas-editing';
import { confirmDialog, useUiStore } from '../lib/ui-store';
import { getNodeNameSource } from '../lib/node-display-name';
import { useT, fmt, type MessageKey } from '../i18n';
import { isImeComposing } from '../utils';
import { EdgeRelationOptions, EdgeRouteOptions } from './EdgeInspectorControls';
import './EdgeInspector.css';

type ConnectionPropertiesProps = { selected: ThoughtEdge[]; onLocateNode: (nodeId: string) => void };
type ConnectionPatch = Partial<EdgeEditSettings>;
const errorKeys: Record<EdgeEditError, MessageKey> = {
  'missing-node': 'edgeEditor.error.missingNode', 'self-loop': 'edgeEditor.error.selfLoop',
  cycle: 'edgeEditor.error.cycle', restricted: 'edgeEditor.error.restricted', 'invalid-settings': 'edgeEditor.error.invalidSettings',
};
const restrictionKeys = {
  material: ['edgeEditor.material', 'edgeEditor.materialHint'],
  branch: ['edgeEditor.branch', 'edgeEditor.branchHint'],
  watch: ['edgeEditor.watch', 'edgeEditor.watchHint'],
  frame: ['edgeEditor.frame', 'edgeEditor.frameHint'],
} as const;

/** Unknown legacy fields never become changes to connection semantics. */
function readPatch(text: string): ConnectionPatch {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') return {};
    return {
      ...(['continue', 'reference'].includes(value.relation) ? { relation: value.relation } : {}),
      ...(['inherit', 'auto', 'curve', 'orthogonal'].includes(value.route) ? { route: value.route } : {}),
      ...(typeof value.label === 'string' ? { label: value.label } : {}),
    };
  } catch { return {}; }
}

function ConnectionForm({ selected, onLocateNode, draftKey }: ConnectionPropertiesProps & { draftKey: string }) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const setEdgePreviews = useCanvasEditing(state => state.setEdgePreviews);
  const [text, setText] = useSessionDraft(draftKey, '{}');
  const patch = useMemo(() => readPatch(text), [text]);
  const [error, setError] = useState<string | null>(null);
  const idsKey = JSON.stringify(selected.map(edge => edge.id).sort());
  // The parent may render for preview changes; identity follows the selection.
  const ids = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const multiple = ids.length > 1;
  const dirty = Object.keys(patch).length > 0;
  const result = useMemo(() => applyBatchEdgeSettings(nodes, edges, ids, patch), [nodes, edges, ids, patch]);
  const continuationCheck = useMemo(() => applyBatchEdgeSettings(nodes, edges, ids, { ...patch, relation: 'continue' }), [nodes, edges, ids, patch]);
  const restricted = selected.some(edge => edgeEditRestriction(edge, nodes));
  const single = selected.length === 1 ? selected[0] : undefined;
  const restriction = single ? edgeEditRestriction(single, nodes) : null;
  const restrictionText = restriction ? restrictionKeys[restriction] : null;
  const clear = () => {
    useUiStore.getState().setDraft(draftKey, '');
    setError(null);
    setEdgePreviews(null);
  };
  useSelectionDraftBoundary(dirty, clear);

  useEffect(() => {
    const selectedIds = new Set(ids);
    setEdgePreviews(dirty && result.ok ? result.edges.filter(edge => selectedIds.has(edge.id)) : null);
    return () => setEdgePreviews(null);
  }, [dirty, result, ids, setEdgePreviews]);

  const change = <K extends keyof EdgeEditSettings>(key: K, value: EdgeEditSettings[K] | undefined) => {
    const next = { ...patch, [key]: value };
    if (value === undefined || selected.every(edge => readEdgeSettings(edge)[key] === value)) delete next[key];
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
  const message = (code: string) => code in errorKeys ? t(errorKeys[code as EdgeEditError]) : code;
  const apply = () => {
    const saved = useStore.getState().updateSelectedEdges(ids, patch);
    if (saved.ok) clear(); else setError(saved.error ? message(saved.error) : t('edgeEditor.error.saveFailed'));
  };
  const resetField = (field: keyof EdgeEditSettings) => patch[field] !== undefined && <button type="button"
    className="edge-inspector-inherit" data-connection-reset={field}
    data-edge-reset={!multiple ? field : undefined} data-batch-edge-reset={multiple ? field : undefined}
    onClick={() => change(field, undefined)}><RotateCcw size={12} aria-hidden="true" />{t('selection.keepEach')}</button>;
  const mixed = <span className="edge-inspector-mixed">{t('selection.mixedValue')}</span>;
  const source = nodes.find(node => node.id === single?.source), target = nodes.find(node => node.id === single?.target);
  const name = (node: typeof source) => node ? getNodeNameSource(node.data, t('edgeEditor.unnamedNode')) : t('edgeEditor.missingNode');

  return <div className="edge-inspector" data-connection-properties data-selection-section="edges" onKeyDown={event => {
    if (isImeComposing(event)) { event.stopPropagation(); return; }
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && dirty && result.ok) { event.preventDefault(); apply(); }
  }}>
    <div className="edge-inspector-body" data-edge-inspector-fields={!multiple ? '' : undefined} data-batch-edge-inspector-fields={multiple ? '' : undefined}>
      {single && <div className="edge-inspector-endpoints">
        {([{ node: source, label: 'edgeEditor.source', value: 'source' }, { node: target, label: 'edgeEditor.target', value: 'target' }] as const).map(({ node, label, value }, index) => <div key={value}>
          {index === 1 && <ArrowDown size={13} className="edge-inspector-direction" aria-hidden="true" />}
          <button type="button" disabled={!node} onClick={() => { if (node) onLocateNode(node.id); }}
            className="edge-inspector-endpoint" title={fmt(t('edgeEditor.locateNode'), { name: name(node) })} data-edge-locate={value}>
            <span className="edge-inspector-endpoint-label">{t(label)}</span><span className="edge-inspector-endpoint-name">{name(node)}</span><LocateFixed size={14} aria-hidden="true" />
          </button>
        </div>)}
      </div>}
      <p className="edge-inspector-batch-hint">{t('selection.batchEdgeHint')}</p>
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.relation')}{!restricted && !relationValue && mixed}</legend>
        {restricted ? <div className="edge-inspector-fixed-purpose"><LockKeyhole size={16} aria-hidden="true" />
          <div><strong>{t(restrictionText ? restrictionText[0] : 'selection.keepEach')}</strong>
            <p>{t(restrictionText ? restrictionText[1] : 'selection.restrictedEdges')}</p></div>
        </div> : <>
          <EdgeRelationOptions batch={multiple} value={relationValue} canContinue={continuationCheck.ok} onChange={relation => change('relation', relation)} />
          {!continuationCheck.ok && <p className="edge-inspector-hint">{message(continuationCheck.error)}</p>}
        </>}
        {resetField('relation')}
      </fieldset>
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.route')}{!routeValue && mixed}</legend>
        <EdgeRouteOptions batch={multiple} value={routeValue} onChange={route => change('route', route)} />
        {resetField('route')}
      </fieldset>
      <div className="edge-inspector-note-section">
        <label className="edge-inspector-note"><span><Tag size={13} aria-hidden="true" />{t('edgeEditor.label')}{mixedLabels && mixed}</span>
          <input data-connection-label data-edge-label={!multiple ? '' : undefined} data-batch-edge-label={multiple ? '' : undefined}
            value={value('label')} maxLength={120} placeholder={t(mixedLabels ? 'selection.keepEach' : 'edgeEditor.labelPlaceholder')}
            onChange={event => change('label', event.target.value)} />
        </label>
        <div className="edge-inspector-note-actions">
          <button type="button" className="edge-inspector-inherit" data-connection-clear-label data-batch-edge-clear-label={multiple ? '' : undefined}
            onClick={() => change('label', '')}>{t('selection.clearLabels')}</button>
          {resetField('label')}
        </div>
      </div>
    </div>
    <footer className="edge-inspector-footer">
      {(error || !result.ok) && <p role="alert" className="edge-inspector-error" data-edge-error>{error || (!result.ok && message(result.error))}</p>}
      <div className="edge-inspector-actions">
        <button type="button" className="edge-inspector-delete object-action-danger" data-connection-delete data-edge-delete={!multiple ? '' : undefined}
          onClick={() => {
            void confirmDialog({ title: t('selection.deleteEdges'), message: fmt(t('selection.deleteEdgesConfirm'), { n: ids.length }), confirmLabel: t('common.delete'), danger: true })
              .then(ok => { if (ok) { useStore.getState().deleteEdges(ids); clear(); } });
          }}><Trash2 strokeWidth={1.75} size={14} aria-hidden="true" />{t('common.delete')}</button>
        <button type="button" className="edge-inspector-cancel" data-connection-cancel data-edge-cancel={!multiple ? '' : undefined} disabled={!dirty} onClick={clear}>{t('common.cancel')}</button>
        <button type="button" className="edge-inspector-apply" data-connection-apply data-edge-apply={!multiple ? '' : undefined} data-batch-edge-apply={multiple ? '' : undefined}
          disabled={!dirty || !result.ok} onClick={apply}>{t('edgeEditor.apply')}</button>
      </div>
    </footer>
  </div>;
}

/** Cardinality and input method share the same session draft and commit path. */
export default function ConnectionProperties({ selected, onLocateNode }: ConnectionPropertiesProps) {
  const project = useProjects(state => state.activeId);
  const ids = selected.map(edge => edge.id).sort();
  const draftKey = `selection-edges:${project}:${JSON.stringify(ids)}`;
  useLayoutEffect(() => {
    const state = useUiStore.getState();
    const batchKey = `batch-edge-editor:${project}:${JSON.stringify(selected.map(edge => edge.id).sort())}`;
    const singleKey = selected.length === 1 ? `edge-editor:${project}:${selected[0].id}` : null;
    if (state.drafts[draftKey] === undefined) {
      let legacy = readPatch(state.drafts[batchKey] ?? '{}');
      if (singleKey && state.drafts[singleKey] !== undefined) {
        const old = readPatch(state.drafts[singleKey]);
        const stored = readEdgeSettings(selected[0]);
        const changes = Object.fromEntries(Object.entries(old).filter(([key, value]) => stored[key as keyof EdgeEditSettings] !== value));
        if (Object.keys(changes).length) legacy = changes;
      }
      if (Object.keys(legacy).length) state.setDraft(draftKey, JSON.stringify(legacy));
    }
    // A cleared canonical draft must not resurrect an obsolete editor draft.
    if (state.drafts[batchKey] !== undefined) state.setDraft(batchKey, '');
    if (singleKey && state.drafts[singleKey] !== undefined) state.setDraft(singleKey, '');
  }, [project, selected, draftKey]);
  if (!selected.length) return null;
  return <ConnectionForm key={draftKey} selected={selected} onLocateNode={onLocateNode} draftKey={draftKey} />;
}
