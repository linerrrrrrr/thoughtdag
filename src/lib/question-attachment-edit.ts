import type { Attachment } from '../types';
import { documentCopyText, isEditableDocument } from './document-copy';
import { isNotebook } from './notebook';

function hasCompanionText(attachment: Attachment): boolean {
  return attachment.type.startsWith('image/') || attachment.type === 'text/html' || isNotebook(attachment);
}

/** The readable channel used by the question compiler, including an empty description. */
export function questionAttachmentText(attachment: Attachment): string {
  if (isEditableDocument(attachment)) return documentCopyText(attachment);
  if (hasCompanionText(attachment)) return attachment.extractedText ?? '';
  return attachment.content;
}

export function questionAttachmentPatch(attachment: Attachment, name: string, text: string): Partial<Attachment> {
  const patch: Partial<Attachment> = {};
  const trimmed = name.trim();
  if (trimmed && trimmed !== attachment.name) patch.name = trimmed;
  if (text === questionAttachmentText(attachment)) return patch;
  patch.digest = undefined;
  patch.digestBy = undefined;
  if (isEditableDocument(attachment)) {
    patch.editedText = text;
  } else if (hasCompanionText(attachment)) {
    patch.extractedText = text;
    patch.extractedBy = 'manual';
  } else {
    patch.content = text;
    patch.size = new TextEncoder().encode(text).byteLength;
    patch.extractedBy = 'manual';
    if (attachment.extractedText !== undefined) patch.extractedText = text;
  }
  return patch;
}
