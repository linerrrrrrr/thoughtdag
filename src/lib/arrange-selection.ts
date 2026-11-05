import type { ThoughtEdge, ThoughtNode } from '../types';
import { nodeRect, resolveCarriedNodeIds } from './frames';
import { nodeHeight } from './layout';

export type ArrangeAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  | 'distribute-horizontal' | 'distribute-vertical';
export type ArrangeReference = 'selection' | 'viewport';
export type ArrangeRect = { x: number; y: number; width: number; height: number };
export type ArrangeReason = 'insufficient' | 'overlap' | 'context-order' | 'chain-alignment' | 'invalid-viewport';
export type ArrangeResult = { nodes: ThoughtNode[]; changed: boolean; reason?: ArrangeReason };

type Unit = { ids: string[]; rect: ArrangeRect };
const EPSILON = 0.01;
const MATERIAL_KINDS = new Set(['note', 'file', 'link', 'frame']);

function rectOf(node: ThoughtNode): ArrangeRect {
  const rect = nodeRect(node);
  const hasHeight = [node.measured?.height, node.height].some((height) => height != null && Number.isFinite(height) && height > 0);
  if (!hasHeight && node.data.stepKind !== 'frame') return { ...rect, height: nodeHeight(node) };
  return rect;
}

function bounds(rects: ArrangeRect[]): ArrangeRect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x, y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}

function selectionUnits(nodes: ThoughtNode[], nodeIds: string[]): Unit[] {
  const selected = new Set(nodeIds);
  const units: Set<string>[] = [];
  for (const id of selected) {
    const members = new Set(resolveCarriedNodeIds(nodes, [id]));
    if (!members.size) continue;
    // Shared members cannot receive two different alignment translations.
    for (let index = units.length - 1; index >= 0; index--) {
      if (![...units[index]].some((member) => members.has(member))) continue;
      for (const member of units[index]) members.add(member);
      units.splice(index, 1);
    }
    units.push(members);
  }
  return units.map((members) => ({
    ids: [...members], rect: bounds(nodes.filter((node) => members.has(node.id)).map(rectOf)),
  }));
}

/** Each selected node is independent; linked frames deduplicate carried nodes. */
export function arrangementUnitCount(nodes: ThoughtNode[], nodeIds: string[]): number {
  return selectionUnits(nodes, nodeIds).length;
}

