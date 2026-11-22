import type { Attachment } from '../types';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { generateId } from '../utils';
import { extractPdf } from './api';
import { PDF_VISION_PAGE_THRESHOLD } from './constants';
import { decodeBytes, internAttachment } from './attachment-vault';
import { loadPdfjs } from './pdf-document-cache';
import { NOTEBOOK_EXTENSION, NOTEBOOK_FIGURE_THRESHOLD, NOTEBOOK_TYPE, isNotebook, notebookMaterial, parseNotebook } from './notebook';
import { toast } from './ui-store';
import { fmt, t } from '../i18n';
import { DOCX_MIME_TYPE } from './document-copy';

// last-resort readable copy when the HTML extraction pipeline itself fails
function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*(\s*\n\s*)+/g, '\n\n')
    .trim();
}

export const TEXT_EXTENSIONS = /\.(md|txt|js|ts|tsx|jsx|py|json|csv|yaml|yml|toml|sh|bash|zsh|c|cpp|h|hpp|java|rs|go|rb|swift|kt|css|xml|sql|r|m|lua)$/i;

// HTML gets its own lane (extraction + rendered reader), not the text lane
export const HTML_EXTENSIONS = /\.x?html?$/i;

// Formats we do not parse but whose own apps export PDF in one click — met
// with guidance instead of silence (readFileToAttachment returns null)
const OFFICE_EXPORT_HINT = /\.(pptx?|key|odp|doc|rtf|odt|xlsx?|numbers|ods)$/i;

// accept attribute for <input type="file"> — keep in sync with TEXT_EXTENSIONS
export const FILE_INPUT_ACCEPT =
  'image/*,.pdf,.docx,.ipynb,.txt,.md,.js,.ts,.tsx,.jsx,.py,.json,.csv,.yaml,.yml,.toml,.sh,.c,.cpp,.h,.java,.rs,.go,.rb,.swift,.css,.html,.htm,.xml,.sql';

// Identity of an attachment's content — used to dedup the same file uploaded
// to multiple nodes or reached via multiple DAG paths.
export { attachmentFingerprint } from './attachment-fingerprint';

// Read a File into an Attachment (no server round-trip). Returns null for
// unsupported types. PDF content is raw base64; extraction happens in processFile.
export function readFileToAttachment(file: File, id = generateId()): Promise<Attachment | null> {
  return new Promise((resolve, reject) => {
    const addedAt = new Date().toISOString();
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    const isHTML = file.type === 'text/html' || HTML_EXTENSIONS.test(file.name);
    const isNotebookFile = NOTEBOOK_EXTENSION.test(file.name);
    const isText = file.type.startsWith('text/') || TEXT_EXTENSIONS.test(file.name);
    const isDocx = file.name.toLowerCase().endsWith('.docx');

    if (isImage) {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error('File read aborted'));
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({
          id, name: file.name, type: file.type, size: file.size, addedAt,
          content: base64, thumbnailUrl: reader.result as string,
        });
      };
      reader.readAsDataURL(file);
    } else if (isPDF) {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error('File read aborted'));
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ id, name: file.name, type: 'application/pdf', size: file.size, addedAt, content: base64 });
      };
      reader.readAsDataURL(file);
    } else if (isDocx) {
      // Keep source bytes separate from the readable Markdown copy. Conversion
      // is local and lazy; no upload or source-file modification is involved.
      void file.arrayBuffer().then(async (buf) => {
        try {
          const mammoth = await import('mammoth');
          const { documentHtmlToMarkdown, sanitizeDocumentHtml } = await import('./html-material');
          const { restoreDocxImageSizes } = await import('./docx-image-sizes');
          const { docxHighlights } = await import('./document-highlights');
          const r = await mammoth.convertToHtml({ arrayBuffer: buf });
          const documentHtml = await sanitizeDocumentHtml(await restoreDocxImageSizes(buf, r.value));
          const extractedText = await documentHtmlToMarkdown(documentHtml);
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          }
          resolve({ id, name: file.name, type: DOCX_MIME_TYPE, size: file.size, addedAt,
            content: btoa(binary), extractedText, documentHtml, documentHighlights: await docxHighlights(buf) });
        } catch {
          resolve(null);
        }
      }).catch(() => resolve(null));
    } else if (isHTML) {
      // raw source only serves the reader's original view; the readable
      // Markdown (extractedText) is produced async in processFile
      file.text().then((text) => {
        resolve({ id, name: file.name, type: 'text/html', size: file.size, addedAt, content: text });
      }).catch(reject);
    } else if (isNotebookFile) {
      // raw JSON serves the reader's original view; processFile writes the
      // model channel (extractedText) and the figures
      file.text().then((text) => {
        resolve({ id, name: file.name, type: NOTEBOOK_TYPE, size: file.size, addedAt, content: text });
      }).catch(reject);
    } else if (isText) {
      file.text().then((text) => {
        resolve({ id, name: file.name, type: file.type || 'text/plain', size: file.size, addedAt, content: text });
      }).catch(reject);
    } else {
      resolve(null);
    }
  });
}

