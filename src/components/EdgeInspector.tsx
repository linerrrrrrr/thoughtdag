import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, LocateFixed, LockKeyhole, Plus, Tag, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { useT, fmt, type MessageKey } from '../i18n';
import { applyEdgeSettings, edgeEditRestriction, readEdgeSettings, type EdgeEditError, type EdgeEditSettings } from '../lib/edge-edit';
import { useCanvasEditing } from '../lib/canvas-editing';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useSessionDraft } from '../lib/use-session-draft';
import { useUiStore } from '../lib/ui-store';
import { getNodeNameSource } from '../lib/node-display-name';
import { useProjects } from '../store/projects';
import type { ThoughtEdge } from '../types';
import './EdgeInspector.css';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';

export interface EdgeInspectorProps {
  edgeId: string;
  onClose: () => void;
  onLocateNode: (nodeId: string) => void;
}

const errorKeys: Record<EdgeEditError, MessageKey> = {
  'missing-node': 'edgeEditor.error.missingNode',
  'self-loop': 'edgeEditor.error.selfLoop',
  cycle: 'edgeEditor.error.cycle',
  restricted: 'edgeEditor.error.restricted',
  'invalid-settings': 'edgeEditor.error.invalidSettings',
};
const restrictionKeys = {
  material: ['edgeEditor.material', 'edgeEditor.materialHint'],
  branch: ['edgeEditor.branch', 'edgeEditor.branchHint'],
  watch: ['edgeEditor.watch', 'edgeEditor.watchHint'],
  frame: ['edgeEditor.frame', 'edgeEditor.frameHint'],
} as const;
const routes = [
  { value: 'curve', label: 'edgeEditor.routeCurve', path: 'M8 25 C30 25 30 7 52 7' },
  { value: 'orthogonal', label: 'edgeEditor.routeOrthogonal', path: 'M8 25 H25 Q30 25 30 20 V12 Q30 7 35 7 H52' },
] as const;
const equal = (a: EdgeEditSettings, b: EdgeEditSettings) => a.relation === b.relation && a.route === b.route && a.label === b.label;

function readSessionSettings(value: string, fallback: EdgeEditSettings): EdgeEditSettings {
  try {
    const settings = JSON.parse(value);
    if (settings && ['continue', 'reference'].includes(settings.relation)
      && ['inherit', 'auto', 'curve', 'orthogonal'].includes(settings.route)
      && typeof settings.label === 'string') {
      // Keep drafts from the previous editor, without reviving its scope field.
      return { relation: settings.relation, route: settings.route, label: settings.label };
    }
  } catch { /* Ignore drafts from an obsolete editor shape. */ }
  return fallback;
}

