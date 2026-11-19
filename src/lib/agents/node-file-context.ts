import type { AgentActivityEntry } from '../../types';
import { useStore } from '../../store';
import { useProjects } from '../../store/projects';
import { resolveNodeNumberReferences } from '../node-numbers';
import { isNotebook } from '../notebook';
import { fileEditPreview } from '../document-edit-preview';
import { isFileMaterial, openNodeFile, ownsNodeFileEdits, releaseNodeFileEdits } from '../node-files';
import { managedDocumentFile } from '../managed-document-file';

type Target = {
  label: string; canvasId: string; nodeId: string; attachmentId: string; name: string;
  path: string; previewPath: string; revision: string; supportsPreview: boolean;
};
export interface AgentFileContext { note: string; targets: Target[] }

/** References are resolved from the person's current question, never from
 * quoted materials, an agent's output, or an earlier canvas's file paths. */
export async function agentFileContext(nodeId: string | undefined, question: string, attachmentIds: ReadonlySet<string>, includeOwn: boolean): Promise<AgentFileContext> {
  const targets: Target[] = [];
  if (!nodeId) return { targets, note: '' };
  const { nodes } = useStore.getState();
  const canvasId = useProjects.getState().activeId ?? 'default';
  const refs = resolveNodeNumberReferences(question, nodes);
  const explicit = new Set(refs.nodes.map(n => n.id));
  const notes = refs.missing.map(n => `There is no canvas node #${n}. Do not guess a canvas file for this number.`);
  for (const n of nodes) {
    const attachments = (n.data.attachments ?? []).filter(isFileMaterial);
    if (explicit.has(n.id) && !attachments.length) notes.push(`Canvas node #${n.data.nodeNumber} has no file attachment. Node text: ${JSON.stringify(n.data.question)}`);
    for (const [index, att] of attachments.entries()) {
      if (!explicit.has(n.id) && !attachmentIds.has(att.id) && !(includeOwn && n.id === nodeId && !n.data.excludedAttachmentIds?.includes(att.id))) continue;
      const file = await openNodeFile(canvasId, n.id, att);
      if (!file) throw new Error('This local agent host cannot open the canvas file. Update or reconnect the local host.');
      targets.push({ label: '#' + n.data.nodeNumber + (attachments.length > 1 ? '/' + (index + 1) : ''), canvasId,
        nodeId: n.id, attachmentId: att.id, name: att.name, path: file.path, previewPath: file.previewPath, revision: file.revision,
        supportsPreview: !isNotebook(att) && !att.type.startsWith('image/') && !['application/pdf', 'text/html'].includes(att.type) });
    }
  }
  if (targets.length) notes.push(
    'Canvas file addresses for this turn. Use the exact native file path for the requested node. Save edits at that path with your usual file tools. Files in your working directory are independent.',
    ...targets.map(f => `${f.label} ${JSON.stringify(f.name)} → ${JSON.stringify(f.path)}${f.supportsPreview ? ` (previewPath ${JSON.stringify(f.previewPath)}, baseRevision ${f.revision})` : ''}`),
  );
  if (targets.some(t => t.supportsPreview)) notes.push(
    'When rewriting a paragraph in a file with a previewPath, stream its preview before saving: start a separate commentary message with TD-PREVIEW, a space, the exact node label above, a space, and the JSON-quoted original paragraph or unique sentence on the first line. From the next line stream only the replacement text, without a code fence. One message per replacement. Then edit the actual file with your normal tools.',
    'Tools without commentary can optionally write UTF-8 JSON {baseRevision,before,after} at previewPath as text is produced. Preview is transient. The native file save commits all edits including formatting and tables.',
  );
  return { targets, note: notes.join('\n') };
}

/** Project only an explicitly addressed editing event and match it to the
 * version handed to this run. Ordinary commentary never becomes document text. */
export function showAgentFilePreview(item: AgentActivityEntry, files: AgentFileContext): boolean {
  // Some native transports announce the commentary phase only at item
  // completion. Its explicit edit header can identify earlier text deltas.
  if ((item.kind !== 'commentary' && item.kind !== 'message') || !item.text?.startsWith('TD-PREVIEW ')) return false;
  const match = /^TD-PREVIEW (#[0-9]+(?:\/[0-9]+)?) ([^\n]+)\r?\n([\s\S]*)$/.exec(item.text);
  if (!match) return true;
  const file = files.targets.find(t => t.supportsPreview && t.label === match[1]);
  if (!file || !ownsNodeFileEdits(file, files) || useProjects.getState().switching || (useProjects.getState().activeId ?? 'default') !== file.canvasId) return true;
  const live = useStore.getState().nodes.find(n => n.id === file.nodeId)?.data.attachments?.find(a => a.id === file.attachmentId);
  if (live?.nodeFileRevision !== file.revision) return true;
  try {
    const before: unknown = JSON.parse(match[2]);
    if (typeof before === 'string' && before) fileEditPreview(file.canvasId, file.nodeId, file.attachmentId, { before, after: match[3] });
  } catch { /* an incomplete header has no corresponding range yet */ }
  return true;
}

export async function finishAgentFileEdits(files: AgentFileContext) {
  const results = await Promise.allSettled(files.targets.map(async f => {
    if (f.supportsPreview && ownsNodeFileEdits(f, files)) {
      fileEditPreview(f.canvasId, f.nodeId, f.attachmentId, null);
      const { canvasId, nodeId, attachmentId } = f;
      const name = f.path.split(/[\\/]/).at(-1)!;
      await managedDocumentFile({ canvasId, nodeId, attachmentId, name }, { op: 'clearPreview', expectedRevision: f.revision });
    }
    const project = useProjects.getState();
    if (project.switching || (project.activeId ?? 'default') !== f.canvasId) return;
    const live = useStore.getState().nodes.find(n => n.id === f.nodeId)?.data.attachments?.find(a => a.id === f.attachmentId);
    if (live) await openNodeFile(f.canvasId, f.nodeId, live);
  }));
  releaseNodeFileEdits(files.targets, files);
  return results.find(r => r.status === 'rejected');
}
