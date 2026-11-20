import type { Attachment, ThoughtNode, ThoughtEdge } from '../types';
import { attachmentContextKey } from './attachment-fingerprint';

export function inheritedAttachments(nodeId: string, nodes: ThoughtNode[], edges: ThoughtEdge[]) {
  const result: { attachment: Attachment; sourceNodeId: string; sourceQuestion: string; excludedByAncestor: boolean }[] = [];
  const seenFingerprints = new Set<string>();
  // References do not inherit attachments; list the same material and
  // conversation layers that the prompt compiler actually consumes.
  const { materials, mainline } = partitionContext(nodeId, nodes, edges);
  const ordered = [...materials, ...mainline];

  // Collect all ancestor exclusions (propagation)
  const ancestorExcludes = new Set<string>();
  for (const node of ordered) {
    if (node.id !== nodeId) {
      for (const exId of (node.data.excludedAttachmentIds || [])) {
        ancestorExcludes.add(exId);
      }
    }
  }

  // Collect attachments from ancestors (not self), with dedup
  for (const node of ordered) {
    if (node.id === nodeId || node.data.archived) continue;
    for (const att of (node.data.attachments || [])) {
      const fp = attachmentContextKey(att);
      if (seenFingerprints.has(fp)) continue;
      seenFingerprints.add(fp);
      result.push({
        attachment: att,
        sourceNodeId: node.id,
        sourceQuestion: node.data.question,
        excludedByAncestor: ancestorExcludes.has(att.id),
      });
    }
  }

  return result;
}

/**
 * Post-order DFS up all incoming conversation and reference edges.
 * Returns ancestors in topological order (roots first, start node last)
 * plus the set of edge ids traversed — the single source of truth for
 * "what does this node's context consist of".
 */
export function walkUpAncestors(
  startIds: string | string[],
  nodes: ThoughtNode[],
  edges: ThoughtEdge[],
): { ordered: ThoughtNode[]; visitedEdgeIds: Set<string> } {
  const starts = Array.isArray(startIds) ? startIds : [startIds];
  const ordered: ThoughtNode[] = [];
  const visited = new Set<string>();
  const visitedEdgeIds = new Set<string>();
  const byId = new Map<string, ThoughtNode>();
  for (const node of nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const incomingByTarget = new Map<string, ThoughtEdge[]>();
  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.target, incoming);
  }

  function walkUp(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    // A merge's incoming BLOCKS enter the context in a stated order:
    // contextOrder on the edge (set from the focus panel), falling back
    // to creation order. The order lives on the EDGE — semantics drive
    // rendering, never the other way round: dragging nodes cannot
    // change what a context says.
    const incoming = incomingByTarget.get(id) ?? [];
    if (incoming.length > 1) {
      incoming.sort((a, b) =>
        ((a.data as { contextOrder?: number } | undefined)?.contextOrder ?? Number.MAX_SAFE_INTEGER)
        - ((b.data as { contextOrder?: number } | undefined)?.contextOrder ?? Number.MAX_SAFE_INTEGER));
    }
    for (const edge of incoming) {
      visitedEdgeIds.add(edge.id);
      walkUp(edge.source);
    }
    ordered.push(node);
  }

  for (const id of starts) walkUp(id);
  return { ordered, visitedEdgeIds };
}

const CONTENT_KINDS = new Set(['note', 'file', 'link']);

/** A conversation starts wherever the current graph has no structural input. */
export function isConversationStart(nodeId: string, edges: ThoughtEdge[]): boolean {
  return !edges.some((edge) => edge.target === nodeId && !edge.data?.isCrossLink);
}

/** Native session provenance preserves a conversation's axis without assigning node kinds. */
function conversationSession(node: ThoughtNode | undefined): string | undefined {
  const own = node?.data.agentSession;
  if (own?.sessionId) return `${own.runtime}:${own.sessionId}`;
  const imported = node?.data.importSource;
  if (!imported) return undefined;
  const delegated = imported.subagent ? `:${imported.subagent.of}:${imported.itemIds[0] ?? ''}` : '';
  return `${imported.runner}:${imported.sessionId}${delegated}`;
}

/** Stable layout ownership: native conversation continuity, creation time, then ids. */
export function orderConversationEdges(nodes: ThoughtNode[], edges: ThoughtEdge[]): ThoughtEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const continuesSession = (edge: ThoughtEdge) => {
    const source = conversationSession(byId.get(edge.source));
    return !!source && source === conversationSession(byId.get(edge.target));
  };
  const createdAt = (edge: ThoughtEdge) => edge.data?.createdAt ?? byId.get(edge.target)?.data.createdAt ?? '';
  return [...edges].sort((a, b) => Number(continuesSession(b)) - Number(continuesSession(a))
    || createdAt(a).localeCompare(createdAt(b)) || a.source.localeCompare(b.source)
    || a.target.localeCompare(b.target) || a.id.localeCompare(b.id));
}

