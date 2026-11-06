import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isImeComposing } from '../utils';

type HistoryKeys = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Keep panel routing and the canvas handler on the same shortcut contract. */
export function canvasHistoryCommand(event: HistoryKeys): 'undo' | 'redo' | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey) return 'redo';
  return null;
}

/** Native text undo belongs to editors, not checkbox/radio and other inputs. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target instanceof HTMLInputElement && ![
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
  ].includes(target.type);
}

/** Working panels isolate local navigation while sharing canvas history.
 * Text fields retain native undo because the canvas handler ignores them.
 * Escape still belongs to the shared dismissal stack, including portal menus.
 */
export function handleCanvasPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (isImeComposing(event) || (event.key !== 'Escape' && !canvasHistoryCommand(event))) {
    event.stopPropagation();
  }
}
