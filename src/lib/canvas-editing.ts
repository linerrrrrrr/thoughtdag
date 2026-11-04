import { create } from 'zustand';
import type { ThoughtEdge, ThoughtNode } from '../types';

/** Draft geometry is rendered separately from the persisted graph and undo history. */
export const useCanvasEditing = create<{
  edgeId: string | null;
  edgePreview: ThoughtEdge | null;
  selectionTarget: 'nodes' | 'edges';
  setSelectionTarget: (target: 'nodes' | 'edges') => void;
  layoutOpen: boolean;
  layoutPreview: ThoughtNode[] | null;
  setEdgeId: (id: string | null) => void;
  setEdgePreview: (edge: ThoughtEdge | null) => void;
  setLayoutOpen: (open: boolean) => void;
  setLayoutPreview: (nodes: ThoughtNode[] | null) => void;
  reset: () => void;
}>((set) => ({
  edgeId: null,
  edgePreview: null,
  selectionTarget: 'nodes',
  setSelectionTarget: (selectionTarget) => set({ selectionTarget, edgeId: null, edgePreview: null }),
  layoutOpen: false,
  layoutPreview: null,
  setEdgeId: (edgeId) => set((state) => state.edgeId === edgeId ? state
    : edgeId ? { edgeId, edgePreview: null, layoutOpen: false, layoutPreview: null } : { edgeId, edgePreview: null }),
  setEdgePreview: (edgePreview) => set({ edgePreview }),
  setLayoutOpen: (layoutOpen) => set(layoutOpen ? { layoutOpen, layoutPreview: null, edgeId: null, edgePreview: null } : { layoutOpen, layoutPreview: null }),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  reset: () => set({ edgeId: null, edgePreview: null, layoutOpen: false, layoutPreview: null }),
}));

if (import.meta.env.DEV) Object.assign(window, { __canvasEditing: useCanvasEditing });
