import { useCallback, useRef, useState, type RefObject } from 'react';
import { useStore } from '../store';
import { generateId } from '../utils';
import { withinOneCodeBlock } from './highlight-match';
import { useDismissableLayer } from './use-dismissable-layer';
import { isViewerMode } from './viewer';

/** A persistent reading tool. Selecting text is the explicit marking gesture;
 * outside clicks never commit a selection, and Escape only puts the pen away. */
export function useTextHighlighter({ scopeKey, enabled, surfaceRef }: {
  scopeKey: string;
  enabled: boolean;
  surfaceRef: RefObject<HTMLElement | null>;
}) {
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const available = enabled && !isViewerMode;
  if (activeScope !== null && (!available || activeScope !== scopeKey)) setActiveScope(null);
  const active = available && activeScope === scopeKey;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggle = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setActiveScope(current => available && current !== scopeKey ? scopeKey : null);
  }, [available, scopeKey]);

  useDismissableLayer({
    open: active,
    refs: [surfaceRef, buttonRef],
    dismissOnOutside: false,
    restoreFocusRef: buttonRef,
    onDismiss: () => {
      setActiveScope(null);
      window.getSelection()?.removeAllRanges();
    },
  });

  // Hosts validate both range endpoints against their answer/material boundary.
  // Consume unsupported or repeated selections without creating undo entries.
  const markSelection = useCallback((selection: Selection, nodeId: string) => {
    if (!active) return false;
    if (!selection.rangeCount || selection.isCollapsed) return true;
    const range = selection.getRangeAt(0);
    if (withinOneCodeBlock(range)) return true;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    const state = useStore.getState();
    const node = state.nodes.find(candidate => candidate.id === nodeId);
    if (text && node && !node.data.isLoading && !node.data.isEditingResponse
      && !node.data.highlights.some(mark => mark.text.replace(/\s+/g, ' ').trim() === text)) {
      state.addHighlight(nodeId, { id: generateId(), text });
    }
    selection.removeAllRanges();
    return true;
  }, [active]);

  return { active, toggle, buttonRef, markSelection };
}
