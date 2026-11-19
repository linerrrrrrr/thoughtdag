import type { ThoughtEdge, ThoughtNode } from '../types';
import { upstreamParts } from '../store/context-builder';

interface InputGraph {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  byId: Map<string, ThoughtNode>;
  incoming: Map<string, ThoughtEdge[]>;
}

// A drag or selection updates React Flow's node/edge objects. Source lists
// depend on data and relationships, so share their index across mounted cards.
let latest: { nodes: ThoughtNode[]; edges: ThoughtEdge[]; graph: InputGraph } | undefined;
export function inputGraph({ nodes, edges }: { nodes: ThoughtNode[]; edges: ThoughtEdge[] }): InputGraph {
  if (latest?.nodes === nodes && latest.edges === edges) return latest.graph;
  const previous = latest?.graph;
  const sameNodes = previous && nodes.length === previous.nodes.length && nodes.every((n, i) =>
    n.id === previous.nodes[i].id && n.data === previous.nodes[i].data);
  const sameEdges = previous && edges.length === previous.edges.length && edges.every((e, i) => {
    const old = previous.edges[i];
    return e.id === old.id && e.source === old.source && e.target === old.target && e.data === old.data;
  });
  if (previous && sameNodes && sameEdges) {
    latest = { nodes, edges, graph: previous };
    return previous;
  }
  const incoming = new Map<string, ThoughtEdge[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target);
    if (list) list.push(edge);
    else incoming.set(edge.target, [edge]);
  }
  for (const list of incoming.values()) list.sort((a, b) =>
    (a.data?.contextOrder ?? Number.MAX_SAFE_INTEGER) - (b.data?.contextOrder ?? Number.MAX_SAFE_INTEGER));
  const graph = { nodes, edges, incoming, byId: new Map(nodes.map(n => [n.id, n])) };
  latest = { nodes, edges, graph };
  return graph;
}

/** The generation record describes only the last answer's source contribution. */
export function changedInputFiles(target: ThoughtNode, files: Set<string>, graph: InputGraph): Set<string> {
  const { data } = target;
  const baseline = data.lastContextParts;
  if (!baseline || !data.response || data.isLoading || data.generationFailed ||
    data.responseIndex !== (data.responses?.length ?? 1) - 1) return new Set();
  const recorded = [...files].filter(id => baseline[id]);
  if (!recorded.length) return new Set();
  const live = upstreamParts(target.id, graph.nodes, graph.edges);
  return new Set(recorded.filter(id => live[id] && live[id].h !== baseline[id].h));
}
