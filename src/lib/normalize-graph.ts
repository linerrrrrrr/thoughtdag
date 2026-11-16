import type { ThoughtData, ThoughtEdge, ThoughtNode } from '../types';
import { COLORS } from './constants';

// One-way cleanup at storage/import boundaries. These names are accepted
// only to remove retired configuration; no runtime consumes them.
const RETIRED_NODE_FIELDS = [
  'isRoot', 'isBranch', 'isEvaluator', 'branchContext', 'fanoutRoles',
  'autoRerun', 'autoRerunRounds', 'evaluatorTrigger',
  'rolePrompt', 'roleMode', 'roleSourceId', 'roleSourceNodeId', 'appliedRole',
] as const;
const RETIRED_EDGE_FIELDS = [
  'isBranchFromSelection', 'branchYRatio', 'isWatch', 'followsTip', 'contextDepth',
] as const;
const CURRENT_KINDS = new Set(['human', 'prompt', 'note', 'file', 'link', 'frame']);

export function normalizeConversationNode(node: ThoughtNode): ThoughtNode {
  const original = node.data;
  const retiredKind = original.stepKind !== undefined && !CURRENT_KINDS.has(original.stepKind);
  if (!retiredKind && !RETIRED_NODE_FIELDS.some(key => key in original)) return node;
  const data: ThoughtData = { ...original };
  // Preserve the person's selected words as visible question content,
  // including each question version, instead of hidden context metadata.
  const passage = typeof data.branchContext === 'string' ? data.branchContext.trim() : '';
  if (passage) {
    const quote = passage.split('\n').map(line => `> ${line}`).join('\n');
    const withQuote = (question: string) => `${quote}\n\n${question}`.trimEnd();
    data.question = withQuote(data.question);
    if (data.questions) data.questions = data.questions.map(withQuote);
  }
  for (const key of RETIRED_NODE_FIELDS) delete data[key];
  if (retiredKind) delete data.stepKind;
  return { ...node, data };
}

export function normalizeConversationEdge(edge: ThoughtEdge): ThoughtEdge {
  const original = edge.data;
  if (!original || !RETIRED_EDGE_FIELDS.some(key => key in original)) return edge;
  const data = { ...original } as Record<string, unknown>;
  const special = !!(data.isWatch || data.isBranchFromSelection || data.followsTip);
  for (const key of RETIRED_EDGE_FIELDS) delete data[key];
  if (!special) return { ...edge, data };
  const reference = !!data.isCrossLink;
  return {
    ...edge, data, animated: false,
    style: { ...edge.style, stroke: COLORS.accent, strokeDasharray: reference ? '8 4' : undefined },
    markerEnd: typeof edge.markerEnd === 'object' ? { ...edge.markerEnd, color: COLORS.accent } : edge.markerEnd,
  };
}

export function normalizeConversationGraph<T extends { nodes: ThoughtNode[]; edges: ThoughtEdge[] }>(graph: T): T {
  return {
    ...graph,
    nodes: graph.nodes.map(normalizeConversationNode),
    edges: graph.edges.map(normalizeConversationEdge),
  };
}
