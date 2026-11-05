import type { ThoughtNode, ThoughtEdge } from '../../types';

interface MirrorLedger {
  importedCount: number;
  tailNodeId: string;
}

/** Repair only nodes whose recorded provenance names a confirmed internal
 * session. Text is never evidence: a real user may discuss review JSON. */
export function repairInternalSessionNodes(
  nodes: ThoughtNode[],
  edges: ThoughtEdge[],
  parentSessionId: string,
  excludedSessionIds: readonly string[],
  freshNodes: ThoughtNode[],
  ledger: MirrorLedger,
): { nodes: ThoughtNode[]; edges: ThoughtEdge[]; ledger: MirrorLedger; changed: boolean } {
  if (!excludedSessionIds.length) return { nodes, edges, ledger, changed: false };
  const excluded = new Set(excludedSessionIds);
  const polluted = nodes.filter((node) => {
    const origin = node.data.importSource;
    return origin?.runner === 'codex' && origin.sessionId === parentSessionId
      && !!origin.subagent && origin.itemIds.some((id) => excluded.has(id));
  });
  const pollutedIds = new Set(polluted.map((node) => node.id));
  const pristine = (node: ThoughtNode): boolean => {
    const d = node.data;
    // A source snapshot proves only the imported text. Keep user-created
    // versions, labels, annotations and attachments too, even when the
    // currently selected answer still equals the original projection.
    return !!d.source && d.question === d.source.question && d.response === d.source.response
      && d.responses.length <= 1 && !d.questions?.length && !d.editedAts?.some(Boolean)
      && d.displayName === undefined && d.displaySummary === undefined
      && !d.highlights.length && !d.isLoading && !d.isEditing && !d.isEditingResponse
      && !d.rolePrompt && !d.instruction && d.roleMode === 'inherit' && !d.stepKind
      && !d.includedAttachmentIds.length
      && !d.attachments.some((attachment) => !attachment.name.startsWith('tool: ')
        || attachment.extractedBy === 'manual' || !d.excludedAttachmentIds.includes(attachment.id));
  };
  const removedIds = new Set(polluted.filter(pristine).map((node) => node.id));
  let changed = removedIds.size > 0;
  const repairedNodes = nodes.flatMap((node) => {
    if (removedIds.has(node.id)) return [];
    if (!pollutedIds.has(node.id) || node.data.archived) return [node];
    changed = true;
    // Edited material belongs to the user. Keep it in place, but archived
    // and disconnected so internal instructions cannot feed later asks.
    return [{ ...node, data: { ...node.data, archived: true } }];
  });
  const repairedEdges = edges.filter((edge) => !pollutedIds.has(edge.source) && !pollutedIds.has(edge.target));
  changed ||= repairedEdges.length !== edges.length;

  const qa = freshNodes.filter((node) => node.data.importSource);
  const freshByItem = new Map(qa.flatMap((node, index) => {
    const key = node.data.importSource?.itemIds[0];
    return key ? [[key, index] as const] : [];
  }));
  const survivors = nodes.filter((node) => node.data.importSource?.runner === 'codex'
    && node.data.importSource.sessionId === parentSessionId && !pollutedIds.has(node.id));
  const freshIndex = (node: ThoughtNode | undefined): number | undefined => {
    const key = node?.data.importSource?.itemIds[0];
    return key ? freshByItem.get(key) : undefined;
  };
  const oldTail = nodes.find((node) => node.id === ledger.tailNodeId);
  const tailIndex = oldTail && !pollutedIds.has(oldTail.id) ? freshIndex(oldTail) : undefined;
  let nextLedger = ledger;
  if (tailIndex !== undefined) {
    // The old tail's stable identity survives a shorter projection. This
    // also repairs the count when the user already deleted the bad child.
    nextLedger = { importedCount: tailIndex + 1, tailNodeId: oldTail!.id };
  } else if (pollutedIds.has(ledger.tailNodeId)) {
    const mapped = survivors.flatMap((node) => {
      const index = freshIndex(node);
      return index === undefined ? [] : [{ node, index }];
    }).sort((a, b) => b.index - a.index);
    const tail = mapped[0];
    if (tail) nextLedger = { importedCount: tail.index + 1, tailNodeId: tail.node.id };
    else nextLedger = {
      importedCount: Math.max(0, ledger.importedCount - polluted.filter((node) => removedIds.has(node.id) || !node.data.archived).length),
      tailNodeId: '',
    };
  } else if (removedIds.size) {
    // With the tail deleted by the user there is no reliable boundary to
    // infer. Subtract only nodes still proven to have occupied the ledger;
    // never infer that deleted real turns should be restored.
    nextLedger = { ...ledger, importedCount: Math.max(0, ledger.importedCount - removedIds.size) };
  }
  changed ||= nextLedger.importedCount !== ledger.importedCount || nextLedger.tailNodeId !== ledger.tailNodeId;
  return { nodes: changed ? repairedNodes : nodes, edges: changed ? repairedEdges : edges, ledger: nextLedger, changed };
}

/** Approval verdicts are audit attachments, excluded from model context.
 * Match the owning turn by native identity and append only new verdicts;
 * a user's edited answer and existing attachment choices stay untouched. */
export function syncApprovalAttachments(nodes: ThoughtNode[], freshNodes: ThoughtNode[], sessionId: string): ThoughtNode[] {
  const keyOf = (node: ThoughtNode): string | undefined => {
    const origin = node.data.importSource;
    return origin?.runner === 'codex' && origin.sessionId === sessionId && !origin.subagent
      ? origin.itemIds[0] : undefined;
  };
  const freshByItem = new Map(freshNodes.flatMap((node) => {
    const key = keyOf(node);
    return key ? [[key, node] as const] : [];
  }));
  let changed = false;
  const updated = nodes.map((node) => {
    const key = keyOf(node);
    const fresh = key ? freshByItem.get(key) : undefined;
    if (!fresh) return node;
    const known = new Set(node.data.attachments.filter((attachment) => attachment.name === 'tool: autoApprovalReview')
      .map((attachment) => attachment.content));
    const added = fresh.data.attachments.filter((attachment) => {
      if (attachment.name !== 'tool: autoApprovalReview' || known.has(attachment.content)) return false;
      known.add(attachment.content);
      return true;
    });
    if (!added.length) return node;
    changed = true;
    return { ...node, data: { ...node.data,
      attachments: [...node.data.attachments, ...added],
      excludedAttachmentIds: [...new Set([...node.data.excludedAttachmentIds, ...added.map((attachment) => attachment.id)])],
    } };
  });
  return changed ? updated : nodes;
}
