import type { Attachment, DocumentHighlight } from '../types';
import { generateId } from '../utils';
import { hasNativeDocxSource } from './document-copy';
import { findHighlightedPassage } from './highlight-navigation';

type Span = { start: number; text: string; color: string };

/** Merge adjacent runs split by inline formatting. Paragraph breaks delimit passages. */
function collectHighlights(previous: readonly DocumentHighlight[]) {
  let offset = 0;
  const spans: Span[] = [];
  return {
    append(text: string, color?: string) {
      if (!text) return;
      if (color) {
        const last = spans.at(-1);
        if (last && last.color === color && last.start + last.text.length === offset) last.text += text;
        else spans.push({ start: offset, text, color });
      }
      offset += text.length;
    },
    finish(): DocumentHighlight[] {
      // Formatting and text before a passage can change on every save.
      // Reconcile by excerpt, using position to disambiguate repeated excerpts.
      const prior = new Map<string, DocumentHighlight[]>();
      for (const mark of previous) {
        const list = prior.get(mark.text) ?? [];
        list.push(mark);
        prior.set(mark.text, list);
      }
      const remaining = new Map<string, number>();
      for (const span of spans) remaining.set(span.text, (remaining.get(span.text) ?? 0) + 1);
      return spans.filter(span => span.text.trim()).map(span => {
        const fraction = (span.start + span.text.length / 2) / offset;
        const matches = prior.get(span.text) ?? [];
        const count = remaining.get(span.text)!;
        remaining.set(span.text, count - 1);
        // A long insertion can move all occurrences past their old positions.
        // Preserve reading order while the same excerpts are all still present.
        const nearest = matches.length === count ? 0 : matches.reduce((best, item, i) =>
          Math.abs(item.fraction - fraction) < Math.abs(matches[best].fraction - fraction) ? i : best, 0);
        const id = matches.splice(nearest, 1)[0]?.id ?? generateId();
        return { id, text: span.text, color: span.color, fraction };
      });
    },
  };
}

const WORD_COLORS: Record<string, string> = {
  darkYellow: '#808000', darkCyan: '#008080', darkMagenta: '#800080',
  darkRed: '#800000', darkGreen: '#008000', darkBlue: '#000080',
  lightGray: '#c0c0c0', darkGray: '#808080', green: '#00ff00',
};

/** Read direct text highlighting from the saved main story. Table and paragraph
 * fills and point comments are separate Word features and have no ruler socket. */
export async function docxHighlights(source: ArrayBuffer | string, previous: readonly DocumentHighlight[] = []) {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(source, { base64: typeof source === 'string' });
  const xml = await archive.file('word/document.xml')?.async('string');
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = doc.documentElement.namespaceURI;
  const collected = collectHighlights(previous);
  const visit = (el: Element, color?: string) => {
    if (el.namespaceURI === ns) {
      if (['del', 'moveFrom', 'rPr', 'pPr', 'drawing', 'pict'].includes(el.localName)) return;
      if (el.localName === 'r') {
        const props = Array.from(el.children).find(child => child.localName === 'rPr');
        const value = (name: string, attr: string) => Array.from(props?.children ?? [])
          .find(child => child.namespaceURI === ns && child.localName === name)?.getAttributeNS(ns, attr);
        const highlight = value('highlight', 'val');
        const fill = value('shd', 'fill');
        color = highlight ? (highlight === 'none' ? undefined : WORD_COLORS[highlight] ?? highlight)
          : fill && /^[0-9a-f]{6}$/i.test(fill) ? '#' + fill : undefined;
      }
      if (el.localName === 't') { collected.append(el.textContent ?? '', color); return; }
      if (el.localName === 'tab' || el.localName === 'br') { collected.append(' ', color); return; }
    }
    for (const child of el.children) visit(child, color);
    if (el.namespaceURI === ns && el.localName === 'p') collected.append('\n');
  };
  visit(doc.documentElement);
  return collected.finish();
}

/** Use one reading order for indexing rich text and locating it again in the DOM. */
function visitRichText(root: Node, append: (text: string, color?: string, node?: Text) => void) {
  const visit = (node: Node, color?: string) => {
    if (node instanceof Text) { append(node.data, color, node); return; }
    if (node instanceof HTMLElement) {
      if (['SCRIPT', 'STYLE'].includes(node.tagName)) return;
      if (node.tagName === 'SPAN' || node.tagName === 'MARK') {
        color = node.style.backgroundColor || (node.tagName === 'MARK' ? 'yellow' : color);
        if (color === 'transparent') color = undefined;
      }
    }
    for (const child of node.childNodes) visit(child, color);
    if (node instanceof HTMLElement && /^(?:P|BR|LI|H[1-6]|TD|TH)$/.test(node.tagName)) append('\n');
  };
  visit(root);
}

/** Legacy rich copies keep their explicit character backgrounds in saved HTML. */
export function richTextHighlights(html: string, previous: readonly DocumentHighlight[] = []) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const collected = collectHighlights(previous);
  visitRichText(template.content, collected.append);
  return collected.finish();
}

/** A rich document's saved fraction belongs to that document alone. It identifies
 * the right repeated excerpt even when only one occurrence carries formatting. */
export function findRichHighlightRange(root: HTMLElement, mark: DocumentHighlight): Range | null {
  if (!mark.text) return null;
  let length = 0;
  const chunks: { node: Text; start: number; end: number }[] = [];
  const pieces: string[] = [];
  visitRichText(root, (value, _color, node) => {
    if (node && value.length) chunks.push({ node, start: length, end: length + value.length });
    pieces.push(value);
    length += value.length;
  });
  const body = pieces.join('');
  const expected = mark.fraction * length - mark.text.length / 2;
  let closest = -1;
  for (let at = body.indexOf(mark.text); at !== -1; at = body.indexOf(mark.text, at + mark.text.length)) {
    if (closest < 0 || Math.abs(at - expected) < Math.abs(closest - expected)) closest = at;
  }
  if (closest < 0) return findHighlightedPassage([root], mark.text);
  const end = closest + mark.text.length;
  const first = chunks.find(chunk => chunk.end > closest);
  const last = chunks.find(chunk => chunk.end >= end);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, Math.max(0, closest - first.start));
  range.setEnd(last.node, Math.max(0, end - last.start));
  return range;
}

/** Older canvases predate the saved highlight index. Read their current
 * revision once, even when a compact card has no document editor mounted. */
export async function savedDocumentHighlights(att: Attachment) {
  if (!hasNativeDocxSource(att)) return richTextHighlights(att.editedHtml ?? att.documentHtml ?? '');
  const { loadDocumentContent } = await import('./attachment-vault');
  const content = await loadDocumentContent(att);
  return content ? docxHighlights(content) : undefined;
}
