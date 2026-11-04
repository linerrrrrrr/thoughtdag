import { useLayoutEffect, useRef, type FocusEventHandler, type RefObject } from 'react';
import { useDismissableLayer } from './use-dismissable-layer';

interface InlineEditDismissOptions<T extends HTMLElement> {
  active: boolean;
  ref: RefObject<T | null>;
  /** Commit a reversible short field, or suspend a cached content draft. */
  onOutside: () => void;
  onCancel: () => void;
  ignoreOutside?: (event: PointerEvent) => boolean;
  ignoreFocusOutside?: (target: EventTarget | null) => boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** The entire editor, including its action buttons, is one focus boundary. */
export function useInlineEditDismiss<T extends HTMLElement>(options: InlineEditDismissOptions<T>): { onBlur: FocusEventHandler<T> } {
  const settled = useRef(false);
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useLayoutEffect(() => { settled.current = false; }, [options.active]);
  const finish = (cancel: boolean) => {
    if (!latest.current.active || settled.current) return;
    settled.current = true;
    if (cancel) latest.current.onCancel();
    else latest.current.onOutside();
  };
  const { isTopLayer } = useDismissableLayer({
    open: options.active,
    refs: [options.ref],
    onDismiss: reason => finish(reason === 'escape'),
    ignoreOutside: options.ignoreOutside,
    restoreFocusRef: options.restoreFocusRef,
  });
  return {
    onBlur: event => {
      // Null means the window lost focus or the focused element was removed.
      // Pointer dismissal handles blank canvas; neither case is a Tab exit.
      const next = event.relatedTarget;
      if (options.ignoreFocusOutside?.(next)) return;
      if (next instanceof Node && !options.ref.current?.contains(next) && isTopLayer()) finish(false);
    },
  };
}
