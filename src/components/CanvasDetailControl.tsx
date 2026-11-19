import { useEffect, useId, useRef, useState } from 'react';
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

const globalDetailLevels = ['auto', ...DETAIL_LEVELS] as const;
const optionClass = 'flex min-h-8 items-center justify-center gap-1 rounded-control border px-2 py-1 text-control transition-colors';
const optionState = (active: boolean) => active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink-muted hover:bg-wash';

export function NodeDetailControls({ nodeId }: { nodeId: string }) {
  const t = useT();
  const node = useStore((state) => state.nodes.find((item) => item.id === nodeId));
  if (!node || node.data.stepKind === 'frame') return null;
  const locked = node.data.detailLevel;
  return <fieldset className="min-w-0 space-y-2" data-node-detail-controls={nodeId}>
    <legend className="text-control font-medium text-ink">{t('detail.node')}</legend>
    <p className="truncate text-control text-ink-muted" data-tooltip={getNodeDisplayName(node.data, t('ctx.unnamedNode'))} data-tooltip-overflow>{getNodeDisplayName(node.data, t('ctx.unnamedNode'))}</p>
    <button type="button" className={`${optionClass} w-full ${optionState(!locked)}`} aria-pressed={!locked}
      onClick={() => setNodeDetail(nodeId)} data-node-detail="auto">
      <LockKeyholeOpen size={13} />{t('detail.follow')}
    </button>
    <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('detail.node')}>
      {DETAIL_LEVELS.map((level) => <button key={level} type="button" className={`${optionClass} ${optionState(locked === level)}`}
        aria-pressed={locked === level} onClick={() => setNodeDetail(nodeId, level)} data-node-detail={level}>
        {locked === level && <LockKeyhole size={12} />}{t(`detail.${level}`)}
      </button>)}
    </div>
    <p className="text-control text-ink-muted">{t('detail.lockHint')}</p>
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
  const detailGroup = useId();
  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);
  const detail = useUiStore((state) => state.canvasDetail);
  const setDetail = useUiStore((state) => state.setCanvasDetail);
  const selectedId = useStore((state) => state.selectedNodeId);
  const position = useCanvasPanelPosition(open, 'right');
  useDismissableLayer({ open, refs: [trigger, panel], onDismiss: reason => {
    setOpen(false);
    if (reason === 'escape') restoreCanvasToolbarFocus(trigger.current);
  }, dismissOnFocusOutside: true, restoreFocus: false });
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      aria-controls="canvas-detail-panel" aria-label={`${t('detail.title')} · ${t(`detail.${detail}`)}`} data-tooltip={`${t('detail.global')} · ${t(`detail.${detail}`)}`}
      className="canvas-toolbar-button canvas-toolbar-secondary canvas-toolbar-icon"
      data-setting-active={detail !== 'auto' || undefined}
      data-canvas-detail-trigger>
      <ListFilter size={16} strokeWidth={1.75} /><span className="canvas-toolbar-label">{t('detail.toolbarLabel')}</span>
    </button>
    {open && createPortal(<div ref={panel} tabIndex={-1} id="canvas-detail-panel" role="dialog" aria-label={t('detail.title')}
      className="canvas-tool-panel canvas-tool-menu p-3 space-y-3" style={position} data-canvas-detail-panel>
      <fieldset className="min-w-0 space-y-2">
        <legend id={detailGroup} className="text-control font-medium text-ink">{t('detail.global')}</legend>
        <div className="flex flex-wrap gap-0.5 rounded-content border border-line p-0.5" role="radiogroup" aria-labelledby={detailGroup}>
          {[globalDetailLevels.slice(0, 2), globalDetailLevels.slice(2)].map(pair =>
            <div key={pair[0]} className="grid min-w-0 flex-[1_1_max-content] grid-cols-2 gap-0.5">
              {pair.map(level => <label key={level} className="relative min-w-0">
                <input type="radio" name={detailGroup} value={level} checked={detail === level}
                  onChange={() => setDetail(level)} data-canvas-detail={level}
                  className="peer absolute inset-0 z-1 m-0 h-full w-full cursor-pointer opacity-0" />
                <span className="flex h-full min-h-8 items-center justify-center gap-1 rounded-control px-1.5 py-1 text-center text-control text-ink-muted transition-colors peer-hover:bg-wash peer-checked:bg-accent/10 peer-checked:font-medium peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-accent">
                  <Check size={12} className={`shrink-0 ${detail === level ? '' : 'invisible'}`} aria-hidden="true" />
                  {t(`detail.${level}`)}
                </span>
              </label>)}
            </div>)}
        </div>
      </fieldset>
      {selectedId && !isViewerMode && <div className="border-t border-line pt-3"><NodeDetailControls nodeId={selectedId} /></div>}
    </div>, document.body)}
  </>;
}
