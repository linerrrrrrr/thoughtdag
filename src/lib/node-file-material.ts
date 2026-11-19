import type { Attachment } from '../types';
import { internAttachment } from './attachment-vault';
import { isNotebook, notebookMaterial, parseNotebook } from './notebook';

/** Rebuild the same reader/model channels that the initial upload produced. */
export async function readMaterialChange(att: Attachment, base64: string): Promise<Partial<Attachment>> {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const common = { size: bytes.length, editedText: undefined, editedHtml: undefined, digest: undefined,
    digestBy: undefined, extractedText: undefined, extractedBy: undefined, isExtracting: false };
  if (att.type.startsWith('image/')) return { ...common, content: base64, thumbnailUrl: `data:${att.type};base64,${base64}` };
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (isNotebook(att)) {
    const material = notebookMaterial(parseNotebook(content));
    const vaulted = await internAttachment({ ...att, content, contentInVault: false });
    return { ...common, content: vaulted.content, contentInVault: vaulted.contentInVault, contentVaultId: vaulted.contentVaultId,
      extractedText: material.text, figures: material.figures };
  }
  if (att.type === 'text/html') {
    const { extractHtmlMaterial } = await import('./html-material');
    const { markdown, numPages } = await extractHtmlMaterial(content);
    return { ...common, content, extractedText: markdown, numPages };
  }
  return { ...common, content, contentInVault: false };
}
