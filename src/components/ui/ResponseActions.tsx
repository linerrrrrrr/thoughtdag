import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { copyText } from '../../lib/export';
import { useDismissableLayer } from '../../lib/use-dismissable-layer';
import { isViewerMode } from '../../lib/viewer';
import { useStore } from '../../store';

const actionClass = 'inline-flex items-center justify-center rounded-control transition-colors hover:bg-wash hover:text-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

function ManualCopy({ text, trigger, onClose }: {
  text: string; trigger: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  const t = useT();
  const label = useRef<HTMLLabelElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useDismissableLayer({ open: true, refs: [label, trigger], onDismiss: onClose,
    dismissOnFocusOutside: true, restoreFocusRef: trigger });
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  return <label ref={label} onClick={event => event.stopPropagation()}
    className="response-manual-copy nodrag nopan order-last grid min-w-0 basis-full gap-1 pt-1 text-control text-ink-muted">
    {t('actions.manualCopy')}
    <textarea ref={input} readOnly rows={2} value={text}
      className="nowheel w-full min-w-0 resize-none select-text rounded-control border border-line bg-card px-2 py-1 text-body text-ink focus-visible:outline-2 focus-visible:outline-accent" />
  </label>;
}

export function ResponseCopyButton({ text }: { text: string }) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const attempt = useRef(0);
  const timer = useRef<number>(undefined);
  const [feedback, setFeedback] = useState<{ text: string; kind: 'copied' | 'manual' } | null>(null);
  if (feedback && feedback.text !== text) setFeedback(null);
  useLayoutEffect(() => () => {
    attempt.current++;
    window.clearTimeout(timer.current);
  }, [text]);

  const copy = async () => {
    const current = ++attempt.current;
    window.clearTimeout(timer.current);
    setFeedback(null);
    try {
      await copyText(text, { notify: false });
    } catch {
      if (attempt.current === current) setFeedback({ text, kind: 'manual' });
      return;
    }
    if (attempt.current !== current) return;
    setFeedback({ text, kind: 'copied' });
    timer.current = window.setTimeout(() => setFeedback(null), 1500);
  };
  const copied = feedback?.kind === 'copied';
  const Icon = copied ? Check : ClipboardCopy;
  return <>
    <button type="button" ref={trigger} onClick={event => { event.stopPropagation(); void copy(); }}
      aria-label={t('actions.copyResponse')} data-tooltip={t('actions.copyResponse')}
      className={`${actionClass} nodrag h-8 gap-1 px-1.5 text-control ${copied ? 'text-accent' : ''}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="grid text-left" aria-hidden="true">
        <span className={`col-start-1 row-start-1 ${copied ? 'invisible' : ''}`}>{t('actions.copy')}</span>
        <span className={`col-start-1 row-start-1 ${copied ? '' : 'invisible'}`}>{t('ctx.copied')}</span>
      </span>
    </button>
    <span role="status" className="sr-only">{copied ? t('ctx.copied') : ''}</span>
    {feedback?.kind === 'manual' && <ManualCopy text={text} trigger={trigger} onClose={() => setFeedback(null)} />}
  </>;
}

export function ResponseVersions({ nodeId, index, count, allowDelete = true }: {
  nodeId: string; index: number; count: number; allowDelete?: boolean;
}) {
  const t = useT();
  const navigate = (direction: 'prev' | 'next') => useStore.getState().navigateVersion(nodeId, direction);
  return <div className="nodrag ml-1 inline-flex shrink-0 items-center gap-1.5 text-control text-ink-muted"
    onClick={event => event.stopPropagation()}>
    <div role="group" aria-label={t('actions.responseVersions')}
      className="inline-flex items-center rounded-content border border-line">
      <button type="button" className={`${actionClass} size-8`} onClick={() => navigate('prev')}
        aria-label={t('actions.previousVersion')} data-tooltip={t('actions.previousVersion')}>
        <ChevronLeft size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span className="text-center font-medium tabular-nums text-accent" style={{ minWidth: `${2 + 2 * String(count).length}ch` }}
        aria-live="polite" aria-atomic="true">v{index + 1}/{count}</span>
      <button type="button" className={`${actionClass} size-8`} onClick={() => navigate('next')}
        aria-label={t('actions.nextVersion')} data-tooltip={t('actions.nextVersion')}>
        <ChevronRight size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
    {allowDelete && !isViewerMode && <button type="button"
      className="object-action-danger grid size-8 place-items-center rounded-control focus-visible:outline-2 focus-visible:outline-accent" data-icon-only
      onClick={() => useStore.getState().deleteVersion(nodeId, index)}
      aria-label={t('common.deleteVersion')} data-tooltip={t('common.deleteVersion')}>
      <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>}
  </div>;
}