/** References carry exactly one turn. */
export function isSingleNodeReference(edge: ThoughtEdge): boolean {
  return !!edge.data?.isCrossLink;
}

/** One dashed reference feeding a context. */
export interface ContextReference {
  source: ThoughtNode;
  edge: ThoughtEdge;
}

export interface ContextPartition {
  /** Structural routes used to assemble the context, including archived bridges. */
  structural: { ordered: ThoughtNode[]; visitedEdgeIds: Set<string> };
  /** Content nodes (notes / files / links) feeding this context, any edge kind. */
  materials: ThoughtNode[];
  /** Cross-links that supply material nodes, in the same order as intake. */
  materialReferences: ContextReference[];
  /** Dashed cross-links into the mainline, one reference block each. */
  references: ContextReference[];
  /** Structural ancestors in chain order, the node itself last. */
  mainline: ThoughtNode[];
}

/**
 * The layered view of a node's context — the single structure behind the
 * prompt builder, the panel's context tree and the follow-up preview, so
 * what the model reads and what the user sees never drift apart.
 *
 * Layers by HOW content enters (the One Rule, ordered):
 *   materials  — content nodes: background blocks with [Note]/[File] identity
 *   references — dashed edges: fenced [Reference] blocks of one turn
 *   mainline   — solid edges: the live conversation, strict chain order
 * A reference never forwards its own references (one level of indirection).
 */
export function partitionContext(
  nodeId: string,
  nodes: ThoughtNode[],
  edges: ThoughtEdge[],
): ContextPartition {
  const structural = edges.filter((e) => !e.data?.isCrossLink);
  const crossLinks = edges.filter((e) => e.data?.isCrossLink);

  // Mainline: structural walk only (content ancestors pulled out as materials)
  const ancestry = walkUpAncestors(nodeId, nodes, structural);
  const structuralOrdered = ancestry.ordered;
  const materials: ThoughtNode[] = [];
  const mainline: ThoughtNode[] = [];
  for (const n of structuralOrdered) {
    (CONTENT_KINDS.has(n.data.stepKind ?? '') ? materials : mainline).push(n);
  }
  const mainlineIds = new Set(structuralOrdered.map((n) => n.id));

  // References: cross-links pointing at the node or any structural ancestor
  const references: ContextReference[] = [];
  const materialReferences: ContextReference[] = [];
  const seenRefSources = new Set<string>();
  for (const edge of crossLinks) {
    if (!mainlineIds.has(edge.target)) continue;
    if (mainlineIds.has(edge.source)) continue; // already in the conversation
    if (seenRefSources.has(edge.source)) continue;
    const source = nodes.find((n) => n.id === edge.source);
    if (!source) continue;
    seenRefSources.add(edge.source);
    if (CONTENT_KINDS.has(source.data.stepKind ?? '')) {
      // Hand-wired material is still material — full identity block, no trail
      materials.push(source);
      materialReferences.push({ source, edge });
      continue;
    }
    references.push({ source, edge });
  }

  return { structural: ancestry, materials, materialReferences, references, mainline };
}

/** Nodes that actually enter context: materials, single-turn references, then the conversation. */
export function getContextPath(
  nodeId: string,
  nodes: ThoughtNode[],
  edges: ThoughtEdge[]
): ThoughtNode[] {
  const { materials, references, mainline } = partitionContext(nodeId, nodes, edges);
  const seen = new Set<string>();
  return [...materials, ...references.map((reference) => reference.source), ...mainline].filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

/**
 * Transitive reduction of a selection: keep only the nodes with NO selected
 * STRUCTURAL descendant (the maximal antichain / the sinks of each selected
 * cluster). Wiring the sinks alone feeds the complete context — every
 * selected ancestor flows in along its chain — with zero redundant
 * "residual" edges. Reachability deliberately ignores dashed references:
 * they carry quotes, not full content, so they must not justify dropping a
 * solid edge.
 */
export function selectionSinks(nodeIds: string[], edges: ThoughtEdge[]): string[] {
  const selected = new Set(nodeIds);
  return nodeIds.filter((id) => !getDescendantIds(id, edges).some((d) => selected.has(d)));
}

// All structural descendants (cross-links don't count as parent-child).
export function getDescendantIds(
  nodeId: string,
  edges: ThoughtEdge[]
): string[] {
  const descendants: string[] = [];
  const queue = [nodeId];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = edges.filter((e) => e.source === current && !e.data?.isCrossLink)
      .map((e) => e.target).filter((id) => !visited.has(id));
    for (const id of children) visited.add(id);
    descendants.push(...children);
    queue.push(...children);
  }
  return descendants;
}
