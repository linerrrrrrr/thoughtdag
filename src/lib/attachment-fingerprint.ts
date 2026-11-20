import type { Attachment } from '../types';

export function attachmentFingerprint(att: Attachment): string {
  return `${att.name}|${att.size}|${att.content?.substring(0, 100)}`;
}

/** Source dedup is still used at upload time. Context dedup also includes the
 * saved working copy, so two independent revisions of one file both survive.
 * Keep this exact key internal; exported fingerprints remain compact source IDs. */
export function attachmentContextKey(att: Attachment): string {
  return JSON.stringify([attachmentFingerprint(att), att.editedText ?? null, att.editedHtml ?? null,
    att.editedDocxRevision ?? null,
    att.extractedBy === 'manual' ? att.extractedText ?? att.content : null]);
}
