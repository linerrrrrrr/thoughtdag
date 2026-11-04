import type { KeyboardEvent } from 'react';
import { isImeComposing } from '../utils';

/** Arrow navigation stays inside an open menu; Tab uses document order. */
export function navigateActionMenu(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.defaultPrevented || isImeComposing(event)) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
  if (event.key === 'Tab') { onClose(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