function overlapArea(a: ArrangeRect, b: ArrangeRect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** The same parent adoption and continuation ownership as the column layout. */
function contextEdges(nodes: ThoughtNode[], edges: ThoughtEdge[]): {
  structural: ThoughtEdge[]; continuations: Set<string>;
} {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const live = edges.filter((edge) => !edge.data?.isWatch && byId.has(edge.source) && byId.has(edge.target));
  const structural = live.filter((edge) => !edge.data?.isCrossLink);
  const parented = new Set(structural.map((edge) => edge.target));
  for (const edge of live) {
    if (!edge.data?.isCrossLink || parented.has(edge.target)) continue;
    structural.push(edge);
    parented.add(edge.target);
  }
  const thoughtEdges = structural.filter((edge) =>
    !MATERIAL_KINDS.has(byId.get(edge.source)!.data.stepKind ?? '')
    && !MATERIAL_KINDS.has(byId.get(edge.target)!.data.stepKind ?? ''));
  const owners = new Map<string, ThoughtEdge>();
  for (const edge of thoughtEdges) {
    const owner = owners.get(edge.target);
    if (!owner || (owner.data?.isBranchFromSelection && !edge.data?.isBranchFromSelection)) {
      owners.set(edge.target, edge);
    }
  }
  const claimedParents = new Set<string>();
  const continuations = new Set<string>();
  for (const edge of thoughtEdges) {
    if (edge.data?.isBranchFromSelection || owners.get(edge.target) !== edge || claimedParents.has(edge.source)) continue;
    claimedParents.add(edge.source);
    continuations.add(edge.id);
  }
  return { structural, continuations };
}

/**
 * Apply one explicit arrangement atomically. Invalid arrangements leave the
 * original graph untouched; unrelated nodes are never nudged to make room.
 * Existing manual imperfections are tolerated when their violation does not
 * increase, so an unrelated crossed edge cannot disable canvas editing.
 */
export function arrangeNodes(
  nodes: ThoughtNode[], edges: ThoughtEdge[], nodeIds: string[],
  action: ArrangeAction, reference: ArrangeReference = 'selection', viewport?: ArrangeRect,
): ArrangeResult {
  const fail = (reason: ArrangeReason): ArrangeResult => ({ nodes, changed: false, reason });
  const units = selectionUnits(nodes, nodeIds);
  const distributing = action === 'distribute-horizontal' || action === 'distribute-vertical';
  const required = reference === 'viewport' ? (distributing ? 2 : 1) : (distributing ? 3 : 2);
  if (units.length < required) return fail('insufficient');
  if (reference === 'viewport' && (!viewport || !Object.values(viewport).every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0)) return fail('invalid-viewport');
  const target = reference === 'viewport' ? viewport! : bounds(units.map((unit) => unit.rect));
  const deltas = new Map<string, { x: number; y: number }>();
  const setDelta = (unit: Unit, x: number, y: number) => {
    for (const id of unit.ids) deltas.set(id, { x, y });
  };

  if (distributing) {
    const axis = action === 'distribute-horizontal' ? 'x' : 'y';
    const size = axis === 'x' ? 'width' : 'height';
    const crossAxis = axis === 'x' ? 'y' : 'x';
    const ordered = [...units].sort((a, b) => a.rect[axis] - b.rect[axis]
      || a.rect[crossAxis] - b.rect[crossAxis] || a.ids[0].localeCompare(b.ids[0]));
    const occupied = units.reduce((sum, unit) => sum + unit.rect[size], 0);
    const gap = (target[size] - occupied) / (units.length - 1);
    if (gap < -EPSILON) return fail('overlap');
    let cursor = target[axis];
    for (const unit of ordered) {
      const delta = cursor - unit.rect[axis];
      setDelta(unit, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
      cursor += unit.rect[size] + Math.max(0, gap);
    }
  } else {
    for (const unit of units) {
      const rect = unit.rect;
      let x = 0;
      let y = 0;
      if (action === 'left') x = target.x - rect.x;
      if (action === 'center') x = target.x + (target.width - rect.width) / 2 - rect.x;
      if (action === 'right') x = target.x + target.width - rect.width - rect.x;
      if (action === 'top') y = target.y - rect.y;
      if (action === 'middle') y = target.y + (target.height - rect.height) / 2 - rect.y;
      if (action === 'bottom') y = target.y + target.height - rect.height - rect.y;
      setDelta(unit, x, y);
    }
  }

  const moved = new Set<string>();
  const proposed = nodes.map((node) => {
    const delta = deltas.get(node.id);
    if (!delta || (Math.abs(delta.x) < EPSILON && Math.abs(delta.y) < EPSILON)) return node;
    moved.add(node.id);
    return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
  });
  if (!moved.size) return { nodes, changed: false };
  const before = new Map(nodes.map((node) => [node.id, node]));
  const after = new Map(proposed.map((node) => [node.id, node]));
  const { structural, continuations } = contextEdges(nodes, edges);
  for (const edge of structural) {
    if (!moved.has(edge.source) && !moved.has(edge.target)) continue;
    const source = before.get(edge.source)!;
    const destination = before.get(edge.target)!;
    const nextSource = after.get(edge.source)!;
    const nextDestination = after.get(edge.target)!;
    // Frames are annotation regions, never an ordered conversation turn.
    if (source.data.stepKind === 'frame' || destination.data.stepKind === 'frame') continue;
    // The upstream node owns the flow direction. A downstream preference
    // is a fallback for old parents that predate explicit layout metadata.
    const horizontal = (source.data.layoutDirection ?? destination.data.layoutDirection) === 'horizontal';
    const primary = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x';
    const clearance = edge.data?.isBranchFromSelection ? 0 : rectOf(source)[horizontal ? 'width' : 'height'];
    const priorViolation = source.position[primary] + clearance - destination.position[primary];
    const nextViolation = nextSource.position[primary] + clearance - nextDestination.position[primary];
    if (nextViolation > Math.max(0, priorViolation) + EPSILON) return fail('context-order');
    if (continuations.has(edge.id)) {
      const priorOffset = Math.abs(source.position[cross] - destination.position[cross]);
      const nextOffset = Math.abs(nextSource.position[cross] - nextDestination.position[cross]);
      if (nextOffset > Math.max(EPSILON, priorOffset) + EPSILON) return fail('chain-alignment');
    }
  }

  // Frames intentionally contain nodes. Existing overlaps may be improved
  // or preserved; newly increased overlaps are refused.
  const solid = proposed.filter((node) => node.data.stepKind !== 'frame');
  const oldRects = new Map(solid.map((node) => [node.id, rectOf(before.get(node.id)!)]));
  const newRects = new Map(solid.map((node) => [node.id, rectOf(node)]));
  for (const a of solid) {
    if (!moved.has(a.id)) continue;
    for (const b of solid) {
      // Only pairs touching a moved card need checking, once per pair.
      if (a.id === b.id || (moved.has(b.id) && a.id > b.id)) continue;
      const prior = overlapArea(oldRects.get(a.id)!, oldRects.get(b.id)!);
      if (overlapArea(newRects.get(a.id)!, newRects.get(b.id)!) > prior + EPSILON) return fail('overlap');
    }
  }
  return { nodes: proposed, changed: true };
}
