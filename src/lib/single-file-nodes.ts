import type { Attachment, ThoughtEdge, ThoughtNode } from '../types';
import { documentCopyText, isEditableDocument } from './document-copy';
import { highlightFoundIn } from './highlight-match';
import { isOverviewRulerHandle, overviewRulerMarks, remapOverviewRulerHandle } from './overview-ruler';
import { buildIncomingContext, upstreamFingerprint } from '../store/context-builder';

/** Find room for another file without moving any existing canvas object. */
export function adjacentFilePosition(nodes: ThoughtNode[], anchor: ThoughtNode): { x: number; y: number } {
  const width = Math.max(anchor.width ?? anchor.measured?.width ?? 400, 340);
  const height = Math.max(anchor.height ?? anchor.measured?.height ?? 0, 620);
  const gap = 60;
  const occupied = nodes.filter(node => node.data.stepKind !== 'frame').map(node => ({
    x: node.position.x, y: node.position.y,
    width: Math.max(node.width ?? node.measured?.width ?? 400, 1),
    height: Math.max(node.height ?? node.measured?.height ?? 0, node.data.stepKind === 'file' ? 620 : 260),
  }));
  for (let index = 0; ; index++) {
    const x = anchor.position.x + (index % 4 + 1) * (width + gap);
    const y = anchor.position.y + Math.floor(index / 4) * (height + gap);
    if (occupied.every(other => x + width + gap <= other.x || other.x + other.width + gap <= x
      || y + height + gap <= other.y || other.y + other.height + gap <= y)) return { x, y };
  }
}

function attachmentText(attachment: Attachment): string {
  return isEditableDocument(attachment) ? documentCopyText(attachment)
    : attachment.extractedText ?? attachment.content ?? '';
}

/**
 * Older file nodes could hold several attachments. Keep the first node's
 * identity and metadata, then give every other attachment its own node and
 * the same outgoing connections. Attachment IDs and vault references remain
 * untouched, so annotations, revisions, and context exclusions still work.
 */
