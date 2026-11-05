import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissableLayer } from '../lib/use-dismissable-layer';
import { create } from 'zustand';
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  Check, ChevronDown, Frame,
} from 'lucide-react';
import { useStore } from '../store';
import { useT, fmt, type MessageKey } from '../i18n';
import type { ArrangeAction, ArrangeReference, ArrangeRect } from '../lib/arrange-selection';
import { arrangementUnitCount } from '../lib/arrange-selection';
import { navigateActionMenu } from '../lib/menu-keyboard';

export type ViewportRectGetter = () => ArrangeRect | undefined;
const useArrangeReference = create<{ reference: ArrangeReference; setReference: (reference: ArrangeReference) => void }>((set) => ({
  reference: 'selection', setReference: (reference) => set({ reference }),
}));
const itemClass = 'w-full flex items-center gap-2.5 rounded-control px-3 py-2 text-left text-control text-ink hover:bg-wash focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
const actions: { action: ArrangeAction; label: MessageKey; icon: typeof Check }[] = [
  { action: 'left', label: 'arrange.left', icon: AlignHorizontalJustifyStart },
  { action: 'center', label: 'arrange.center', icon: AlignHorizontalJustifyCenter },
  { action: 'right', label: 'arrange.right', icon: AlignHorizontalJustifyEnd },
  { action: 'top', label: 'arrange.top', icon: AlignVerticalJustifyStart },
  { action: 'middle', label: 'arrange.middle', icon: AlignVerticalJustifyCenter },
  { action: 'bottom', label: 'arrange.bottom', icon: AlignVerticalJustifyEnd },
  { action: 'distribute-horizontal', label: 'arrange.distributeHorizontal', icon: AlignHorizontalDistributeCenter },
  { action: 'distribute-vertical', label: 'arrange.distributeVertical', icon: AlignVerticalDistributeCenter },
];

/** Spatial commands use the selection without creating context relationships. */
export function ArrangeItems({ ids, getViewportRect, onClose }: { ids: string[]; getViewportRect: ViewportRectGetter; onClose: () => void }) {
  const t = useT();
  const nodes = useStore((s) => s.nodes);
  const { reference, setReference } = useArrangeReference();
  const selectedIds = new Set(ids);
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  const unitCount = arrangementUnitCount(nodes, ids);
  const run = (action: ArrangeAction) => {
    const viewport = getViewportRect();
    onClose();
    useStore.getState().arrangeSelection(selected.map(node => node.id), action, reference, viewport);
  };
  return <>
    {actions.map(({ action, label, icon: Icon }, index) => {
      const minimum = action.startsWith('distribute') ? (reference === 'selection' ? 3 : 2) : (reference === 'selection' ? 2 : 1);
      const disabled = unitCount < minimum;
      return <div key={action}>
        {(index === 3 || index === 6) && <div className="my-1 border-t border-line" role="separator" />}
        <button type="button" role="menuitem" className={itemClass} disabled={disabled}
          title={disabled ? fmt(t('arrange.minimum'), { n: minimum }) : undefined}
          onClick={() => run(action)} data-arrange-action={action}>
          <Icon size={15} strokeWidth={1.75} className="text-ink-muted shrink-0" aria-hidden="true" />{t(label)}
        </button>
      </div>;
    })}
    <div className="my-1 border-t border-line" role="separator" />
    {(['viewport', 'selection'] as const).map((value) => <button type="button" key={value} role="menuitemradio"
      aria-checked={reference === value} className={itemClass} onClick={() => setReference(value)} data-arrange-reference={value}>
      <Check size={15} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 ${reference === value ? 'text-accent' : 'invisible'}`} />
      {t(value === 'selection' ? 'arrange.relativeSelection' : 'arrange.relativeViewport')}
    </button>)}
  </>;
}

function AlignPopover({ ids, getViewportRect, open, onOpenChange }: {
  ids: string[];
  getViewportRect: ViewportRectGetter; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const label = t('arrange.alignLabel');
  const menuId = useId();
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { onOpenChange(false); button.current?.focus(); };
  useDismissableLayer({ dismissOnFocusOutside: true, open, refs: [menu, button], onDismiss: () => onOpenChange(false) });
  useEffect(() => {
    if (!open || !position) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const resize = () => onOpenChange(false);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); };
  }, [open, position, onOpenChange]);
  return <>
    <button type="button" ref={button} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={label}
      data-selection-align
      className={`h-8 px-2.5 rounded-control transition-colors flex items-center gap-1.5 text-control whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-accent ${open ? 'bg-accent/10 text-accent' : 'bg-wash hover:bg-line text-ink-muted'}`}
      onClick={() => {
        if (open) { close(); return; }
        const rect = button.current!.getBoundingClientRect();
        const below = Math.max(0, window.innerHeight - rect.bottom - 14);
        const above = Math.max(0, rect.top - 14);
        const upward = below < Math.min(360, above);
        setPosition({
          left: Math.max(8, Math.min(rect.right - 280, window.innerWidth - 288)),
          ...(upward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          maxHeight: upward ? above : below,
        });
        onOpenChange(true);
      }}>
      <AlignHorizontalJustifyStart size={14} strokeWidth={1.75} aria-hidden="true" />{label}<ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && position && createPortal(<div ref={menu} id={menuId} role="menu" data-selection-menu aria-label={label} onKeyDown={(event) => navigateActionMenu(event, close)}
      className="fixed z-[70] w-[280px] max-w-[calc(100vw-16px)] rounded-overlay border border-line bg-card shadow-lg p-1 overflow-y-auto"
      style={position}>
      <ArrangeItems ids={ids} getViewportRect={getViewportRect} onClose={close} />
    </div>, document.body)}
  </>;
}

export default function SelectionArrangeMenu({ ids, getViewportRect }: { ids: string[]; getViewportRect: ViewportRectGetter }) {
  const t = useT();
  const nodes = useStore(state => state.nodes);
  const [open, setOpen] = useState(false);
  const selected = new Set(ids);
  const selectedNodes = nodes.filter(node => selected.has(node.id));
  const hasFrame = selectedNodes.some(node => node.data.stepKind === 'frame');
  return <div className="flex items-center gap-1.5 shrink-0 ml-auto" role="group" aria-label={t('arrange.spatialTools')}>
    <AlignPopover ids={ids} getViewportRect={getViewportRect} open={open} onOpenChange={setOpen} />
    <button type="button" data-create-selection-frame disabled={!selectedNodes.length || hasFrame}
      aria-label={t('frame.createFromSelection')} title={t(hasFrame ? 'frame.selectionContainsFrame' : 'frame.createFromSelectionHint')}
      className="h-8 px-2.5 rounded-control transition-colors flex items-center gap-1.5 text-control whitespace-nowrap shrink-0 bg-wash hover:bg-line text-ink-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed"
      onClick={() => { setOpen(false); useStore.getState().createFrameFromSelection(ids); }}>
      <Frame size={14} strokeWidth={1.75} aria-hidden="true" />{t('frame.create')}
    </button>
  </div>;
}
