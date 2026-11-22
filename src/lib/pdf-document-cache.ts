import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Attachment } from '../types';
import { decodeBytes, loadNodePdfFile } from './attachment-vault';

type Pdfjs = typeof import('pdfjs-dist');
type PdfTask = ReturnType<Pdfjs['getDocument']>;

export interface CachedPdfPage {
  width: number;
  pixelRatio: number;
  ratio: number;
  hasText: boolean;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
}

export interface PdfDocumentResource {
  key: string;
  document?: PDFDocumentProxy;
  pdfjs?: Pdfjs;
  promise: Promise<{ doc: PDFDocumentProxy; pdfjs: Pdfjs }>;
  task?: PdfTask;
  source?: string;
  size: number;
  revision?: string;
  refs: number;
  disposed: boolean;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  lastUsed: number;
  pages: Map<number, CachedPdfPage>;
  pageRatios: Map<number, number>;
  widths: Map<'compact' | 'reader', number>;
  canvasScroll?: { top: number; left: number };
}

const RETAIN_MS = 30_000;
const MAX_IDLE_DOCUMENTS = 4;
const MAX_PAGE_PIXELS = 4_000_000;
const resources = new Map<string, PdfDocumentResource>();
let pdfjsPromise: Promise<Pdfjs> | undefined;

export function loadPdfjs(): Promise<Pdfjs> {
  return pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
}

export const pdfDocumentKey = (projectId: string | null, nodeId: string, attachmentId: string) =>
  JSON.stringify([projectId, nodeId, attachmentId]);

/** Both readers paint the current canvas marks separately from the PDF pages. */
export async function readPdfPageBytes(attachment: Attachment): Promise<Uint8Array> {
  const content = await loadNodePdfFile(attachment);
  if (!content) throw new Error('PDF source missing');
  const bytes = decodeBytes(content);
  if (!attachment.pdfSavedAnnotations?.length) return bytes;
  const { canvasPdfPages } = await import('./pdf-annotations');
  return canvasPdfPages(bytes, attachment.pdfSavedAnnotations);
}

function matches(resource: PdfDocumentResource, attachment: Attachment) {
  return resource.revision === attachment.pdfFileRevision && resource.size === attachment.size
    && (!attachment.content || !resource.source || resource.source === attachment.content);
}

export function peekPdfDocument(key: string, attachment: Attachment) {
  const resource = resources.get(key);
  return resource && !resource.failed && !resource.disposed && matches(resource, attachment) ? resource : undefined;
}

function dispose(resource: PdfDocumentResource) {
  if (resource.disposed) return;
  resource.disposed = true;
  if (resource.timer) clearTimeout(resource.timer);
  if (resources.get(resource.key) === resource) resources.delete(resource.key);
  resource.pages.clear();
  if (resource.document) void resource.document.destroy();
  else if (resource.task) void resource.task.destroy();
}

function trimIdleDocuments() {
  const idle = [...resources.values()].filter(resource => resource.refs === 0).sort((a, b) => a.lastUsed - b.lastUsed);
  while (idle.length > MAX_IDLE_DOCUMENTS) dispose(idle.shift()!);
}

export function acquirePdfDocument(key: string, attachment: Attachment, retry = false) {
  let resource = peekPdfDocument(key, attachment);
  if (retry) resource = undefined;
  if (!resource) {
    // A still-open reader can finish using the old resource independently.
    const previous = resources.get(key);
    if (previous) {
      resources.delete(key);
      if (!previous.refs) dispose(previous);
    }
    resource = {
      key, size: attachment.size, revision: attachment.pdfFileRevision, source: attachment.content || undefined,
      refs: 0, disposed: false, failed: false, lastUsed: performance.now(),
      pages: new Map(), pageRatios: new Map(), widths: new Map(),
      promise: undefined as unknown as PdfDocumentResource['promise'],
    };
    const entry = resource;
    entry.promise = (async () => {
      const [pdfjs, bytes] = await Promise.all([loadPdfjs(), readPdfPageBytes(attachment)]);
      if (entry.disposed) throw new Error('PDF resource released');
      entry.task = pdfjs.getDocument({ data: bytes });
      const doc = await entry.task.promise;
      if (entry.disposed) { void doc.destroy(); throw new Error('PDF resource released'); }
      entry.document = doc;
      entry.pdfjs = pdfjs;
      return { doc, pdfjs };
    })().catch(error => { entry.failed = true; throw error; });
    resources.set(key, entry);
  }
  if (resource.timer) clearTimeout(resource.timer);
  resource.timer = undefined;
  resource.refs++;
  resource.lastUsed = performance.now();
  return resource;
}

export function releasePdfDocument(resource: PdfDocumentResource) {
  resource.refs = Math.max(0, resource.refs - 1);
  if (resource.refs) return;
  resource.lastUsed = performance.now();
  if (resources.get(resource.key) !== resource || resource.failed) { dispose(resource); return; }
  resource.timer = setTimeout(() => dispose(resource), RETAIN_MS);
  trimIdleDocuments();
}

export function getCachedPdfPage(resource: PdfDocumentResource, page: number, width: number, pixelRatio: number) {
  const cached = resource.pages.get(page);
  if (!cached || cached.width !== width || cached.pixelRatio !== pixelRatio) return undefined;
  resource.pages.delete(page);
  resource.pages.set(page, cached);
  return cached;
}

export function cachePdfPage(resource: PdfDocumentResource, page: number, snapshot: CachedPdfPage) {
  if (resource.disposed) return;
  resource.pages.delete(page);
  resource.pages.set(page, snapshot);
  let pixels = [...resource.pages.values()].reduce((sum, value) => sum + value.canvas.width * value.canvas.height, 0);
  while (pixels > MAX_PAGE_PIXELS && resource.pages.size) {
    const oldest = resource.pages.keys().next().value as number;
    const removed = resource.pages.get(oldest)!;
    resource.pages.delete(oldest);
    pixels -= removed.canvas.width * removed.canvas.height;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => { resources.forEach(dispose); });
