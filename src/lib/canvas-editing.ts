import { create } from 'zustand';
import type { ThoughtNode } from '../types';
import type { SelectionRegion, SelectionTarget } from './canvas-selection';

/** Layout previews stay separate from the persisted graph and undo history. */
export const useCanvasEditing = create<{
  propertiesRequest: number;
  requestProperties: () => void;
  selectionTarget: SelectionTarget;
  selectionRegion: SelectionRegion | null;
  setSelectionRegion: (region: SelectionRegion | null) => void;
  setSelectionTarget: (target: SelectionTarget) => void;
  layoutOpen: boolean;
  layoutPreview: ThoughtNode[] | null;
  layoutBusy: boolean;
  layoutRequest: number;
  beginLayout: () => number;
  finishLayout: (request: number) => void;
  cancelLayout: () => void;
  setLayoutOpen: (open: boolean) => void;
  setLayoutPreview: (nodes: ThoughtNode[] | null) => void;
  reset: () => void;
}>((set, get) => ({
  propertiesRequest: 0,
  requestProperties: () => set(state => ({ propertiesRequest: state.propertiesRequest + 1 })),
  selectionTarget: 'nodes',
  selectionRegion: null,
  setSelectionRegion: (selectionRegion) => set({ selectionRegion: selectionRegion ? { ...selectionRegion, frameIds: selectionRegion.frameIds ?? [] } : null,
    ...(!selectionRegion ? { selectionTarget: 'nodes' as const } : {}) }),
  setSelectionTarget: (selectionTarget) => set({ selectionTarget }),
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
  setLayoutOpen: (layoutOpen) => set((state) => ({ layoutOpen, layoutPreview: null, layoutBusy: false, layoutRequest: state.layoutRequest + 1 })),
  setLayoutPreview: (layoutPreview) => set({ layoutPreview }),
  reset: () => set((state) => ({ selectionRegion: null, selectionTarget: 'nodes', layoutOpen: false, layoutPreview: null,
    layoutBusy: false, layoutRequest: state.layoutRequest + 1 })),
}));

if (import.meta.env.DEV) Object.assign(window, { __canvasEditing: useCanvasEditing });
