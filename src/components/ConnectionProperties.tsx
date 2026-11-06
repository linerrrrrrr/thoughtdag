import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, LocateFixed, LockKeyhole, Tag, Trash2 } from 'lucide-react';
import type { ThoughtEdge } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { applyBatchEdgeSettings, edgeEditRestriction, readEdgeSettings, type EdgeEditSettings, type EdgeEditError } from '../lib/edge-edit';
import { useInlineEditDismiss } from '../lib/use-inline-edit-dismiss';
import { confirmDialog, useUiStore } from '../lib/ui-store';
import { getNodeNameSource } from '../lib/node-display-name';
import { useT, fmt, type MessageKey } from '../i18n';
import { isImeComposing } from '../utils';
import { handleCanvasPanelKeyDown } from '../lib/canvas-shortcuts';
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

function ConnectionForm({ selected, onLocateNode }: ConnectionPropertiesProps) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const [error, setError] = useState<string | null>(null);
  const labelEditor = useRef<HTMLDivElement>(null);
  const labelHistory = useRef(false);
  // Keep the raw input while typing so persisted whitespace normalization
  // does not swallow the spaces between words. The graph is always current.
  const [labelInput, setLabelInput] = useState<{ text: string; saved: string } | null>(null);
  const idsKey = JSON.stringify(selected.map(edge => edge.id).sort());
  // Identity follows the selection, not the live property updates.
  const ids = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const multiple = ids.length > 1;
  const continuationCheck = useMemo(() => applyBatchEdgeSettings(nodes, edges, ids, { relation: 'continue' }), [nodes, edges, ids]);
  const restricted = selected.some(edge => edgeEditRestriction(edge, nodes));
  const single = selected.length === 1 ? selected[0] : undefined;
  const restriction = single ? edgeEditRestriction(single, nodes) : null;
  const restrictionText = restriction ? restrictionKeys[restriction] : null;
  const finishLabel = () => {
    if (labelHistory.current) {
      labelHistory.current = false;
      useStore.getState().pushHistory();
    }
    setLabelInput(null);
  };
  const dismissLabel = useInlineEditDismiss({ active: labelInput !== null, ref: labelEditor,
    onOutside: finishLabel, onCancel: finishLabel });
  useEffect(() => {
    // A programmatic selection/card change also finishes the typing step.
    return () => { if (labelHistory.current) useStore.getState().pushHistory(); };
  }, []);

  const message = (code: string) => code in errorKeys ? t(errorKeys[code as EdgeEditError]) : code;
  const change = (patch: ConnectionPatch) => {
    finishLabel();
    const saved = useStore.getState().updateSelectedEdges(ids, patch);
    setError(saved.ok ? null : saved.error ? message(saved.error) : t('edgeEditor.error.saveFailed'));
  };
  const changeLabel = (text: string) => {
    const state = useStore.getState();
    if (!labelHistory.current) state.pushHistory();
    const saved = state.updateSelectedEdges(ids, { label: text }, { recordHistory: false });
    if (saved.ok) labelHistory.current = true;
    setLabelInput({ text, saved: text.replace(/\s+/g, ' ').trim() });
    setError(saved.ok ? null : saved.error ? message(saved.error) : t('edgeEditor.error.saveFailed'));
  };
  const value = <K extends keyof EdgeEditSettings>(key: K): EdgeEditSettings[K] | '' => {
    const values = selected.map(edge => readEdgeSettings(edge)[key]);
    return values.every(item => item === values[0]) ? values[0] : '';
  };
  const routes = selected.map(edge => {
    const route = readEdgeSettings(edge).route;
    const effective = route === 'inherit' ? nodes.find(node => node.id === edge.source)?.data.edgeRouteDefault : route;
    return effective === 'orthogonal' ? 'orthogonal' : 'curve';
  });
  const routeValue = routes.every(route => route === routes[0]) ? routes[0] : '';
  const relationValue = value('relation');
  const mixedLabels = selected.some(edge => readEdgeSettings(edge).label !== readEdgeSettings(selected[0]).label);
  const storedLabel = value('label');
  const mixed = <span className="edge-inspector-mixed">{t('selection.mixedValue')}</span>;
  const source = nodes.find(node => node.id === single?.source), target = nodes.find(node => node.id === single?.target);
  const name = (node: typeof source) => node ? getNodeNameSource(node.data, t('edgeEditor.unnamedNode')) : t('edgeEditor.missingNode');

  return <div className="edge-inspector" data-connection-properties data-selection-section="edges" onKeyDown={handleCanvasPanelKeyDown}>
    <div className="edge-inspector-body" data-edge-inspector-fields={!multiple ? '' : undefined} data-batch-edge-inspector-fields={multiple ? '' : undefined}>
      {single && <div className="edge-inspector-endpoints">
        {([{ node: source, label: 'edgeEditor.source', value: 'source' }, { node: target, label: 'edgeEditor.target', value: 'target' }] as const).map(({ node, label, value }, index) => <div key={value}>
          {index === 1 && <ArrowDown size={13} className="edge-inspector-direction" aria-hidden="true" />}
          <button type="button" disabled={!node} onClick={() => { if (node) onLocateNode(node.id); }}
            className="edge-inspector-endpoint" data-tooltip={fmt(t('edgeEditor.locateNode'), { name: name(node) })} data-edge-locate={value}>
            <span className="edge-inspector-endpoint-label">{t(label)}</span><span className="edge-inspector-endpoint-name">{name(node)}</span><LocateFixed size={14} aria-hidden="true" />
          </button>
        </div>)}
      </div>}
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.relation')}{!restricted && !relationValue && mixed}</legend>
        {restricted ? <div className="edge-inspector-fixed-purpose"><LockKeyhole size={16} aria-hidden="true" />
          <div><strong>{t(restrictionText ? restrictionText[0] : 'selection.keepEach')}</strong>
            <p>{t(restrictionText ? restrictionText[1] : 'selection.restrictedEdges')}</p></div>
        </div> : <>
          <EdgeRelationOptions batch={multiple} value={relationValue} canContinue={continuationCheck.ok} onChange={relation => change({ relation })} />
          {!continuationCheck.ok && <p className="edge-inspector-hint">{message(continuationCheck.error)}</p>}
        </>}
      </fieldset>
      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.route')}{!routeValue && mixed}</legend>
        <EdgeRouteOptions batch={multiple} value={routeValue} onChange={route => change({ route })} />
      </fieldset>
      <div ref={labelEditor} onBlur={dismissLabel.onBlur} className="edge-inspector-note-section">
        <label className="edge-inspector-note"><span><Tag size={13} aria-hidden="true" />{t('edgeEditor.label')}{mixedLabels && mixed}</span>
          <input data-connection-label data-edge-label={!multiple ? '' : undefined} data-batch-edge-label={multiple ? '' : undefined}
            value={labelInput?.saved === storedLabel ? labelInput.text : storedLabel} maxLength={120}
            placeholder={t(mixedLabels ? 'selection.keepEach' : 'edgeEditor.labelPlaceholder')}
            onFocus={() => setLabelInput({ text: storedLabel, saved: storedLabel })}
            onChange={event => changeLabel(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !isImeComposing(event)) { event.preventDefault(); finishLabel(); }
            }} />
        </label>
        <div className="edge-inspector-note-actions">
          <button type="button" className="edge-inspector-inherit" data-connection-clear-label data-batch-edge-clear-label={multiple ? '' : undefined}
            onClick={() => change({ label: '' })}>{t('selection.clearLabels')}</button>
        </div>
      </div>
    </div>
    <footer className="edge-inspector-footer">
      {error && <p role="alert" className="edge-inspector-error" data-edge-error>{error}</p>}
      <div className="edge-inspector-actions">
        <button type="button" className="edge-inspector-delete object-action-danger" data-connection-delete data-edge-delete={!multiple ? '' : undefined}
          onClick={() => {
            void confirmDialog({ title: t('selection.deleteEdges'), message: fmt(t('selection.deleteEdgesConfirm'), { n: ids.length }), confirmLabel: t('common.delete'), danger: true })
              .then(ok => { if (ok) useStore.getState().deleteEdges(ids); });
          }}><Trash2 strokeWidth={1.75} size={14} aria-hidden="true" />{t('common.delete')}</button>
      </div>
    </footer>
  </div>;
}

/** Single and batch selections share the same immediate, validated updates. */
export default function ConnectionProperties({ selected, onLocateNode }: ConnectionPropertiesProps) {
  const project = useProjects(state => state.activeId);
  const idsKey = JSON.stringify(selected.map(edge => edge.id).sort());
  useLayoutEffect(() => {
    const state = useUiStore.getState();
    const ids = JSON.parse(idsKey) as string[];
    // Opening the new inspector must never apply or preview an obsolete draft.
    const keys = [`selection-edges:${project}:${idsKey}`, `batch-edge-editor:${project}:${idsKey}`,
      ...(ids.length === 1 ? [`edge-editor:${project}:${ids[0]}`] : [])];
    for (const key of keys) if (state.drafts[key] !== undefined) state.setDraft(key, '');
  }, [project, idsKey]);
  if (!selected.length) return null;
  return <ConnectionForm key={`${project}:${idsKey}`} selected={selected} onLocateNode={onLocateNode} />;
}
