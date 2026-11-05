import type { StateCreator } from 'zustand';
import type { ThoughtNode, ThoughtEdge } from '../../types';
import { generateId, countTokens } from '../../utils';
import { COLORS, FRAME_COLORS } from '../../lib/constants';
import { healLegacyNoteEdges, autoLayout, placeNewNodes, estimateNodeHeight, nodeHeight } from '../../lib/layout';
import { getDescendantIds, walkUpAncestors } from '../../lib/graph';
import { referenceBlockContent, upstreamFingerprint, buildContext } from '../context-builder';
import { pruneHighlights } from '../../lib/highlight-match';
import { toast } from '../../lib/ui-store';
import { t, fmt, type MessageKey } from '../../i18n';
import type { StoreState, NodeSlice } from '../types';
import { condenseGuard } from '../../lib/condense-guard';
import { activeAbortControllers } from '../streaming';
import { arrangeNodes } from '../../lib/arrange-selection';
import { fitFrameNodes, frameContentIds, isFrameNode, nodesRect } from '../../lib/frames';
import { applySelectionGeometry } from '../../lib/node-geometry';
import { applyEdgeSettings, applyBatchEdgeSettings } from '../../lib/edge-edit';
import { canvasLayoutInputKey, planCanvasLayout } from '../../lib/canvas-layout';

/** Do not propagate retired metadata when copying older saved documents. */
function copiedNodeData(data: ThoughtNode['data']): ThoughtNode['data'] {
  const copy = { ...data };
  Reflect.deleteProperty(copy, 'canvasGroupId');
  Reflect.deleteProperty(copy, 'previousCanvasGroupId');
  return copy;
}

// A node that goes while it is still generating takes its stream with it:
// the Stop button went with the card, so the only way to end the call is
// here (#49). The stream's own writes to a removed node are no-ops.
const abortGenerations = (ids: Iterable<string>): void => {
  for (const id of ids) {
    const controller = activeAbortControllers.get(id);
    if (!controller) continue;
    controller.abort();
    activeAbortControllers.delete(id);
  }
};

