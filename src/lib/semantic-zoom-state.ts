import { pickLevel, type LadderLevel } from './ladder-core';

export type ZoomTier = 'work' | 'map' | 'glyph';

export interface SemanticZoomSnapshot {
  zoom: number;
  tier: ZoomTier;
  level: LadderLevel;
}

interface ZoomSource {
  getState: () => { transform: readonly [number, number, number] };
  subscribe: (listener: () => void) => () => void;
}

function nextTier(zoom: number, current: ZoomTier): ZoomTier {
  if (current === 'work') return zoom <= 0.32 ? 'glyph' : zoom <= 0.8 ? 'map' : 'work';
  if (current === 'map') return zoom >= 0.9 ? 'work' : zoom <= 0.32 ? 'glyph' : 'map';
  return zoom >= 0.9 ? 'work' : zoom >= 0.4 ? 'map' : 'glyph';
}

/** One hysteresis history per canvas, independent of which nodes are mounted. */
export function createSemanticZoomState(source: ZoomSource) {
  const zoom = source.getState().transform[2];
  let snapshot: SemanticZoomSnapshot = { zoom, tier: nextTier(zoom, 'work'), level: pickLevel(zoom, null) };
  let published = snapshot;
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;

  const refresh = () => {
    const zoom = source.getState().transform[2];
    if (zoom === snapshot.zoom) return;
    const tier = nextTier(zoom, snapshot.tier);
    const level = pickLevel(zoom, snapshot.level);
    snapshot = { zoom, tier, level };
  };

  return {
    getSnapshot: () => {
      // Also catch the gap between render and subscription, including Strict Mode remounts.
      refresh();
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!unsubscribe) {
        unsubscribe = source.subscribe(() => {
          refresh();
          const changed = snapshot.tier !== published.tier || snapshot.level !== published.level;
          published = snapshot;
          if (changed) for (const notify of listeners) notify();
        });
        refresh();
        published = snapshot;
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      };
    },
  };
}

type SemanticZoomState = ReturnType<typeof createSemanticZoomState>;
const canvasStates = new WeakMap<ZoomSource['getState'], SemanticZoomState>();

export function semanticZoomStateFor(source: ZoomSource): SemanticZoomState {
  // useStoreApi returns a new facade per hook; getState identifies the actual shared store.
  let state = canvasStates.get(source.getState);
  if (!state) {
    state = createSemanticZoomState(source);
    canvasStates.set(source.getState, state);
  }
  return state;
}
