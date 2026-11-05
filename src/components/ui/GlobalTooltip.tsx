import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './GlobalTooltip.css';

// Only supplement what the surface already communicates. Conditional titles
// are suppressed natively too; hiding our own popup alone would still leave
// a delayed browser tooltip. Restore titles when the interaction ends.

const SHOW_DELAY_MS = 350;

function hasClippedContent(element: HTMLElement): boolean {
  return [element, ...element.querySelectorAll<HTMLElement>('*')].some(candidate => {
    if (!candidate.getClientRects().length) return false;
    const style = getComputedStyle(candidate);
    const clipsX = /hidden|clip/.test(style.overflowX);
    const clipsY = /hidden|clip/.test(style.overflowY);
    return (clipsX && candidate.scrollWidth > candidate.clientWidth + 1)
      || (clipsY && candidate.scrollHeight > candidate.clientHeight + 1);
  });
}

function shouldShow(element: HTMLElement): boolean {
  // The library owns these controls and their accessible names. Keep its
  // zoom behavior intact while avoiding explanations of a familiar + / −.
  if (element.matches('.react-flow__controls-zoomin, .react-flow__controls-zoomout')) return false;
  const overflowOnly = element.hasAttribute('data-tooltip-overflow');
  const iconOnly = element.hasAttribute('data-tooltip-icon-only');
  if (!overflowOnly && !iconOnly) return true;
  return (overflowOnly && hasClippedContent(element))
    || (iconOnly && !element.innerText?.trim());
}

export interface TooltipDetails {
  title: string;
  total: string;
  rows: { label: string; value: string; share: string; color: string }[];
  note: string;
}

function readDetails(value: string | undefined): TooltipDetails | undefined {
  if (!value) return;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return;
    const details = parsed as Partial<TooltipDetails>;
    if (typeof details.title !== 'string' || typeof details.total !== 'string' || typeof details.note !== 'string' || !Array.isArray(details.rows)) return;
    if (!details.rows.every((row) => row && typeof row.label === 'string' && typeof row.value === 'string' && typeof row.share === 'string' && typeof row.color === 'string')) return;
    return details as TooltipDetails;
  } catch { return; }
}

interface Tip {
  text: string;
  details?: TooltipDetails;
  x: number;
  top: number;
  bottom: number;
  above: boolean;
}

export default function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipId = useId();

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let pointerFocus = false;
    let addedLabel: { element: HTMLElement; value: string } | null = null;

    const restore = () => {
      if (current?.dataset.tipStash !== undefined) {
        if (!current.hasAttribute('title')) current.setAttribute('title', current.dataset.tipStash);
        delete current.dataset.tipStash;
      }
      if (addedLabel && addedLabel.element.getAttribute('aria-label') === addedLabel.value) addedLabel.element.removeAttribute('aria-label');
      addedLabel = null;
      if (current) {
        const descriptions = (current.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== tipId);
        if (descriptions.length) current.setAttribute('aria-describedby', descriptions.join(' '));
        else current.removeAttribute('aria-describedby');
      }
    };
    const clear = () => {
      window.clearTimeout(timer);
      restore();
      current = null;
      setTip(null);
    };

    const show = (target: EventTarget | null, keyboard = false) => {
      const el = (target as Element | null)?.closest?.('[title], [data-tip-stash]') as HTMLElement | null;
      if (!el || el === current) return;
      clear();
      const text = el.getAttribute('title') ?? el.dataset.tipStash ?? '';
      if (!text.trim()) return;
      current = el;
      // Legacy icon controls may still rely on title for their name. Preserve
      // that fallback for both keyboard and pointer interactions.
      if (el.matches('button, a[href], [role="button"], [role="menuitem"]')
          && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')
          && !el.innerText?.trim() && !el.querySelector('img[alt]:not([alt=""]), svg title')) {
        el.setAttribute('aria-label', text);
        addedLabel = { element: el, value: text };
      }
      el.dataset.tipStash = text;
      el.removeAttribute('title');
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        el.removeAttribute('title'); // a React re-render may have put it back
        if (!shouldShow(el)) return;
        const descriptions = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
        el.setAttribute('aria-describedby', [...new Set([...descriptions, tipId])].join(' '));
        const rect = el.getBoundingClientRect();
        const above = rect.bottom > window.innerHeight - 96;
        setTip({
          text,
          details: readDetails(el.dataset.tooltipDetails),
          x: Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 12)),
          top: rect.top,
          bottom: rect.bottom,
          above,
        });
      }, keyboard ? 0 : SHOW_DELAY_MS);
    };
    // A focusable status label can also be a canvas drag handle. Pointer
    // focus must not reopen the tooltip that mousedown just dismissed.
    const over = (e: MouseEvent) => { if (e.buttons === 0) show(e.target); };
    const focus = (e: FocusEvent) => {
      if (pointerFocus) { pointerFocus = false; return; }
      show(e.target, true);
    };

    const out = (e: MouseEvent) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      if (document.activeElement && current.contains(document.activeElement)) return;
      if (e.target instanceof Node && (current === e.target || current.contains(e.target))) clear();
    };
    const blur = (e: FocusEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) clear();
    };
    // The tooltip never consumes Escape; the active editor/layer still owns it.
    const key = (e: KeyboardEvent) => {
      pointerFocus = false;
      if (e.key === 'Escape') clear();
    };

    // capture phase: the title is back BEFORE any click handler or
    // re-render runs, so post-click attribute queries never miss
    const down = (event: Event) => {
      pointerFocus = event.type === 'mousedown';
      clear();
    };

    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key, true);
    document.addEventListener('mousedown', down, true);
    document.addEventListener('scroll', down, true);
    window.addEventListener('blur', down);
    return () => {
      clear();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('scroll', down, true);
      window.removeEventListener('blur', down);
    };
  }, [tipId]);

  if (!tip) return null;
  return <TipBox tip={tip} id={tipId} />;
}

// Measured clamping: centering on the anchor alone lets long tips bleed
// off-screen for edge buttons (left palette, right rail). Render, measure,
// shove the box fully back inside — before paint, so nothing flashes.
function TipBox({ tip, id }: { tip: Tip; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // measure, then write the clamped position straight onto the element:
  // still before paint, and without a second render
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.max(12 + half, Math.min(tip.x, window.innerWidth - 12 - half))}px`;
    const height = el.offsetHeight;
    const fitsBelow = tip.bottom + 8 + height <= window.innerHeight - 12;
    const top = fitsBelow ? tip.bottom + 8 : tip.top - height - 8;
    el.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
    el.style.transform = 'translateX(-50%)';
  }, [tip]);
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`tdag-tooltip${tip.details ? ' tdag-tooltip-details' : ''}`}
      style={{
        left: tip.x,
        top: tip.above ? tip.top - 8 : tip.bottom + 8,
        transform: `translate(-50%, ${tip.above ? '-100%' : '0'})`,
      }}
    >
      {tip.details ? <>
        <div className="tooltip-details-heading"><strong>{tip.details.title}</strong><span>{tip.details.total}</span></div>
        <div className="tooltip-details-rows">
          {tip.details.rows.map((row, index) => <div className="tooltip-details-row" key={`${row.label}-${index}`}>
            <span className="tooltip-details-dot" style={{ backgroundColor: row.color }} aria-hidden="true" />
            <span>{row.label}</span>
            <span className="tooltip-details-value">{row.value}</span>
            <span className="tooltip-details-share">{row.share}</span>
          </div>)}
        </div>
        <p className="tooltip-details-note">{tip.details.note}</p>
      </> : tip.text}
    </div>,
    document.body,
  );
}
