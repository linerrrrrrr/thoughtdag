import { create } from 'zustand';
import type { ThoughtEdge, ThoughtNode } from '../types';
import type { SelectionRegion } from './canvas-selection';

/** Draft geometry is rendered separately from the persisted graph and undo history. */
export const useCanvasEditing = create<{
  edgeId: string | null;
  edgePreview: ThoughtEdge | null;
  selectionTarget: 'nodes' | 'edges';
  selectionRegion: SelectionRegion | null;
  setSelectionRegion: (region: SelectionRegion | null) => void;
  setSelectionTarget: (target: 'nodes' | 'edges') => void;
  layoutOpen: boolean;
  layoutPreview: ThoughtNode[] | null;
  layoutBusy: boolean;
  layoutRequest: number;
  beginLayout: () => number;
  finishLayout: (request: number) => void;
  cancelLayout: () => void;
  setEdgeId: (id: string | null) => void;
  setEdgePreview: (edge: ThoughtEdge | null) => void;
  setLayoutOpen: (open: boolean) => void;
  setLayoutPreview: (nodes: ThoughtNode[] | null) => void;
  reset: () => void;
}>((set, get) => ({
  edgeId: null,
  edgePreview: null,
  selectionTarget: 'nodes',
  selectionRegion: null,
  setSelectionRegion: (selectionRegion) => set({ selectionRegion }),
  setSelectionTarget: (selectionTarget) => set({ selectionTarget, edgeId: null, edgePreview: null }),
  layoutOpen: false,
  layoutPreview: null,
  layoutBusy: false,
  layoutRequest: 0,
  beginLayout: () => {
    const request = get().layoutRequest + 1;
    // Keep an accepted preview visible while applying it. Removing the
    // overlay here would restore original DOM sizes during snapshot capture.
    set({ layoutRequest: request, layoutBusy: true });
    return request;
  },
  finishLayout: (request) => set((state) => state.layoutRequest === request ? { layoutBusy: false } : state),
  cancelLayout: () => set((state) => ({ layoutRequest: state.layoutRequest + 1, layoutBusy: false, layoutPreview: null })),
  setEdgeId: (edgeId) => set((state) => state.edgeId === edgeId ? state
    : edgeId ? { edgeId, edgePreview: null, layoutOpen: false, layoutPreview: null, layoutBusy: false, layoutRequest: state.layoutRequest + 1 } : { edgeId, edgePreview: null }),
  setEdgePreview: (edgePreview) => set({ edgePreview }),
  setLayoutOpen: (layoutOpen) => set((state) => ({ layoutOpen, layoutPreview: null, layoutBusy: false, layoutRequest: state.layoutRequest + 1,
    ...(layoutOpen ? { edgeId: null, edgePreview: null } : {}) })),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  reset: () => set((state) => ({ edgeId: null, edgePreview: null, selectionRegion: null, layoutOpen: false, layoutPreview: null,
    layoutBusy: false, layoutRequest: state.layoutRequest + 1 })),
}));

if (import.meta.env.DEV) Object.assign(window, { __canvasEditing: useCanvasEditing });