function EdgeInspectorForm({ edgeId, onClose, onLocateNode, draftKey }: EdgeInspectorProps & { draftKey: string }) {
  const t = useT();
  const titleId = useId();
  const relationName = useId();
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const updateEdgeSettings = useStore((s) => s.updateEdgeSettings);
  const deleteEdges = useStore((s) => s.deleteEdges);
  const setEdgePreview = useCanvasEditing((s) => s.setEdgePreview);
  const edge = edges.find((item) => item.id === edgeId);
  const stored = useMemo(() => readEdgeSettings(edge ?? { id: edgeId, source: '', target: '' } as ThoughtEdge), [edge, edgeId]);
  const [draftText, setDraftText] = useSessionDraft(draftKey, JSON.stringify(stored));
  const draft = useMemo(() => readSessionSettings(draftText, stored), [draftText, stored]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [labelExpanded, setLabelExpanded] = useState(() => Boolean(draft.label || stored.label));
  const panelRef = useRef<HTMLElement>(null);
  const panelPosition = useCanvasPanelPosition();
  const closeRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const dirty = !equal(draft, stored);
  const restriction = edge ? edgeEditRestriction(edge, nodes) : null;
  const result = useMemo(() => edge ? applyEdgeSettings(edge, nodes, edges, draft) : null, [edge, nodes, edges, draft]);
  const continuationCheck = useMemo(() => edge ? applyEdgeSettings(edge, nodes, edges, { ...draft, relation: 'continue' }) : null,
    [edge, nodes, edges, draft]);
  const source = nodes.find((node) => node.id === edge?.source);
  const target = nodes.find((node) => node.id === edge?.target);
  const effectiveRoute = (draft.route === 'inherit' ? source?.data.edgeRouteDefault : draft.route) === 'orthogonal' ? 'orthogonal' : 'curve';
  const clearDraft = () => useUiStore.getState().setDraft(draftKey, '');
  const cancel = () => {
    clearDraft();
    setSaveError(null);
    setLabelExpanded(Boolean(stored.label));
    setEdgePreview(null);
  };
  const close = () => { setEdgePreview(null); onClose(); };
  const { isTopLayer } = useDismissableLayer({
    open: !!edge, refs: [panelRef], dismissOnOutside: false,
    onDismiss: () => { if (dirty) cancel(); else close(); },
  });

  useEffect(() => {
    setEdgePreview(dirty && result?.ok ? result.edge : null);
    return () => setEdgePreview(null);
  }, [dirty, result, setEdgePreview]);
  useEffect(() => { closeRef.current?.focus(); }, []);

  if (!edge) return null;
  const messageFor = (error: string) => error in errorKeys ? t(errorKeys[error as EdgeEditError]) : error;
  const validationError = result && !result.ok ? messageFor(result.error) : null;
  const change = <K extends keyof EdgeEditSettings>(key: K, value: EdgeEditSettings[K]) => {
    const next = { ...draft, [key]: value };
    if (equal(next, stored)) clearDraft(); else setDraftText(JSON.stringify(next));
    setSaveError(null);
  };
  const apply = () => {
    const saved = updateEdgeSettings(edgeId, draft);
    if (!saved.ok) { setSaveError(saved.error ? messageFor(saved.error) : t('edgeEditor.error.saveFailed')); return; }
    clearDraft();
    setSaveError(null);
    setEdgePreview(null);
  };
  const restrictionText = restriction ? restrictionKeys[restriction] : null;
  const error = saveError || validationError;
  const canContinue = continuationCheck?.ok !== false;
  const name = (node: typeof source) => node ? getNodeNameSource(node.data, t('edgeEditor.unnamedNode')) : t('edgeEditor.missingNode');

  return <aside ref={panelRef} style={panelPosition} data-edge-inspector aria-labelledby={titleId} className="canvas-tool-panel edge-inspector nodrag nopan nowheel"
    onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
      if (event.key === 'Escape') return;
      event.stopPropagation();
      if (isTopLayer() && (event.ctrlKey || event.metaKey) && event.key === 'Enter' && dirty && result?.ok) { event.preventDefault(); apply(); }
    }}>
    <header className="edge-inspector-header">
      <h2 id={titleId}>{t('edgeEditor.title')}</h2>
      <button type="button" ref={closeRef} onClick={close} className="edge-inspector-icon" title={t('common.close')} aria-label={t('common.close')}><X size={17} /></button>
    </header>

    <div className="edge-inspector-body" data-edge-inspector-fields>
      <div className="edge-inspector-endpoints">
        {([{ node: source, label: 'edgeEditor.source', value: 'source' }, { node: target, label: 'edgeEditor.target', value: 'target' }] as const).map(({ node, label, value }, index) => <div key={value}>
          {index === 1 && <ArrowDown size={13} className="edge-inspector-direction" aria-hidden="true" />}
          <button type="button" disabled={!node} onClick={() => { if (node) onLocateNode(node.id); }}
            className="edge-inspector-endpoint" title={fmt(t('edgeEditor.locateNode'), { name: name(node) })} data-edge-locate={value}>
            <span className="edge-inspector-endpoint-label">{t(label)}</span>
            <span className="edge-inspector-endpoint-name">{name(node)}</span>
            <LocateFixed size={14} aria-hidden="true" />
          </button>
        </div>)}
      </div>

      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.relation')}</legend>
        {restrictionText ? <div className="edge-inspector-fixed-purpose">
          <LockKeyhole size={16} aria-hidden="true" /><div><strong>{t(restrictionText[0])}</strong><p>{t(restrictionText[1])}</p></div>
        </div> : <>
          <div className="edge-inspector-relations">
            {(['continue', 'reference'] as const).map((relation) => <label key={relation} className="edge-inspector-relation"
              data-selected={draft.relation === relation} data-disabled={relation === 'continue' && !canContinue}>
              <input type="radio" name={relationName} value={relation} checked={draft.relation === relation}
                disabled={relation === 'continue' && !canContinue} data-edge-relation={relation}
                onChange={() => change('relation', relation)} />
              <span><strong>{t(relation === 'continue' ? 'edgeEditor.continue' : 'edgeEditor.reference')}</strong>
                <span className="edge-inspector-relation-hint">{t(relation === 'continue' ? 'edgeEditor.continueHint' : 'edgeEditor.referenceHint')}</span></span>
            </label>)}
          </div>
          {!canContinue && continuationCheck && !continuationCheck.ok && <p className="edge-inspector-hint">{messageFor(continuationCheck.error)}</p>}
        </>}
      </fieldset>

      <fieldset className="edge-inspector-section">
        <legend>{t('edgeEditor.route')}</legend>
        <div className="edge-inspector-routes" role="group" aria-label={t('edgeEditor.route')}>
          {routes.map(({ value, label, path }) => <button type="button" key={value} data-edge-route={value}
            aria-pressed={effectiveRoute === value} onClick={() => change('route', value)}>
            <svg width="60" height="32" viewBox="0 0 60 32" fill="none" aria-hidden="true">
              <path d={path} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8" cy="25" r="2.5" fill="currentColor" /><circle cx="52" cy="7" r="2.5" fill="currentColor" />
            </svg><span>{t(label)}</span>
          </button>)}
        </div>
      </fieldset>

      {labelExpanded || draft.label ? <label className="edge-inspector-note">
        <span><Tag size={13} aria-hidden="true" />{t('edgeEditor.label')}</span>
        <input ref={labelRef} value={draft.label} maxLength={120} placeholder={t('edgeEditor.labelPlaceholder')} data-edge-label onChange={(event) => change('label', event.target.value)} />
      </label> : <button type="button" className="edge-inspector-add-note" data-edge-label-add data-edge-label-toggle onClick={() => {
        setLabelExpanded(true); requestAnimationFrame(() => labelRef.current?.focus());
      }}><Plus size={14} aria-hidden="true" />{t('edgeEditor.addLabel')}</button>}
    </div>

    <footer className="edge-inspector-footer">
      {error && <p role="alert" className="edge-inspector-error" data-edge-error>{error}</p>}
      <div className="edge-inspector-actions">
        <button type="button" className="edge-inspector-delete" title={t('edgeEditor.delete')} aria-label={t('edgeEditor.delete')} data-edge-delete
          onClick={() => { deleteEdges([edgeId]); clearDraft(); close(); }}><Trash2 size={14} aria-hidden="true" />{t('common.delete')}</button>
        <button type="button" className="edge-inspector-cancel" disabled={!dirty} onClick={cancel} data-edge-cancel>{t('common.cancel')}</button>
        <button type="button" className="edge-inspector-apply" disabled={!dirty || !result?.ok} onClick={apply} data-edge-apply>{t('edgeEditor.apply')}</button>
      </div>
    </footer>
  </aside>;
}

/** A distinct session draft belongs to each project and connection. */
export default function EdgeInspector(props: EdgeInspectorProps) {
  const projectId = useProjects((state) => state.activeId);
  const draftKey = `edge-editor:${projectId}:${props.edgeId}`;
  return <EdgeInspectorForm key={draftKey} {...props} draftKey={draftKey} />;
}
