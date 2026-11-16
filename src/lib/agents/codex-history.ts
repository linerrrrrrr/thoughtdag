import type { ContextMessage, ImageAttachment } from '../api';
import type { ThoughtNode } from '../../types';
import { canonicalStringify, sha256Hex } from '../context-bundle';

export type CodexResponseItem = { type: string; [key: string]: unknown };
export interface CodexHistoryMapping {
  nodeId: string | null;
  revision: string;
  itemStart: number;
  itemEnd: number;
  representation: 'messages' | 'native';
  turnId?: string | null;
}
export interface CodexHistoryRequest {
  version: 1;
  items: CodexResponseItem[];
  mappings: CodexHistoryMapping[];
  fingerprint: string;
  base?: { threadId: string; turnId: string; sessionFile: string; checkpoint: string; itemCount: number };
}
export interface CodexNativeHistory {
  version: 1;
  threadId: string;
  turnId: string | null;
  historyFingerprint: string | null;
  mappings: CodexHistoryMapping[];
  /** Only this turn's raw messages and paired tool records. Never display projections. */
  items: CodexResponseItem[];
  capture: 'complete' | 'unavailable';
  reason?: string;
  checkpoint?: string | null;
  question?: string;
  response?: string;
  outputFingerprint?: string;
  itemCount?: number;
  toolAttachmentsFingerprint?: string;
}

export const historyFingerprint = (items: CodexResponseItem[], instructions: string) =>
  sha256Hex(canonicalStringify({ instructions, items }));
export const nodeHistoryRevision = (question: string, response: string) => sha256Hex(canonicalStringify({ question, response }));
export const toolAttachmentsFingerprint = (node: ThoughtNode | undefined) => sha256Hex(canonicalStringify(
  (node?.data.attachments ?? []).filter((a) => a.op || a.name.startsWith('tool: ')).map((a) => ({ id: a.id, name: a.name, content: a.content, op: a.op, paths: a.paths }))));

/** Call identities are scoped to a canvas node when independent threads merge. */
export async function scopeNativeItems(items: CodexResponseItem[], nodeId: string): Promise<CodexResponseItem[]> {
  const prefix = `td_${(await sha256Hex(nodeId)).slice(0, 16)}_`;
  const ids = new Map<string, string>();
  for (const item of items) if (typeof item.call_id === 'string') ids.set(item.call_id, prefix + item.call_id);
  return items.map((item) => ({ ...item, ...(typeof item.call_id === 'string' ? { call_id: ids.get(item.call_id)! } : {}) }));
}

function nativeRecord(node: ThoughtNode): CodexNativeHistory | undefined {
  const data = node.data;
  const history = Array.isArray(data.codexHistories) ? data.codexHistories[data.responseIndex] : data.agentSession?.nativeHistory;
  return history?.version === 1 && history.capture === 'complete' && Array.isArray(history.items) && history.items.length > 0
    && typeof history.threadId === 'string' && history.items.every((item) => item && typeof item.type === 'string')
    && history.question === data.question && history.response === data.response
    && !data.isLoading && !data.generationFailed && data.highlightMode !== 'filter'
    ? history : undefined;
}

