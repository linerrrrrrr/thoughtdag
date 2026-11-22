import type { Attachment, Highlight, ThoughtData } from '../types';
import { documentCopyText, isEditableDocument } from './document-copy';
import { attachmentHighlights, proseOccurrences, renderedHighlightText } from './highlight-match';
import { isNotebook } from './notebook';
import { isPdfPointNote } from './pdf-mark';

export interface OverviewRulerMark {
  id: string;
  /** Relative position in the source, used when the passage has no mounted layout. */
  fraction: number;
  text: string;
  source?: Highlight['source'];
  color?: string;
  page?: number;
  attachmentId?: string;
  /** Stable ID inside a PDF or rich document's own highlight index. */
  documentMarkId?: string;
  /** Zero-based among visible occurrences of this passage in its own text. */
  occurrence?: number;
}

export const rulerGeometry = { inset: 8, gap: 16, tickWidth: 9 } as const;
export interface OverviewRulerTick { mark: OverviewRulerMark; left: number; top: number }
const tickCache = new WeakMap<OverviewRulerMark[], { trackHeight: number; scale: number; ticks: OverviewRulerTick[] }>();

/** Close passages keep their reading position and get separate horizontal hit areas. */
export function overviewRulerTicks(marks: OverviewRulerMark[], trackHeight: number, scale = 1,
  measured?: ReadonlyMap<string, number>): OverviewRulerTick[] {
  const previous = !measured?.size ? tickCache.get(marks) : undefined;
  if (previous?.trackHeight === trackHeight && previous.scale === scale) return previous.ticks;
  const ticks = marks.map(mark => ({ mark, left: 0, top: measured?.get(mark.id) ?? mark.fraction * trackHeight }));
  if (measured?.size) ticks.sort((a, b) => a.top - b.top);
  const laneEnds: number[] = [];
  for (const tick of ticks) {
    let lane = laneEnds.findIndex(end => end <= tick.top);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = tick.top + 12 * scale;
    tick.left = lane * 16 * scale;
  }
  if (!measured?.size) tickCache.set(marks, { trackHeight, scale, ticks });
  return ticks;
}

const PREFIX = 'ruler/';
const cache = new WeakMap<ThoughtData, OverviewRulerMark[]>();
const encode = encodeURIComponent;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function isOverviewRulerHandle(id: string | null | undefined): boolean {
  return typeof id === 'string' && /^ruler\/(?:text\/[^/]*\/[^/]+\/\d+|mark\/[^/]+\/[^/]+)$/.test(id);
}

/** Older conversations also exposed an answer tick on any attachment that
 * repeated the passage. Keep wires from those aliases on the saved highlight. */
export function resolveRulerHandle(data: ThoughtData, handle?: string | null): string | undefined {
  if (!handle || !isOverviewRulerHandle(handle)) return;
  const marks = overviewRulerMarks(data);
  if (marks.some(mark => mark.id === handle)) return handle;
  const [, kind, file, highlight, occurrence] = handle.split('/');
  if (kind !== 'text' || !file || !data.attachments?.some(att => encode(att.id) === file)
    || ['file', 'note', 'link'].includes(data.stepKind ?? '')) return;
  const body = `${PREFIX}text//${highlight}/`;
  const answerMarks = marks.filter(mark => !mark.source && mark.id.startsWith(body));
  return answerMarks.find(mark => mark.id === body + occurrence)?.id ?? answerMarks[0]?.id;
}

export function remapOverviewRulerHandle(id: string, attachmentIds: ReadonlyMap<string, string>, highlightIds: ReadonlyMap<string, string>): string {
  if (!isOverviewRulerHandle(id)) return id;
  const [, kind, attachmentId, markId, occurrence] = id.split('/');
  // Compare encoded IDs so even an unrecognized imported escape sequence is preserved.
  const remap = (value: string, map: ReadonlyMap<string, string>) => {
    for (const [from, to] of map) if (encode(from) === value) return encode(to);
    return value;
  };
  return kind === 'text'
    ? `${PREFIX}text/${remap(attachmentId, attachmentIds)}/${remap(markId, highlightIds)}/${occurrence}`
    : `${PREFIX}mark/${remap(attachmentId, attachmentIds)}/${markId}`;
}

