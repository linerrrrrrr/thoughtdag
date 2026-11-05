import type { ThoughtEdge, ThoughtNode } from '../types';
import { useStore } from '../store';
import { generateId } from '../utils';
import { COLORS, EDGE_ARROW_GEOMETRY } from './constants';
import { condenseGuard } from './condense-guard';
import { placeNewNodes } from './layout';
import { useUiStore } from './ui-store';
import { deriveFollowupModel } from './agents/agent-runtime';

export interface QuestionDraftOptions {
  parentId?: string;
  branchContext?: string;
  branchYRatio?: number;
  position?: { x: number; y: number };
  editor?: 'canvas' | 'panel';
}

/** Create one unsent turn. The question editor owns all later generation. */
export function createQuestionDraft(options: QuestionDraftOptions = {}): string | null {
  if (condenseGuard()) return null;
  const state = useStore.getState();
  const parent = options.parentId ? state.nodes.find((node) => node.id === options.parentId) : undefined;
  if (options.parentId && (!parent || parent.data.stepKind === 'frame')) return null;
  const id = generateId();
  const isBranch = !!options.branchContext;
  const node: ThoughtNode = {
    id, type: 'thought', position: options.position ?? { x: 0, y: 0 }, dragHandle: '.drag-handle', selected: true,
    data: {
      question: '', response: '', responses: [], responseIndex: -1,
      createdAt: new Date().toISOString(),
      isCollapsed: false, isEditing: true, questionEditor: options.editor ?? 'canvas',
      isEditingResponse: false, isLoading: false, tokenCount: 0,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', isRoot: !parent, isBranch, branchContext: options.branchContext,
      model: deriveFollowupModel(parent?.data, useUiStore.getState().selectedModel),
      layoutDirection: parent?.data.layoutDirection, edgeRouteDefault: parent?.data.edgeRouteDefault,
      // Search and recall choices are snapshotted only by an explicit send.
    },
  };
  const color = isBranch ? COLORS.warm : COLORS.accent;
  const edge: ThoughtEdge | undefined = parent ? {
    id: `edge-${parent.id}-${id}`, source: parent.id, target: id,
    sourceHandle: isBranch ? 'branch' : 'continue', targetHandle: isBranch ? 'left' : 'top',
    type: 'smoothstep', style: { stroke: color, strokeWidth: 2 }, animated: false,
    markerEnd: { type: 'arrowclosed', color, ...EDGE_ARROW_GEOMETRY },
    data: isBranch ? { isBranchFromSelection: true, branchYRatio: options.branchYRatio ?? 0.5 } : {},
  } : undefined;
  const deselectedEdges = state.edges.map((existing) => existing.selected ? { ...existing, selected: false } : existing);
  const edges = edge ? [...deselectedEdges, edge] : deselectedEdges;
  const nodes = [...state.nodes.map((existing) => existing.selected ? { ...existing, selected: false } : existing), node];
  state.pushHistory();
  useStore.setState({
    nodes: options.position ? nodes : placeNewNodes(nodes, edges, [id]), edges,
    selectedNodeId: id, selectedNodeIds: [id],
  });
  useStore.getState().pushHistory();
  return id;
}
