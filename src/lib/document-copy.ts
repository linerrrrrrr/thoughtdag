import type { Attachment } from '../types';

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Old imports stored DOCX as plain text; new imports retain the original bytes. */
export function isDocxDocument(att: Pick<Attachment, 'name' | 'type'>): boolean {
  return att.type === DOCX_MIME_TYPE || /\.docx$/i.test(att.name);
}

/** Legacy text-only imports cannot be reopened as a native DOCX file. */
export function hasNativeDocxSource(att: Attachment): boolean {
  return isDocxDocument(att) && (!!att.editedDocxRevision || !!att.editedDocxContent
    || (att.type === DOCX_MIME_TYPE && (!!att.content || !!att.contentInVault)));
}

export function isEditableDocument(att: Attachment): boolean {
  return att.type === 'application/pdf' || isDocxDocument(att);
}

/** The saved working copy is authoritative, including an intentionally empty copy.
 * Original binary payloads must never enter the readable/model text channel. */
export function documentCopyText(att: Attachment): string {
  return att.editedText ?? att.extractedText
    ?? (isDocxDocument(att) && att.type.startsWith('text/') ? att.content : '');
}

/** Rich documents share one saved body between the card and the reading panel. */
export async function documentRichHtml(att: Attachment): Promise<string> {
  const { sanitizeDocumentHtml } = await import('./html-material');
  // Native edits can change objects as well as text. The original HTML is no
  // longer a current preview; viewers without binary bytes use saved text.
  const hasNativeRevision = !!(att.editedDocxRevision || att.editedDocxSavedAt)
    || att.editedDocxContent !== undefined;
  const html = att.editedHtml ?? (hasNativeRevision ? undefined : att.documentHtml);
  if (html !== undefined) return sanitizeDocumentHtml(html);
  const [{ micromark }, { gfm, gfmHtml }] = await Promise.all([
    import('micromark'), import('micromark-extension-gfm'),
  ]);
  return sanitizeDocumentHtml(micromark(documentCopyText(att), { extensions: [gfm()], htmlExtensions: [gfmHtml()] }));
}
