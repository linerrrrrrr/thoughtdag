import type { ThoughtEdge, ThoughtNode } from '../types';

export type LayoutDirection = 'horizontal' | 'vertical';
export type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeAnchors {
  sourceHandle: string;
  targetHandle: string;
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  axis: LayoutDirection;
  sourceAnchor: { x: number; y: number };
  targetAnchor: { x: number; y: number };
}

type NodeCollection = readonly ThoughtNode[] | ReadonlyMap<string, ThoughtNode>;
interface NodeRect { x: number; y: number; width: number; height: number }

const MATERIAL_KINDS = new Set(['note', 'file', 'link']);
const SIDES = new Set<AnchorSide>(['top', 'right', 'bottom', 'left']);
const AXIS_BIAS = 48;

/** Side ports share a header-height baseline, even when card bodies differ. */
export function sideAnchorOffset(height: number): number {
  return Math.min(56, Math.max(0, height - 12));
}

function rect(node: ThoughtNode): NodeRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width || node.width || 520,
    height: node.measured?.height || node.height || 240,
  };
}

function findNode(nodes: NodeCollection, id: string): ThoughtNode | undefined {
  return Array.isArray(nodes) ? nodes.find((node) => node.id === id) : (nodes as ReadonlyMap<string, ThoughtNode>).get(id);
}

export function nodeLayoutDirection(node: ThoughtNode | undefined): LayoutDirection {
  return node?.data.layoutDirection === 'horizontal' ? 'horizontal' : 'vertical';
}

export function anchorHandle(type: 'source' | 'target', side: AnchorSide): string {
  return `${type === 'source' ? 'out' : 'in'}-${side}`;
}

/** Legacy IDs remain geometry aliases, never evidence of the edge's purpose. */
export function handleSide(handle: string | null | undefined): AnchorSide | undefined {
  if (handle === 'continue') return 'bottom';
  if (handle === 'branch') return 'right';
  if (handle === 'top' || handle === 'left') return handle;
  const side = handle?.replace(/^(?:in|out)-/, '') as AnchorSide | undefined;
  return side && SIDES.has(side) ? side : undefined;
}

function pointFor(box: NodeRect, side: AnchorSide): { x: number; y: number } {
  if (side === 'left' || side === 'right') {
    return { x: box.x + (side === 'right' ? box.width : 0), y: box.y + sideAnchorOffset(box.height) };
  }
  return { x: box.x + box.width / 2, y: box.y + (side === 'bottom' ? box.height : 0) };
}

function resultFor(source: NodeRect, target: NodeRect, sourceSide: AnchorSide, targetSide: AnchorSide): EdgeAnchors {
  return {
    sourceHandle: anchorHandle('source', sourceSide), targetHandle: anchorHandle('target', targetSide),
    sourceSide, targetSide,
    axis: sourceSide === 'left' || sourceSide === 'right' ? 'horizontal' : 'vertical',
    sourceAnchor: pointFor(source, sourceSide), targetAnchor: pointFor(target, targetSide),
  };
}

/** Pure geometry resolution. Content, reference and workflow semantics stay on the edge. */
export function resolveEdgeAnchors(
  edge: ThoughtEdge,
  nodes: NodeCollection,
  preference?: LayoutDirection,
  previous?: EdgeAnchors,
): EdgeAnchors | null {
  const source = findNode(nodes, edge.source), target = findNode(nodes, edge.target);
  if (!source || !target || source.id === target.id || source.data.stepKind === 'frame'
    || target.data.stepKind === 'frame' || MATERIAL_KINDS.has(target.data.stepKind ?? '')) return null;
  const a = rect(source), b = rect(target);
  const preferred = preference ?? (source.data.layoutDirection === 'horizontal' || target.data.layoutDirection === 'horizontal'
    ? 'horizontal' : 'vertical');
  const rightward = b.x + b.width / 2 >= a.x + a.width / 2;
  const downward = b.y + sideAnchorOffset(b.height) >= a.y + sideAnchorOffset(a.height);
  const horizontal = resultFor(a, b, rightward ? 'right' : 'left', rightward ? 'left' : 'right');
  const vertical = resultFor(a, b, downward ? 'bottom' : 'top', downward ? 'top' : 'bottom');
  const gapX = Math.max(b.x - a.x - a.width, a.x - b.x - b.width);
  const gapY = Math.max(b.y - a.y - a.height, a.y - b.y - b.height);

  // An unambiguous row/column wins even on a manually arranged old canvas.
  if (gapX >= 0 && gapY < 0) return horizontal;
  if (gapY >= 0 && gapX < 0) return vertical;
  const cost = (candidate: EdgeAnchors) => Math.abs(candidate.sourceAnchor.x - candidate.targetAnchor.x)
    + Math.abs(candidate.sourceAnchor.y - candidate.targetAnchor.y)
    + (candidate.axis === preferred ? 0 : AXIS_BIAS)
    + (previous && candidate.axis !== previous.axis ? AXIS_BIAS : 0);
  return cost(horizontal) < cost(vertical) ? horizontal : vertical;
}

