import type { PDFPageProxy } from 'pdfjs-dist';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageSquare } from 'lucide-react';
import { fmt, t } from '../i18n';
import type { Attachment, PdfAnnotation } from '../types';
import { loadPdfjs, readPdfPageBytes } from './pdf-document-cache';
import { isPdfPointNote } from './pdf-mark';

async function pageImage(page: PDFPageProxy) {
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2400 / Math.max(natural.width, natural.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  try {
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to render PDF page');
    await page.render({ canvasContext: context, viewport }).promise;
    return { src: canvas.toDataURL('image/webp', 0.94), width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

function pageFigure(page: number, src: string | undefined, marks: PdfAnnotation[], size?: { width: number; height: number }): string {
  const figure = document.createElement('figure');
  figure.className = 'pdf-document-page-wrap';
  const label = fmt(t('pdfDocument.page'), { page });
  const caption = document.createElement('figcaption');
  const pageLabel = document.createElement('div');
  pageLabel.className = 'pdf-document-page-label text-meta text-ink-faint';
  pageLabel.textContent = label;
  const sheet = document.createElement('div');
  sheet.className = 'pdf-sheet pdf-document-page';
  sheet.setAttribute('data-pdf-page', '');
  sheet.dataset.page = String(page);
  if (src) {
    const image = document.createElement('img');
    image.src = src;
    if (size) { image.width = size.width; image.height = size.height; }
    image.alt = label;
    image.loading = 'lazy';
    sheet.append(image);
  }
  for (const mark of marks) {
    let anchor: HTMLElement | undefined;
    for (const rect of mark.rects ?? []) {
      if (!src || rect.length !== 4 || !rect.every(Number.isFinite)) continue;
      const [left, top, width, height] = rect.map(value => `${Math.max(0, Math.min(1, value)) * 100}%`);
      const ink = document.createElement('button');
      anchor ??= ink;
      ink.type = 'button';
      ink.className = 'pdf-document-mark';
      ink.dataset.pdfAnnotation = mark.id;
      ink.setAttribute('aria-label', mark.comment || mark.text || t('pdfDocument.savedMark'));
      if (isPdfPointNote(mark)) ink.dataset.pointNote = '';
      const backgroundColor = /^#[\da-f]{6}$/i.test(mark.color) ? mark.color : '#f4cc48';
      Object.assign(ink.style, { left, top, width, height, backgroundColor });
      sheet.append(ink);
    }
    if (anchor) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pdf-document-comment-pin';
      pin.dataset.pdfCommentPin = mark.id;
      pin.style.top = anchor.style.top;
      pin.setAttribute('aria-label', mark.comment || t('pdfDocument.savedMark'));
      pin.innerHTML = renderToStaticMarkup(createElement(MessageSquare, { size: 13 }));
      sheet.append(pin);
    } else {
      anchor = document.createElement('span');
      caption.append(anchor);
    }
    anchor.dataset.pdfMark = mark.id;
    for (const text of [mark.text, mark.comment]) {
      if (!text) continue;
      const note = document.createElement('p');
      note.dataset.readingPdfNote = mark.id;
      note.textContent = text;
      caption.append(note);
    }
  }
  figure.append(pageLabel, sheet);
  if (caption.hasChildNodes()) figure.append(caption);
  return figure.outerHTML;
}

export async function renderPdfReadingPages(attachment: Attachment): Promise<string> {
  const marks = new Map<number, PdfAnnotation[]>();
  for (const mark of attachment.pdfAnnotations ?? []) {
    if (!marks.has(mark.page)) marks.set(mark.page, []);
    marks.get(mark.page)!.push(mark);
  }
  if (attachment.pdfFileRevision || attachment.pdfFileContent || attachment.content || attachment.contentInVault) {
    try {
      const [pdfjs, data] = await Promise.all([loadPdfjs(), readPdfPageBytes(attachment)]);
      const task = pdfjs.getDocument({ data });
      try {
        const doc = await task.promise;
        const figures: string[] = [];
        for (let page = 1; page <= doc.numPages; page++) {
          const image = await pageImage(await doc.getPage(page));
          figures.push(pageFigure(page, image.src, marks.get(page) ?? [], image));
        }
        return figures.join('');
      } finally {
        await task.destroy();
      }
    } catch {
      // A protected or missing original can still have saved page previews and text.
    }
  }
  const previews = attachment.pageImages ?? [];
  const pages = new Set([...previews.keys()].map(index => index + 1));
  for (const page of marks.keys()) pages.add(page);
  if (!pages.size && !attachment.extractedText && attachment.editedText === undefined) {
    return `<p>${t('pdfDocument.failed')}</p>`;
  }
  return Array.from(pages).sort((a, b) => a - b).map(page => {
    const bytes = previews[page - 1];
    return pageFigure(page, bytes ? `data:image/png;base64,${bytes}` : undefined, marks.get(page) ?? []);
  }).join('');
}
