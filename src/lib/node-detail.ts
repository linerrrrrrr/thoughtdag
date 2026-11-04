import type { NodeDetailLevel } from '../types';
import { useStore } from '../store';
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

/** Presentation only. One undo step, with no generation or context mutation. */
export function setNodeDetail(nodeId: string, detailLevel?: NodeDetailLevel) {
  const node = useStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node || node.data.stepKind === 'frame' || node.data.detailLevel === detailLevel) return;
  useStore.getState().pushHistory();
  useStore.setState((state) => ({ nodes: state.nodes.map((item) => item.id === nodeId
    ? { ...item, data: { ...item.data, detailLevel } } : item) }));
  useStore.getState().pushHistory();
}
