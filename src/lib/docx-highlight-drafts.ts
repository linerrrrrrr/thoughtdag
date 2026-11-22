import type { Attachment, DocumentHighlight } from '../types';

// Scope a draft to its actual canvas attachment. Clones and other projects may carry the same file ID.
const drafts = new WeakMap<Attachment, DocumentHighlight[]>();
const listeners = new Set<() => void>();
let version = 0;

export const draftDocxHighlights = (attachment: Attachment) => drafts.get(attachment);
export const docxHighlightsVersion = () => version;

export function subscribeDocxHighlights(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setDraftDocxHighlights(attachment: Attachment, marks: DocumentHighlight[] | undefined) {
  if (drafts.get(attachment) === marks) return;
  if (marks) drafts.set(attachment, marks);
  else drafts.delete(attachment);
  version++;
  listeners.forEach(listener => listener());
}
