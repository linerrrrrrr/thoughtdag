import type { OverviewRulerMark } from './overview-ruler';

const BLOCK = /^(?:P|DIV|BLOCKQUOTE|LI|PRE|TABLE|TR|TD|TH|H[1-6]|BR)$/;

function indexScope(scope: HTMLElement) {
  const pieces: string[] = [];
  const chunks: { node: Text; start: number; end: number }[] = [];
  let length = 0;
  const append = (value: string) => { pieces.push(value); length += value.length; };
  const walk = (node: Node, code: boolean) => {
    if (node instanceof Text) {
      const start = length;
      append(node.data);
      if (!code && length > start) chunks.push({ node, start, end: length });
    } else if (node instanceof Element) {
      if (node.matches('script, style, button, .katex-mathml, [hidden]')) return;
      const block = BLOCK.test(node.tagName);
      if (block) append(' ');
      for (const child of node.childNodes) walk(child, code || node.tagName === 'PRE');
      if (block) append(' ');
    }
  };
  walk(scope, false);
  return { content: pieces.join(''), chunks };
}

/** Index one snapshot of the reading DOM. Each lookup may span inline nodes
 * and blocks within a scope. Occurrences follow the supplied scope order. */
export function indexHighlightedPassages(scopes: Iterable<HTMLElement>): (text: string) => Iterable<Range> {
  const sections = Array.from(scopes, indexScope);
  return function* (text) {
    const words = text.trim().split(/\s+/);
    if (!words[0]) return;
    const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const search = new RegExp(pattern, 'g');
    for (const { content, chunks } of sections) {
      search.lastIndex = 0;
      let chunk = 0;
      for (let match = search.exec(content); match; match = search.exec(content)) {
        const start = match.index, end = start + match[0].length;
        while (chunk < chunks.length && chunks[chunk].end <= start) chunk++;
        const first = chunks[chunk];
        if (!first || first.start >= end) continue;
        let last = chunk;
        while (last + 1 < chunks.length && chunks[last + 1].start < end) last++;
        const range = first.node.ownerDocument.createRange();
        range.setStart(first.node, Math.max(0, start - first.start));
        range.setEnd(chunks[last].node, Math.min(chunks[last].node.length, end - chunks[last].start));
        yield range;
      }
    }
  };
}

export function findHighlightedPassage(scopes: Iterable<HTMLElement>, text: string, occurrence = 0): Range | null {
  for (const range of indexHighlightedPassages(scopes)(text)) {
    if (occurrence-- === 0) return range;
  }
  return null;
}

/** Move only the local reading viewport. DOM rects use screen pixels, while
 * scrollTop/Left use CSS layout units even on a zoomed canvas. */
export function revealHighlight(scroller: HTMLElement, target: Range | Element): void {
  centerHighlight(scroller, target);
  showDestination(target);
}

function centerHighlight(scroller: HTMLElement, target: Range | Element) {
  const viewport = scroller.getBoundingClientRect();
  const rect = target instanceof Range
    ? Array.from(target.getClientRects()).find(line => line.width > 0 && line.height > 0)
    : target.getBoundingClientRect();
  if (!rect || !viewport.height || !viewport.width || !scroller.offsetHeight || !scroller.offsetWidth) return;
  const scaleY = viewport.height / scroller.offsetHeight;
  const scaleX = viewport.width / scroller.offsetWidth;
  const top = (rect.top - viewport.top) / scaleY - scroller.clientTop;
  const left = (rect.left - viewport.left) / scaleX - scroller.clientLeft;
  scroller.scrollTop += top + rect.height / scaleY / 2 - scroller.clientHeight / 2;
  if (left < 0 || left + rect.width / scaleX > scroller.clientWidth) {
    scroller.scrollLeft += left + rect.width / scaleX / 2 - scroller.clientWidth / 2;
  }
}

let clearFeedback: (() => void) | undefined;
function showDestination(target: Range | Element, onClear?: () => void) {
  clearFeedback?.();
  let clear: () => void;
  if (target instanceof Range) {
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.set('ruler-destination', new Highlight(target));
    clear = () => CSS.highlights.delete('ruler-destination');
  } else {
    target.setAttribute('data-ruler-destination', '');
    clear = () => target.removeAttribute('data-ruler-destination');
  }
  const timer = window.setTimeout(() => clearFeedback?.(), 1500);
  clearFeedback = () => { window.clearTimeout(timer); onClear?.(); clear(); clearFeedback = undefined; };
}

/** A distant page has an estimated height until scrolling brings it into view.
 * Center its mark again when the reader measures the actual page. */
export function revealMountedPdfHighlight(host: HTMLElement, mark: OverviewRulerMark): boolean {
  if (!mark.attachmentId || !mark.documentMarkId || !mark.page) return false;
  const selector = `[data-pdf-document="${CSS.escape(mark.attachmentId)}"]`;
  const pdf = host.matches(selector) ? host : host.querySelector<HTMLElement>(selector);
  if (!pdf) return false;
  const pages = pdf.querySelector<HTMLElement>('.pdf-page-viewport');
  const scroller = pdf.classList.contains('pdf-document-compact') ? pages : pdf.closest<HTMLElement>('[data-reader-body]');
  if (!scroller || !pages) return false;
  const id = CSS.escape(mark.documentMarkId);
  const target = pdf.querySelector<HTMLElement>(`[data-pdf-fallback-annotation="${id}"], [data-pdf-annotation="${id}"]`);
  if (!target) return false;
  const page = target.closest<HTMLElement>('[data-pdf-page]');
  if (page) {
    const expected = Math.max(160, Math.min(900, pages.clientWidth - 32));
    if (Math.abs(page.offsetWidth - expected) > 1) return false;
    if (!page.hasAttribute('data-pdf-sized')) {
      centerHighlight(scroller, target);
      const observer = new ResizeObserver(() => {
        if (!page.hasAttribute('data-pdf-sized')) return;
        centerHighlight(scroller, target);
        observer.disconnect();
      });
      observer.observe(page);
      showDestination(target, () => observer.disconnect());
      return true;
    }
  }
  revealHighlight(scroller, target);
  return true;
}
