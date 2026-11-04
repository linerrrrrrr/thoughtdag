import type { ThoughtNode } from '../types';

/** Frames are spatial containers, never members of a rigid node group.
 * Ignore legacy frame metadata without rewriting saved documents. */
export function canvasGroupId(node: ThoughtNode): string | undefined {
  return node.data.stepKind !== 'frame' && typeof node.data.canvasGroupId === 'string'
    ? node.data.canvasGroupId || undefined : undefined;
}

/** Explicit groups are independent of context edges and spatial frames. */
export function expandGroupSelection(nodes: ThoughtNode[], ids: string[]): string[] {
  const selected = new Set(ids);
  const groups = new Set(nodes.filter((n) => selected.has(n.id) && canvasGroupId(n)).map(canvasGroupId));
  return nodes.filter((n) => selected.has(n.id) || (canvasGroupId(n) && groups.has(canvasGroupId(n)))).map((n) => n.id);
}

export function canGroup(nodes: ThoughtNode[], ids: string[]): boolean {
  const selected = new Set(expandGroupSelection(nodes, ids));
  if (nodes.some((n) => selected.has(n.id) && n.data.stepKind === 'frame')) return false;
  return new Set(nodes.filter((n) => selected.has(n.id)).map((n) => canvasGroupId(n) ? `group:${canvasGroupId(n)}` : `node:${n.id}`)).size > 1;
}

export function canUngroup(nodes: ThoughtNode[], ids: string[]): boolean {
  const selected = new Set(ids);
  return nodes.some((n) => selected.has(n.id) && !!canvasGroupId(n));
}

/** Only currently ungrouped members can rejoin an old group. */
export function regroupCandidates(nodes: ThoughtNode[], ids: string[]): Map<string, string[]> {
  const selected = new Set(ids);
  const previous = new Set(nodes.filter((n) => selected.has(n.id) && n.data.stepKind !== 'frame' && !canvasGroupId(n) && n.data.previousCanvasGroupId).map((n) => n.data.previousCanvasGroupId!));
  const candidates = new Map<string, string[]>();
  for (const n of nodes) {
    const group = n.data.previousCanvasGroupId;
    if (n.data.stepKind !== 'frame' && !canvasGroupId(n) && group && previous.has(group)) {
      const members = candidates.get(group) ?? [];
      members.push(n.id);
      candidates.set(group, members);
    }
  }
  for (const [id, members] of candidates) if (members.length < 2) candidates.delete(id);
  return candidates;
}

export const canRegroup = (nodes: ThoughtNode[], ids: string[]): boolean => regroupCandidates(nodes, ids).size > 0;

/** A selected/deselected member applies the same selection to its group.
 * Selecting wins when React Flow switches directly between two members. */
export function applyGroupSelectionChanges(nodes: ThoughtNode[], changes: { id: string; selected: boolean }[]): ThoughtNode[] {
  const changed = new Map(changes.map((change) => [change.id, change.selected]));
  const selectedGroups = new Set<string>();
  const deselectedGroups = new Set<string>();
  for (const node of nodes) {
    const group = canvasGroupId(node);
    if (!group || !changed.has(node.id)) continue;
    (changed.get(node.id) ? selectedGroups : deselectedGroups).add(group);
  }
  if (!selectedGroups.size && !deselectedGroups.size) return nodes;
  return nodes.map((node) => {
    const group = canvasGroupId(node);
    const selected = group && selectedGroups.has(group) ? true : group && deselectedGroups.has(group) ? false : node.selected;
    return selected === node.selected ? node : { ...node, selected };
  });
}
