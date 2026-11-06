import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { fmt, useT } from '../i18n';
import { DEFAULT_QUESTION_HEIGHT_RATIO, MIN_QUESTION_HEIGHT_RATIO, MAX_QUESTION_HEIGHT_RATIO, questionHeightRatio } from '../lib/conversation-split';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import './ConversationSplit.css';

interface Props {
  nodeId: string;
  surface: 'node' | 'panel';
  enabled: boolean;
  availableHeight?: number;
  question: ReactNode;
  answer: ReactNode;
}

interface Drag {
  nodeId: string;
  pointerId: number;
  startY: number;
  startRatio: number;
  ratio: number;
  height: number;
  changed: boolean;
}

/** Both reading surfaces use the same ratio; a drag persists only on release. */
export default function ConversationSplit({ nodeId, surface, enabled, availableHeight, question, answer }: Props) {
  return enabled
    ? <ResizableConversation key={nodeId} nodeId={nodeId} surface={surface} availableHeight={availableHeight} question={question} answer={answer} />
    : <>{question}{answer}</>;
}

function ResizableConversation({ nodeId, surface, availableHeight, question, answer }: Omit<Props, 'enabled'>) {
  const t = useT();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [contentHeight, setContentHeight] = useState({ question: 0, answer: 0, total: 0 });
  const [preview, setPreview] = useState<{ nodeId: string; ratio: number; height: number } | null>(null);
  const savedRatio = useStore(s => s.nodes.find(n => n.id === nodeId)?.data.questionHeightRatio);
  const setRatio = useStore(s => s.setQuestionHeightRatio);
  const ratio = preview?.nodeId === nodeId ? preview.ratio : questionHeightRatio(savedRatio);
  const fullHeight = contentHeight.question + contentHeight.answer + 13;
  const naturalHeight = Math.min(420, fullHeight);
  const panelHeight = surface === 'panel'
    ? preview?.height ?? Math.min(availableHeight ?? 420, fullHeight)
    : undefined;
  const available = Math.max(0, Math.min(contentHeight.total - 12, contentHeight.question + contentHeight.answer + 2));
  const minimum = available ? Math.max(0, 1 - (contentHeight.answer + 1) / available) : 0;
  const maximum = available ? Math.min(1, (contentHeight.question + 1) / available) : 1;
  const effectiveRatio = Math.min(maximum, Math.max(minimum, ratio));
  const lowerRatio = Math.max(MIN_QUESTION_HEIGHT_RATIO, minimum);
  const upperRatio = Math.min(MAX_QUESTION_HEIGHT_RATIO, maximum);
  const adjustable = available > 0 && (upperRatio - lowerRatio) * available > 1;
  const boundedRatio = (value: number) => Math.min(upperRatio, Math.max(lowerRatio, value));
  // Keep each flex weight above one: after the shorter pane hits its content
  // ceiling, the remaining pane must consume all remaining space, not a fraction.
  const questionGrow = ratio * 100;
  const answerGrow = (1 - ratio) * 100;

  // Canvas cards keep stable outer geometry. Panel reading space also stops
  // at the full-content height instead of filling the window with empty space.
  useLayoutEffect(() => {
    if (!questionRef.current || !answerRef.current) return;
    const measure = () => {
      const question = questionRef.current?.offsetHeight ?? 0;
      const answer = answerRef.current?.offsetHeight ?? 0;
      const total = rootRef.current?.offsetHeight ?? 0;
      setContentHeight(current => current.question === question && current.answer === answer && current.total === total
        ? current : { question, answer, total });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(questionRef.current);
    observer.observe(answerRef.current);
    if (rootRef.current) observer.observe(rootRef.current);
    measure();
    return () => observer.disconnect();
  }, [surface]);

  const cancelDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPreview(null);
    if (drag && dividerRef.current?.hasPointerCapture(drag.pointerId)) dividerRef.current.releasePointerCapture(drag.pointerId);
  };
  useDismissableLayer({ open: preview !== null, refs: [dividerRef], priority: 10,
    dismissOnOutside: false, restoreFocus: false, onDismiss: cancelDrag });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current || !adjustable) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const height = rootRef.current?.offsetHeight ?? 0;
    const questionPane = questionRef.current?.parentElement;
    const answerPane = answerRef.current?.parentElement;
    const paneHeight = (questionPane?.clientHeight ?? 0) + (answerPane?.clientHeight ?? 0);
    const startRatio = paneHeight ? (questionPane?.clientHeight ?? 0) / paneHeight : effectiveRatio;
    dragRef.current = { nodeId, pointerId: event.pointerId, startY: event.clientY, startRatio, ratio: startRatio, height, changed: false };
    setPreview({ nodeId, ratio: startRatio, height });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    // Both rectangles are screen-space, so the delta stays correct at any canvas zoom.
    const height = (rootRef.current?.getBoundingClientRect().height ?? 0) - event.currentTarget.getBoundingClientRect().height;
    if (height <= 0) return;
    const next = boundedRatio(drag.startRatio + (event.clientY - drag.startY) / height);
    if (!drag.changed && Math.abs((next - drag.startRatio) * height) < 1) return;
    drag.changed = true;
    drag.ratio = next;
    setPreview({ nodeId, ratio: drag.ratio, height: drag.height });
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    setPreview(null);
    if (commit && drag.changed && drag.nodeId === nodeId) setRatio(nodeId, drag.ratio);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
      return;
    }
    const step = event.shiftKey ? 0.1 : 0.02;
    const next = event.key === 'ArrowUp' ? effectiveRatio - step
      : event.key === 'ArrowDown' ? effectiveRatio + step
      : event.key === 'Home' ? lowerRatio
      : event.key === 'End' ? upperRatio : undefined;
    if (next === undefined || dragRef.current || !adjustable) return;
    event.preventDefault();
    event.stopPropagation();
    const bounded = boundedRatio(next);
    if (Math.abs((bounded - effectiveRatio) * available) >= 1) setRatio(nodeId, bounded);
  };

  return (
    <div ref={rootRef} className={`conversation-split${preview?.nodeId === nodeId ? ' conversation-split--dragging' : ''}`}
      style={{ '--conversation-natural-height': `${naturalHeight}px`, height: panelHeight } as CSSProperties}
      data-conversation-split={surface} data-conversation-node-id={nodeId}>
      <div id={`${id}-question`} className="conversation-split-question nodrag nopan nowheel"
        data-conversation-split-question style={{ flexGrow: questionGrow, maxHeight: contentHeight.question + 1 }}><div ref={questionRef} className="conversation-split-content">{question}</div></div>
      <div ref={dividerRef} role="separator" tabIndex={adjustable ? 0 : -1} aria-orientation="horizontal" aria-label={t('conversation.resize')}
        aria-controls={`${id}-question ${id}-answer`} aria-valuemin={Math.round(minimum * 100)} aria-valuemax={Math.round(maximum * 100)}
        aria-disabled={!adjustable || undefined} data-adjustable={adjustable || undefined}
        aria-valuenow={Math.round(effectiveRatio * 100)}
        aria-valuetext={fmt(t('conversation.resizeValue'), { question: Math.round(effectiveRatio * 100), answer: Math.round((1 - effectiveRatio) * 100) })}
        data-conversation-divider data-conversation-split-handle
        className="conversation-divider nodrag nopan nowheel"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={event => { onPointerMove(event); finishDrag(event, true); }} onPointerCancel={event => finishDrag(event, false)}
        onLostPointerCapture={event => finishDrag(event, false)} onKeyDown={onKeyDown}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (adjustable) setRatio(nodeId, DEFAULT_QUESTION_HEIGHT_RATIO); }} />
      <div id={`${id}-answer`} className="conversation-split-answer nodrag nopan nowheel"
        data-conversation-split-answer style={{ flexGrow: answerGrow, maxHeight: contentHeight.answer + 1 }}><div ref={answerRef} className="conversation-split-content">{answer}</div></div>
    </div>
  );
}
