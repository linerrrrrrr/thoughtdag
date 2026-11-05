import type { ThoughtNode } from '../../types';

const sourceKey = (node: ThoughtNode): string | undefined => {
  const origin = node.data.importSource;
  return origin?.runner === 'codex' && !origin.subagent && origin.itemIds[0]
    ? `${origin.sessionId}:${origin.itemIds[0]}` : undefined;
};

/** Upgrade old mirrored Codex turns in place. Source projection changes must
 *  neither rewrite edited prose nor erase versions, layout, or metadata. */
export function repairCodexActivity(nodes: ThoughtNode[], fresh: ThoughtNode[]): ThoughtNode[] {
  const sources = new Map(fresh.flatMap((node) => {
    const key = sourceKey(node);
    return key && node.data.agentActivities?.[0]?.length ? [[key, node] as const] : [];
  }));
  let changed = false;
  const next = nodes.map((node) => {
    const key = sourceKey(node);
    const source = key ? sources.get(key) : undefined;
    const old = node.data.source;
    if (!source || !old || node.data.isLoading) return node;
    const d = node.data;
    let index = d.responses.findIndex((response, i) => response === old.response && (d.questions?.[i] ?? d.question) === old.question);
    // A single edited imported version still owns the source work record.
    if (index < 0 && d.responses.length === 1) index = 0;
    if (index < 0 || d.agentActivities?.[index]?.length) return node;
    const pristine = d.question === old.question && d.response === old.response;
    const activities = Array.from({ length: d.responses.length }, (_, i) => d.agentActivities?.[i]);
    activities[index] = source.data.agentActivities![0];
    const responses = d.responses.slice();
    if (pristine && d.responseIndex === index) responses[index] = source.data.response;
    changed = true;
    return { ...node, data: {
      ...d, agentActivities: activities, source: source.data.source,
      ...(pristine && d.responseIndex === index ? { response: source.data.response, responses, tokenCount: source.data.tokenCount } : {}),
    } };
  });
  return changed ? next : nodes;
}
