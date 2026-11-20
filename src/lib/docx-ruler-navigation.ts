import type { SuperDoc, TextAddress } from 'superdoc';
import type { Attachment } from '../types';
import type { OverviewRulerMark } from './overview-ruler';

type Reveal = (mark: OverviewRulerMark) => void;
const hosts = new WeakMap<HTMLElement, Reveal>();

export function registerDocxRulerHost(element: HTMLElement, reveal: Reveal) {
  hosts.set(element, reveal);
  return () => { hosts.delete(element); };
}

/** The live editor moves between its canvas and reader hosts. Only its
 * current owner can scroll it; an unmounted or loading card opens the reader. */
export function revealMountedDocxHighlight(card: HTMLElement, mark: OverviewRulerMark): boolean {
  if (!mark.documentMarkId) return false;
  for (const host of card.querySelectorAll<HTMLElement>('[data-superdoc-scroll]')) {
    const reveal = hosts.get(host);
    if (host.dataset.superdocScroll !== mark.attachmentId || !reveal) continue;
    reveal(mark);
    return true;
  }
  return false;
}

/** Resolve against model text, including virtualized pages. The native query
 * carries exact block ranges and run formatting without changing selection. */
export async function docxHighlightAddress(instance: SuperDoc, attachment: Attachment, id: string, signal: AbortSignal) {
  const saved = attachment.documentHighlights ?? [];
  const mark = saved.find(item => item.id === id);
  const doc = instance.activeEditor?.doc;
  if (!mark?.text || !doc) return;
  const sameText = saved.filter(item => item.text === mark.text);
  const colored: TextAddress[] = [];
  let offset = 0;
  while (!signal.aborted) {
    const result = await doc.query.match({ select: { type: 'text', pattern: mark.text, caseSensitive: true },
      in: { kind: 'story', storyType: 'body' }, offset, limit: 100 });
    for (const item of result.items) {
      if (item.matchKind !== 'text' || item.blocks.length !== 1) continue;
      const block = item.blocks[0];
      if (block.runs.length && block.runs.every(run => run.styles.highlight && run.styles.highlight !== 'none')) {
        colored.push({ kind: 'text', blockId: block.blockId, range: block.range });
      }
    }
    offset += result.items.length;
    if (!result.items.length || offset >= result.total) break;
  }
  if (signal.aborted) return;
  const occurrence = sameText.indexOf(mark);
  if (colored.length === sameText.length) return colored[occurrence];
  // A longer highlight can contain the same words; Word character shading
  // may lack a highlight property. Tabs and soft breaks become one space in
  // our OOXML index. Read literal block text to disambiguate by its position.
  const body = await doc.extract({});
  const length = body.blocks.reduce((total, block) => total + block.text.length + 1, 0);
  let start = 0;
  let best: TextAddress | undefined;
  let distance = Infinity;
  for (const block of body.blocks) {
    const text = block.text.replace(/[\t\n\r\v]/g, ' ');
    for (let i = text.indexOf(mark.text); i >= 0; i = text.indexOf(mark.text, i + mark.text.length)) {
      const delta = Math.abs(start + i + mark.text.length / 2 - mark.fraction * length);
      if (delta < distance) {
        distance = delta;
        best = { kind: 'text', blockId: block.nodeId, range: { start: i, end: i + mark.text.length } };
      }
    }
    start += text.length + 1;
  }
  return best;
}
