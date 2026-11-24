import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GitMerge, X } from 'lucide-react';
import { useStore } from '../store';
import { useProjects } from '../store/projects';
import { useContextInspection } from '../lib/context-inspection';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { followAnchoredMenu } from '../lib/anchored-menu';
import { useT, fmt } from '../i18n';
import ContextOrderSection from './focus-panel/ContextOrderSection';
import './NodeContextSources.css';

/** One local entry explains incoming context without changing the canvas selection. */
export default function NodeContextSources({ nodeId, compact = false }: { nodeId: string; compact?: boolean }) {
  const t = useT();
  const count = useStore(state => state.edges.filter(edge => edge.target === nodeId).length);
  const projectId = useProjects(state => state.activeId);
  const open = useContextInspection(state => !state.inline && state.targetId === nodeId);
  const close = useContextInspection(state => state.close);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = `context-sources-${nodeId}`;
  const visible = open && count > 1;

  useDismissableLayer({ open: visible, refs: [trigger, panel], onDismiss: close,
    dismissOnFocusOutside: true, restoreFocusRef: trigger });

  useEffect(() => () => {
    const inspection = useContextInspection.getState();
    if (!inspection.inline && inspection.targetId === nodeId) close();
  }, [nodeId, projectId, close]);
  useEffect(() => {
    if (count < 2 && open) close();
  }, [count, open, close]);

  useLayoutEffect(() => {
    if (!visible || !trigger.current || !panel.current) return;
    const stop = followAnchoredMenu(trigger.current, panel.current, 'start', 8);
    panel.current.focus({ preventScroll: true });
    return stop;
  }, [visible]);

  if (count < 2) return null;
  return <>
    <button ref={trigger} type="button" className="node-context-sources-trigger nodrag nopan"
      aria-label={compact ? t('contextSources.title') : undefined} data-tooltip={compact ? t('contextSources.title') : undefined}
      data-context-sources-trigger={nodeId} aria-expanded={visible} aria-controls={panelId} aria-haspopup="dialog"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (visible) close(); else useContextInspection.getState().open(nodeId); }}>
      <GitMerge size={14} strokeWidth={1.75} aria-hidden="true" />
      {!compact && <span>{fmt(t('contextSources.count'), { n: count })}</span>}
    </button>
    {visible && createPortal(<div ref={panel} id={panelId} tabIndex={-1} role="dialog"
      aria-label={t('contextSources.title')} data-type-surface="portal" data-context-sources-popover={nodeId}
      className="node-context-sources-popover nodrag nopan nowheel"
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
