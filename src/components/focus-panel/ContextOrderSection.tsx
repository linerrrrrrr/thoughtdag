import { ArrowDown, ArrowUp, Eye, GitBranch, Link } from 'lucide-react';
import { useStore } from '../../store';
import { useContextInspection } from '../../lib/context-inspection';
import { getNodeNameSource } from '../../lib/node-display-name';
import { isViewerMode } from '../../lib/viewer';
import { isSingleNodeReference } from '../../lib/graph';
import { useT } from '../../i18n';
import type { ThoughtEdge } from '../../types';
import '../NodeContextSources.css';

// The order of a merge's incoming BLOCKS — visible and adjustable only
// where several parents feed one node. Reordering moves whole upstream
// blocks (an entry = one incoming edge = its entire chain); the order of
// nodes INSIDE a single chain is conversational fact and never offered
// here. Changing the order changes the context, so staleness recomputes
// and downstream honestly flags itself.
export default function ContextOrderSection({ nodeId, inspect = false }: { nodeId: string; inspect?: boolean }) {
  const t = useT();
  const edges = useStore((s) => s.edges);
  const nodes = useStore((s) => s.nodes);
  const activeEdgeId = useContextInspection(state => inspect ? state.activeEdgeId : null);
  const incoming = edges
    .filter((e) => e.target === nodeId && !e.data?.isCrossLink)
    .sort((a, b) => (a.data?.contextOrder ?? Number.MAX_SAFE_INTEGER) - (b.data?.contextOrder ?? Number.MAX_SAFE_INTEGER));
  const crossLinks = inspect ? edges.filter(edge => edge.target === nodeId && edge.data?.isCrossLink) : [];
  const references = crossLinks.filter(isSingleNodeReference);
  const special = crossLinks.filter(edge => !isSingleNodeReference(edge));
  if (!inspect && incoming.length < 2) return null;

  const labelOf = (sourceId: string): string => {
    const n = nodes.find((x) => x.id === sourceId);
    if (!n) return sourceId.slice(0, 8);
    return getNodeNameSource(n.data, t('ctx.unnamedNode'));
  };

  const move = (i: number, dir: -1 | 1) => {
    if (isViewerMode) return;
    const j = i + dir;
    if (j < 0 || j >= incoming.length) return;
    const next = [...incoming];
    [next[i], next[j]] = [next[j], next[i]];
    const orderOf = new Map(next.map((e, k) => [e.id, k]));
    const store = useStore.getState();
    store.pushHistory();
    useStore.setState((s) => ({
      edges: s.edges.map((e) => (orderOf.has(e.id) ? { ...e, data: { ...e.data, contextOrder: orderOf.get(e.id)! } } : e)),
    }));
    store.pushHistory();
    store.recomputeStaleness();
  };

  const highlight = (edgeId: string | null) => {
    const state = useContextInspection.getState();
    if (inspect && state.targetId === nodeId) state.setActiveEdge(edgeId);
  };
  const sourceRow = (edge: ThoughtEdge, index: number, kind: 'ordered' | 'reference' | 'special') => (
    <div key={edge.id} className="context-source-row" tabIndex={inspect ? 0 : undefined}
      data-context-order-item={kind === 'ordered' ? edge.source : undefined}
      data-context-reference-item={kind === 'reference' ? edge.source : undefined}
      data-context-special-item={kind === 'special' ? edge.source : undefined}
      data-context-source-edge={edge.id} data-context-source-active={activeEdgeId === edge.id || undefined}
      onPointerEnter={() => highlight(edge.id)}
      onPointerLeave={() => {
        const focused = document.activeElement?.closest('[data-context-source-edge]');
        highlight(focused?.getAttribute('data-context-source-edge') ?? null);
      }}
      onFocusCapture={() => highlight(edge.id)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) highlight(null); }}>
      <span className="context-source-number" aria-hidden={kind !== 'ordered' || undefined}>
        {kind === 'ordered' ? index + 1 : kind === 'reference' ? <Link size={13} strokeWidth={1.75} />
          : edge.data?.isWatch ? <Eye size={13} strokeWidth={1.75} /> : <GitBranch size={13} strokeWidth={1.75} />}
      </span>
      <span className="context-source-name">{labelOf(edge.source)}
        {kind === 'special' && <span className="context-source-kind">{t(edge.data?.isWatch ? 'edgeEditor.watch' : 'edgeEditor.branch')}</span>}
      </span>
      {kind === 'ordered' && incoming.length > 1 && !isViewerMode && <span className="context-source-actions">
        <button type="button" className="context-source-action" disabled={index === 0}
          onClick={() => move(index, -1)} aria-label={t('panel.ctxOrderUp')} data-ctx-up>
          <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="context-source-action" disabled={index === incoming.length - 1}
          onClick={() => move(index, 1)} aria-label={t('panel.ctxOrderDown')} data-ctx-down>
          <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>}
    </div>
  );

  return (
    <div className="context-source-section" data-context-order>
      {incoming.length > 0 && <div className="context-source-group">
        <div className="context-source-group-title">{t('panel.ctxOrder')}</div>
        {incoming.map((edge, index) => sourceRow(edge, index, 'ordered'))}
      </div>}
      {references.length > 0 && <div className="context-source-group">
        <div className="context-source-group-title">{t('contextSources.references')}</div>
        {references.map((edge, index) => sourceRow(edge, index, 'reference'))}
        <p className="context-source-hint">{t('contextSources.referenceHint')}</p>
      </div>}
      {special.length > 0 && <div className="context-source-group">
        <div className="context-source-group-title">{t('contextSources.special')}</div>
        {special.map((edge, index) => sourceRow(edge, index, 'special'))}
      </div>}
    </div>
  );
}
