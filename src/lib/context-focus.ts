import type { ThoughtEdge, ThoughtNode } from '../types';
import { partitionContext } from './graph';

/** Read-only canvas focus for the union of each selected node's context. */
export function contextFocusForSelection(selectedIds: string[], nodes: ThoughtNode[], edges: ThoughtEdge[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const targets = new Set(selectedIds.filter(id => {
    const node = byId.get(id);
    return node && node.data.stepKind !== 'frame';
  }));
  const ctx = new Set<string>();
  const pathEdgeIds = new Set<string>();
  const refEdgeIds = new Set<string>();
  const structural = edges.filter(edge => !edge.data?.isCrossLink);
  const outgoing = new Map<string, ThoughtEdge[]>();
  for (const edge of structural) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  for (const id of targets) {
    const part = partitionContext(id, nodes, edges);
    const ancestry = part.structural;
    // Archived nodes contribute no content, but can still connect a live
    // upstream contribution to the target.
    const contributors = new Set(ancestry.ordered.filter(node => !node.data.archived).map(node => node.id));
    for (const node of [...part.mainline, ...part.materials]) {
      if (!node.data.archived && !targets.has(node.id)) ctx.add(node.id);
    }
    for (const ref of [...part.references, ...part.materialReferences]) {
      if (ref.source.data.archived) continue;
      if (!targets.has(ref.source.id)) ctx.add(ref.source.id);
      refEdgeIds.add(ref.edge.id);
      // A reference to an archived intermediate still feeds the target.
      contributors.add(ref.edge.target);
    }

    // Keep only structural routes from a contributing node or reference to
    // this target. Reference edges themselves are never traversed upstream.
    const visited = new Set<string>();
    const pending = [...contributors];
    while (pending.length) {
      const source = pending.pop()!;
      if (visited.has(source)) continue;
      visited.add(source);
      for (const edge of outgoing.get(source) ?? []) {
        if (!ancestry.visitedEdgeIds.has(edge.id)) continue;
        pathEdgeIds.add(edge.id);
        pending.push(edge.target);
      }
    }
  }

  const downOut = structural.filter(edge => targets.has(edge.source));
  return { targets, ctx, pathEdgeIds, refEdgeIds,
    down: new Set(downOut.map(edge => edge.target)), downEdgeIds: new Set(downOut.map(edge => edge.id)) };
}
