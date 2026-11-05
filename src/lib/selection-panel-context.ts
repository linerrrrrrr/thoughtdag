import { createContext, useContext, useLayoutEffect, useRef } from 'react';

export type SelectionDraftBoundary = { dirty: boolean; cancel: () => void };
export const SelectionPanelContext = createContext<Map<symbol, SelectionDraftBoundary> | null>(null);

/** Sections share one card-level Escape boundary; focused editors may nest inside it. */
export function useSelectionDraftBoundary(dirty: boolean, cancel: () => void) {
  const boundaries = useContext(SelectionPanelContext);
  const key = useRef(Symbol('selection-draft'));
  useLayoutEffect(() => {
    const token = key.current;
    boundaries?.set(token, { dirty, cancel });
    return () => { boundaries?.delete(token); };
  }, [boundaries, dirty, cancel]);
}
