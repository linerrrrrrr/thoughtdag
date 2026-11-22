import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Highlighter, Pipette } from 'lucide-react';
import { useT, type MessageKey } from '../i18n';
import { followAnchoredMenu } from '../lib/anchored-menu';
import { useDismissableLayer } from '../lib/use-dismissable-layer';

const swatches: ReadonlyArray<readonly [string, MessageKey]> = [
  ['#ffff00', 'nativeDocument.yellow'], ['#00ff00', 'nativeDocument.green'],
  ['#00ffff', 'nativeDocument.cyan'], ['#ff00ff', 'nativeDocument.magenta'],
  ['#0000ff', 'nativeDocument.blue'], ['#ff0000', 'nativeDocument.red'],
  ['#c0c0c0', 'nativeDocument.silver'], ['#808080', 'nativeDocument.gray'],
];

function inkThickness(color: string) {
  const linear = (offset: number) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  return 1.6 - 0.8 * luminance;
}

export default function DocxHighlighterButton({ active, disabled, color, onToggle, onColorChange }: {
  active: boolean; disabled: boolean; color: string; onToggle: () => void; onColorChange: (color: string) => void;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const palette = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const focusOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  if (open && disabled) setOpen(false);

  const cancelLeave = () => window.clearTimeout(leaveTimer.current);
  const leave = () => {
    cancelLeave();
    // Allow the pointer to cross the gap to the floating palette.
    leaveTimer.current = window.setTimeout(() => {
      if (!palette.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  const focusColor = () => {
    const selected = palette.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    (selected ?? palette.current?.querySelector('input'))?.focus({ preventScroll: true });
  };
  const close = () => {
    if (palette.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    cancelLeave();
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !palette.current) return;
    const stop = followAnchoredMenu(trigger.current, palette.current, 'end', 4);
    if (focusOnOpen.current) {
      focusColor();
      focusOnOpen.current = false;
    }
    return stop;
  }, [open]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  useDismissableLayer({
    open, refs: [trigger, palette], dismissOnFocusOutside: true, restoreFocus: false,
    onDismiss: reason => { if (reason === 'escape') close(); else setOpen(false); },
  });

  return <>
    <button ref={trigger} type="button" className="native-document-tool native-document-pen"
      style={{ '--docx-pen-color': color } as CSSProperties} data-docx-highlighter data-highlighter-toggle
      aria-label={t('highlight.pen')} aria-pressed={active} aria-expanded={open} aria-haspopup="dialog"
      aria-controls={open ? id : undefined} aria-keyshortcuts="ArrowDown" disabled={disabled}
      onPointerEnter={event => {
        if (event.pointerType !== 'touch' && event.buttons === 0 && !disabled) { cancelLeave(); setOpen(true); }
      }}
      onPointerLeave={event => { if (event.pointerType !== 'touch') leave(); }} onPointerDown={event => {
        event.preventDefault();
        if (event.pointerType === 'touch') setOpen(true);
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (open) focusColor();
        else { focusOnOpen.current = true; setOpen(true); }
      }}
      onClick={onToggle}>
      <Highlighter size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="native-document-ink-line" style={{ backgroundColor: color, height: inkThickness(color) }} />
    </button>
    {open && createPortal(<div ref={palette} id={id} role="dialog" aria-label={t('richDocument.highlightColor')}
      data-docx-pen-palette data-export-omit="files" data-type-surface="portal" className="native-document-pen-palette nodrag nopan nowheel"
      onPointerEnter={cancelLeave} onPointerLeave={event => { if (event.pointerType !== 'touch') leave(); }}>
      <div className="native-document-swatches">
        {swatches.map(([ink, label]) => <button key={ink} type="button" data-docx-ink={ink}
          aria-label={t(label)} aria-pressed={color === ink} data-tooltip={t(label)}
          onPointerDown={event => event.preventDefault()} onClick={() => { onColorChange(ink); close(); }}>
          <span style={{ backgroundColor: ink }} />
        </button>)}
      </div>
      <label className="native-document-custom-ink">
        <Pipette size={14} aria-hidden="true" />{t('nativeDocument.customColor')}
        <input type="color" data-cursor="action" data-docx-highlighter-color aria-label={t('nativeDocument.customColor')}
          value={color} onChange={event => onColorChange(event.target.value)} />
      </label>
    </div>, document.body)}
  </>;
}
