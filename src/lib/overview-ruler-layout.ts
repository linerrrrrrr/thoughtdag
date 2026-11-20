import { indexHighlightedPassages } from './highlight-navigation';
import type { OverviewRulerMark } from './overview-ruler';

export interface RulerLayout {
  height: number;
  /** CSS pixels from the top of this track. Unmounted passages have no entry. */
  tops: Map<string, number>;
}

/** A full scrollable document occupies the span of its viewport on the ruler.
 * Apply the same projection inside-out for nested scroll panes. */
function passageTop(range: Range, card: HTMLElement, track: DOMRect, height: number) {
  const rect = range.getBoundingClientRect();
  if (!rect.height || !track.height) return;
  let y = rect.top + rect.height / 2;
  for (let el = range.startContainer.parentElement; el && el !== card; el = el.parentElement) {
    if (!el.clientHeight || el.scrollHeight <= el.clientHeight || !/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) continue;
    const box = el.getBoundingClientRect();
    const scale = box.height / el.offsetHeight;
    const top = box.top + el.clientTop * scale;
    y = top + (y - top + el.scrollTop * scale) * el.clientHeight / el.scrollHeight;
  }
  return Math.max(0, Math.min(height, (y - track.top) * height / track.height));
}

export type RulerTextSurface = 'conversation' | 'note';

/** Measure the track and its mounted passages in the same layout pass. A resize
 * reuses live ranges. Only an edit or disclosure changes the text index. */
export function observeRulerLayout(ruler: HTMLElement, marks: OverviewRulerMark[], surface: RulerTextSurface | undefined,
  publish: (layout: RulerLayout) => void) {
  const card = ruler.parentElement!;
  const body = surface && card.querySelector(surface === 'note' ? '.material-content' : '[data-thought-body]');
  const ranges = new Map<string, Range>();
  const measure = () => {
    const height = ruler.clientHeight;
    const track = ruler.getBoundingClientRect();
    const tops = new Map<string, number>();
    for (const [id, range] of ranges) {
      const top = passageTop(range, card, track, height);
      if (top !== undefined) tops.set(id, top);
    }
    publish({ height, tops });
  };
  const resize = new ResizeObserver(measure);
  const bind = () => {
    ranges.clear();
    resize.disconnect();
    resize.observe(ruler);
    if (body) {
      for (const turn of ['question', 'response'] as const) {
        const turnMarks = marks.filter(mark => !mark.attachmentId && (mark.source ?? 'response') === turn);
        if (!turnMarks.length) continue;
        const selector = surface === 'note' ? '[data-content-body] .markdown-body' : `[data-highlight-turn="${turn}"]`;
        const find = indexHighlightedPassages(body.querySelectorAll<HTMLElement>(selector));
        const occurrences = new Map<string, Range[]>();
        for (const mark of turnMarks) {
          const matches = occurrences.get(mark.text) ?? [...find(mark.text)];
          occurrences.set(mark.text, matches);
          const range = matches[mark.occurrence ?? 0];
          if (range) ranges.set(mark.id, range);
        }
      }
      for (const child of card.children) resize.observe(child);
      for (const range of ranges.values()) {
        for (let el = range.startContainer.parentElement; el && el !== card; el = el.parentElement) resize.observe(el);
      }
    }
    measure();
  };
  bind();
  const mutation = new MutationObserver(bind);
  if (body) mutation.observe(body, { childList: true, characterData: true, subtree: true });
  return () => { resize.disconnect(); mutation.disconnect(); };
}
