import { create, type StateCreator } from 'zustand';
import { browserRenderStore } from '../lib/browser-render-store';
import { persist } from 'zustand/middleware';
import { createIdbObjectStorage } from '../lib/persistence';
import { isViewerMode } from '../lib/viewer';
import type { ThoughtNode } from '../types';
import type { StoreState, PersistedState } from './types';
import { buildContext } from './context-builder';
import { createHistorySlice } from './slices/history';
import { createNodeSlice } from './slices/nodes';
import { createLlmSlice } from './slices/llm';
import { createHighlightSlice } from './slices/highlights';
import { createAttachmentSlice } from './slices/attachments';
import { createReplaySlice } from './slices/replay';
import { createEventSlice } from './slices/events';
import { recoverInterruptedAgentRun, settleAgentActivity } from '../lib/agent-activity';
import { t } from '../i18n';
import { normalizeConversationNode, normalizeConversationEdge } from '../lib/normalize-graph';
import { savedDocxRulerEdges } from '../lib/docx-ruler-data';
import { splitLegacyFileNodes } from '../lib/single-file-nodes';
import { numberCanvasNodes } from '../lib/node-numbers';

// Reset transient UI flags — applied both when persisting and when rehydrating,
// so a refresh mid-stream/mid-edit never restores a node stuck in loading state.
export function stripTransient(nodes: ThoughtNode[]): ThoughtNode[] {
  return nodes.map((node) => {
    const n = normalizeConversationNode(node);
    const data = recoverInterruptedAgentRun(n.data, t('node.stoppedPlaceholder'));
    return {
      ...n,
      selected: false,
      data: {
        ...data,
        isLoading: false,
        isEditing: false,
        isEditingResponse: false,
        questionEditor: undefined,
        responseEditor: undefined,
        restreaming: undefined,
        toolProgress: undefined,
        liveCodexThreadId: undefined,
        pendingApprovals: undefined,
        agentTrace: undefined,
        agentActivity: settleAgentActivity(data.agentActivity, 'interrupted'),
        attachments: (data.attachments || []).map((a) =>
          a.isExtracting ? { ...a, isExtracting: false } : a
        ),
      },
    };
  });
}

// Both slice actions and imperative writes (imports, drops, runtime updates)
// enter through this boundary. Allocate before subscribers or history see them.
function withNodeNumbers(createState: StateCreator<StoreState>): StateCreator<StoreState> {
  return (set, get, api) => {
    const setNumbered: typeof set = (update, replace) => {
      const current = get();
      let patch = typeof update === 'function' ? update(current) : update;
      const incoming = patch.nodes;
      if (incoming && incoming !== current.nodes) {
        const restoring = patch.historyIndex !== undefined && (patch.historyIndex !== current.historyIndex
          || patch.history?.[patch.historyIndex]?.nodes === incoming);
        const numbered = numberCanvasNodes(incoming, current.lastNodeNumber, restoring ? undefined : current.nodes);
        if (numbered.nodes !== incoming || numbered.lastNodeNumber !== current.lastNodeNumber) {
          const history = patch.history?.map(snapshot => snapshot.nodes === incoming ? { ...snapshot, nodes: numbered.nodes } : snapshot);
          patch = { ...patch, ...numbered, ...(history ? { history } : {}) };
        }
      }
      if (replace) set(patch as StoreState, true);
      else set(patch);
    };
    api.setState = setNumbered;
    return createState(setNumbered, get, api);
  };
}

export const useStore = browserRenderStore(create<StoreState>()(persist(withNodeNumbers((...a) => ({
  ...createHistorySlice(...a),
  ...createNodeSlice(...a),
  ...createLlmSlice(...a),
  ...createHighlightSlice(...a),
  ...createAttachmentSlice(...a),
  ...createReplaySlice(...a),
  ...createEventSlice(...a),
})), {
  // Placeholder name — bootProjects() (src/store/projects.ts) points this at
  // the active project's key via persist.setOptions() before rehydrating.
  name: 'thoughtdag',
  version: 1,
  skipHydration: true,
  // Viewer mode is a guest session: nothing it does may touch local storage —
  // decided HERE at store creation so no early set() can race a later swap.
  storage: isViewerMode
    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    : createIdbObjectStorage<PersistedState>(),
  // Persist only the graph. Undo history (full-graph snapshots ×50) and
  // selection are session-scoped and would bloat the stored payload.
  partialize: (state): PersistedState => ({
    nodes: stripTransient(state.nodes),
    lastNodeNumber: state.lastNodeNumber,
    edges: savedDocxRulerEdges(state.nodes, state.edges).map(normalizeConversationEdge).map((e) => (e.selected ? { ...e, selected: false } : e)),
    events: state.events,
  }),
  merge: (persisted, current) => {
    const p = (persisted ?? { nodes: [], edges: [] }) as PersistedState;
    const graph = splitLegacyFileNodes({
      nodes: stripTransient(p.nodes ?? []),
      edges: (p.edges ?? []).map(normalizeConversationEdge).map((e) => (e.selected ? { ...e, selected: false } : e)),
    });
    const { nodes, lastNodeNumber } = numberCanvasNodes(graph.nodes, p.lastNodeNumber);
    const { edges } = graph;
    return {
      ...current,
      nodes,
      lastNodeNumber,
      edges,
      events: p.events ?? [],
      // The restored graph becomes the base snapshot of the undo stack.
      history: [{ nodes, edges }], // shallow baseline — updates never mutate
      historyIndex: 0,
    };
  },
  // Surface rehydration failures — zustand's hydrate() swallows them silently,
  // which would leave the app stuck behind the hydration gate.
  onRehydrateStorage: () => (_state, error) => {
    if (error) console.error('[thoughtdag] rehydration failed:', error);
  },
})));

// Staleness watcher: whenever the graph itself changes (any source — edits,
// generation, undo, project switch, rehydration), recompute which answers
// now predate their upstream. Debounced so streaming chunks coalesce.
let staleTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.nodes === prev.nodes && s.edges === prev.edges) return;
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => useStore.getState().recomputeStaleness(), 400);
});

// Debug: expose store for testing (DEV only)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, { __store: useStore, __buildContext: buildContext });
  // the bundle compiler rides along for protocol fixture tests
  void import('../lib/context-bundle').then((m) => {
    Object.assign(window, { __compileBundle: m.compileContextBundle, __graphSnapshotHash: m.graphSnapshotHash });
  });
}
