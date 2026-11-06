import type { ThoughtNode } from '../types';
import { isFrameNode, nodeRect } from './frames';

export type NodeLayerAction = 'forward' | 'backward' | 'front' | 'back';

/** Legacy frames use -1 as their automatic background placement. */
function explicitLayer(node: ThoughtNode): number | undefined {
  return Number.isFinite(node.zIndex) && !(isFrameNode(node) && node.zIndex === -1) ? node.zIndex : undefined;
}

/** Keep the legacy frame order until an explicit layer operation overrides it. */
export function nodeLayerIndices(nodes: ThoughtNode[]): Map<string, number> {
  const explicit = nodes.flatMap(node => {
    const layer = explicitLayer(node);
    return layer === undefined ? [] : [layer];
  });
  const lowest = explicit.reduce((low, layer) => Math.min(low, layer), 0);
  const highest = explicit.reduce((high, layer) => Math.max(high, layer), 0);
  const frames = nodes.filter(node => isFrameNode(node) && explicitLayer(node) === undefined)
    .map((node, order) => ({ node, order, rect: nodeRect(node) }))
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height || a.order - b.order);
  const automatic = new Map(frames.map(({ node }, index) => [node.id, lowest - frames.length + index]));
  return new Map(nodes.map(node => [node.id, explicitLayer(node) ?? automatic.get(node.id) ?? highest + 1]));
}

/** Back to front; sorting never changes the graph's creation order. */
export function nodeLayerOrder(nodes: ThoughtNode[]): ThoughtNode[] {
  const indices = nodeLayerIndices(nodes);
  return nodes.map((node, order) => ({ node, order }))
    .sort((a, b) => indices.get(a.node.id)! - indices.get(b.node.id)! || a.order - b.order)
    .map(({ node }) => node);
}

function orderedSelection(nodes: ThoughtNode[], ids: string[], action: NodeLayerAction): ThoughtNode[] {
  const ordered = nodeLayerOrder(nodes);
  const selected = new Set(ids);
  if (action === 'front') return [...ordered.filter(node => !selected.has(node.id)), ...ordered.filter(node => selected.has(node.id))];
  if (action === 'back') return [...ordered.filter(node => selected.has(node.id)), ...ordered.filter(node => !selected.has(node.id))];
  if (action === 'forward') {
    for (let index = ordered.length - 2; index >= 0; index--) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index + 1].id)) {
        [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
      }
    }
  } else {
    for (let index = 1; index < ordered.length; index++) {
      if (selected.has(ordered[index].id) && !selected.has(ordered[index - 1].id)) {
        [ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]];
      }
    }
  }
  return ordered;
}

export function canReorderNodeLayer(nodes: ThoughtNode[], ids: string[], action: NodeLayerAction): boolean {
  const previous = nodeLayerOrder(nodes);
  return orderedSelection(nodes, ids, action).some((node, index) => node.id !== previous[index].id);
}

/** Persist only stacking metadata, preserving geometry, data and array order. */
export function reorderNodeLayers(nodes: ThoughtNode[], ids: string[], action: NodeLayerAction): ThoughtNode[] {
  const previous = nodeLayerOrder(nodes);
  const next = orderedSelection(nodes, ids, action);
  if (next.every((node, index) => node.id === previous[index].id)) return nodes;
  const indices = new Map(next.map((node, index) => [node.id, index + 1]));
  return nodes.map(node => node.zIndex === indices.get(node.id) ? node : { ...node, zIndex: indices.get(node.id)! });
}
