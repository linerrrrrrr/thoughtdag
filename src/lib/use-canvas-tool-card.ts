import { useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface CardOwner {
  token: symbol;
  name: string;
  suspend: () => void;
}

/** Toolbar cards and working inspectors share one slot without a hidden back stack. */
export const useCanvasToolCards = create<{ active: CardOwner | null }>(() => ({ active: null }));

/** Relinquishing the slot closes the old card without cancelling its draft. */
export function useCanvasToolCard(name: string, requested: boolean, onSuspend: () => void, activationKey = ''): boolean {
  const [token] = useState(() => Symbol(name));
  const suspend = useRef(onSuspend);
  const active = useCanvasToolCards((state) => state.active);
  useLayoutEffect(() => { suspend.current = onSuspend; });
  useLayoutEffect(() => {
    if (!requested) return;
    const previous = useCanvasToolCards.getState().active;
    useCanvasToolCards.setState({ active: { token, name, suspend: () => suspend.current() } });
    if (previous?.token !== token) previous?.suspend();
    return () => {
      if (useCanvasToolCards.getState().active?.token === token) {
        useCanvasToolCards.setState({ active: null });
      }
    };
  }, [name, requested, token, activationKey]);
  return requested && active?.token === token;
}

/** Replacing an inspector preserves its selection, but only a new selection reopens it. */
export function useCanvasSelectionCard(name: string, selectionKey: string, enabled: boolean, reopen = 0): boolean {
  const active = useCanvasToolCards(state => state.active);
  const [request, setRequest] = useState(() => ({ selectionKey, reopen, open: !!selectionKey && enabled }));
  if (request.selectionKey !== selectionKey || request.reopen !== reopen) {
    // Locate actions inside search, chat, and other tools update the selection
    // without replacing the tool the user is still using. Canvas clicks reopen explicitly.
    const canReplace = request.reopen !== reopen || !active || active.name === 'selection-properties';
    setRequest({ selectionKey, reopen, open: !!selectionKey && enabled && canReplace });
  }
  return useCanvasToolCard(name, request.open, () => setRequest(previous => ({ ...previous, open: false })),
    JSON.stringify([request.selectionKey, request.reopen]));
}
