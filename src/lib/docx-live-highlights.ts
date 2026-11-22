import type { SuperDoc } from 'superdoc';
import type { SelectionInfo } from 'superdoc/ui';
import type { Attachment, DocumentHighlight } from '../types';
import { generateId } from '../utils';
import { setDraftDocxHighlights } from './docx-highlight-drafts';
import { nativeDocxHighlights, readNativeDocxParagraphs, type Stroke } from './native-docx-highlight-index';

function sameMarks(left: DocumentHighlight[], right: DocumentHighlight[]) {
  return left.length === right.length && left.every((mark, i) => {
    const other = right[i];
    return mark.id === other.id && mark.strokeId === other.strokeId && mark.text === other.text && mark.color === other.color
      && mark.fraction === other.fraction && mark.anchor?.blockId === other.anchor?.blockId
      && mark.anchor?.start === other.anchor?.start && mark.anchor?.end === other.anchor?.end;
  });
}

export function createDocxHighlightIndex(instance: SuperDoc, attachment: Attachment) {
  let current = attachment;
  let marks = attachment.documentHighlights ?? [];
  // Keep identities of removed marks for native undo/redo while the session exists.
  const known = new Map(marks.map(mark => [mark.id, mark]));
  let strokes: Stroke[] = [];
  let revision = 0;
  let settled = marks.length ? -1 : 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let draft: DocumentHighlight[] | undefined;

  const read = async () => {
    while (!disposed && settled !== revision) {
      const reading = revision;
      const version = instance.ui.document.getVersion();
      let paragraphs;
      try {
        paragraphs = await readNativeDocxParagraphs(instance);
        if (!paragraphs) return;
      } catch {
        // An editor may disappear during replacement; the committed index remains valid.
        return;
      }
      if (disposed || settled === revision) return;
      if (reading !== revision || version !== instance.ui.document.getVersion()) {
        if (timer !== undefined) return;
        continue;
      }
      const ids = new Set(marks.map(mark => mark.id));
      const previous = [...marks, ...Array.from(known.values()).filter(mark => !ids.has(mark.id))];
      const next = nativeDocxHighlights(paragraphs, previous, strokes);
      if (!sameMarks(marks, next)) marks = next;
      strokes = [];
      settled = reading;
      for (const mark of marks) known.set(mark.id, mark);
      draft = instance.ui.document.getSnapshot().dirty && !sameMarks(marks, current.documentHighlights ?? [])
        ? marks : undefined;
      setDraftDocxHighlights(current, draft);
    }
  };
  const flush = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (!inFlight) inFlight = read().finally(() => { inFlight = undefined; });
    await inFlight;
    return settled === revision ? marks : undefined;
  };
  const changed = (delay: number) => {
    revision++;
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, delay);
  };
  const unsubscribe = instance.ui.document.onChange(() => changed(strokes.length ? 0 : 220));
  // Clean files already expose their saved index. Only existing marks need initial block addresses.
  if (marks.length) changed(0);

  return {
    stroke(info: SelectionInfo) {
      const segments = info.target?.segments.filter(segment => segment.range.end > segment.range.start) ?? [];
      const exact = segments.map(({ blockId, range }) => marks.find(mark => mark.anchor?.blockId === blockId
        && mark.anchor.start === range.start && mark.anchor.end === range.end));
      const previousGroup = exact[0]?.strokeId;
      const strokeId = segments.length > 1 && !(previousGroup && exact.every(mark => mark?.strokeId === previousGroup))
        ? generateId() : previousGroup;
      segments.forEach(({ blockId, range }, i) => {
        strokes.push({ id: exact[i]?.id ?? generateId(), strokeId, anchor: { blockId, ...range } });
      });
      changed(0);
    },
    clean() {
      draft = undefined;
      setDraftDocxHighlights(current, undefined);
    },
    flush,
    setAttachment(next: Attachment) {
      if (current === next) return;
      setDraftDocxHighlights(current, undefined);
      current = next;
      if (draft) setDraftDocxHighlights(next, draft);
      else if (next.documentHighlights !== undefined) {
        marks = next.documentHighlights;
        for (const mark of marks) known.set(mark.id, mark);
      }
    },
    saved(next: Attachment) {
      settled = ++revision;
      marks = next.documentHighlights ?? [];
      strokes = [];
      draft = undefined;
      setDraftDocxHighlights(current, undefined);
      current = next;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      setDraftDocxHighlights(current, undefined);
    },
  };
}
