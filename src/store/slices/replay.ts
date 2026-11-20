import type { StateCreator } from 'zustand';
import { shownStaleIds } from '../../lib/stale-judge';
import { buildContext } from '../context-builder';
import { runNodeGeneration } from '../streaming';
import { t } from '../../i18n';
import type { StoreState, ReplaySlice } from '../types';
import { condenseGuard } from '../../lib/condense-guard';
import { documentCopyText, isEditableDocument } from '../../lib/document-copy';

export const createReplaySlice: StateCreator<StoreState, [], [], ReplaySlice> = (set, get) => ({
  /**
   * Regenerate a node IN PLACE from its incoming edges (standard context
   * walk — same one every node uses), appending to its version history.
   */
  rerunNode: async (nodeId: string) => {
    if (condenseGuard()) return;
    const { nodes, edges } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.data.isLoading) return;
    get().pushHistory();
    // In-place regenerate works for anything with a question — roots included
    // (their context is just the question). Material/frames never generate.
    if (!node.data.question) return;
    if (['note', 'file', 'link', 'frame'].includes(node.data.stepKind ?? '')) return;

    // Digest nodes regenerate through the digest prompt against the source
    // attachment's full extracted text — not the context walk (the walk
    // would summarize the summary once versions accumulate).
    if (node.data.digestOf) {
      const material = nodes.find((n) => n.data.attachments?.some((a) => a.id === node.data.digestOf));
      const att = material?.data.attachments?.find((a) => a.id === node.data.digestOf);
      if (!att) return;
      const text = isEditableDocument(att) ? documentCopyText(att) : att.extractedText;
      if (!text?.trim()) return;
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, isLoading: true, isCollapsed: false, response: '' } } : n
        ),
      }));
      await runNodeGeneration(set, get, nodeId, {
        question: node.data.question,
        messages: [{ role: 'user', content: `${t('content.digestPrompt')}\n\n[Material: ${att.name}]\n${text.slice(0, 120000)}` }],
        versionMode: 'append',
        sources: material ? [{ layer: 'material', nodeId: material.id, attachmentId: att.id, part: 'attachment' }] : [],
      });
      return;
    }

    // Standard context with this node's own Q&A blanked out (same pattern
    // as editQuestion) — ancestors, highlights, attachments all
    // resolve exactly like any other generation.
    const ctx = buildContext(
      nodeId,
      nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, question: '', response: '' } } : n)),
      edges,
      node.data.excludedAttachmentIds,
      node.data.includedAttachmentIds,
      shownStaleIds(get()),
    );
    const messages = ctx.messages;
    messages.push({ role: 'user', content: node.data.question });

    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, isLoading: true, isCollapsed: false, response: '' } } : n
      ),
    }));

    await runNodeGeneration(set, get, nodeId, {
      question: node.data.question,
      messages,
      images: ctx.images,
      versionMode: 'append',
      sources: ctx.sources,
    });
  },
});
