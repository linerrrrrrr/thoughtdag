import type { ThoughtData, ThoughtEdge, ThoughtNode } from '../types';
import { docxHighlightsVersion, draftDocxHighlights } from './docx-highlight-drafts';
import { isDocxDocument } from './document-copy';

const liveData = new WeakMap<ThoughtData, { version: number; data: ThoughtData }>();

/** Project a session's native highlights for reading and wiring, without editing its saved attachment. */
export function liveDocxRulerData(data: ThoughtData, version = docxHighlightsVersion()): ThoughtData {
  if (!data.attachments?.length) return data;
  const cached = liveData.get(data);
  if (cached?.version === version) return cached.data;
  let attachments = data.attachments;
  for (const [index, attachment] of data.attachments.entries()) {
    const marks = draftDocxHighlights(attachment);
    if (marks === undefined || marks === attachment.documentHighlights) continue;
    if (attachments === data.attachments) attachments = [...attachments];
    attachments[index] = { ...attachment, documentHighlights: marks };
  }
  const projected = attachments === data.attachments ? data : { ...data, attachments };
  liveData.set(data, { version, data: projected });
  return projected;
}

export function liveDocxRulerNode(node: ThoughtNode, version = docxHighlightsVersion()): ThoughtNode {
  const data = liveDocxRulerData(node.data, version);
  return data === node.data ? node : { ...node, data };
}

/** A graph snapshot can keep the connection even when its exact passage exists only in an unsaved DOCX. */
export function savedDocxRulerEdges(nodes: readonly ThoughtNode[], edges: ThoughtEdge[]): ThoughtEdge[] {
  if (!edges.some(edge => edge.sourceHandle?.startsWith('ruler/mark/'))) return edges;
  const sources = new Map(nodes.map(node => [node.id, node.data]));
  return edges.map(edge => {
    if (!edge.sourceHandle?.startsWith('ruler/mark/')) return edge;
    const [, , file, mark] = edge.sourceHandle.split('/');
    const attachment = sources.get(edge.source)?.attachments?.find(att => encodeURIComponent(att.id) === file);
    if (!attachment || !isDocxDocument(attachment)) return edge;
    // Legacy canvases may not have indexed an existing saved mark yet.
    if (!attachment.documentHighlights && draftDocxHighlights(attachment) === undefined) return edge;
    return attachment.documentHighlights?.some(item => encodeURIComponent(item.strokeId ?? item.id) === mark)
      ? edge : { ...edge, sourceHandle: 'continue' };
  });
}
