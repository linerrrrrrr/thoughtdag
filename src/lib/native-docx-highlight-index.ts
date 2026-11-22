import type { SuperDoc } from 'superdoc';
import type { DocumentHighlight } from '../types';
import { generateId } from '../utils';
import { wordHighlightColor } from './document-highlights';

type Anchor = NonNullable<DocumentHighlight['anchor']>;
type Band = { start: number; end: number; color: string };
type Paragraph = { blockId: string; text: string; bands: Band[] };
export type Stroke = { id: string; strokeId?: string; anchor: Anchor };

// Canonical structural reads can still describe the imported package after an edit.
// Match runs reflect the current native character formatting, including custom Word shading.
export async function readNativeDocxParagraphs(instance: SuperDoc) {
  const doc = instance.activeEditor?.doc;
  if (!doc) return;
  const paragraphs = new Map<string, Paragraph>();
  let offset = 0;
  for (;;) {
    const page = await doc.query.match({ select: { type: 'text', pattern: '.+', mode: 'regex' },
      in: { kind: 'story', storyType: 'body' }, offset, limit: 100 });
    for (const item of page.items) {
      if (item.matchKind !== 'text') continue;
      for (const block of item.blocks) {
        const p = paragraphs.get(block.blockId) ?? { blockId: block.blockId, text: '', bands: [] };
        paragraphs.set(block.blockId, p);
        for (const run of block.runs) {
          const { start, end } = run.range;
          if (start < p.text.length) continue;
          p.text += ' '.repeat(start - p.text.length) + run.text.replace(/[\t\n\r\v]/g, ' ');
          const color = wordHighlightColor(run.styles.highlight);
          if (!color) continue;
          const last = p.bands.at(-1);
          if (last?.end === start && last.color === color) last.end = end;
          else p.bands.push({ start, end, color });
        }
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return [...paragraphs.values()];
}

export function nativeDocxHighlights(paragraphs: Paragraph[], previous: DocumentHighlight[], strokes: Stroke[]) {
  const marks: DocumentHighlight[] = [];
  const byBlock = new Map<string, DocumentHighlight[]>();
  const byText = new Map<string, DocumentHighlight[]>();
  const used = new Set<string>();
  for (const mark of previous) {
    const list = byText.get(mark.text) ?? [];
    list.push(mark);
    byText.set(mark.text, list);
    if (!mark.anchor) continue;
    const local = byBlock.get(mark.anchor.blockId) ?? [];
    local.push(mark);
    byBlock.set(mark.anchor.blockId, local);
  }

  let offset = 0;
  for (const { blockId, text, bands } of paragraphs) {
    const local = byBlock.get(blockId) ?? [];
    for (const band of bands) {
      const cuts = new Set([band.start, band.end]);
      const identities = new Map<string, Pick<Stroke, 'id' | 'strokeId'>>();
      const remember = (start: number, end: number, identity: Pick<Stroke, 'id' | 'strokeId'>) => {
        if (start < band.start || end > band.end || start >= end || used.has(identity.id)) return;
        cuts.add(start);
        cuts.add(end);
        const key = start + '/' + end;
        if (!identities.has(key)) identities.set(key, identity);
      };
      // Preserve authored boundaries when Word coalesces adjacent same-color runs.
      for (const stroke of strokes) {
        const { anchor } = stroke;
        if (blockId === anchor.blockId) remember(anchor.start, anchor.end, stroke);
      }
      const available = local.filter(mark => !used.has(mark.id));
      for (const mark of available) {
        const { start, end } = mark.anchor!;
        if (text.slice(start, end) === mark.text) remember(start, end, mark);
      }
      for (const mark of available) {
        const { start, end } = mark.anchor!;
        if (text.slice(start, end) === mark.text || !mark.text) continue;
        // Translate a recorded boundary across insertions before its text.
        let best = -1;
        for (let pos = text.indexOf(mark.text, band.start); pos >= 0 && pos + mark.text.length <= band.end;
          pos = text.indexOf(mark.text, pos + mark.text.length)) {
          if (!identities.has(pos + '/' + (pos + mark.text.length)) && (best < 0 || Math.abs(pos - start) < Math.abs(best - start))) best = pos;
        }
        if (best >= 0) remember(best, best + mark.text.length, mark);
      }
      const positions = [...cuts].sort((a, b) => a - b);
      for (let i = 1; i < positions.length; i++) {
        const start = positions[i - 1], end = positions[i];
        const excerpt = text.slice(start, end);
        if (!excerpt.trim()) continue;
        const identity = identities.get(start + '/' + end);
        const existing = byText.get(excerpt)?.find(mark => !used.has(mark.id) && (!mark.anchor || mark.anchor.blockId === blockId))
          ?? available.find(mark => !used.has(mark.id) && mark.anchor?.start === start && mark.anchor.end === end);
        const match = identity && !used.has(identity.id) ? identity : existing;
        const id = match?.id ?? generateId();
        used.add(id);
        marks.push({ id, text: excerpt, color: band.color, fraction: offset + (start + end) / 2,
          anchor: { blockId, start, end }, ...(match?.strokeId && { strokeId: match.strokeId }) });
      }
    }
    offset += text.length + 1;
  }
  for (const mark of marks) mark.fraction /= offset;
  return marks;
}
