import type { ThoughtNode } from '../types';
import { nodeRect, resolveCarriedNodeIds } from './frames';
import { nodeHeight } from './layout';

export type ArrangeAction = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  | 'distribute-horizontal' | 'distribute-vertical';
export type ArrangeReference = 'selection' | 'viewport';
export type ArrangeRect = { x: number; y: number; width: number; height: number };
export type ArrangeReason = 'insufficient' | 'invalid-viewport';
export type ArrangeResult = { nodes: ThoughtNode[]; changed: boolean; reason?: ArrangeReason };

type Unit = { ids: string[]; rect: ArrangeRect };
const EPSILON = 0.01;

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

/**
 * Manual arrangement changes only the selected spatial objects. Chain
 * alignment, arrow direction, and collisions do not constrain placement;
 * unselected objects stay fixed unless carried by a linked frame.
 */
export function arrangeNodes(
  nodes: ThoughtNode[], nodeIds: string[],
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
    let cursor = target[axis];
    for (const unit of ordered) {
      const delta = cursor - unit.rect[axis];
      setDelta(unit, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
      cursor += unit.rect[size] + gap;
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

  let changed = false;
  const proposed = nodes.map((node) => {
    const delta = deltas.get(node.id);
    if (!delta || (Math.abs(delta.x) < EPSILON && Math.abs(delta.y) < EPSILON)) return node;
    changed = true;
    return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
  });
  if (!changed) return { nodes, changed: false };
  return { nodes: proposed, changed: true };
}
