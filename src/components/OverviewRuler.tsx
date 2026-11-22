import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Handle, Position, useStore as useFlowStore, useUpdateNodeInternals } from '@xyflow/react';
import type { ThoughtData } from '../types';
import { fmt, useT } from '../i18n';
import { overviewRulerMarks, overviewRulerTicks, rulerGeometry, type OverviewRulerMark } from '../lib/overview-ruler';
import { findHighlightedPassage, revealHighlight, revealMountedPdfHighlight } from '../lib/highlight-navigation';
import { revealMountedDocxHighlight } from '../lib/docx-ruler-navigation';
import { observeRulerLayout, type RulerLayout, type RulerTextSurface } from '../lib/overview-ruler-layout';
import { findRichHighlightRange, savedDocumentHighlights } from '../lib/document-highlights';
import { useUiStore } from '../lib/ui-store';
import { isDocxDocument } from '../lib/document-copy';
import { useStore } from '../store';
import { subscribeDocxHighlights } from '../lib/docx-highlight-drafts';
import { liveDocxRulerData } from '../lib/docx-ruler-data';
import './OverviewRuler.css';

function revealConversationTurn(host: Element, turn: 'question' | 'response', mark: OverviewRulerMark) {
  const selector = `[data-highlight-turn="${turn}"]`;
  const range = findHighlightedPassage(host.querySelectorAll<HTMLElement>(selector), mark.text, mark.occurrence);
  if (!range) return false;
  const body = range.startContainer.parentElement?.closest<HTMLElement>(selector);
  if (!body?.getClientRects().length) return false;
  const activity = body.closest<HTMLElement>('.activity-scroll');
  const pane = body.closest<HTMLElement>('[data-conversation-split-question], [data-conversation-split-answer]');
  if (activity) revealHighlight(activity, range);
  revealHighlight(pane ?? body, range);
  return true;
}

function jumpToHighlight(id: string, data: ThoughtData, mark: OverviewRulerMark, tick: HTMLElement) {
  const ui = useUiStore.getState();
  const card = tick.closest<HTMLElement>('.react-flow__node');
  const conversationTurn = !mark.attachmentId && !['file', 'link', 'note'].includes(data.stepKind ?? '')
    ? mark.source ?? 'response' : undefined;
  const openReader = () => ui.setReaderNodeId(id, { rulerMark: { ...mark }, attachmentId: mark.attachmentId, conversationTurn });
  if (ui.readerNodeId === id) { openReader(); return; }
  if (conversationTurn && ui.panelOpen && ui.panelNodeId === id) {
    const panel = document.querySelector(`[data-focus-node-id="${CSS.escape(id)}"]`);
    if (panel && revealConversationTurn(panel, conversationTurn, mark)) return;
  }
  if (card) {
    if (mark.attachmentId) {
      const doc = card.querySelector<HTMLElement>(`[data-document-card="${CSS.escape(mark.attachmentId)}"]`);
      if (doc && mark.documentMarkId) {
        if (revealMountedPdfHighlight(doc, mark) || revealMountedDocxHighlight(doc, mark)) return;
        const rich = doc.querySelector<HTMLElement>('[data-document-rich-body]');
        const scroller = rich?.closest<HTMLElement>('[data-content-body]');
        const saved = data.attachments.find(att => att.id === mark.attachmentId)?.documentHighlights?.find(item => item.id === mark.documentMarkId);
        const range = rich && saved && findRichHighlightRange(rich, saved);
        if (range && scroller?.clientHeight) { revealHighlight(scroller, range, true); return; }
      }
    } else if (conversationTurn) {
      if (revealConversationTurn(card, conversationTurn, mark)) return;
    } else {
      const body = card.querySelector<HTMLElement>('[data-content-body] .markdown-body');
      const scroller = body?.closest<HTMLElement>('[data-content-body]');
      const range = body && findHighlightedPassage([body], mark.text, mark.occurrence);
      if (range && scroller?.clientHeight && body.getClientRects().length) { revealHighlight(scroller, range); return; }
    }
  }
  openReader();
}

