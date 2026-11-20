import type { NodeDetailLevel } from '../types';
import { useStore } from '../store';
import { isFrameNode } from './frames';
import { useUiStore } from './ui-store';
import { useZoomTier, type ZoomTier } from './use-map-mode';

export const DETAIL_LEVELS = ['compact', 'summary', 'full'] as const;
const TIERS: Record<NodeDetailLevel, ZoomTier> = { compact: 'glyph', summary: 'map', full: 'work' };

/** A node lock wins over the global preference; automatic detail keeps hysteresis. */
export function useNodeDetail(locked?: NodeDetailLevel) {
  const automaticTier = useZoomTier();
  const global = useUiStore((state) => state.canvasDetail);
  const fixed = locked ?? (global === 'auto' ? undefined : global);
  return { tier: fixed ? TIERS[fixed] : automaticTier, fixed };
}

/** All changed node locks form one undo step. Omit the level to follow the global preference. */
export function setNodeDetail(nodeIds: string | readonly string[], detailLevel?: NodeDetailLevel) {
  const targets = new Set(typeof nodeIds === 'string' ? [nodeIds] : nodeIds);
  const state = useStore.getState();
  let changed = false;
  const nodes = state.nodes.map(node => {
    if (!targets.has(node.id) || isFrameNode(node) || node.data.detailLevel === detailLevel) return node;
    changed = true;
    return { ...node, data: { ...node.data, detailLevel } };
  });
  if (!changed) return;
  state.pushHistory();
  useStore.setState({ nodes });
  state.pushHistory();
}
