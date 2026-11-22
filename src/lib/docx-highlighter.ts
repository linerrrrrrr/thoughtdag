import type { SuperDoc } from 'superdoc';
import { t } from '../i18n';
import { recordDocxHighlightStroke } from './docx-session';
import { toast } from './ui-store';

/** Let the native editor finish selecting before formatting the exact model range. */
export function attachDocxHighlighter(instance: SuperDoc, color: string, endOnInput: () => void) {
  const root = instance.element;
  if (!(root instanceof HTMLElement)) return;
  const owner = root.ownerDocument;
  let start: { id: number; x: number; y: number } | null = null;
  let gesture = 0;
  let frame = 0;
  const cancel = () => {
    start = null;
    gesture++;
    cancelAnimationFrame(frame);
  };
  const onPaper = (target: EventTarget | null) => {
    const page = target instanceof Element && target.closest('.superdoc-page');
    return !!page && root.contains(page);
  };
  const begin = (event: PointerEvent) => {
    cancel();
    if (event.isPrimary && event.button === 0 && onPaper(event.target)) {
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };
  const apply = async (stroke: number) => {
    const doc = instance.activeEditor?.doc;
    if (!doc) return;
    try {
      const info = await doc.selection.current({ includeText: true });
      const target = info.selectionTarget;
      if (stroke !== gesture || !target || info.empty || !info.text?.trim()
        || info.tableSelection?.selectionMode === 'cells' || (target.story && target.story.storyType !== 'body')) return;
      const result = await doc.format.highlight({ target, value: color });
      if (!result.success) {
        if (result.failure.code !== 'NO_OP') toast('error', t('nativeDocument.commandFailed'));
        return;
      }
      recordDocxHighlightStroke(instance, info);
      // Reveal the applied ink without moving focus or replacing a newer gesture.
      if (stroke === gesture) instance.ui.selection.apply({ ...target, start: target.end });
    } catch {
      if (stroke === gesture) toast('error', t('nativeDocument.commandFailed'));
    }
  };
  const finish = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    const dragged = event.clientX !== start.x || event.clientY !== start.y;
    start = null;
    if (!dragged || !onPaper(owner.elementFromPoint(event.clientX, event.clientY))) return;
    const stroke = gesture;
    frame = requestAnimationFrame(() => { void apply(stroke); });
  };

  root.setAttribute('data-docx-highlighter-active', '');
  root.addEventListener('pointerdown', begin, true);
  root.addEventListener('pointercancel', cancel, true);
  root.addEventListener('beforeinput', endOnInput, true);
  owner.addEventListener('pointerup', finish, true);
  return () => {
    cancel();
    root.removeAttribute('data-docx-highlighter-active');
    root.removeEventListener('pointerdown', begin, true);
    root.removeEventListener('pointercancel', cancel, true);
    root.removeEventListener('beforeinput', endOnInput, true);
    owner.removeEventListener('pointerup', finish, true);
  };
}
