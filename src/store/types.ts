import type { ThoughtNode, ThoughtEdge, Highlight, Attachment, CanvasEvent, CanvasOp, Ladder } from '../types';

export interface StaleVerdict { fp: string; p: number; changed: string[] }
export interface Snapshot {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
}

export interface EventSlice {
  /** Append-only semantic operation log (thinking timeline, form 2). */
  events: CanvasEvent[];
  logEvent: (op: CanvasOp, id?: string, d?: Record<string, string | number | boolean>) => void;
}

export interface HistorySlice {
  history: Snapshot[];
  historyIndex: number;
  pushHistory: () => void;
  /** The app finished filling a node in (an answer, a fetched page): fold the
      result into the snapshots taken while it was pending, then record. */
  settleNode: (nodeId: string, pending?: (data: ThoughtNode['data']) => boolean) => void;
  /** Derived content ceilings update matching active geometry without creating an undo step. */
  normalizeNodeContentHeight: (nodeId: string, limit: number) => void;
  undo: () => void;
  redo: () => void;
}

export interface NodeSlice {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  setNodes: (nodes: ThoughtNode[]) => void;
  setEdges: (edges: ThoughtEdge[]) => void;
  setSelectedNodeId: (id: string | null, options?: { focus?: boolean }) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  /** Persist one completed reading-divider adjustment as one undo step. */
  setQuestionHeightRatio: (nodeId: string, ratio: number) => void;
  /** Apply ordered size/ratio edits as one undo step; coordinates require one object. */
  setSelectionGeometry: (nodeIds: string[], patch: import('../lib/node-geometry').NodeGeometryPatch | import('../lib/node-geometry').NodeGeometryPatch[]) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdges: (edgeIds: string[]) => void;
  editResponse: (nodeId: string, response: string) => void;
  toggleCollapse: (nodeId: string) => void;
  setEditing: (nodeId: string, editing: boolean, surface?: 'canvas' | 'panel') => void;
  setEditingResponse: (nodeId: string, editing: boolean, surface?: 'canvas' | 'panel') => void;
  duplicateNode: (nodeId: string) => void;
  addCrossLink: (sourceId: string, targetId: string) => void;
  /** Convert between continuation (effective upstream, materials included)
   *  and single-node reference (source turn only). Cycle-guarded. */
  setEdgeStructural: (edgeId: string, structural: boolean) => void;
  updateEdgeSettings: (edgeId: string, settings: import('../lib/edge-edit').EdgeEditSettings) => { ok: boolean; error?: string };
  /** Live text edits can manage their own baseline and closing history snapshots. */
  updateSelectedEdges: (edgeIds: string[], patch: Partial<import('../lib/edge-edit').EdgeEditSettings>, options?: { recordHistory?: boolean }) => { ok: boolean; error?: string };
  applyCanvasLayout: (options: import('../lib/canvas-layout').CanvasLayoutOptions, selectedIds?: string[], isCurrent?: () => boolean) => Promise<{ ok: boolean; error?: string }>;
  navigateVersion: (nodeId: string, direction: 'prev' | 'next') => void;
  deleteVersion: (nodeId: string, versionIndex: number) => void;
  batchDelete: (nodeIds: string[], edgeIds?: string[]) => void;
  /** Duplicate the multi-selection as a detached copy: inner edges kept, boundary edges cut, attachments shared by reference under new ids (undoable). */
  duplicateSelection: (nodeIds: string[]) => void;
  /** Re-run the column-tree layout over the whole graph (undoable). */
  relayout: () => void;
  /** Stack the selected nodes into one vertical column, in conversation order (undoable). */
  alignSelection: (nodeIds: string[]) => Promise<void>;
  /** Align/distribute selected spatial objects without changing context wiring. */
  arrangeSelection: (nodeIds: string[], action: import('../lib/arrange-selection').ArrangeAction, reference: import('../lib/arrange-selection').ArrangeReference, viewport?: import('../lib/arrange-selection').ArrangeRect) => void;
  /** Change selected objects' stacking order as one undo step. */
  reorderSelection: (nodeIds: string[], action: import('../lib/node-layer').NodeLayerAction) => void;
  /** Enclose selected spatial objects without changing their positions or context. */
  createFrameFromSelection: (nodeIds: string[]) => string | undefined;
  /** Frame metadata edits never change node membership or context. */
  setFrameProperties: (frameIds: string[], patch: import('../lib/frames').FramePropertiesPatch) => void;
  /** Select contents, or explicitly include the requested and nested frames. */
  selectFrameContents: (frameIds: string[], includeFrames?: boolean) => void;
  /** Fit each frame to its current contents, without moving those contents. */
  fitFramesToContents: (frameIds: string[]) => void;
  /** Explicitly copy either frame objects or frames with their contents. */
  duplicateFrames: (frameIds: string[], withContents: boolean) => void;
  /** Set/clear a per-node LLM override (undefined = follow the global picker). */
  setNodeModel: (nodeId: string, model: string | undefined) => void;
  /** Archive/unarchive nodes: dimmed on canvas, excluded from every context walk (undoable). */
  setArchived: (nodeIds: string[], archived: boolean) => void;
  /** Nodes whose answers predate upstream changes (derived, not persisted). */
  staleIds: string[];
  /** the fingerprint each stale node was flagged at, so a judge's verdict can be matched to it */
  staleFps: Record<string, string>;
  /** the judge's verdict per stale node: does the upstream change bear on the answer (see lib/stale-judge) */
  staleVerdicts: Record<string, StaleVerdict>;
  setStaleVerdicts: (verdicts: Record<string, StaleVerdict>) => void;
  /** Recompute staleness across the graph (debounce-subscribed to nodes/edges). */
  recomputeStaleness: () => void;
}

