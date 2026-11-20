import { useStore, type StoreApi } from 'zustand';

/** Browser-generated static markup reads the same state as the mounted canvas.
 * Keep getInitialState on the public store for resets and migrations. */
export function browserRenderStore<S, A extends Pick<StoreApi<S>, 'getState' | 'getInitialState' | 'subscribe'>>(bound: A & { getState: () => S }) {
  const source = { ...bound, getInitialState: bound.getState };
  function useBrowserStore(): S;
  function useBrowserStore<T>(selector: (state: S) => T): T;
  function useBrowserStore<T>(selector?: (state: S) => T) {
    const pick = selector ?? ((state: S) => state);
    return useStore(source, pick as (state: S) => S | T);
  }
  return Object.assign(useBrowserStore, bound);
}
