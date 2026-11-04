import type { ThoughtEdge, ThoughtNode } from '../types';

export interface EdgeEditSettings {
  relation: 'continue' | 'reference';
  route: 'inherit' | 'auto' | 'curve' | 'orthogonal';
  label: string;
}

export type EdgeEditError = 'missing-node' | 'self-loop' | 'cycle' | 'restricted' | 'invalid-settings';
export type EdgeEditRestriction = 'material' | 'branch' | 'watch' | 'frame';
export type EdgeEditResult = { ok: true; edge: ThoughtEdge; semanticChanged: boolean }
  | { ok: false; error: EdgeEditError };

export function readEdgeSettings(edge: ThoughtEdge): EdgeEditSettings {
  return {
    relation: edge.data?.isCrossLink ? 'reference' : 'continue',
    route: edge.data?.route ?? 'inherit',
    label: edge.data?.label ?? '',
  };
}

/** Validate against the evolving graph, then commit all selected edges together.
 * A cycle formed only by multiple conversions must still reject the entire edit. */
export function applyBatchEdgeSettings(nodes: ThoughtNode[], edges: ThoughtEdge[], ids: string[], patch: Partial<EdgeEditSettings>):
  { ok: true; edges: ThoughtEdge[] } | { ok: false; error: EdgeEditError } {
  const selected = new Set(ids);
  if (!selected.size || ids.some(id => !edges.some(edge => edge.id === id))) return { ok: false, error: 'missing-node' };
  let next = edges;
  for (const edge of edges) {
    if (!selected.has(edge.id)) continue;
    const result = applyEdgeSettings(edge, nodes, next, { ...readEdgeSettings(edge), ...patch });
    if (!result.ok) return result;
    if (JSON.stringify(result.edge) !== JSON.stringify(edge)) next = next.map(item => item.id === edge.id ? result.edge : item);
  }
  return { ok: true, edges: next };
}

/** Special connections retain their existing role; visual settings stay editable. */
export function edgeEditRestriction(edge: ThoughtEdge, nodes: ThoughtNode[]): EdgeEditRestriction | null {
  if (edge.data?.isWatch) return 'watch';
  if (edge.data?.isBranchFromSelection) return 'branch';
  const endpoints = nodes.filter((node) => node.id === edge.source || node.id === edge.target);
  if (endpoints.some((node) => node.data.stepKind === 'frame')) return 'frame';
  if (endpoints.some((node) => ['note', 'file', 'link'].includes(node.data.stepKind ?? ''))) return 'material';
  return null;
}

/** Validate a draft without changing nodes, history, or the supplied edge. */
export function applyEdgeSettings(
  edge: ThoughtEdge, nodes: ThoughtNode[], edges: ThoughtEdge[], settings: EdgeEditSettings,
): EdgeEditResult {
  if (!nodes.some((node) => node.id === edge.source) || !nodes.some((node) => node.id === edge.target)) {
    return { ok: false, error: 'missing-node' };
  }
  if (!['continue', 'reference'].includes(settings.relation)
    || !['inherit', 'auto', 'curve', 'orthogonal'].includes(settings.route)
    || typeof settings.label !== 'string' || settings.label.length > 120) {
    return { ok: false, error: 'invalid-settings' };
  }
  const current = readEdgeSettings(edge);
  const relationChanged = current.relation !== settings.relation;
  const restricted = edgeEditRestriction(edge, nodes);
  if (restricted && relationChanged) return { ok: false, error: 'restricted' };

  // Reference cycles are an existing feedback mechanism. A new structural
  // connection must preserve the DAG, including cycles longer than one hop.
  if (relationChanged && settings.relation === 'continue') {
    if (edge.source === edge.target) return { ok: false, error: 'self-loop' };
    const outgoing = new Map<string, string[]>();
    for (const candidate of edges) {
      if (candidate.id === edge.id || candidate.data?.isCrossLink) continue;
      const targets = outgoing.get(candidate.source) ?? [];
      targets.push(candidate.target);
      outgoing.set(candidate.source, targets);
    }
    const pending = [edge.target], visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === edge.source) return { ok: false, error: 'cycle' };
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(outgoing.get(id) ?? []));
    }
  }

  const data = { ...edge.data };
  if (settings.route === 'inherit') delete data.route;
  else data.route = settings.route;
  const label = settings.label.replace(/\s+/g, ' ').trim();
  if (label) data.label = label;
  else delete data.label;

  // Geometry and labels never normalize unrelated semantic fields. This
  // preserves legacy watch/exploration links and content fingerprints.
  let result: ThoughtEdge = { ...edge, data };
  if (relationChanged) {
    if (settings.relation === 'continue') {
      delete data.isCrossLink;
      delete data.contextDepth;
      result = {
        ...result, sourceHandle: 'continue', targetHandle: 'top', animated: false,
        style: { ...edge.style, strokeDasharray: undefined },
      };
    } else {
      data.isCrossLink = true;
      delete data.contextDepth;
      result = { ...result, animated: false, style: { ...edge.style, strokeDasharray: '8 4' } };
    }
  }
  return { ok: true, edge: result, semanticChanged: relationChanged };
}