export function splitLegacyFileNodes<T extends { nodes: ThoughtNode[]; edges: ThoughtEdge[] }>(graph: T): T {
  if (!graph.nodes.some(node => node.data.stepKind === 'file' && (node.data.attachments?.length ?? 0) > 1)) return graph;
  const usedNodeIds = new Set(graph.nodes.map(node => node.id));
  const usedEdgeIds = new Set(graph.edges.map(edge => edge.id));
  const uniqueId = (base: string, used: Set<string>) => {
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}~${suffix++}`;
    used.add(id);
    return id;
  };
  const addedBySource = new Map<string, string[]>();
  const markOwners = new Map<string, Map<string, { source: string; sourceHandle: string }>>();
  const placed = [...graph.nodes];
  let nodes = graph.nodes.flatMap(node => {
    const attachments = node.data.attachments ?? [];
    if (node.data.stepKind !== 'file' || attachments.length < 2) return [node];
    const owners = new Map<string, { source: string; sourceHandle: string }>();
    const marks = overviewRulerMarks(node.data);
    markOwners.set(node.id, owners);
    // A legacy file's optional text followed all of its attachments in
    // context. Keep it after the last split file in the same edge order.
    const first = { ...node, data: { ...node.data, question: '', tokenCount: 0, attachments: [attachments[0]] } };
    for (const mark of marks) if (mark.attachmentId === attachments[0].id) {
      owners.set(mark.id, { source: first.id, sourceHandle: mark.id });
    }
    const added = attachments.slice(1).map((attachment, index): ThoughtNode => {
      const id = uniqueId(`${node.id}~file~${index + 2}`, usedNodeIds);
      const text = attachmentText(attachment);
      // Marks are node-scoped in older data. Retain all originals on the
      // original node, and copy identifiable marks to their document.
      const originals = (node.data.highlights ?? []).filter(mark => mark.attachmentId ? mark.attachmentId === attachment.id : text && highlightFoundIn(text, mark.text));
      const highlights = originals
        .map(mark => ({ ...mark, id: `${mark.id}~${id}` }));
      const highlightIds = new Map(originals.map((mark, i) => [mark.id, highlights[i].id]));
      for (const mark of marks) if (mark.attachmentId === attachment.id) {
        owners.set(mark.id, { source: id, sourceHandle: remapOverviewRulerHandle(mark.id, new Map(), highlightIds) });
      }
      const next: ThoughtNode = {
        ...node,
        id,
        position: adjacentFilePosition(placed, node),
        selected: false, dragging: false, measured: undefined,
        data: {
          ...node.data,
          question: index === attachments.length - 2 ? node.data.question : '',
          tokenCount: index === attachments.length - 2 ? node.data.tokenCount : 0,
          displayName: undefined, displaySummary: undefined,
          summary: undefined, summaries: undefined, summaryTopics: undefined, summaryLadders: undefined,
          highlights, attachments: [attachment],
        },
      };
      placed.push(next);
      return next;
    });
    addedBySource.set(node.id, added.map(item => item.id));
    return [first, ...added];
  });
  const generalKey = (source: string, edge: ThoughtEdge) => JSON.stringify([source, edge.target, !!edge.data?.isCrossLink]);
  const covered = new Set<string>();
  for (const edge of graph.edges) {
    const added = addedBySource.get(edge.source);
    if (!added) continue;
    const owner = edge.sourceHandle && markOwners.get(edge.source)?.get(edge.sourceHandle);
    if (owner) covered.add(generalKey(owner.source, edge));
    else for (const source of [edge.source, ...added]) covered.add(generalKey(source, edge));
  }
  const edges = graph.edges.flatMap(edge => {
    const added = addedBySource.get(edge.source);
    if (!added) return [edge];
    const owner = edge.sourceHandle && markOwners.get(edge.source)?.get(edge.sourceHandle);
    return [edge.source, ...added].flatMap(source => {
      // The tick follows its own file. Retain the other files as context,
      // using one ordinary connection for each otherwise disconnected file.
      if (owner && owner.source === source) return [{ ...edge, ...owner }];
      const key = generalKey(source, edge);
      if (owner && covered.has(key)) return [];
      covered.add(key);
      const sourceHandle = isOverviewRulerHandle(edge.sourceHandle) ? 'continue' : edge.sourceHandle;
      if (!owner && source === edge.source) return [sourceHandle === edge.sourceHandle ? edge : { ...edge, sourceHandle }];
      return [{ ...edge, id: uniqueId(`${edge.id}~${source}`, usedEdgeIds), source, sourceHandle, selected: false }];
    });
  });

  // The live fingerprint includes source node IDs. Rebase only answers that
  // were current before the split and whose actual input is unchanged; an
  // already-stale answer must never become current because of migration.
  // Only structural descendants of an affected edge can inherit its material.
  const affected = new Set<string>();
  const pending = graph.edges.filter(edge => addedBySource.has(edge.source)).map(edge => edge.target);
  const structuralChildren = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.data?.isCrossLink) continue;
    const children = structuralChildren.get(edge.source) ?? [];
    children.push(edge.target);
    structuralChildren.set(edge.source, children);
  }
  while (pending.length) {
    const id = pending.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    pending.push(...(structuralChildren.get(id) ?? []));
  }
  nodes = nodes.map(node => {
    if (!affected.has(node.id) || !node.data.lastContextHash || !node.data.response) return node;
    if (node.data.lastContextHash !== upstreamFingerprint(node.id, graph.nodes, graph.edges)) return node;
    const before = buildIncomingContext(node.id, graph.nodes, graph.edges);
    const after = buildIncomingContext(node.id, nodes, edges);
    const sameMessages = before.messages.length === after.messages.length && before.messages.every((message, index) =>
      message.role === after.messages[index].role && message.content === after.messages[index].content);
    const sameImages = before.images.length === after.images.length && before.images.every((image, index) =>
      image.data === after.images[index].data && image.mimeType === after.images[index].mimeType
      && image.hasCompanion === after.images[index].hasCompanion);
    if (!sameMessages || !sameImages) return node;
    const lastContextHash = upstreamFingerprint(node.id, nodes, edges);
    return lastContextHash === node.data.lastContextHash ? node : { ...node, data: { ...node.data, lastContextHash } };
  });
  return { ...graph, nodes, edges };
}