export interface AddQuestionOptions {
  parentId?: string;
  /** Quoted passage for a reading question or a saved branch. */
  branchContext?: string;
  branchYRatio?: number;
  /** false → the new node starts with roleMode 'reset' (no inherited role). */
  inheritRole?: boolean;
  rolePrompt?: string;
  initialAttachments?: Attachment[];
  excludeAllInheritedAttachments?: boolean;
  /** @-mentioned node ids: any not already in the new node's context get a
      real dashed reference edge (the graph stays honest). */
  mentions?: string[];
}

export interface LlmSlice {
  addQuestion: (question: string, opts?: AddQuestionOptions) => void;
  editQuestion: (nodeId: string, question: string) => void;
  /** A paradigm human turn: record the question WITHOUT generating (the
   *  answers belong to downstream prompt nodes), then advance the cascade. */
  submitHumanTurn: (nodeId: string, question: string) => void;
  /** Fan out N perspectives: once = blind candidate branches; follow = reviewers that auto-rerun with the thread. */
  fanOut: (parentId: string, question: string, roles: { name: string; prompt: string }[], opts?: { follow?: boolean; rounds?: number }) => Promise<void>;
  regenerate: (nodeId: string) => void;
  batchMergeSummarize: (nodeIds: string[], deleteAfter?: boolean, intent?: string) => void;
  /** Weave the highlights of the selected nodes into one cited passage.
   *  Input = the user's OWN marks (already-human-curated), so context stays
   *  small even for whole-canvas selections; the passage cites [n] back to
   *  its source highlights. Optional intent steers angle/purpose. */
  weaveHighlights: (nodeIds: string[], intent?: string, highlightIds?: string[]) => Promise<void>;
  stopGeneration: (nodeId: string) => void;
}

export interface RoleSlice {
  setRolePrompt: (nodeId: string, rolePrompt: string) => void;
}

export interface HighlightSlice {
  addHighlight: (nodeId: string, highlight: Highlight) => void;
  removeHighlight: (nodeId: string, highlightId: string) => void;
  setHighlightMode: (nodeId: string, mode: 'off' | 'tag' | 'filter') => void;
  setSummary: (nodeId: string, summary: string, forResponse: string, type?: string, topic?: string, confidence?: number, conclusive?: number) => void;
  /** store a version's zoom ladder (lib/ladder.ts); also refreshes the plain summary and topic from it */
  setLadder: (nodeId: string, forResponse: string, ladder: Ladder | null) => void;
  setMaterialSummary: (nodeId: string, summary: string, topic?: string) => void;
}

export interface EvaluatorSlice {
  /** PRESET: ordinary node with a critic role + autoRerun, wired by a followsTip edge. */
  /** Regenerate a node in place from its incoming edges, appending a version (generic primitive). */
  rerunNode: (nodeId: string, opts?: { auto?: boolean }) => Promise<void>;
  /** Replay every currently-stale node in dependency order (confirm first — N generations). */
  replayStale: () => Promise<void>;
  /** Toggle the autoRerun primitive on any node. */
  setAutoRerun: (nodeId: string, enabled: boolean) => void;
  /** Set how many auto rounds per user action this node may fire (loops need >1). */
  setAutoRerunRounds: (nodeId: string, rounds: number) => void;
}

export interface AttachmentSlice {
  addAttachment: (nodeId: string, attachment: Attachment) => void;
  removeAttachment: (nodeId: string, attachmentId: string) => void;
  toggleExcludeAttachment: (nodeId: string, attachmentId: string, ancestorExcluded?: boolean) => void;
  /** Hand a node's tool record downstream, or keep it on the node: every tool step at once. */
  setToolRecordForwarded: (nodeId: string, forward: boolean) => void;
  setAttachmentRenderMode: (nodeId: string, attachmentId: string, mode: 'full' | 'text-only') => void;
  setAttachmentData: (nodeId: string, attachmentId: string, data: Partial<Attachment>) => void;
  getInheritedAttachments: (nodeId: string) => { attachment: Attachment; sourceNodeId: string; sourceQuestion: string; excludedByAncestor: boolean }[];
}

export type StoreState = HistorySlice & NodeSlice & LlmSlice & RoleSlice & HighlightSlice & AttachmentSlice & EvaluatorSlice & EventSlice;

export type PersistedState = { nodes: ThoughtNode[]; edges: ThoughtEdge[]; events?: CanvasEvent[] };
