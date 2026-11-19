import { create } from 'zustand';

/** Inspection is a temporary view, independent of graph selection and persistence. */
export const useContextInspection = create<{
  targetId: string | null;
  activeEdgeId: string | null;
  inline: boolean;
  open: (targetId: string) => void;
  trace: (targetId: string, edgeId: string) => void;
  close: () => void;
  setActiveEdge: (edgeId: string | null) => void;
}>((set) => ({
  targetId: null,
  activeEdgeId: null,
  inline: false,
  open: (targetId) => set({ targetId, activeEdgeId: null, inline: false }),
  trace: (targetId, edgeId) => set(state => state.targetId && !state.inline
    ? state : { targetId, activeEdgeId: edgeId, inline: true }),
  close: () => set({ targetId: null, activeEdgeId: null, inline: false }),
  setActiveEdge: (activeEdgeId) => set({ activeEdgeId }),
}));

if (import.meta.env.DEV) Object.assign(window, { __contextInspection: useContextInspection });