/** Place a new card with its automatically resolved input at the released wire tip. */
export function positionNodeAtConnectionEnd(
  source: ThoughtNode, target: ThoughtNode, end: { x: number; y: number },
  targetHandles?: readonly { id?: string | null; x: number; y: number; width: number; height: number }[],
): { x: number; y: number } {
  const box = { ...rect(target), x: 0, y: 0 };
  const edge: ThoughtEdge = { id: '', source: source.id, target: target.id };
  const preferred = nodeLayoutDirection(source);
  const offsetFor = (side: AnchorSide) => {
    const handle = targetHandles?.find(item => item.id === anchorHandle('target', side));
    // React Flow ends a line at the outer edge of its measured handle.
    // Include the real border and port dimensions once the card has mounted.
    return handle ? {
      x: handle.x + (side === 'left' ? 0 : side === 'right' ? handle.width : handle.width / 2),
      y: handle.y + (side === 'top' ? 0 : side === 'bottom' ? handle.height : handle.height / 2),
    } : pointFor(box, side);
  };
  const candidates = (['top', 'left', 'bottom', 'right'] as const).map(side => {
    const offset = offsetFor(side);
    const position = { x: end.x - offset.x, y: end.y - offset.y };
    const anchors = resolveEdgeAnchors(edge, [source, { ...target, position }])!;
    const resolvedOffset = offsetFor(anchors.targetSide);
    return {
      position,
      error: Math.hypot(position.x + resolvedOffset.x - end.x, position.y + resolvedOffset.y - end.y),
      cost: Math.abs(anchors.sourceAnchor.x - end.x) + Math.abs(anchors.sourceAnchor.y - end.y)
        + (anchors.axis === preferred ? 0 : AXIS_BIAS),
    };
  });
  // Resolve each candidate through the normal facing rules; placement never
  // pins an edge to a port or changes its continuation/reference meaning.
  candidates.sort((a, b) => a.error - b.error || a.cost - b.cost);
  return candidates[0].position;
}

interface CachedAnchors {
  sourceId: string; targetId: string;
  sx: number; sy: number; tx: number; ty: number;
  preference: string;
  dragging: boolean;
  measured: boolean;
  anchors: EdgeAnchors;
}

/** One resolver per mounted canvas. Clear on project changes; no global state. */
export function createEdgeAnchorResolver() {
  const cache = new Map<string, CachedAnchors>();
  return {
    clear() { cache.clear(); },
    prune(edges: readonly ThoughtEdge[]) {
      const live = new Set(edges.map((edge) => edge.id));
      for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    },
    resolve(edge: ThoughtEdge, nodes: NodeCollection, preference?: LayoutDirection): EdgeAnchors | null {
      const source = findNode(nodes, edge.source), target = findNode(nodes, edge.target);
      const prior = cache.get(edge.id);
      const preferenceKey = `${preference ?? ''}:${source?.data.layoutDirection ?? ''}:${target?.data.layoutDirection ?? ''}`;
      const compatible = !!prior && prior.sourceId === edge.source && prior.targetId === edge.target && prior.preference === preferenceKey;
      const fresh = resolveEdgeAnchors(edge, nodes, preference, compatible ? prior.anchors : undefined);
      if (!fresh || !source || !target) { cache.delete(edge.id); return fresh; }
      const dragging = !!source.dragging || !!target.dragging;
      const measured = !!source.measured?.width && !!source.measured?.height && !!target.measured?.width && !!target.measured?.height;
      const unmoved = compatible && prior.sx === source.position.x && prior.sy === source.position.y
        && prior.tx === target.position.x && prior.ty === target.position.y;
      // ResizeObserver/semantic zoom may change the body height, but should
      // not rotate the wire. Drag release is an explicit geometry decision.
      const preserveSides = compatible && (dragging || (unmoved && !prior.dragging && (prior.measured || !measured)));
      const anchors = preserveSides ? resultFor(rect(source), rect(target), prior.anchors.sourceSide, prior.anchors.targetSide) : fresh;
      cache.set(edge.id, { sourceId: edge.source, targetId: edge.target,
        sx: source.position.x, sy: source.position.y, tx: target.position.x, ty: target.position.y,
        preference: preferenceKey, dragging, measured, anchors });
      return anchors;
    },
  };
}