function textSection(source: string, highlights: Highlight[], attachmentId?: string, turn?: Highlight['source'], measureUnmarked = false) {
  const applicable = highlights.filter(mark => mark.source === turn && mark.text.trim() && (!mark.attachmentId || mark.attachmentId === attachmentId));
  if ((!applicable.length && !measureUnmarked) || !source.trim()) return { length: 0, marks: [] };
  const rendered = renderedHighlightText(source);
  const result: OverviewRulerMark[] = [];
  for (const mark of applicable) {
    const needle = mark.text.replace(/\s+/g, ' ').trim();
    let occurrence = 0;
    for (const index of proseOccurrences(rendered, needle)) {
      result.push({
        id: `${PREFIX}text/${encode(attachmentId ?? '')}/${encode(mark.id)}/${occurrence}`,
        fraction: (index + needle.length / 2) / rendered.text.length, text: mark.text, source: mark.source, attachmentId, occurrence,
      });
      occurrence++;
    }
  }
  return { length: rendered.text.length, marks: result };
}

function attachmentText(attachment: Attachment): string {
  if (isEditableDocument(attachment)) return documentCopyText(attachment);
  if (attachment.type.startsWith('image/') || attachment.type === 'text/html' || isNotebook(attachment)) return attachment.extractedText ?? '';
  return attachment.content ?? '';
}

function documentMarks(att: Attachment): OverviewRulerMark[] {
  const prefix = `${PREFIX}mark/${encode(att.id)}/`;
  const marks: OverviewRulerMark[] = [];
  // The native format stores separate paragraph ranges. One pen gesture owns one port.
  const strokes = new Map<string, OverviewRulerMark>();
  for (const mark of att.documentHighlights ?? []) {
    if (!Number.isFinite(mark.fraction)) continue;
    const earlier = mark.strokeId && strokes.get(mark.strokeId);
    if (earlier) {
      earlier.text += '\n' + mark.text;
      continue;
    }
    const tick = { ...mark, id: prefix + encode(mark.strokeId ?? mark.id), documentMarkId: mark.id,
      fraction: clamp(mark.fraction), attachmentId: att.id };
    marks.push(tick);
    if (mark.strokeId) strokes.set(mark.strokeId, tick);
  }
  const annotations = att.pdfAnnotations ?? [];
  const pages = annotations.reduce((count, mark) => Number.isInteger(mark.page) ? Math.max(count, mark.page) : count,
    Math.max(1, att.numPages || 0, att.pageImages?.length ?? 0));
  for (const mark of annotations) {
    if (isPdfPointNote(mark) || !Number.isInteger(mark.page) || mark.page < 1) continue;
    const rect = mark.rects?.find(([x, y, w, h]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0);
    if (!rect) continue;
    marks.push({ id: prefix + encode(mark.id), fraction: (mark.page - 1 + clamp(rect[1] + rect[3] / 2)) / pages,
      text: mark.text || mark.comment || '', page: mark.page, color: mark.color, attachmentId: att.id, documentMarkId: mark.id });
  }
  return marks;
}

/** Conversation fallback for surfaces without mounted text. The question and
 * answer share a continuous reading order independent of attached documents. */
function conversationMarks(data: ThoughtData, highlights: Highlight[]): OverviewRulerMark[] {
  if (!highlights.some(mark => !mark.attachmentId && mark.text.trim())) return [];
  const question = textSection(data.question ?? '', highlights, undefined, 'question', true);
  const answer = textSection(data.response ?? '', highlights, undefined, undefined, true);
  const total = question.length + answer.length;
  return [
    ...question.marks.map(mark => ({ ...mark, fraction: mark.fraction * question.length / total })),
    ...answer.marks.map(mark => ({ ...mark, fraction: (question.length + mark.fraction * answer.length) / total })),
  ];
}

export function overviewRulerMarks(data: ThoughtData): OverviewRulerMark[] {
  const existing = cache.get(data);
  if (existing) return existing;
  const highlights = data.highlights ?? [];
  const sections: OverviewRulerMark[][] = [];
  const material = data.stepKind === 'file' || data.stepKind === 'note' || data.stepKind === 'link';
  const marks = material ? [] : conversationMarks(data, highlights);
  if (material) {
    const question = textSection(data.question ?? '', highlights, undefined, 'question');
    if (question.marks.length) sections.push(question.marks);
    const primary = data.stepKind === 'file' ? data.response : data.question;
    if (primary) sections.push(textSection(primary, highlights).marks);
  }
  for (const att of data.attachments ?? []) {
    const source = attachmentText(att);
    if (!source && !isEditableDocument(att)) continue;
    sections.push([...textSection(source, attachmentHighlights(data, att.id), att.id).marks, ...documentMarks(att)]);
  }
  // Materials map each readable document to a span in node order. Conversation
  // attachments use the same document coordinates on a separate reading surface.
  sections.forEach((section, index) => {
    for (const mark of section) marks.push({ ...mark, fraction: (index + mark.fraction) / sections.length });
  });
  marks.sort((a, b) => a.fraction - b.fraction);
  cache.set(data, marks);
  return marks;
}
