import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListFilter, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { useStore } from '../store';
import { useUiStore } from '../lib/ui-store';
import { DETAIL_LEVELS, setNodeDetail } from '../lib/node-detail';
import { isFrameNode } from '../lib/frames';
import { getNodeDisplayName } from '../lib/node-display-name';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { useCanvasPanelPosition } from '../lib/use-canvas-panel-position';
import { useCanvasToolCard } from '../lib/use-canvas-tool-card';
import { restoreCanvasToolbarFocus } from '../lib/use-responsive-canvas-header';
import { useT } from '../i18n';
import { isViewerMode } from '../lib/viewer';

const detailLevels = ['auto', ...DETAIL_LEVELS] as const;
type DetailLevel = typeof detailLevels[number];
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

export function CanvasDetailChoices({ title, value, onChange, disabled, followDefault = false }: {
  title: string;
  value?: DetailLevel;
  onChange: (level: DetailLevel) => void;
  disabled?: boolean;
  followDefault?: boolean;
}) {
  const t = useT();
  const group = useId();
  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend id={group} className="text-control font-medium text-ink">{title}</legend>
    <div className="flex flex-wrap gap-0.5 rounded-content border border-line p-0.5" role="radiogroup" aria-labelledby={group}>
      {[detailLevels.slice(0, 2), detailLevels.slice(2)].map(pair =>
        <div key={pair[0]} className="grid min-w-0 flex-[1_1_max-content] grid-cols-2 gap-0.5">
          {pair.map(level => <label key={level} className="relative min-w-0">
            <input type="radio" name={group} value={level} checked={value === level}
              onChange={() => onChange(level)} data-canvas-detail={level}
              className="peer absolute inset-0 z-1 m-0 h-full w-full opacity-0 when-unavailable" />
            <span className="flex h-full min-h-8 items-center justify-center gap-1 rounded-control px-1.5 py-1 text-center text-control text-ink-muted transition-colors peer-hover:bg-wash peer-checked:bg-accent/10 peer-checked:font-medium peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-40">
              <Check size={12} className={`shrink-0 ${value === level ? '' : 'invisible'}`} aria-hidden="true" />
              {t(level === 'auto' && followDefault ? 'settingsCanvas.followDefault' : `detail.${level}`)}
            </span>
          </label>)}
        </div>)}
    </div>
  </fieldset>;
}

export default function CanvasDetailControl({ openPing = 0, selectedEdgeCount }: { openPing?: number; selectedEdgeCount: number }) {
  const t = useT();
  const [requestedOpen, setOpen] = useState(false);
  const [seenPing, setSeenPing] = useState(openPing);
  if (seenPing !== openPing) { setSeenPing(openPing); setOpen(true); }
  const open = useCanvasToolCard('detail', requestedOpen, () => setOpen(false));
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) panel.current?.focus({ preventScroll: true }); }, [open]);
  const globalDetail = useUiStore((state) => state.canvasDetail);
  const setGlobalDetail = useUiStore((state) => state.setCanvasDetail);
  const nodes = useStore(state => state.nodes);
  const selectedIds = useStore(state => state.selectedNodeIds);
  const selection = useMemo(() => {
    if (isViewerMode || selectedIds.length + selectedEdgeCount < 2) return null;
    const ids = new Set(selectedIds);
    const selected = nodes.filter(node => ids.has(node.id) && !node.hidden && node.selectable !== false);
    if (selected.length + selectedEdgeCount < 2) return null;
    return selected.filter(node => !isFrameNode(node));
  }, [nodes, selectedIds, selectedEdgeCount]);
  let detail: typeof globalDetail | undefined = globalDetail;
  if (selection) {
    const firstLock = selection[0]?.data.detailLevel;
    const shared = selection.length > 0 && selection.every(node => node.data.detailLevel === firstLock);
    detail = shared ? firstLock ?? 'auto' : undefined;
  }
  const title = t(selection ? 'settingsCanvas.selectedDetail' : 'detail.global');
  const activeLabel = detail === 'auto' && selection ? t('settingsCanvas.followDefault') : detail && t(`detail.${detail}`);
  const description = activeLabel ? `${title} · ${activeLabel}` : title;
  const setDetail = (level: typeof globalDetail) => {
    if (selection) setNodeDetail(selection.map(node => node.id), level === 'auto' ? undefined : level);
    else setGlobalDetail(level);
  };
  const position = useCanvasPanelPosition(open, 'right');
  useDismissableLayer({ open, refs: [trigger, panel], onDismiss: reason => {
    setOpen(false);
    if (reason === 'escape') restoreCanvasToolbarFocus(trigger.current);
  }, dismissOnFocusOutside: true, restoreFocus: false });
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
      aria-controls="canvas-detail-panel" aria-label={description} data-tooltip={description}
      className="canvas-toolbar-button canvas-toolbar-secondary canvas-toolbar-icon"
      data-setting-active={detail !== undefined && detail !== 'auto' || undefined}
      data-canvas-detail-trigger>
      <ListFilter size={16} strokeWidth={1.75} /><span className="canvas-toolbar-label">{t('detail.toolbarLabel')}</span>
    </button>
    {open && createPortal(<div ref={panel} tabIndex={-1} id="canvas-detail-panel" role="dialog" aria-label={title}
      className="canvas-tool-panel canvas-tool-menu p-3" style={position} data-type-surface="portal" data-canvas-detail-panel data-selection-menu>
      <CanvasDetailChoices title={title} value={detail} onChange={setDetail}
        disabled={selection?.length === 0} followDefault={Boolean(selection)} />
    </div>, document.body)}
  </>;
}
