import { useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface CardOwner {
  token: symbol;
  name: string;
  suspend: () => void;
}

/** Temporary toolbar cards share one slot; the working inspector resumes afterwards. */
export const useCanvasToolCards = create<{ active: CardOwner | null }>(() => ({ active: null }));

/** Relinquishing the slot closes the old card without cancelling its draft. */
export function useCanvasToolCard(name: string, requested: boolean, onSuspend: () => void): boolean {
  const [token] = useState(() => Symbol(name));
  const suspend = useRef(onSuspend);
  const active = useCanvasToolCards((state) => state.active);
  useLayoutEffect(() => { suspend.current = onSuspend; });
  useLayoutEffect(() => {
    if (!requested) return;
    const previous = useCanvasToolCards.getState().active;
    useCanvasToolCards.setState({ active: { token, name, suspend: () => suspend.current() } });
    previous?.suspend();
    return () => {
      if (useCanvasToolCards.getState().active?.token === token) {
        useCanvasToolCards.setState({ active: null });
      }
    };
  }, [name, requested, token]);
  return requested && active?.token === token;
}