export const createNodeSlice: StateCreator<StoreState, [], [], NodeSlice> = (set, get, api) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedNodeIds: [],

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSelectedNodeId: (id) => {
    const ids = id && get().nodes.some(node => node.id === id) ? [id] : [];
    const selected = new Set(ids);
    set((state) => ({
      selectedNodeId: ids.length === 1 ? ids[0] : null,
      selectedNodeIds: ids,
      // Programmatic selection and React Flow outlines share one selection.
      nodes: state.nodes.map((n) => !!n.selected === selected.has(n.id) ? n : { ...n, selected: selected.has(n.id) }),
    }));
  },
  setSelectedNodeIds: (ids) => {
    const requested = new Set(ids);
    const selectedIds = get().nodes.filter(node => requested.has(node.id)).map(node => node.id);
    const selected = new Set(selectedIds);
    set((state) => ({
      selectedNodeIds: selectedIds,
      selectedNodeId: selectedIds.length === 1 ? selectedIds[0] : null,
      nodes: state.nodes.map((n) => !!n.selected === selected.has(n.id) ? n : { ...n, selected: selected.has(n.id) }),
    }));
  },

  setSelectionGeometry: (ids, patch) => {
    if (condenseGuard()) return;
    const patches = Array.isArray(patch) ? patch : [patch];
    const nodes = patches.reduce((current, edit) => applySelectionGeometry(current, ids, edit), get().nodes);
    if (nodes === get().nodes) return;
    get().pushHistory();
    set({ nodes });
    get().pushHistory();
  },

  deleteNode: (nodeId: string) => {
    if (condenseGuard()) return;
    get().logEvent('delete', nodeId, { n: 1 });
    get().pushHistory();
    const { edges } = get();
    const descendants = getDescendantIds(nodeId, edges);
    const removeIds = new Set([nodeId, ...descendants]);
    abortGenerations(removeIds);
    set((state) => ({
      nodes: state.nodes.filter((n) => !removeIds.has(n.id)),
      edges: state.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
    }));
    get().pushHistory();
    // deletion IS unsubscription — see canonical.unsubscribeOrphanedSessions
    void import('../../lib/atlas/canonical').then((m) => m.unsubscribeOrphanedSessions());
  },

  deleteEdges: (edgeIds: string[]) => {
    if (condenseGuard()) return;
    get().logEvent('disconnect', edgeIds[0], { n: edgeIds.length });
    const remove = new Set(edgeIds);
    if (!get().edges.some((e) => remove.has(e.id))) return;
    get().pushHistory();
    set((state) => ({ edges: state.edges.filter((e) => !remove.has(e.id)) }));
    get().pushHistory();
  },

  editResponse: (nodeId: string, response: string) => {
    if (condenseGuard()) return;
    get().logEvent('edit-response', nodeId, { chars: response.length });
    get().pushHistory();
    const tokenCount = countTokens(get().nodes.find((n) => n.id === nodeId)?.data.question + response || response);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                response,
                responses: n.data.responses.map((r, i) => (i === n.data.responseIndex ? response : r)),
                // a hand-edited answer invalidates its auto summary
                summaries: n.data.summaries?.map((s, i) => (i === n.data.responseIndex ? undefined : s)),
                summaryTypes: n.data.summaryTypes?.map((s, i) => (i === n.data.responseIndex ? undefined : s)),
                summaryTopics: n.data.summaryTopics?.map((s, i) => (i === n.data.responseIndex ? undefined : s)),
                // the zoom ladder was selected from the old text; the plaque falls back to a local one
                summaryLadders: n.data.summaryLadders?.map((s, i) => (i === n.data.responseIndex ? undefined : s)),
                // timeline: the human revised this version (generation stamp stays)
                editedAts: n.data.responses.map((_, i) => (i === n.data.responseIndex ? new Date().toISOString() : n.data.editedAts?.[i])),
                highlights: pruneHighlights(n.data.highlights, response),
                isEditingResponse: false,
                tokenCount,
              },
            }
          : n
      ),
    }));
    get().pushHistory();
  },

  toggleCollapse: (nodeId: string) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // folding moves everything below it: one step of its own
    get().pushHistory();

    // Current height is measured; the post-toggle height must be estimated
    const oldHeight = nodeHeight(node);
    const newHeight = node.data.isCollapsed && node.height != null
      ? node.height
      : estimateNodeHeight({ ...node, data: { ...node.data, isCollapsed: !node.data.isCollapsed } });
    const delta = newHeight - oldHeight;

    // Find all descendants of this node
    const descendants = getDescendantIds(nodeId, get().edges);
    const descSet = new Set(descendants);

    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id === nodeId) {
          return { ...n, data: { ...n.data, isCollapsed: !n.data.isCollapsed } };
        }
        // Shift descendants vertically by delta
        if (descSet.has(n.id)) {
          return { ...n, position: { ...n.position, y: n.position.y + delta } };
        }
        return n;
      }),
    }));
    get().pushHistory();
  },

  setEditing: (nodeId: string, editing: boolean, surface = 'canvas') => {
    if (editing && condenseGuard()) return;
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, isEditing: editing, questionEditor: editing ? surface : undefined } } : n
      ),
    }));
  },

  setEditingResponse: (nodeId: string, editing: boolean, surface = 'canvas') => {
    if (editing && condenseGuard()) return;
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, isEditingResponse: editing, responseEditor: editing ? surface : undefined } } : n
      ),
    }));
  },

  duplicateNode: (nodeId: string) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    get().pushHistory();
    const id = generateId();
    const newNode: ThoughtNode = {
      id,
      type: 'thought',
      position: { x: 0, y: 0 },
      dragHandle: '.drag-handle',
      data: {
        ...copiedNodeData(node.data),
        isCollapsed: true,
        isEditing: false,
        isEditingResponse: false,
        isLoading: false,
        highlights: node.data.highlights.map((h) => ({ ...h, id: generateId() })),
      },
    };
    // Find parent edge and create same type of edge
    const parentEdge = get().edges.find((e) => e.target === nodeId);
    const newEdge = parentEdge ? {
      ...parentEdge,
      id: `edge-${parentEdge.source}-${id}`,
      target: id,
    } : null;
    const newEdges = newEdge ? [...get().edges, newEdge] : get().edges;
    const newNodes = placeNewNodes([...get().nodes, newNode], newEdges, [id]);
    set({ nodes: newNodes, edges: newEdges, selectedNodeId: id });
    get().pushHistory();
  },

  addCrossLink: (sourceId: string, targetId: string) => {
    const { edges, nodes } = get();
    // Block only an identical edge. The REVERSE direction is allowed on
    // purpose: writer->critic->writer loops are how auto-refresh iterates
    // (context walks are visited-guarded, and auto-chains are budgeted).
    const exists = edges.some((e) => e.source === sourceId && e.target === targetId);
    if (exists) return;
    // MATERIAL sources wire SOLID by default. A dashed reference carries a
    // node's Q/A transcript — a material has none, so a dashed wire from a
    // material is a nearly-empty gesture that LOOKS like "file connected"
    // (the exact misreading a real canvas produced). Solid is the only
    // honest default; the toast offers the way back down.
    const srcNode = nodes.find((x) => x.id === sourceId);
    if (srcNode && ['note', 'file', 'link'].includes(srcNode.data.stepKind ?? '')) {
      get().pushHistory();
      const matEdge: ThoughtEdge = {
        id: `edge-${sourceId}-${targetId}`,
        source: sourceId, sourceHandle: 'continue',
        target: targetId, targetHandle: 'top',
        type: 'smoothstep',
        style: { stroke: COLORS.accent, strokeDasharray: '8 4', strokeWidth: 2 },
        animated: true,
        data: { isCrossLink: true, createdAt: new Date().toISOString() },
      };
      set((state) => ({ edges: [...state.edges, matEdge] }));
      get().logEvent('connect', matEdge.id);
      // structural conversion reuses the cycle guard, styling, layout and
      // staleness reaction in one place; on refusal the edge stays dashed.
      get().setEdgeStructural(matEdge.id, true);
      const converted = get().edges.find((e) => e.id === matEdge.id);
      if (converted && !converted.data?.isCrossLink) {
        const ctx = buildContext(sourceId, get().nodes, get().edges);
        const tok = ctx.messages.reduce((s2, m) => s2 + countTokens(m.content), 0);
        toast('success', fmt(t('edge.materialWiredFull'), { n: tok.toLocaleString() }), 8000, {
          label: t('edge.materialMakeQuote'),
          run: () => get().setEdgeStructural(matEdge.id, false),
        });
      }
      return;
    }
    get().pushHistory();
    // Anchor by geometry: a reference into a node right below reads as part
    // of the vertical grammar (bottom→top); anything else routes via the
    // side channel so dashed lines never cut across the chain columns.
    const src = nodes.find((n) => n.id === sourceId);
    const tgt = nodes.find((n) => n.id === targetId);
    const vertical = !!src && !!tgt
      && tgt.position.y > src.position.y + 60
      && Math.abs(tgt.position.x - src.position.x) < 320;
    const newEdge: ThoughtEdge = {
      id: `crosslink-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle: vertical ? 'continue' : 'branch',
      target: targetId,
      targetHandle: vertical ? 'top' : 'left',
      type: 'smoothstep',
      style: { stroke: COLORS.accent, strokeDasharray: '8 4', strokeWidth: 2 },
      animated: true,
      // createdAt only here: manual connect is the one edge born
      // independently of a node (elsewhere edge time = target's createdAt)
      data: { isCrossLink: true, createdAt: new Date().toISOString() },
    };
    set((state) => ({ edges: [...state.edges, newEdge] }));
    get().logEvent('connect', newEdge.id);
    get().pushHistory();
    // Price tag at the moment of connection — BOTH prices, so it's a
    // decision, not a nudge. When the source has no upstream chain the two
    // depths are the same thing; asking would be noise, so we don't.
    if (src && !['note', 'file', 'link'].includes(src.data.stepKind ?? '')) {
      const { ordered } = walkUpAncestors(sourceId, nodes, edges.filter((e) => !e.data?.isCrossLink));
      const chain = ordered.filter((n) => n.id !== sourceId && !['note', 'file', 'link'].includes(n.data.stepKind ?? ''));
      if (chain.length > 0) {
        const quoteTok = countTokens(referenceBlockContent({ source: src, edge: newEdge, depth: 'quote', chain }));
        // Full tier = SOLID wiring: the target reads the source's whole
        // upstream, files included — price the real thing, not a transcript.
        const ctx = buildContext(sourceId, nodes, edges);
        const fullTok = ctx.messages.reduce((sum, m) => sum + countTokens(m.content), 0)
          + countTokens(src.data.question + src.data.response);
        toast('info', fmt(t('edge.linkedQuote'), { n: quoteTok }), 8000, {
          label: fmt(t('edge.makeFull'), { m: fullTok }),
          run: () => get().setEdgeStructural(newEdge.id, true),
        });
      }
    }
  },

  staleIds: [],
  staleFps: {},
  staleVerdicts: {},
  setStaleVerdicts: (verdicts) => set((s) => ({ staleVerdicts: { ...s.staleVerdicts, ...verdicts } })),

  // A node is stale when the live fingerprint of everything it depended on
  // (materials, references, ancestor turns) no longer matches the one
  // recorded when its answer was generated. Nodes generated before
  // provenance recording (no lastContextHash) are never flagged — honest:
  // unknown provenance, not known-stale. Re-running a node re-records.
  recomputeStaleness: () => {
    const { nodes, edges } = get();
    const stale: string[] = [];
    const fps: Record<string, string> = {};
    for (const n of nodes) {
      if (!n.data.lastContextHash || !n.data.response) continue;
      if (['note', 'file', 'link', 'frame'].includes(n.data.stepKind ?? '')) continue;
      // an archived answer feeds no context: replaying it would only cost model calls
      if (n.data.archived) continue;
      const fp = upstreamFingerprint(n.id, nodes, edges);
      if (fp !== n.data.lastContextHash) { stale.push(n.id); fps[n.id] = fp; }
    }
    const prevFps = get().staleFps;
    const prev = get().staleIds;
    if (prev.length === stale.length && prev.every((id, i) => id === stale[i] && prevFps[id] === fps[id])) return;
    set({ staleIds: stale, staleFps: fps });
    // with a judge, each newly stale node is asked about: does the change matter?
    if (stale.length) void import('../../lib/stale-judge').then((m) => m.judgeStaleness()).catch(() => undefined);
  },

  setEdgeStructural: (edgeId: string, structural: boolean) => {
    const { nodes, edges } = get();
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    if (structural) {
      // Dashed → solid: the target will read the source's whole upstream.
      // Guard the DAG: if the source already sits downstream of the target
      // along structural edges, going solid would close a cycle.
      const structuralEdges = edges.filter((e) => !e.data?.isCrossLink);
      const { ordered } = walkUpAncestors(edge.source, nodes, structuralEdges);
      if (ordered.some((n) => n.id === edge.target)) {
        toast('error', t('edge.cycleBlocked'));
        return;
      }
    }
    get().pushHistory();
    get().logEvent(structural ? 'connect' : 'disconnect', edgeId, { convert: true });
    set((state) => ({
      edges: state.edges.map((e) => {
        if (e.id !== edgeId) return e;
        if (structural) {
          const rest = { ...(e.data ?? {}) };
          delete rest.isCrossLink; delete rest.contextDepth; delete rest.isWatch;
          return {
            ...e,
            sourceHandle: 'continue', targetHandle: 'top',
            animated: false,
            style: { stroke: COLORS.accent, strokeWidth: 2 },
            markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
            data: rest,
          };
        }
        return {
          ...e,
          animated: true,
          style: { stroke: COLORS.accent, strokeDasharray: '8 4', strokeWidth: 2 },
          markerEnd: { type: 'arrowclosed' as const, color: COLORS.accent, width: 18, height: 18 },
          data: { ...(e.data ?? {}), isCrossLink: true, contextDepth: undefined },
        };
      }),
    }));
    get().pushHistory();
  },

  updateEdgeSettings: (edgeId, settings) => {
    const { nodes, edges } = get();
    const edge = edges.find((item) => item.id === edgeId);
    if (!edge) return { ok: false, error: 'missing-node' };
    const result = applyEdgeSettings(edge, nodes, edges, settings);
    if (!result.ok) return result;
    if (JSON.stringify(result.edge) === JSON.stringify(edge)) return { ok: true };
    get().pushHistory();
    set({ edges: edges.map((item) => item.id === edgeId ? result.edge : item) });
    get().pushHistory();
    return { ok: true };
  },

  updateSelectedEdges: (ids, patch) => {
    if (condenseGuard()) return { ok: false, error: 'restricted' };
    const { nodes, edges } = get();
    const result = applyBatchEdgeSettings(nodes, edges, ids, patch);
    if (!result.ok) return result;
    if (result.edges === edges) return { ok: true };
    get().pushHistory();
    set({ edges: result.edges });
    get().pushHistory();
    return { ok: true };
  },

  applyCanvasLayout: async (options, selectedIds, isCurrent) => {
    const state = get();
    const input = canvasLayoutInputKey(state.nodes, state.edges);
    const selection = [...state.selectedNodeIds].sort().join('\0');
    // Project boot depends on the main store; load this guard only after the
    // store has initialized instead of creating a module-evaluation cycle.
    const { useProjects } = await import('../projects');
    const current = get();
    if (isCurrent?.() === false || current.history !== state.history || current.historyIndex !== state.historyIndex
      || [...current.selectedNodeIds].sort().join('\0') !== selection
      || canvasLayoutInputKey(current.nodes, current.edges) !== input) return { ok: false, error: 'stale-layout' };
    const project = useProjects.getState().activeId;
    let stale = false;
    // A layout must not undo edits made while its worker was computing. Keep
    // even transient edits/undo/project switches invalidating the request.
    const stopGraph = api.subscribe((next) => {
      if (stale) return;
      stale = next.history !== state.history || next.historyIndex !== state.historyIndex
        || [...next.selectedNodeIds].sort().join('\0') !== selection
        || canvasLayoutInputKey(next.nodes, next.edges) !== input;
    });
    const stopProject = useProjects.subscribe((next) => { if (next.activeId !== project) stale = true; });
    let result;
    try { result = await planCanvasLayout(state.nodes, state.edges, options, selectedIds); }
    catch { return { ok: false, error: 'layout-failed' }; }
    finally { stopGraph(); stopProject(); }
    if (stale || isCurrent?.() === false) return { ok: false, error: 'stale-layout' };
    if (result.error) return { ok: false, error: result.error };
    if (result.nodes === state.nodes) return { ok: true };
    const planned = new Map(result.nodes.map((node) => [node.id, node]));
    let changed = false;
    const nodes = get().nodes.map((node) => {
      const draft = planned.get(node.id);
      if (!draft || (draft.position.x === node.position.x && draft.position.y === node.position.y
        && draft.width === node.width && draft.height === node.height
        && draft.data.layoutDirection === node.data.layoutDirection && draft.data.edgeRouteDefault === node.data.edgeRouteDefault)) return node;
      changed = true;
      const resized = draft.width !== node.width || draft.height !== node.height;
      return { ...node, position: draft.position, width: draft.width, height: draft.height,
        measured: resized ? draft.measured : node.measured,
        style: resized ? { ...node.style, width: draft.style?.width, height: draft.style?.height } : node.style,
        data: { ...node.data, layoutDirection: draft.data.layoutDirection, edgeRouteDefault: draft.data.edgeRouteDefault } };
    });
    if (!changed) return { ok: true };
    get().pushHistory();
    set({ nodes });
    get().pushHistory();
    return { ok: true };
  },

  navigateVersion: (nodeId: string, direction: 'prev' | 'next') => {
    // the version shown is the one downstream reads: switching is a step
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const { responses, responseIndex } = n.data;
        let newIndex = direction === 'prev' ? responseIndex - 1 : responseIndex + 1;
        if (newIndex < 0) newIndex = responses.length - 1;
        if (newIndex >= responses.length) newIndex = 0;
        return {
          ...n,
          // navigating away from a failed placeholder reclaims the older answer;
          // the question mirrors its version's wording (a version is a PAIR)
          data: { ...n.data, responseIndex: newIndex, response: responses[newIndex], agentActivity: undefined, question: n.data.questions?.[newIndex] ?? n.data.question, generationFailed: undefined, highlights: pruneHighlights(n.data.highlights, responses[newIndex]) },
        };
      }),
    }));
    get().pushHistory();
  },

  deleteVersion: (nodeId: string, versionIndex: number) => {
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const newResponses = n.data.responses.filter((_, i) => i !== versionIndex);
        if (newResponses.length === 0) return n; // Don't delete last version
        const newIndex = Math.min(n.data.responseIndex, newResponses.length - 1);
        return {
          ...n,
          data: {
            ...n.data,
            responses: newResponses,
            responseIndex: newIndex,
            response: newResponses[newIndex],
            questions: n.data.questions?.filter((_, i) => i !== versionIndex),
            question: n.data.questions?.filter((_, i) => i !== versionIndex)[newIndex] ?? n.data.question,
            summaries: n.data.summaries?.filter((_, i) => i !== versionIndex),
            generatedBy: n.data.generatedBy?.filter((_, i) => i !== versionIndex),
            summaryTypes: n.data.summaryTypes?.filter((_, i) => i !== versionIndex),
            reasonings: n.data.reasonings?.filter((_, i) => i !== versionIndex),
            reasoningTokens: n.data.reasoningTokens?.filter((_, i) => i !== versionIndex),
            agentActivities: n.data.agentActivities?.filter((_, i) => i !== versionIndex),
            agentActivity: undefined,
            generatedAts: n.data.generatedAts?.filter((_, i) => i !== versionIndex),
            editedAts: n.data.editedAts?.filter((_, i) => i !== versionIndex),
            highlights: pruneHighlights(n.data.highlights, newResponses[newIndex]),
          },
        };
      }),
    }));
    get().pushHistory();
  },

  relayout: () => {
    if (condenseGuard()) return;
    get().pushHistory();
    set((state) => {
      // one-click relayout also heals legacy mirror wiring (notes once
      // sat INSIDE the chain) — otherwise no relayout could ever fix
      // those canvases and the button would look broken
      const edges = healLegacyNoteEdges(state.nodes, state.edges);
      return { nodes: autoLayout(state.nodes, edges), edges };
    });
    get().pushHistory();
  },

  setArchived: (nodeIds: string[], archived: boolean) => {
    const ids = new Set(nodeIds);
    get().pushHistory();
    get().logEvent(archived ? 'archive' : 'unarchive', nodeIds[0], { n: nodeIds.length });
    set((state) => ({
      nodes: state.nodes.map((n) =>
        ids.has(n.id)
          ? { ...n, data: { ...n.data, archived: archived || undefined, archivedAt: archived ? new Date().toISOString() : undefined } }
          : n
      ),
    }));
    get().pushHistory();
  },

  setNodeModel: (nodeId: string, model: string | undefined) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, model } } : n
      ),
    }));
  },

  arrangeSelection: (nodeIds, action, reference, viewport) => {
    if (condenseGuard()) return;
    const state = get();
    const result = arrangeNodes(state.nodes, state.edges, nodeIds, action, reference, viewport);
    if (result.reason) {
      toast('info', t(`arrange.blocked.${result.reason}` as MessageKey));
      return;
    }
    if (!result.changed) return;
    state.pushHistory();
    set({ nodes: result.nodes });
    get().pushHistory();
  },

  createFrameFromSelection: (nodeIds) => {
    if (condenseGuard()) return undefined;
    const state = get();
    const ids = new Set(nodeIds);
    const members = state.nodes.filter((node) => ids.has(node.id));
    if (!members.length || members.some((node) => node.data.stepKind === 'frame')) return undefined;
    const bounds = nodesRect(members)!;
    const id = generateId();
    const frame: ThoughtNode = {
      id, type: 'thought',
      position: { x: bounds.x - 32, y: bounds.y - 64 },
      width: Math.max(280, bounds.width + 64),
      height: Math.max(180, bounds.height + 96),
      zIndex: -1, dragHandle: '.drag-handle', selected: true,
      data: {
        question: '', stepKind: 'frame', frameCarry: true,
        response: '', responses: [], responseIndex: -1,
        isCollapsed: false, isEditing: false, isEditingResponse: false, isLoading: false,
        tokenCount: 0, highlights: [], highlightMode: 'tag',
        attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
        roleMode: 'inherit', isRoot: false, isBranch: false,
      },
    };
    state.pushHistory();
    set({
      nodes: [...state.nodes.map((node) => node.selected ? { ...node, selected: false } : node), frame],
      selectedNodeId: id, selectedNodeIds: [id],
    });
    get().pushHistory();
    return id;
  },

  setFrameProperties: (frameIds, patch) => {
    if (condenseGuard()) return;
    if (patch.title !== undefined && typeof patch.title !== 'string') return;
    if (patch.color !== undefined && !Object.hasOwn(FRAME_COLORS, patch.color)) return;
    if (patch.carry !== undefined && typeof patch.carry !== 'boolean') return;
    const state = get();
    const requested = new Set(frameIds);
    const frames = state.nodes.filter(node => isFrameNode(node) && requested.has(node.id));
    const title = frames.length === 1 && patch.title !== undefined ? patch.title.trim() : undefined;
    let changed = false;
    const nodes = state.nodes.map(node => {
      if (!isFrameNode(node) || !requested.has(node.id)) return node;
      const data = { ...node.data };
      if (title !== undefined) data.question = title;
      if (patch.color !== undefined) data.frameColor = patch.color;
      if (patch.carry !== undefined) data.frameCarry = patch.carry;
      if (data.question === node.data.question
        && (data.frameColor ?? 'gray') === (node.data.frameColor ?? 'gray')
        && (data.frameCarry !== false) === (node.data.frameCarry !== false)) return node;
      changed = true;
      return { ...node, data };
    });
    if (!changed) return;
    state.pushHistory();
    set({ nodes });
    get().pushHistory();
  },

  selectFrameContents: (frameIds, includeFrames = false) => {
    const nodes = get().nodes;
    const roots = new Set(frameIds);
    const selected = new Set(frameContentIds(nodes, frameIds, includeFrames));
    if (includeFrames) for (const node of nodes) if (isFrameNode(node) && roots.has(node.id)) selected.add(node.id);
    get().setSelectedNodeIds(nodes.filter(node => selected.has(node.id)).map(node => node.id));
  },

  fitFramesToContents: (frameIds) => {
    if (condenseGuard()) return;
    const state = get();
    const nodes = fitFrameNodes(state.nodes, frameIds);
    if (nodes === state.nodes) return;
    state.pushHistory();
    set({ nodes });
    get().pushHistory();
  },

  duplicateFrames: (frameIds, withContents) => {
    if (condenseGuard()) return;
    const nodes = get().nodes;
    const requested = new Set(frameIds);
    const roots = nodes.filter(node => isFrameNode(node) && requested.has(node.id)).map(node => node.id);
    const selected = new Set(withContents ? [...roots, ...frameContentIds(nodes, roots, true)] : roots);
    get().duplicateSelection(nodes.filter(node => selected.has(node.id)).map(node => node.id));
  },

  alignSelection: async (nodeIds: string[]) => {
    if (nodeIds.length < 2) return;
    const selected = new Set(nodeIds);
    const { nodes } = get();
    if (nodes.filter(node => selected.has(node.id)).length < 2) return;
    if (nodes.some((node) => selected.has(node.id) && node.data.stepKind === 'frame')) {
      toast('info', t('arrange.nodesOnly'));
      return;
    }

    const first = nodes.find((node) => selected.has(node.id));
    const result = await get().applyCanvasLayout({
      method: 'chains', direction: first?.data.layoutDirection ?? 'vertical',
      density: 'standard', route: first?.data.edgeRouteDefault ?? 'auto',
    }, nodeIds);
    if (!result.ok) toast('info', t(result.error === 'stale-layout' ? 'canvasLayout.stale' : 'canvasLayout.boundaryBlocked'));
  },

  batchDelete: (nodeIds: string[]) => {
    if (condenseGuard()) return;
    get().logEvent('delete', nodeIds[0], { n: nodeIds.length });
    get().pushHistory();
    const removeSet = new Set(nodeIds);
    abortGenerations(removeSet);
    set((state) => ({
      nodes: state.nodes.filter((n) => !removeSet.has(n.id)),
      edges: state.edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target)),
      selectedNodeId: null,
      selectedNodeIds: [],
    }));
    get().pushHistory();
    // deletion IS unsubscription — see canonical.unsubscribeOrphanedSessions
    void import('../../lib/atlas/canonical').then((m) => m.unsubscribeOrphanedSessions());
  },

  duplicateSelection: (nodeIds: string[]) => {
    const { nodes, edges } = get();
    const selected = new Set(nodeIds);
    const originals = nodes.filter((n) => selected.has(n.id));
    if (originals.length === 0) return;
    get().pushHistory();

    const boxOf = (n: ThoughtNode) => ({
      x: n.position.x,
      y: n.position.y,
      w: n.measured?.width ?? n.width ?? 520,
      h: n.measured?.height ?? n.height ?? nodeHeight(n),
    });

    // Selection bounding box → candidate landing spots (right, below,
    // diagonal, then farther out) — first collision-free offset wins.
    const boxes = originals.map(boxOf);
    const bbox = {
      x: Math.min(...boxes.map((b) => b.x)),
      y: Math.min(...boxes.map((b) => b.y)),
      right: Math.max(...boxes.map((b) => b.x + b.w)),
      bottom: Math.max(...boxes.map((b) => b.y + b.h)),
    };
    const GAP = 80;
    const stepX = bbox.right - bbox.x + GAP;
    const stepY = bbox.bottom - bbox.y + GAP;
    const candidates: { dx: number; dy: number }[] = [];
    for (let k = 1; k <= 6; k++) {
      candidates.push({ dx: k * stepX, dy: 0 }, { dx: 0, dy: k * stepY }, { dx: k * stepX, dy: k * stepY });
    }
    // Frames are background regions, not obstacles — copies may land inside one.
    const obstacles = nodes.filter((n) => n.data.stepKind !== 'frame').map(boxOf);
    const overlaps = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const offset = candidates.find((c) =>
      !boxes.some((b) => obstacles.some((o) => overlaps({ ...b, x: b.x + c.dx, y: b.y + c.dy }, o)))
    ) ?? { dx: stepX, dy: stepY };

    // Attachments are shared by REFERENCE (content is never copied) but get
    // NEW ids: exclude/include and digest links work by id, so shared ids
    // would entangle the copy with its source.
    const idMap = new Map<string, string>();
    const attIdMap = new Map<string, string>();
    for (const n of originals) {
      idMap.set(n.id, generateId());
      for (const a of n.data.attachments ?? []) attIdMap.set(a.id, generateId());
    }
    const remapAttIds = (ids?: string[]) => (ids ?? []).map((x) => attIdMap.get(x) ?? x);

    const copies: ThoughtNode[] = originals.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + offset.dx, y: n.position.y + offset.dy },
      selected: true,
      data: {
        ...copiedNodeData(n.data),
        attachments: (n.data.attachments ?? []).map((a) => ({ ...a, id: attIdMap.get(a.id)! })),
        excludedAttachmentIds: remapAttIds(n.data.excludedAttachmentIds),
        includedAttachmentIds: remapAttIds(n.data.includedAttachmentIds),
        digestOf: n.data.digestOf ? (attIdMap.get(n.data.digestOf) ?? n.data.digestOf) : undefined,
        highlights: (n.data.highlights ?? []).map((h) => ({ ...h, id: generateId() })),
        isEditing: false,
        isEditingResponse: false,
        isLoading: false,
      },
    }));

    // Edges INSIDE the selection are copied; edges crossing the boundary are
    // cut — the copy has no wires to the original graph, so its stale check
    // (lastContextHash vs. the now-empty upstream) flags it naturally.
    const innerEdges: ThoughtEdge[] = edges
      .filter((e) => selected.has(e.source) && selected.has(e.target))
      .map((e) => ({
        ...e,
        id: `edge-${idMap.get(e.source)!}-${idMap.get(e.target)!}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        data: e.data ? { ...e.data } : e.data,
      }));

    const newIds = copies.map((c) => c.id);
    set((state) => ({
      nodes: [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copies],
      edges: [...state.edges, ...innerEdges],
      selectedNodeId: newIds.length === 1 ? newIds[0] : null,
      selectedNodeIds: newIds,
    }));
    get().pushHistory();
  },
});
