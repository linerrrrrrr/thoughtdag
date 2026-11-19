import type { ThoughtNode, ThoughtEdge, ThoughtData } from '../types';
import { generateId } from '../utils';
import { autoLayout } from './layout';
import { normalizeConversationGraph } from './normalize-graph';

// Paradigm = the score; a chat canvas = the performance. This module turns
// an orchestration graph (steps, instructions, flow kinds) into a
// runnable chat graph. Nothing executes here — instantiation only lays the
// structure out; every generation is initiated by the human on the canvas.

export interface ParadigmFile {
  kind: 'thoughtdag-paradigm';
  version: 1;
  name: string;
  description?: string;
  lastNodeNumber?: number;
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
}

export function serializeParadigm(name: string, nodes: ThoughtNode[], edges: ThoughtEdge[]): ParadigmFile {
  return normalizeConversationGraph({ kind: 'thoughtdag-paradigm', version: 1, name, nodes, edges });
}

/**
 * Run lock: while any instantiated paradigm node is still incomplete the
 * canvas is a run in progress — follow-up inputs, node deletion and the
 * floating root input hide until the run finishes, then the graph unlocks
 * into an ordinary conversation canvas.
 */
export function isRunLocked(nodes: ThoughtNode[]): boolean {
  return nodes.some((n) =>
    (n.data.stepKind === 'human' && !n.data.question) ||
    (n.data.stepKind === 'prompt' && (n.data.isLoading || (!n.data.response && !n.data.generationFailed)))
  );
}

export function isParadigmFile(parsed: unknown): parsed is ParadigmFile {
  const p = parsed as Record<string, unknown> | null;
  return !!p && typeof p === 'object' && p.kind === 'thoughtdag-paradigm' && Array.isArray(p.nodes) && Array.isArray(p.edges);
}

// NOTE: ThoughtData extends Record<string, unknown>, whose index signature
// makes Omit<> collapse to a bare index type — so return the full shape.
const baseData = (): ThoughtData => ({
  question: '',
  response: '',
  responses: [],
  responseIndex: -1,
  isCollapsed: false,
  isEditing: false,
  isEditingResponse: false,
  isLoading: false,
  tokenCount: 0,
  highlights: [],
  highlightMode: 'tag',
  attachments: [],
  excludedAttachmentIds: [],
  includedAttachmentIds: [],
});

/**
 * Score → performance: convert a paradigm graph into a chat graph that RUNS
 * itself forward (see triggerParadigmCascade in store/streaming.ts).
 * - human           → EMPTY question slot tagged stepKind 'human'; the
 *                     operator guidance (instruction) becomes its placeholder.
 *                     The human types here and submits WITHOUT generating —
 *                     answers belong to downstream prompt nodes.
 * - prompt          → node tagged stepKind 'prompt' (question = the prompt);
 *                     auto-runs once all its structural parents complete.
 */
export function instantiateParadigm(pNodes: ThoughtNode[], pEdges: ThoughtEdge[]): { nodes: ThoughtNode[]; edges: ThoughtEdge[] } {
  const normalized = normalizeConversationGraph({ nodes: pNodes, edges: pEdges });
  const idMap = new Map<string, string>();
  const nodes: ThoughtNode[] = normalized.nodes.map((pn) => {
    const id = generateId();
    idMap.set(pn.id, id);
    const kind = pn.data.stepKind;
    const question = (pn.data.instruction?.trim() || pn.data.question || '').trim();

    const data: ThoughtData = {
      ...baseData(),
      nodeNumber: pn.data.nodeNumber,
      question,
    };
    if (kind === 'human') {
      data.stepKind = 'human';
      data.question = '';
      data.instruction = pn.data.instruction?.trim() || undefined; // shown as the input placeholder
    }
    if (kind === 'prompt') {
      data.stepKind = 'prompt';
      // Per-step search permissions travel with the paradigm; unset means
      // "follow the runner's defaults" (also how legacy files behave)
      data.webSearch = pn.data.webSearch;
      data.scholarSearch = pn.data.scholarSearch;
    }
    if (kind === 'note' || kind === 'file' || kind === 'link' || kind === 'frame') {
      // Content nodes / frames pass through as-is: filled = experiment
      // material, empty = a MATERIAL SLOT the cascade waits on; frames are
      // pure annotation — stage regions travel with the paradigm
      data.stepKind = kind;
      data.question = pn.data.question || '';
      data.attachments = pn.data.attachments ?? [];
      data.tokenCount = pn.data.tokenCount ?? 0;
      data.linkUrl = pn.data.linkUrl;
      data.linkTitle = pn.data.linkTitle;
      data.linkFetchedAt = pn.data.linkFetchedAt;
      data.frameColor = pn.data.frameColor;
    }
    // Dimensions matter for frames and resized material — carry them over
    return { id, type: 'thought', position: { ...pn.position }, width: pn.width, height: pn.height, zIndex: pn.zIndex, dragHandle: '.drag-handle', data };
  });

  const edges: ThoughtEdge[] = normalized.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => {
      const source = idMap.get(e.source)!;
      const target = idMap.get(e.target)!;
      return {
        ...e,
        id: `edge-${source}-${target}`,
        source,
        target,
      };
    });

  return { nodes: autoLayout(nodes, edges), edges };
}
