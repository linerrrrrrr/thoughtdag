import type { SuperDoc } from 'superdoc';
import { fmt, t } from '../i18n';
import { DOCX_MIME_TYPE } from './document-copy';
import { buildReaderPages } from './html-material';
import type { Attachment } from '../types';

async function pagePicture(element: HTMLElement, width: number, height: number, page: number) {
  const { toCanvas } = await import('html-to-image');
  const figure = document.createElement('figure');
  figure.className = 'document-page';
  const band = height > 3000 ? 1500 : height;
  for (let y = 0; y < height; y += band) {
    const slice = Math.min(band, height - y);
    const canvas = await toCanvas(element, {
      width, height: slice, pixelRatio: Math.min(2, 3000 / Math.max(width, slice)), preferredFontFormat: 'woff2',
      style: { margin: '0', left: '0', top: '0', position: 'relative', height: `${height}px`,
        transform: y ? `translateY(-${y}px)` : 'none', transformOrigin: 'top left', boxShadow: 'none' },
    });
    try {
      const image = document.createElement('img');
      image.src = canvas.toDataURL('image/webp', .95);
      image.width = width;
      image.height = slice;
      image.loading = 'lazy';
      image.alt = !y ? fmt(t('pdfDocument.page'), { page }) : '';
      figure.append(image);
    } finally { canvas.width = canvas.height = 0; }
  }
  return figure.outerHTML;
}

const nextPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** Use the same paginated renderer as a file node, independent of its mounted
 * editor, scroll position or unsaved draft. The file carries only the pages. */
export async function docxPagePictures(att: Attachment, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const [{ SuperDoc }] = await Promise.all([import('superdoc'), import('superdoc/style.layered.css')]);
  const host = document.createElement('div');
  host.inert = true;
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: '1080px', height: '900px' });
  document.body.append(host);
  let instance: SuperDoc | undefined, timeout = 0, expectedPages = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error('Document layout unavailable')), 30000);
      instance = new SuperDoc({
        selector: host, document: new File([bytes], att.name, { type: DOCX_MIME_TYPE }),
        documentMode: 'viewing', contained: true, viewOptions: { layout: 'print' },
        layoutEngineOptions: { virtualization: { enabled: false } },
        zoom: { mode: 'manual', initial: 100 }, ui: { toolbar: false, comments: false }, telemetry: { enabled: false },
        onPaginationUpdate: state => { expectedPages = state.totalPages; },
        onReady: () => resolve(), onContentError: reject, onException: reject,
      });
    });
    clearTimeout(timeout);
    const deadline = performance.now() + 10000;
    let pages: HTMLElement[];
    let ready: boolean;
    do {
      await nextPaint();
      pages = Array.from(host.querySelectorAll<HTMLElement>('.superdoc-page'));
      ready = pages.length >= Math.max(1, expectedPages) && pages.some(page => page.childElementCount);
    } while (!ready && performance.now() < deadline);
    if (!ready) throw new Error('Document pages unavailable');
    await document.fonts.ready;
    const pictures: string[] = [];
    for (const [index, page] of pages.entries()) {
      await Promise.all([...page.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
      pictures.push(await pagePicture(page, page.offsetWidth, page.offsetHeight, index + 1));
    }
    return pictures.join('');
  } finally {
    clearTimeout(timeout);
    try { instance?.destroy(); } finally { host.remove(); }
  }
}

/** A slide or a styled HTML material has its own page layout. Rasterize that
 * layout in a scriptless, isolated frame; retain the selectable body alongside it. */
export async function htmlPagePictures(source: string): Promise<string> {
  if (!/<(?:style|svg)\b|\sstyle\s*=|class=["'][^"']*\bslides?\b/i.test(source)) return '';
  const pages = await buildReaderPages(source);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.inert = true;
  Object.assign(frame.style, { position: 'fixed', left: '-20000px', top: '0', width: '850px', height: '1px', border: '0' });
  document.body.append(frame);
  try {
    const result: string[] = [];
    for (const { page, srcdoc } of pages) {
      const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; base-uri 'none'; form-action 'none'";
      let timeout = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          timeout = window.setTimeout(() => reject(new Error('HTML page unavailable')), 10000);
          frame.onload = () => resolve();
          frame.onerror = () => reject(new Error('HTML page unavailable'));
          frame.srcdoc = srcdoc.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
        });
      } finally { clearTimeout(timeout); }
      const doc = frame.contentDocument!;
      await doc.fonts.ready;
      const body = doc.body;
      const width = Math.max(body.scrollWidth, body.offsetWidth);
      const height = Math.max(body.scrollHeight, body.offsetHeight);
      if (!width || !height) return '';
      result.push(await pagePicture(body, width, height, page ?? 1));
    }
    return result.join('');
  } finally { frame.remove(); }
}
