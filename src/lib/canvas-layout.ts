import type { ThoughtEdge, ThoughtNode } from '../types';
import { nodeHeight } from './layout';
import { NODE_CSS_WIDTH } from './constants';

export interface CanvasLayoutOptions {
  direction: 'vertical' | 'horizontal';
  method: 'manual' | 'chains' | 'layers';
  density: 'compact' | 'standard' | 'relaxed';
  route: 'auto' | 'curve' | 'orthogonal';
}

export type CanvasLayoutError = 'empty-selection' | 'grouped-nodes' | 'cycle' | 'boundary-conflict' | 'obstacle-conflict';
export interface CanvasLayoutResult { nodes: ThoughtNode[]; error?: CanvasLayoutError }

const MATERIALS = new Set(['note', 'file', 'link', 'frame']);
const EPSILON = 0.01;
const SPACING = {
  compact: { primary: 56, cross: 40 },
  standard: { primary: 96, cross: 64 },
  relaxed: { primary: 160, cross: 112 },
};

/** Context topology and visual arrangement are separate: routing choices never
 * change edge kinds, input order, or payloads. Plans are atomic and pure. */
export function planCanvasLayout(
  nodes: ThoughtNode[], edges: ThoughtEdge[], options: CanvasLayoutOptions, selectedIds?: string[],
): CanvasLayoutResult {
  const selected = selectedIds ? new Set(selectedIds) : null;
  const moving = nodes.filter((n) => (!selected || selected.has(n.id)) && !MATERIALS.has(n.data.stepKind ?? ''));
  const fail = (error: CanvasLayoutError): CanvasLayoutResult => ({ nodes, error });
  if (!moving.length) return fail('empty-selection');
  const ids = new Set(moving.map((n) => n.id));
  const withPreferences = (node: ThoughtNode): ThoughtNode => ({
    ...node, data: { ...node.data, layoutDirection: options.direction, edgeRouteDefault: options.route },
  });
  if (options.method === 'manual') return { nodes: nodes.map((n) => ids.has(n.id) ? withPreferences(n) : n) };

  // A rigid group cannot be split into topology lanes. Refuse explicitly;
  // the existing arrange/group commands remain available for moving it whole.
  const grouped = new Set(moving.map((n) => n.data.canvasGroupId).filter(Boolean));
  if (nodes.some((n) => n.data.stepKind !== 'frame' && n.data.canvasGroupId && grouped.has(n.data.canvasGroupId))) {
    return fail('grouped-nodes');
  }

  const horizontal = options.direction === 'horizontal';
  const primary = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
  const { primary: gap, cross: crossGap } = SPACING[options.density];
  const width = (n: ThoughtNode) => Math.max(n.width ?? n.measured?.width ?? NODE_CSS_WIDTH, n.measured?.width ?? 0);
  const size = (n: ThoughtNode) => horizontal ? width(n) : nodeHeight(n);
  const crossSize = (n: ThoughtNode) => horizontal ? nodeHeight(n) : width(n);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = edges.filter((e) => !e.data?.isWatch && byId.has(e.source) && byId.has(e.target)
    && byId.get(e.source)!.data.stepKind !== 'frame' && byId.get(e.target)!.data.stepKind !== 'frame');
  const structural = live.filter((e) => !e.data?.isCrossLink);
  const parented = new Set(structural.map((e) => e.target));
  // Match the legacy layout's sole-reference parent adoption.
  for (const edge of live) {
    if (edge.data?.isCrossLink && !parented.has(edge.target)) {
      structural.push(edge);
      parented.add(edge.target);
    }
  }
  const internal = structural.filter((e) => ids.has(e.source) && ids.has(e.target));
  const incoming = new Map<string, ThoughtEdge[]>(), outgoing = new Map<string, ThoughtEdge[]>();
  for (const edge of internal) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const compare = (a: ThoughtNode, b: ThoughtNode) => a.position[cross] - b.position[cross]
    || a.position[primary] - b.position[primary] || a.id.localeCompare(b.id);
  const degree = new Map(moving.map((n) => [n.id, incoming.get(n.id)?.length ?? 0]));
  const ready = moving.filter((n) => !degree.get(n.id)).sort(compare);
  const ordered: ThoughtNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const edge of outgoing.get(node.id) ?? []) {
      degree.set(edge.target, degree.get(edge.target)! - 1);
      if (!degree.get(edge.target)) { ready.push(byId.get(edge.target)!); ready.sort(compare); }
    }
  }
  if (ordered.length !== moving.length) return fail('cycle');

  // First non-exploration parent owns a merge; its first continuation owns
  // the same lane. This is independent of the nodes array's storage order.
  const thoughtEdges = structural.filter((e) => !MATERIALS.has(byId.get(e.source)!.data.stepKind ?? '')
    && !MATERIALS.has(byId.get(e.target)!.data.stepKind ?? ''));
  const owners = new Map<string, ThoughtEdge>();
  for (const edge of thoughtEdges) {
    const current = owners.get(edge.target);
    if (!current || (current.data?.isBranchFromSelection && !edge.data?.isBranchFromSelection)) owners.set(edge.target, edge);
  }
  const firstChildren = new Set<string>();
  const continuations = thoughtEdges.filter((edge) => {
    if (edge.data?.isBranchFromSelection || owners.get(edge.target) !== edge || firstChildren.has(edge.source)) return false;
    firstChildren.add(edge.source);
    return true;
  });
  const laneOf = new Map<string, string>();
  const continuationParent = new Map(continuations.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => [e.target, e.source]));
  for (const node of ordered) laneOf.set(node.id, laneOf.get(continuationParent.get(node.id) ?? '') ?? node.id);
  const lanes = new Map<string, { ids: string[]; width: number; at?: number }>();
  for (const node of ordered) {
    const key = laneOf.get(node.id)!;
    const lane = lanes.get(key) ?? { ids: [], width: 0 };
    lane.ids.push(node.id); lane.width = Math.max(lane.width, crossSize(node));
    lanes.set(key, lane);
  }
  const pin = (nodeId: string, at: number) => {
    const lane = lanes.get(laneOf.get(nodeId)!)!;
    if (lane.at != null && Math.abs(lane.at - at) > EPSILON) return false;
    lane.at = at;
    return true;
  };
  for (const edge of continuations) {
    if (ids.has(edge.target) && !ids.has(edge.source) && !pin(edge.target, byId.get(edge.source)!.position[cross])) return fail('boundary-conflict');
    if (ids.has(edge.source) && !ids.has(edge.target) && !pin(edge.source, byId.get(edge.target)!.position[cross])) return fail('boundary-conflict');
  }
  // Material-origin chains remain visually anchored to their immutable source.
  for (const edge of structural) {
    if (!ids.has(edge.target) || ids.has(edge.source) || !MATERIALS.has(byId.get(edge.source)!.data.stepKind ?? '')) continue;
    const lane = lanes.get(laneOf.get(edge.target)!)!;
    if (lane.at == null) lane.at = byId.get(edge.source)!.position[cross];
  }
  const assigned = [...lanes.values()].filter((lane) => lane.at != null);
  let cursor = Math.min(...moving.map((n) => n.position[cross]));
  for (const lane of lanes.values()) {
    if (lane.at != null) continue;
    let at = cursor;
    for (;;) {
      const conflict = assigned.find((other) => at < other.at! + other.width + crossGap && at + lane.width + crossGap > other.at!);
      if (!conflict) break;
      at = conflict.at! + conflict.width + crossGap;
    }
    lane.at = at; assigned.push(lane); cursor = at + lane.width + crossGap;
  }

  const rank = new Map<string, number>(), local = new Map<string, number>();
  for (const node of ordered) {
    const parents = incoming.get(node.id) ?? [];
    rank.set(node.id, Math.max(0, ...parents.map((e) => rank.get(e.source)! + 1)));
    local.set(node.id, Math.max(0, ...parents.map((e) => local.get(e.source)! + size(byId.get(e.source)!) + gap)));
  }
  if (options.method === 'layers') {
    const heights = new Map<number, number>();
    for (const node of ordered) heights.set(rank.get(node.id)!, Math.max(heights.get(rank.get(node.id)!) ?? 0, size(node)));
    const offsets = new Map<number, number>();
    let offset = 0;
    for (let r = 0; r <= Math.max(...rank.values()); r++) { offsets.set(r, offset); offset += (heights.get(r) ?? 0) + gap; }
    for (const node of ordered) local.set(node.id, offsets.get(rank.get(node.id)!)!);
  }

  let lower = -Infinity, upper = Infinity;
  for (const edge of structural) {
    if (ids.has(edge.target) && !ids.has(edge.source)) {
      const fixed = byId.get(edge.source)!;
      lower = Math.max(lower, fixed.position[primary] + size(fixed) + gap - local.get(edge.target)!);
    }
    if (ids.has(edge.source) && !ids.has(edge.target)) {
      const fixed = byId.get(edge.target)!;
      upper = Math.min(upper, fixed.position[primary] - gap - local.get(edge.source)! - size(byId.get(edge.source)!));
    }
  }
  if (lower > upper + EPSILON) return fail('boundary-conflict');
  let offset = Math.max(lower, Math.min(upper, Math.min(...moving.map((n) => n.position[primary]))));
  const fixed = nodes.filter((n) => !ids.has(n.id) && n.data.stepKind !== 'frame');
  // Shift the plan as one unit around immutable materials and unselected
  // cards, preserving lane alignment and layer coordinates throughout.
  for (let pass = 0; pass <= fixed.length * moving.length; pass++) {
    let next = offset;
    for (const node of moving) {
      const lane = lanes.get(laneOf.get(node.id)!)!;
      const start = local.get(node.id)! + offset;
      for (const obstacle of fixed) {
        if (lane.at! >= obstacle.position[cross] + crossSize(obstacle) + 16
          || lane.at! + crossSize(node) + 16 <= obstacle.position[cross]) continue;
        if (start >= obstacle.position[primary] + size(obstacle) + 16
          || start + size(node) + 16 <= obstacle.position[primary]) continue;
        next = Math.max(next, obstacle.position[primary] + size(obstacle) + gap - local.get(node.id)!);
      }
    }
    if (next === offset) break;
    if (next > upper + EPSILON) return fail('obstacle-conflict');
    offset = next;
  }
  const proposed = nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const at = lanes.get(laneOf.get(node.id)!)!.at!;
    return { ...withPreferences(node), position: horizontal ? { x: local.get(node.id)! + offset, y: at } : { x: at, y: local.get(node.id)! + offset } };
  });
  // Boundary-pinned lanes can coincide. Validate the finished rectangles
  // instead of silently separating chains from their unselected neighbors.
  const after = proposed.filter((n) => n.data.stepKind !== 'frame');
  for (let i = 0; i < after.length; i++) {
    for (let j = i + 1; j < after.length; j++) {
      const a = after[i], b = after[j];
      if (!ids.has(a.id) && !ids.has(b.id)) continue;
      if (a.position[primary] < b.position[primary] + size(b) - EPSILON
        && a.position[primary] + size(a) > b.position[primary] + EPSILON
        && a.position[cross] < b.position[cross] + crossSize(b) - EPSILON
        && a.position[cross] + crossSize(a) > b.position[cross] + EPSILON) return fail('obstacle-conflict');
    }
  }
  return { nodes: proposed };
}
