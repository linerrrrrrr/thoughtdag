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
    get length() { return offset; },
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

export function wordHighlightColor(highlight?: string | null, fill?: string | null) {
  if (highlight) return highlight === 'none' ? undefined : WORD_COLORS[highlight] ?? highlight;
  if (!fill) return;
  const hex = fill.replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex : undefined;
}

// Character formatting in DOCX can merge two adjacent strokes. Node metadata retains
// their individual anchors when the saved bytes still contain both excerpts.
function preserveDocxAnchors(saved: DocumentHighlight[], previous: readonly DocumentHighlight[], length: number) {
  if (!previous.some(mark => mark.anchor)) return saved;
  const used = new Set<string>();
  return saved.flatMap(span => {
    let best: DocumentHighlight[] = [];
    let sameId: DocumentHighlight | undefined;
    let hasSplit = false;
    let distance = Infinity;
    for (let i = 0; i < previous.length; i++) {
      const first = previous[i];
      if (!first.anchor || used.has(first.id) || !span.text.startsWith(first.text)) continue;
      let end = first.anchor.start, covered = 0;
      const group: DocumentHighlight[] = [];
      for (let j = i; j < previous.length && covered < span.text.length; j++) {
        const candidate = previous[j];
        if (candidate.anchor?.blockId !== first.anchor.blockId || candidate.anchor.start !== end
          || used.has(candidate.id) || !span.text.startsWith(candidate.text, covered)) break;
        group.push(candidate);
        covered += candidate.text.length;
        end = candidate.anchor.end;
      }
      if (covered !== span.text.length) continue;
      if (group.length > 1) hasSplit = true;
      else if (first.id === span.id) sameId = first;
      const center = (first.fraction + group[group.length - 1].fraction) / 2;
      const delta = Math.abs(center - span.fraction);
      if (delta < distance) { best = group; distance = delta; }
    }
    if (!hasSplit && sameId) best = [sameId];
    if (!best.length) {
      const id = used.has(span.id) ? generateId() : span.id;
      used.add(id);
      return [{ ...span, id }];
    }
    let offset = span.fraction * length - span.text.length / 2;
    return best.map(mark => {
      used.add(mark.id);
      const fraction = (offset + mark.text.length / 2) / length;
      offset += mark.text.length;
      return { ...mark, color: span.color, fraction };
    });
  });
}

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
        color = wordHighlightColor(highlight, fill);
      }
      if (el.localName === 't') { collected.append(el.textContent ?? '', color); return; }
      if (el.localName === 'tab' || el.localName === 'br') { collected.append(' ', color); return; }
    }
    for (const child of el.children) visit(child, color);
    if (el.namespaceURI === ns && el.localName === 'p') collected.append('\n');
  };
  visit(doc.documentElement);
  return preserveDocxAnchors(collected.finish(), previous, collected.length);
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