/** Every tick is a measured canvas port, including ticks outside the current reading viewport. */
export default function OverviewRuler({ id, data, textSurface }: { id: string; data: ThoughtData; textSurface?: RulerTextSurface }) {
  const t = useT();
  const rulerData = useSyncExternalStore(subscribeDocxHighlights, () => liveDocxRulerData(data), () => data);
  const marks = useMemo(() => overviewRulerMarks(rulerData), [rulerData]);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<RulerLayout>();
  useLayoutEffect(() => {
    const ruler = rulerRef.current;
    if (ruler) return observeRulerLayout(ruler, marks, textSurface, setLayout);
  }, [marks, textSurface]);
  // Compensate for zoom in steps so handle bounds need not be remeasured every frame.
  const scale = useFlowStore(state => marks.length
    ? Math.max(1, Math.min(3, Math.round(2 / state.transform[2]) / 2)) : 1);
  const connectable = useFlowStore(state => state.nodesConnectable && state.nodeLookup.get(id)?.connectable !== false);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    let active = true;
    for (const att of data.attachments ?? []) {
      if (att.documentHighlights !== undefined || !isDocxDocument(att)) continue;
      void savedDocumentHighlights(att).then(documentHighlights => {
        const state = useStore.getState();
        const current = state.nodes.find(node => node.id === id)?.data.attachments.find(item => item.id === att.id);
        if (active && current === att && documentHighlights) state.setAttachmentData(id, att.id, { documentHighlights });
      }).catch(() => { /* Unavailable legacy bytes still have a readable text copy. */ });
    }
    return () => { active = false; };
  }, [id, data.attachments]);
  const ticks = useMemo(() => overviewRulerTicks(marks, layout?.height ?? 0, scale, layout?.tops), [marks, layout, scale]);
  const hadMarks = useRef(false);
  useLayoutEffect(() => {
    if (ticks.length || hadMarks.current) updateNodeInternals(id);
    hadMarks.current = ticks.length > 0;
  }, [id, ticks, updateNodeInternals]);
  if (ticks.length === 0) return null;
  return <div ref={rulerRef} className="overview-ruler nodrag nopan" data-overview-ruler role="group" aria-label={t('overviewRuler.title')}
    style={{ '--ruler-scale': scale, top: rulerGeometry.inset, bottom: rulerGeometry.inset,
      width: rulerGeometry.tickWidth * scale, left: `calc(100% + ${rulerGeometry.gap * scale}px)` } as CSSProperties}
    onDoubleClick={event => event.stopPropagation()}>
    {ticks.map(({ mark, left, top }) => {
      const excerpt = mark.text.trim();
      const passage = excerpt.length > 160 ? excerpt.slice(0, 159) + '…' : excerpt || t('overviewRuler.area');
      const location = mark.page ? fmt(t('overviewRuler.page'), { page: mark.page, text: passage }) : passage;
      const label = fmt(t(connectable ? 'overviewRuler.extend' : 'overviewRuler.jump'), { text: location });
      return <Handle key={mark.id} id={mark.id} type="source" position={Position.Right}
        isConnectable={connectable} isConnectableStart={connectable} isConnectableEnd={false}
        className="overview-ruler-mark nodrag nopan" data-overview-ruler-mark={mark.id} data-export-ruler-label={fmt(t('overviewRuler.jump'), { text: location })}
        style={{ top, left, width: rulerGeometry.tickWidth * scale, backgroundColor: mark.color }}
        role="button" tabIndex={0} aria-label={label} data-tooltip={label}
        onPointerDownCapture={event => { delete event.currentTarget.dataset.rulerDragged; }}
        onClickCapture={event => {
          event.stopPropagation();
          if (!event.currentTarget.dataset.rulerDragged) jumpToHighlight(id, data, mark, event.currentTarget);
        }}
        onKeyDown={event => {
          if ((event.key !== 'Enter' && event.key !== ' ') || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) jumpToHighlight(id, data, mark, event.currentTarget);
        }} />;
    })}
  </div>;
}
