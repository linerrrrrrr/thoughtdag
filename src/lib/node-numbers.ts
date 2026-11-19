import type { ThoughtNode } from '../types';

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * At load/restore, keep the saved numbers and repair legacy or duplicate entries.
 * During ordinary writes the existing ID owns its number. A copied node with a
 * fresh ID always gets a fresh number, even when its data was copied verbatim.
 */
export function numberCanvasNodes(nodes: ThoughtNode[], lastNodeNumber = 0, previous?: ThoughtNode[]) {
  if (!validNumber(lastNodeNumber)) lastNodeNumber = 0;
  // Streaming, dragging and editing normally leave the identities untouched.
  if (previous && previous.length === nodes.length && nodes.every((n, i) =>
    n.id === previous[i].id && n.data.nodeNumber === previous[i].data.nodeNumber
    && (n.data.stepKind === 'frame') === (previous[i].data.stepKind === 'frame'))) {
    return { nodes, lastNodeNumber };
  }
  const byId = new Map<string, number>();
  const used = new Set<number>();
  for (const n of previous ?? nodes) {
    const number = n.data.nodeNumber;
    if (n.data.stepKind === 'frame' || !validNumber(number) || used.has(number)) continue;
    byId.set(n.id, number);
    used.add(number);
    lastNodeNumber = Math.max(lastNodeNumber, number);
  }
  let result = nodes;
  for (const [i, n] of nodes.entries()) {
    const number = n.data.stepKind === 'frame' ? undefined : byId.get(n.id) ?? ++lastNodeNumber;
    if (n.data.nodeNumber === number) continue;
    if (result === nodes) result = nodes.slice();
    result[i] = { ...n, data: { ...n.data, nodeNumber: number } };
  }
  return { nodes: result, lastNodeNumber };
}

/** An explicit #number resolves within the current canvas, in mention order. */
export function resolveNodeNumberReferences(text: string, nodes: ThoughtNode[]) {
  const mentioned = new Set<number>();
  for (const match of text.matchAll(/(?<![a-zA-Z0-9_/#＃])[#＃]([0-9０-９]+)(?![a-zA-Z0-9０-９_])/g)) {
    const number = Number(match[1].normalize('NFKC'));
    if (Number.isSafeInteger(number)) mentioned.add(number);
  }
  const found: ThoughtNode[] = [];
  const missing: number[] = [];
  if (mentioned.size) {
    const byNumber = new Map(nodes.filter(n => n.data.stepKind !== 'frame').map(n => [n.data.nodeNumber, n]));
    for (const number of mentioned) {
      const node = byNumber.get(number);
      if (node) found.push(node);
      else missing.push(number);
    }
  }
  return { nodes: found, missing };
}