// A file import already has bytes; saved originals come from the vault as base64.
export async function openPdf(source: string | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: typeof source === 'string' ? decodeBytes(source) : source, verbosity: 0 });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

// The vision model consumes one bounded image at a time, even for a whole book.
export async function renderPdfRecognitionPage(doc: PDFDocumentProxy, number: number): Promise<string> {
  const page = await doc.getPage(number);
  const canvas = document.createElement('canvas');
  try {
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(150 / 72, 1568 / Math.max(size.width, size.height)) });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    await page.render({ canvasContext: ctx, viewport, background: '#fff' }).promise;
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  } finally {
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

export interface ProcessFileCallbacks {
  /** Returning false discards a removed file before its extraction starts. */
  add: (att: Attachment) => void | false;
  /** Called after async PDF extraction with the fields to merge in. */
  update: (attachmentId: string, patch: Partial<Attachment>) => void;
}

/**
 * Full upload pipeline shared by the landing input, node drop zone and
 * FocusPanel attachments section: read the file, hand it to `add`, and for
 * PDFs run server-side extraction and deliver the result via `update`.
 */
export async function processFile(file: File, cb: ProcessFileCallbacks, id?: string): Promise<void> {
  if (OFFICE_EXPORT_HINT.test(file.name)) {
    toast('info', `${file.name}: ${t('content.officeExportHint')}`);
    return;
  }
  let att: Attachment | null;
  try {
    att = await readFileToAttachment(file, id);
  } catch {
    toast('error', `${file.name}: ${t('attach.readFailed')}`);
    return;
  }
  if (!att) {
    toast('info', fmt(t('toast.unsupportedFile'), { name: file.name }));
    return;
  }

  if (att.type === 'text/html') {
    if (cb.add({ ...att, isExtracting: true }) === false) return;
    try {
      const { extractHtmlMaterial } = await import('./html-material');
      const r = await extractHtmlMaterial(att.content);
      cb.update(att.id, { extractedText: r.markdown, numPages: r.numPages, isExtracting: false });
    } catch {
      // extraction machinery unavailable → the crude tag strip keeps the
      // material usable (same net the link snapshot route uses)
      cb.update(att.id, { extractedText: stripHtmlTags(att.content), isExtracting: false });
    }
    return;
  }

  if (isNotebook(att)) {
    let material: ReturnType<typeof notebookMaterial>;
    try {
      material = notebookMaterial(parseNotebook(att.content));
    } catch {
      toast('info', `${file.name}: ${t('content.notebookUnreadable')}`);
      return;
    }
    const light = await internAttachment(att);
    if (cb.add({ ...light, isExtracting: true }) === false) return;
    const n = material.figures.length;
    cb.update(att.id, {
      extractedText: material.text,
      figures: n ? material.figures : undefined,
      renderMode: n === 0 ? undefined : n > NOTEBOOK_FIGURE_THRESHOLD ? 'text-only' : 'full',
      isExtracting: false,
    });
    return;
  }

  if (att.type !== 'application/pdf') {
    cb.add(await internAttachment(att));
    return;
  }

  // The original PDF bytes go straight to the vault — the store only ever
  // sees the lightened attachment. Extraction below keeps using the local
  // `att.content` closure value.
  const light = await internAttachment(att);
  if (cb.add({ ...light, isExtracting: true }) === false) return;
  try {
    const data = await extractPdf(att.content);
    // A proxy whose pdfjs is broken answers 200 with an all-empty result
    // (the desktop app did exactly this for every PDF). Treat it as the
    // failure it is so the browser fallback below takes over.
    if (!data.numPages && !data.text?.trim()) throw new Error('empty extraction result');
    const numPages = data.numPages || 0;
    cb.update(att.id, {
      extractedText: data.text,
      numPages,
      renderMode: numPages > PDF_VISION_PAGE_THRESHOLD ? 'text-only' : 'full',
      isExtracting: false,
    });
  } catch {
    // The public demo has no extraction backend. Read the same text layer
    // with the browser worker and leave scanned pages in the original.
    let doc: PDFDocumentProxy | undefined;
    try {
      doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        try {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
          page.cleanup();
        } catch { pages.push(''); }
      }
      cb.update(att.id, {
        extractedText: pages.join('\n\n').trim(),
        numPages: doc.numPages,
        renderMode: doc.numPages > PDF_VISION_PAGE_THRESHOLD ? 'text-only' : 'full',
        isExtracting: false,
      });
    } catch {
      cb.update(att.id, { isExtracting: false });
    } finally {
      await doc?.destroy();
    }
  }
}
