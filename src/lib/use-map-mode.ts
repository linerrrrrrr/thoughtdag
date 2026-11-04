import { useSyncExternalStore } from 'react';
import { useStoreApi } from '@xyflow/react';
import { semanticZoomStateFor, type ZoomTier } from './semantic-zoom-state';
import type { LadderLevel } from './ladder-core';

export type { ZoomTier } from './semantic-zoom-state';

/**
 * Semantic zoom, three tiers with hysteresis at both boundaries:
 *
 *   work  (zoom >= 0.9)   — full cards: read the content
 *   map   (~0.4 – 0.9)    — named cards; quiet previews appear when close
 *   glyph (zoom < ~0.35)  — compact names for navigating the whole graph
 *
 * Dual thresholds per boundary prevent flapping; unfolding to work mode
 * happens close enough that only a handful of cards fit the viewport.
 */
export function useZoomTier(): ZoomTier {
  const state = semanticZoomStateFor(useStoreApi());
  return useSyncExternalStore(state.subscribe, () => state.getSnapshot().tier, () => state.getSnapshot().tier);
}

/** Shared with every map label, including labels mounted after a pan or a ladder build. */
export function useLadderLevel(): LadderLevel {
  const state = semanticZoomStateFor(useStoreApi());
  return useSyncExternalStore(state.subscribe, () => state.getSnapshot().level, () => state.getSnapshot().level);
}

/** Legacy boolean view: true whenever cards are folded (map OR glyph). */
export function useMapMode(): boolean {
  return useZoomTier() !== 'work';
}
