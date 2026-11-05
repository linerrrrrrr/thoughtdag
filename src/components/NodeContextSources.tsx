import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GitMerge, X } from 'lucide-react';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { useContextInspection } from '../lib/context-inspection';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useT, fmt } from '../i18n';
import ContextOrderSection from './focus-panel/ContextOrderSection';
import './NodeContextSources.css';

/** One local entry explains incoming context without changing the canvas selection. */
export default function NodeContextSources({ nodeId }: { nodeId: string }) {
  const t = useT();
  const count = useStore(state => state.edges.filter(edge => edge.target === nodeId).length);
  const projectId = useProjects(state => state.activeId);
  const open = useContextInspection(state => state.targetId === nodeId);
  const close = useContextInspection(state => state.close);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = `context-sources-${nodeId}`;
  const visible = open && count > 1;

  useDismissableLayer({ open: visible, refs: [trigger, panel], onDismiss: close,
    dismissOnFocusOutside: true, restoreFocusRef: trigger });

  useEffect(() => () => {
    if (useContextInspection.getState().targetId === nodeId) close();
  }, [nodeId, projectId, close]);
  useEffect(() => {
    if (count < 2 && useContextInspection.getState().targetId === nodeId) close();
  }, [count, nodeId, close]);

  useLayoutEffect(() => {
    if (!visible) return;
    let frame = 0;
    // The portal stays in screen space and follows drag, zoom and natural card resizing.
    const place = () => {
      const anchor = trigger.current, element = panel.current;
      if (!anchor || !element) return;
      const rect = anchor.getBoundingClientRect();
      const width = element.offsetWidth, height = element.offsetHeight;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 8 ? below
        : Math.max(8, Math.min(rect.top - height - 8, window.innerHeight - height - 8));
      const nextLeft = `${left}px`, nextTop = `${top}px`;
      if (element.style.left !== nextLeft) element.style.left = nextLeft;
      if (element.style.top !== nextTop) element.style.top = nextTop;
      if (element.style.visibility !== 'visible') element.style.visibility = 'visible';
      frame = requestAnimationFrame(place);
    };
    place();
    panel.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  if (count < 2) return null;
  return <>
    <button ref={trigger} type="button" className="node-context-sources-trigger nodrag nopan"
      data-context-sources-trigger={nodeId} aria-expanded={visible} aria-controls={panelId} aria-haspopup="dialog"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (visible) close(); else useContextInspection.getState().open(nodeId); }}>
      <GitMerge size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>{fmt(t('contextSources.count'), { n: count })}</span>
    </button>
    {visible && createPortal(<div ref={panel} id={panelId} tabIndex={-1} role="dialog"
      aria-label={t('contextSources.title')} data-context-sources-popover={nodeId}
      className="node-context-sources-popover nodrag nopan nowheel" style={{ visibility: 'hidden' }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
      <div className="node-context-sources-heading">
        <span>{t('contextSources.title')}</span>
        <button type="button" className="context-source-action" aria-label={t('common.close')} onClick={close}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <ContextOrderSection nodeId={nodeId} inspect />
    </div>, document.body)}
  </>;
}
