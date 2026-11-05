import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListFilter, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { useStore } from '../store';
import { useUiStore } from '../lib/ui-store';
import { DETAIL_LEVELS, setNodeDetail } from '../lib/node-detail';
import { getNodeDisplayName } from '../lib/node-display-name';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../lib/use-canvas-tool-card';
import { restoreCanvasToolbarFocus } from '../lib/use-responsive-canvas-header';
import { useT } from '../i18n';
import { isViewerMode } from '../lib/viewer';

const optionClass = 'flex min-h-8 items-center justify-center gap-1 rounded-control border px-2 py-1 text-xs transition-colors';
const optionState = (active: boolean) => active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink-muted hover:bg-wash';

export function NodeDetailControls({ nodeId }: { nodeId: string }) {
  const t = useT();
  const node = useStore((state) => state.nodes.find((item) => item.id === nodeId));
  if (!node || node.data.stepKind === 'frame') return null;
  const locked = node.data.detailLevel;
  return <fieldset className="min-w-0 space-y-2" data-node-detail-controls={nodeId}>
    <legend className="text-xs font-medium text-ink">{t('detail.node')}</legend>
    <p className="truncate text-xs text-ink-muted" title={getNodeDisplayName(node.data, t('ctx.unnamedNode'))}>{getNodeDisplayName(node.data, t('ctx.unnamedNode'))}</p>
    <button type="button" className={`${optionClass} w-full ${optionState(!locked)}`} aria-pressed={!locked}
      onClick={() => setNodeDetail(nodeId)} data-node-detail="auto">
      <LockKeyholeOpen size={13} />{t('detail.follow')}
    </button>
    <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('detail.node')}>
      {DETAIL_LEVELS.map((level) => <button key={level} type="button" className={`${optionClass} ${optionState(locked === level)}`}
        aria-pressed={locked === level} onClick={() => setNodeDetail(nodeId, level)} data-node-detail={level}
        title={t('detail.lockHint')}>
        {locked === level && <LockKeyhole size={12} />}{t(`detail.${level}`)}
      </button>)}
    </div>
    <p className="text-xs leading-relaxed text-ink-muted">{t('detail.lockHint')}</p>
  </fieldset>;
}

export default function CanvasDetailControl({ openPing = 0 }: { openPing?: number }) {
  const t = useT();
  const [requestedOpen, setOpen] = useState(false);
  const [seenPing, setSeenPing] = useState(openPing);
  if (seenPing !== openPing) { setSeenPing(openPing); setOpen(true); }
  const open = useCanvasToolCard('detail', requestedOpen, () => setOpen(false));
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);
  const detail = useUiStore((state) => state.canvasDetail);
  const setDetail = useUiStore((state) => state.setCanvasDetail);
  const selectedId = useStore((state) => state.selectedNodeId);
  const position = useCanvasPanelPosition(open);
  useDismissableLayer({ open, refs: [trigger, panel], onDismiss: reason => {
    setOpen(false);
    if (reason === 'escape') restoreCanvasToolbarFocus(trigger.current);
  }, dismissOnFocusOutside: true, restoreFocus: false });
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      aria-controls="canvas-detail-panel" aria-label={t('detail.title')} title={`${t('detail.global')} · ${t(`detail.${detail}`)}`}
      className="canvas-toolbar-button canvas-toolbar-secondary canvas-toolbar-icon"
      data-canvas-detail-trigger>
      <ListFilter size={16} strokeWidth={1.75} className={detail !== 'auto' ? 'text-accent' : undefined} /><span className="canvas-toolbar-label">{t('detail.title')}</span>
    </button>
    {open && createPortal(<div ref={panel} tabIndex={-1} id="canvas-detail-panel" role="dialog" aria-label={t('detail.title')}
      className="canvas-tool-panel canvas-tool-menu p-3 space-y-3" style={position} data-canvas-detail-panel>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink">{t('detail.global')}</legend>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label={t('detail.global')}>
          {(['auto', ...DETAIL_LEVELS] as const).map((level) => <button key={level} type="button"
            className={`${optionClass} ${optionState(detail === level)}`} aria-pressed={detail === level}
            onClick={() => setDetail(level)} data-canvas-detail={level}>
            {detail === level && <Check size={12} />}{t(`detail.${level}`)}
          </button>)}
        </div>
      </fieldset>
      {selectedId && !isViewerMode && <div className="border-t border-line pt-3"><NodeDetailControls nodeId={selectedId} /></div>}
    </div>, document.body)}
  </>;
}
