import { useLayoutEffect } from 'react';
import { useStoreApi } from '@xyflow/react';
import type { ThoughtNode, ThoughtEdge } from '../types';

type FlowApi = ReturnType<typeof useStoreApi<ThoughtNode, ThoughtEdge>>;
let activeFlow: FlowApi | undefined;

/** Expose the current renderer projection to the lazy HTML exporter. */
export function NativeGraphSource() {
  const api = useStoreApi<ThoughtNode, ThoughtEdge>();
  useLayoutEffect(() => {
    activeFlow = api;
    return () => { if (activeFlow === api) activeFlow = undefined; };
  }, [api]);
  return null;
}

export function currentNativeGraph() {
  return activeFlow?.getState();
}
