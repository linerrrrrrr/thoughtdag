import { useCallback, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { useStore } from '../store';
import type { Highlight, ThoughtData } from '../types';
import { awaitingInput, generateId } from '../utils';
import { attachmentHighlights, conversationHighlightTexts, withinOneCodeBlock } from './highlight-match';
import { useDismissableLayer } from './use-dismissable-layer';
import { isViewerMode } from './viewer';

export function hasConversationHighlightText(data: ThoughtData) {
  return !!data.response || (!!data.question && !awaitingInput(data));
}

export function canHighlightConversation(data: ThoughtData) {
  return hasConversationHighlightText(data) && !data.isLoading && !data.isEditing && !data.isEditingResponse;
}

export function useConversationHighlights(highlights: Highlight[] | undefined) {
  return useMemo(() => ({
    questionHighlights: conversationHighlightTexts(highlights, 'question'),
    responseHighlights: conversationHighlightTexts(highlights, 'response'),
  }), [highlights]);
}

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

  // Hosts validate both range endpoints against one reading passage.
  // Consume unsupported or repeated selections without creating undo entries.
  const markSelection = useCallback((selection: Selection, nodeId: string, origin: Pick<Highlight, 'source' | 'attachmentId'> = {}) => {
    if (!active) return false;
    if (!selection.rangeCount || selection.isCollapsed) return true;
    const range = selection.getRangeAt(0);
    if (withinOneCodeBlock(range)) return true;
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    const state = useStore.getState();
    const node = state.nodes.find(candidate => candidate.id === nodeId);
    if (text && node && !node.data.isLoading && !node.data.isEditingResponse) {
      const candidates = origin.attachmentId ? attachmentHighlights(node.data, origin.attachmentId)
        : node.data.highlights.filter(mark => !mark.attachmentId && mark.source === origin.source);
      if (!candidates.some(mark => mark.text.replace(/\s+/g, ' ').trim() === text)) {
        state.addHighlight(nodeId, { id: generateId(), text, ...origin });
      }
    }
    selection.removeAllRanges();
    return true;
  }, [active]);

  const markConversationSelection = (event: MouseEvent, nodeId: string) => {
    if (!active || event.button !== 0 || !(event.target instanceof Element)
      || event.target.closest('button, input, textarea')) return;
    const passage = event.target.closest<HTMLElement>('[data-highlight-turn]');
    const selection = window.getSelection();
    if (!passage || !surfaceRef.current?.contains(passage) || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (passage.contains(range.startContainer) && passage.contains(range.endContainer)) {
      markSelection(selection, nodeId, passage.dataset.highlightTurn === 'question' ? { source: 'question' } : {});
    }
  };

  return { active, toggle, buttonRef, markSelection, markConversationSelection };
}
