import type { ThoughtEdge, ThoughtNode } from '../types';
import { useStore } from '../store';
import { generateId } from '../utils';
import { COLORS, EDGE_ARROW_GEOMETRY } from './constants';
import { condenseGuard } from './condense-guard';
import { placeNewNodes } from './layout';
import { useUiStore } from './ui-store';
import { deriveFollowupModel } from './agents/agent-runtime';
import { positionNodeAtConnectionEnd } from './edge-anchors';

export interface QuestionDraftOptions {
  parentId?: string;
  position?: { x: number; y: number };
  /** Released wire tip in canvas coordinates; anchors the new input when a parent exists. */
  connectionEnd?: { x: number; y: number };
  editor?: 'canvas' | 'panel';
}

/** Create one unsent turn. The question editor owns all later generation. */
export function createQuestionDraft(options: QuestionDraftOptions = {}): string | null {
  if (condenseGuard()) return null;
  const state = useStore.getState();
  const parent = options.parentId ? state.nodes.find((node) => node.id === options.parentId) : undefined;
  if (options.parentId && (!parent || parent.data.stepKind === 'frame')) return null;
  const id = generateId();
  const node: ThoughtNode = {
    id, type: 'thought', position: options.position ?? { x: 0, y: 0 }, dragHandle: '.drag-handle', selected: true,
    data: {
      question: '', response: '', responses: [], responseIndex: -1,
      createdAt: new Date().toISOString(),
      isCollapsed: false, isEditing: true, questionEditor: options.editor ?? 'canvas',
      isEditingResponse: false, isLoading: false, tokenCount: 0,
      highlights: [], highlightMode: 'tag', attachments: [], excludedAttachmentIds: [], includedAttachmentIds: [],
      roleMode: 'inherit', isRoot: !parent, isBranch: false,
      model: deriveFollowupModel(parent?.data, useUiStore.getState().selectedModel),
      layoutDirection: parent?.data.layoutDirection, edgeRouteDefault: parent?.data.edgeRouteDefault,
      // Search and recall choices are snapshotted only by an explicit send.
    },
  };
  const edge: ThoughtEdge | undefined = parent ? {
    id: `edge-${parent.id}-${id}`, source: parent.id, target: id,
    sourceHandle: 'continue', targetHandle: 'top',
    type: 'smoothstep', style: { stroke: COLORS.accent, strokeWidth: 2 }, animated: false,
    markerEnd: { type: 'arrowclosed', color: COLORS.accent, ...EDGE_ARROW_GEOMETRY },
    data: {},
  } : undefined;
  if (parent && options.connectionEnd) node.position = positionNodeAtConnectionEnd(parent, node, options.connectionEnd);
  const deselectedEdges = state.edges.map((existing) => existing.selected ? { ...existing, selected: false } : existing);
  const edges = edge ? [...deselectedEdges, edge] : deselectedEdges;
  const nodes = [...state.nodes.map((existing) => existing.selected ? { ...existing, selected: false } : existing), node];
  state.pushHistory();
  useStore.setState({
    nodes: options.position || (parent && options.connectionEnd) ? nodes : placeNewNodes(nodes, edges, [id]), edges,
    selectedNodeId: id, selectedNodeIds: [id],
  });
  useStore.getState().pushHistory();
  return id;
}
