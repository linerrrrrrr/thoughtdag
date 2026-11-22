import { uiScale } from './ui-scale';

type Alignment = 'start' | 'end' | ((rect: DOMRect, menuWidth: number) => number);

/** Keep a body portal attached through scrolling, wrapping and canvas transforms. */
export function followAnchoredMenu(anchor: HTMLElement, menu: HTMLElement, align: Alignment, gap = 6) {
  let frame = 0;
  const place = () => {
    const scale = uiScale();
    const inset = 8 * scale;
    const rect = anchor.getBoundingClientRect();
    const width = menu.getBoundingClientRect().width;
    const anchorLeft = typeof align === 'function' ? align(rect, width)
      : align === 'end' ? rect.right - width : rect.left;
    const left = Math.max(inset, Math.min(anchorLeft, window.innerWidth - width - inset)) / scale + 'px';

    // Pin the near edge first. Loading or navigating the menu can only grow it away from the anchor.
    const below = window.innerHeight - rect.bottom >= rect.top;
    const edge = below ? rect.bottom : window.innerHeight - rect.top;
    const offset = Math.max(inset, edge + gap * scale);
    const available = Math.max(0, window.innerHeight - offset - inset) / scale + 'px';
    const top = below ? offset / scale + 'px' : '';
    const bottom = below ? '' : offset / scale + 'px';
    if (menu.style.top !== top) menu.style.top = top;
    if (menu.style.bottom !== bottom) menu.style.bottom = bottom;
    if (menu.style.left !== left) menu.style.left = left;
    if (menu.style.getPropertyValue('--menu-available-height') !== available) {
      menu.style.setProperty('--menu-available-height', available);
    }
    frame = requestAnimationFrame(place);
  };
  place();
  return () => cancelAnimationFrame(frame);
}