/** Compile the already resolved canvas context. No second graph walk/order rule. */
export async function compileCodexHistory(messages: ContextMessage[], nodes: ThoughtNode[], currentNodeId?: string, images: ImageAttachment[] = []): Promise<{
  question: string; instructions: string; history: CodexHistoryRequest; images: ImageAttachment[];
}> {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new Error('The last message must be the current question.');
  const instructions = messages.slice(0, -1).filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const prior = messages.slice(0, -1).filter((m) => m.role !== 'system');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const eligible = new Map<string, CodexNativeHistory>();
  for (const node of nodes) {
    if (node.id === currentNodeId) continue;
    const record = nativeRecord(node);
    if (!record) continue;
    if (record.toolAttachmentsFingerprint !== await toolAttachmentsFingerprint(node)) continue;
    const recordedImages = record.items.flatMap((item) => item.type === 'message' && Array.isArray(item.content)
      ? item.content.filter((part: { type?: string }) => part.type === 'input_image').map((part: { image_url?: string }) => part.image_url) : []).sort();
    const selectedImages = images.filter((image) => image.canvasSource?.nodeId === node.id)
      .map((image) => `data:${image.mimeType};base64,${image.data}`).sort();
    if (canonicalStringify(recordedImages) !== canonicalStringify(selectedImages)) continue;
    const own = prior.filter((m) => m.canvasSource?.layer === 'chain' && m.canvasSource.nodeId === node.id);
    // Filtered/stale/revised text is authoritative. Never restore excluded raw content.
    if (!own.some((m) => m.canvasSource?.part === 'question' && m.content === record.question)
      || !own.some((m) => m.canvasSource?.part === 'response' && m.content === record.response)) continue;
    const toolAttachments = (node.data.attachments ?? []).filter((a) => a.op || a.name.startsWith('tool: '));
    const included = new Set(own.flatMap((m) => m.canvasSource?.attachmentIds ?? (m.canvasSource?.attachmentId ? [m.canvasSource.attachmentId] : [])));
    if (toolAttachments.some((a) => !included.has(a.id)) || own.some((m) => m.content.startsWith('[Files this turn touched'))) continue;
    eligible.set(node.id, record);
  }
  const items: CodexResponseItem[] = [];
  const mappings: CodexHistoryMapping[] = [];
  const emitted = new Set<string>();
  const pendingImages = images.filter((image) => image.canvasSource && image.canvasSource.nodeId !== currentNodeId);
  const addImages = async (nodeId?: string | null) => {
    for (let i = 0; i < pendingImages.length;) {
      const image = pendingImages[i];
      const sourceId = image.canvasSource!.nodeId;
      if (nodeId !== undefined && sourceId !== nodeId) { i++; continue; }
      pendingImages.splice(i, 1);
      // A captured native user input already contains this node's pixels.
      if (eligible.has(sourceId)) continue;
      const start = items.length;
      items.push({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}`, detail: 'auto' }] });
      mappings.push({ nodeId: sourceId, revision: await sha256Hex(image.data), itemStart: start, itemEnd: items.length, representation: 'messages' });
    }
  };
  for (const message of prior) {
    const source = message.canvasSource;
    const nodeId = source?.nodeId ?? source?.refSourceId ?? null;
    await addImages(nodeId);
    const node = nodeId ? byId.get(nodeId) : undefined;
    const native = source?.layer === 'chain' && nodeId ? eligible.get(nodeId) : undefined;
    if (native && nodeId) {
      if (source?.part === 'response' && emitted.has(nodeId)) continue;
      if (source?.part === 'attachment') {
        const ids = source.attachmentIds ?? (source.attachmentId ? [source.attachmentId] : []);
        if (ids.length && ids.every((id) => node?.data.attachments?.some((a) => a.id === id && (a.op || a.name.startsWith('tool: '))))) continue;
      }
      if (source?.part === 'question' && !emitted.has(nodeId)) {
        const start = items.length;
        items.push(...await scopeNativeItems(native.items, nodeId));
        mappings.push({ nodeId, revision: await nodeHistoryRevision(node!.data.question, node!.data.response), itemStart: start, itemEnd: items.length, representation: 'native', turnId: native.turnId });
        emitted.add(nodeId);
        continue;
      }
    }
    const start = items.length;
    items.push({ type: 'message', role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] });
    mappings.push({ nodeId, revision: await sha256Hex(canonicalStringify({ role: message.role, content: message.content })), itemStart: start, itemEnd: items.length, representation: 'messages' });
  }
  await addImages();
  return { question: last.content, instructions, history: { version: 1, items, mappings, fingerprint: await historyFingerprint(items, instructions) }, images: images.filter((image) => !image.canvasSource || image.canvasSource.nodeId === currentNodeId) };
}

/** Resume only a byte-equivalent prefix in the same working directory. Backend
 * checks the persisted checkpoint again to detect updates outside this canvas. */
export async function selectCodexBase(history: CodexHistoryRequest, instructions: string, nodes: ThoughtNode[], cwd: string): Promise<void> {
  const normalize = (value: string) => { const s = value.replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(s) ? s.toLowerCase() : s; };
  const candidates = nodes.filter((node) => {
    const record = nativeRecord(node);
    const session = node.data.agentSession;
    return record?.checkpoint && record.turnId && record.outputFingerprint && record.itemCount != null
      && record.itemCount <= history.items.length && session?.sessionFile && normalize(session.cwd) === normalize(cwd)
      && history.mappings.some((mapping) => mapping.nodeId === node.id && mapping.representation === 'native' && mapping.turnId === record.turnId && mapping.itemEnd === record.itemCount)
      && session.sessionId === record.threadId;
  }).sort((a, b) => (nativeRecord(b)!.itemCount ?? 0) - (nativeRecord(a)!.itemCount ?? 0));
  for (const node of candidates) {
    const record = nativeRecord(node)!;
    if (await historyFingerprint(history.items.slice(0, record.itemCount!), instructions) !== record.outputFingerprint) continue;
    history.base = { threadId: record.threadId, turnId: record.turnId!, sessionFile: node.data.agentSession!.sessionFile!, checkpoint: record.checkpoint!, itemCount: record.itemCount! };
    return;
  }
}
