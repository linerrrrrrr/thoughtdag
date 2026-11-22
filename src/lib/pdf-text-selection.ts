import type { PdfAnnotation } from '../types';

type PageSelection = Pick<PdfAnnotation, 'page' | 'rects'> & { text: string };
type Bounds = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

/** Join touching runs on one baseline, preserving real gaps (e.g. columns). */
function appendRun(boxes: Bounds[], box: Bounds, newLine: boolean) {
  const last = boxes.at(-1);
  if (last && !newLine) {
    const tolerance = Math.min(last.bottom - last.top, box.bottom - box.top) * 0.12;
    if (Math.abs(last.top - box.top) <= tolerance && Math.abs(last.bottom - box.bottom) <= tolerance
      && last.left <= box.right + tolerance && box.left <= last.right + tolerance) {
      boxes[boxes.length - 1] = {
        left: Math.min(last.left, box.left), right: Math.max(last.right, box.right),
        top: Math.min(last.top, box.top), bottom: Math.max(last.bottom, box.bottom),
      };
      return;
    }
  }
  boxes.push(box);
}

/** Range.getClientRects() on a cross-element selection includes the selected
 * elements themselves. Only the text nodes in each page's text layer describe
 * selected glyphs. Page labels, wrappers and annotations have no PDF geometry. */
export function readPdfTextSelection(root: HTMLElement, range: Range): PageSelection[] {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return [];
  const result: PageSelection[] = [];
  const run = document.createRange();
  for (const layer of root.querySelectorAll<HTMLElement>('.tdag-textlayer')) {
    if (!range.intersectsNode(layer)) continue;
    const page = layer.closest<HTMLElement>('[data-pdf-page]');
    if (!page) continue;
    const bounds = page.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const boxes: Bounds[] = [];
    const fragments: string[] = [];
    let newLine = true;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        return node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeName === 'BR') {
        fragments.push('\n');
        newLine = true;
        continue;
      }
      run.selectNodeContents(node);
      if (range.startContainer === node) run.setStart(node, range.startOffset);
      if (range.endContainer === node) run.setEnd(node, range.endOffset);
      fragments.push(run.toString());
      for (const rect of run.getClientRects()) {
        const box = {
          left: Math.max(rect.left, bounds.left), right: Math.min(rect.right, bounds.right),
          top: Math.max(rect.top, bounds.top), bottom: Math.min(rect.bottom, bounds.bottom),
        };
        if (box.right <= box.left || box.bottom <= box.top) continue;
        appendRun(boxes, box, newLine);
        newLine = false;
      }
    }
    const text = fragments.join('').trim();
    if (!text || !boxes.length) continue;
    result.push({ page: Number(page.dataset.page), text, rects: boxes.map(box => [
      (box.left - bounds.left) / bounds.width, (box.top - bounds.top) / bounds.height,
      (box.right - box.left) / bounds.width, (box.bottom - box.top) / bounds.height,
    ]) });
  }
  return result;
}
