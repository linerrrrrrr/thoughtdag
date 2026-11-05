import { create } from 'zustand';

/** Inspection is a temporary view, independent of graph selection and persistence. */
export const useContextInspection = create<{
  targetId: string | null;
  activeEdgeId: string | null;
  open: (targetId: string) => void;
  close: () => void;
  setActiveEdge: (edgeId: string | null) => void;
}>((set) => ({
  targetId: null,
  activeEdgeId: null,
  open: (targetId) => set({ targetId, activeEdgeId: null }),
  close: () => set({ targetId: null, activeEdgeId: null }),
  setActiveEdge: (activeEdgeId) => set({ activeEdgeId }),
}));

if (import.meta.env.DEV) Object.assign(window, { __contextInspection: useContextInspection });
