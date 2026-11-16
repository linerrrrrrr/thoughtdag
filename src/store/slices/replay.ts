import type { StateCreator } from 'zustand';
import { shownStaleIds } from '../../lib/stale-judge';
import { buildContext } from '../context-builder';
import { runNodeGeneration } from '../streaming';
import { toast, updateToast, useUiStore } from '../../lib/ui-store';
import { t, fmt } from '../../i18n';
import type { StoreState, ReplaySlice } from '../types';
import { condenseGuard } from '../../lib/condense-guard';
import { documentCopyText, isEditableDocument } from '../../lib/document-copy';

// Batch-replay cancellation flag — one replay at a time, module-scoped.
let replayAborted = false;

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

  /**
   * Batch replay: re-run every node that was stale AT CONFIRMATION TIME,
   * in dependency order (a node runs only after all its stale structural
   * parents finished). The snapshot rule keeps the confirm-dialog count
   * honest and stops the run from chasing reference-edge contagion — nodes
   * that turn stale DURING the replay keep their badges for the human.
   */
  replayStale: async () => {
    replayAborted = false;
    get().recomputeStaleness();
    // the same set the chip counts and the dialog prices: the fingerprint's stale nodes minus the judge's dismissals
    const snapshot = shownStaleIds(get());
    if (snapshot.length === 0) return;
    const structural = () => get().edges.filter((e) => !e.data?.isCrossLink);
    const remaining = new Set(snapshot);
    let done = 0;
    const progress = toast('info', fmt(t('replay.progress'), { done, total: snapshot.length }), 0, {
      label: t('replay.stop'),
      run: () => { replayAborted = true; },
    });
    try {
      while (remaining.size > 0 && !replayAborted) {
        const ready = [...remaining].filter((id) =>
          !structural().some((e) => e.target === id && remaining.has(e.source)));
        if (ready.length === 0) break; // safety: no cycle exists on solid edges
        await Promise.all(ready.map((id) => get().rerunNode(id)));
        for (const id of ready) remaining.delete(id);
        done += ready.length;
        updateToast(progress, fmt(t('replay.progress'), { done, total: snapshot.length }));
      }
    } finally {
      useUiStore.getState().dismissToast(progress);
      get().recomputeStaleness();
      toast('success', replayAborted
        ? fmt(t('replay.stopped'), { done, total: snapshot.length })
        : fmt(t('replay.done'), { done }));
    }
  },
});
