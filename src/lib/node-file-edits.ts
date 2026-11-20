import type { Attachment, PdfAnnotation } from '../types';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { saveDocumentRevision, savePdfFileRevision } from './attachment-vault';
import { DOCX_MIME_TYPE, hasNativeDocxSource } from './document-copy';
import { DocumentSourceError } from './document-errors';
import { openPdf, renderPdfPages } from './attachments';

export { fileEditPreview } from './document-edit-preview';
export { loadNodePdfFile } from './attachment-vault';

export async function docxRevisionPatch(attachment: Attachment, blob: Blob): Promise<Partial<Attachment>> {
  const { extractRawText } = await import('mammoth');
  const { docxHighlights } = await import('./document-highlights');
  const bytes = await blob.arrayBuffer();
  const [{ value: text }, documentHighlights] = await Promise.all([
    extractRawText({ arrayBuffer: bytes }), docxHighlights(bytes, attachment.documentHighlights),
  ]);
  const revision = await saveDocumentRevision(attachment, blob);
  const hasRevision = attachment.editedDocxRevision || attachment.editedDocxContent !== undefined || attachment.editedDocxSavedAt;
  return {
    ...revision, size: blob.size, editedText: text, editedHtml: undefined, documentHighlights, digest: undefined, digestBy: undefined,
    ...(!hasRevision && {
      legacyDocumentHtml: attachment.legacyDocumentHtml ?? attachment.editedHtml,
      legacyDocumentText: attachment.legacyDocumentText ?? attachment.editedText,
    }),
  };
}

function mergePdfMarks(current: PdfAnnotation[], saved: PdfAnnotation[], incoming: PdfAnnotation[]) {
  const base = new Map(saved.map(mark => [mark.id, mark]));
  const remote = new Map(incoming.map(mark => [mark.id, mark]));
  return current.flatMap(mark => {
    // Preserve locally added or edited overlays. Untouched overlays follow
    // the ordinary PDF editor, including its deletions and page changes.
    if (JSON.stringify(base.get(mark.id)) !== JSON.stringify(mark)) return [mark];
    const updated = remote.get(mark.id);
    return updated ? [updated] : [];
  });
}

async function pdfRevisionPatch(attachment: Attachment, content: string): Promise<Partial<Attachment>> {
  const doc = await openPdf(content);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      pages.push(text.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    const bytes = await doc.getData();
    const pageImages = attachment.pageImages?.length || pages.every(page => !page.trim()) ? await renderPdfPages(doc) : undefined;
    const saved = attachment.pdfSavedAnnotations ?? [];
    const { readSavedCanvasMarks } = await import('./pdf-annotations');
    const incoming = await readSavedCanvasMarks(bytes, doc, saved);
    return {
      pdfFileRevision: await savePdfFileRevision(content), pdfFileContent: undefined, size: bytes.length,
      pdfSavedAnnotations: incoming, pdfAnnotations: mergePdfMarks(attachment.pdfAnnotations ?? [], saved, incoming),
      numPages: doc.numPages, extractedText: pages.join('\n\n').trim(), editedText: undefined,
      editedHtml: undefined, extractedBy: undefined, digest: undefined, digestBy: undefined,
      pageImages, isExtracting: false,
    };
  } finally { await doc.destroy(); }
}

export async function applyNodeFile(projectId: string, nodeId: string, attachment: Attachment,
  content: string, encoding: 'utf8' | 'base64', isCurrent: () => boolean, diskRevision: string): Promise<void> {
  if (encoding !== 'base64') throw new Error('A binary node file must supply its complete bytes.');
  let patch: Partial<Attachment>;
  if (hasNativeDocxSource(attachment)) {
    const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
    patch = await docxRevisionPatch(attachment, new Blob([bytes], { type: DOCX_MIME_TYPE }));
  } else if (attachment.type === 'application/pdf') {
    patch = await pdfRevisionPatch(attachment, content);
  } else throw new Error('Unsupported document format.');
  const project = useProjects.getState();
  const state = useStore.getState();
  const live = state.nodes.find(node => node.id === nodeId)?.data.attachments?.find(att => att.id === attachment.id);
  if (!live || project.switching || (project.activeId ?? 'default') !== projectId || !isCurrent()
    || live.editedDocxRevision !== attachment.editedDocxRevision || live.pdfFileRevision !== attachment.pdfFileRevision
    || live.pdfAnnotations !== attachment.pdfAnnotations) throw new DocumentSourceError('document.editChanged');
  state.pushHistory();
  state.setAttachmentData(nodeId, attachment.id, { ...patch, nodeFileRevision: diskRevision });
  state.pushHistory();
}
