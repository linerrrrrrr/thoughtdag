import { useContext, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useStore as useFlowStore, type EdgeProps } from '@xyflow/react';
import { routeEdge } from '../lib/edge-path';
import { CanvasEdgeRouting } from '../lib/edge-routing-context';
import { useCanvasEditing } from '../lib/canvas-editing';
import { isViewerMode } from '../lib/viewer';
import { useT } from '../i18n';
import type { ThoughtEdge, ThoughtNode } from '../types';
import { useStore } from '../store';

/**
 * Custom edge registered under the 'smoothstep' type name (overrides the
 * built-in, so edges persisted before this component existed pick it up
 * with no migration). Clear connections use the standard whole-span Bezier;
 * blocked curves use a smooth obstacle route, while elbow mode stays
 * orthogonal. Both preserve port directions (see lib/edge-path). Click an edge to select
 * it to edit in the inspector. No floating toolbar covers the route.
 */
export default function ThoughtEdgeView({
  id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  style, markerEnd, markerStart, selected, interactionWidth, data,
}: EdgeProps<ThoughtEdge>) {
  const editEdge = useCanvasEditing((s) => s.setEdgeId);
  const routingContext = useContext(CanvasEdgeRouting);
  const visibleNodes = useFlowStore((s) => s.nodes as ThoughtNode[]);
  const edges = useFlowStore((s) => s.edges as ThoughtEdge[]);
  const zoom = useFlowStore((s) => s.transform[2]);
  const t = useT();
  const isRef = !!data?.isCrossLink;
  const routeMode = data?.route ?? visibleNodes.find((node) => node.id === source)?.data.edgeRouteDefault ?? 'auto';
  const label = data?.label?.trim();
  const annotationClass = 'max-w-[240px] rounded-tag border border-line bg-card px-2 py-1 text-xs text-ink break-words';
  const { path, labelX, labelY } = useMemo(
    () => routeEdge(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, source, target, visibleNodes, routeMode,
      { edgeId: id, context: routingContext, ...(!routingContext ? { edges } : {}) }),
    [sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, source, target, visibleNodes, routeMode, id, routingContext, edges],
  );

  // When selected, force full visibility (overrides the ancestor-dim pass)
  // and thicken the stroke as selection feedback.
  const edgeStyle = selected ? { ...style, strokeWidth: 2.5, opacity: 1 } : style;

  // A merge's incoming blocks have a stated order — show it AT the join,
  // where the question "which reads first?" is asked. Only merges wear
  // numbers; a single-parent edge needs none.
  const mergeIndex = useMemo(() => {
    if (isRef) return -1;
    const siblings = edges.filter((e) => e.target === target && !e.data?.isCrossLink);
    if (siblings.length < 2) return -1;
    siblings.sort((a, b) => (a.data?.contextOrder ?? Number.MAX_SAFE_INTEGER) - (b.data?.contextOrder ?? Number.MAX_SAFE_INTEGER));
    return siblings.findIndex((e) => e.id === id);
  }, [edges, target, id, isRef]);
  const mergeOffset = 24 + Math.max(0, mergeIndex) * 20;
  const mergeX = targetX + (targetPosition === 'left' ? -mergeOffset : targetPosition === 'right' ? mergeOffset : 0);
  const mergeY = targetY + (targetPosition === 'bottom' ? mergeOffset : targetPosition === 'top' || !targetPosition ? -mergeOffset : 0);

  return (
    <>
      <BaseEdge
        path={path}
        style={edgeStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={Math.max(interactionWidth ?? 20, 14 / Math.max(zoom, 0.01))}
      />
      {mergeIndex >= 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              transform: `translate(-50%, -50%) translate(${mergeX}px, ${mergeY}px)`,
            }}
            data-merge-order={mergeIndex + 1}
          >
            <div className="w-4.5 h-4.5 min-w-[18px] px-0.5 rounded-tag bg-card border border-line flex items-center justify-center text-2xs font-mono text-ink-muted" style={{ fontSize: 10 }}>
              {mergeIndex + 1}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
      {data?.focusRole === 'path' && (
        // Context Focus feed line: bright dots gliding INSIDE the solid
        // stroke (narrower than it, so the line never reads as dashed —
        // dashed is taken: references)
        <path d={path} className="tdag-flow-ov" fill="none" />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              pointerEvents: isViewerMode ? 'none' : 'all',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <div className="flex flex-col items-center gap-1" style={{ transform: 'scale(calc(1 / var(--tdag-zoom, 1)))', transformOrigin: 'center' }}>
              {label && (isViewerMode
                ? <span className={annotationClass} data-edge-annotation>{label}</span>
                : <button type="button" onClick={(event) => {
                  event.stopPropagation();
                  const state = useStore.getState();
                  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
                  state.setSelectedNodeIds([]);
                  state.setEdges(state.edges.map(edge => ({ ...edge, selected: additive ? edge.id === id ? !edge.selected : !!edge.selected : edge.id === id })));
                  editEdge(additive || useCanvasEditing.getState().selectionTarget === 'edges' ? null : id);
                }}
                  className={annotationClass} title={t('edgeEditor.title')} data-edge-annotation>{label}</button>)}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
