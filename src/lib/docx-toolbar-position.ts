import { uiRect, uiViewport } from './ui-scale';

/** Follow the editing node in screen space without moving the paper under the pointer. */
export function anchorDocxToolbar(host: HTMLElement, toolbar: HTMLElement) {
  const node = host.closest('.react-flow__node');
  const viewport = node?.closest('.react-flow__viewport');
  const canvas = viewport?.closest('.react-flow');
  if (!node || !viewport || !canvas) return;
  const header = document.querySelector('[data-canvas-header]');
  const tokens = getComputedStyle(document.documentElement);
  const inset = parseFloat(tokens.getPropertyValue('--spacing-canvas-inset'));
  const gap = parseFloat(tokens.getPropertyValue('--spacing-related'));
  let frame = 0;
  let remainingFrames = 0;

  const place = () => {
    const anchor = uiRect(node);
    const bounds = uiRect(canvas);
    const chrome = header && uiRect(header);
    const screen = uiViewport();
    const left = Math.max(0, bounds.left) + inset;
    const right = Math.min(screen.width - inset, bounds.right - inset, chrome?.right ?? Infinity);
    const top = Math.max(bounds.top + inset, (chrome?.bottom ?? 0) + gap);
    const bottom = Math.min(screen.height, bounds.bottom) - inset;
    if (right <= left || bottom <= top || anchor.right <= left || anchor.left >= right
      || anchor.bottom <= top || anchor.top >= bottom) {
      toolbar.style.visibility = 'hidden';
      return;
    }

    toolbar.style.setProperty('--docx-node-width', `${anchor.width}px`);
    toolbar.style.maxWidth = `${right - left}px`;
    toolbar.style.maxHeight = `${Math.min(bottom - top, screen.height / 2)}px`;
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const above = anchor.top - gap - height;
    const below = anchor.bottom + gap;
    let x = anchor.left;
    let y = above;
    if (above < top) {
      if (below + height <= bottom) y = below;
      else if (anchor.right + gap + width <= right) { x = anchor.right + gap; y = anchor.top; }
      else if (anchor.left - gap - width >= left) { x = anchor.left - gap - width; y = anchor.top; }
      // An oversized node can fill the screen. Use the edge covering the least of it.
      else y = anchor.top - top >= bottom - anchor.bottom ? top : bottom - height;
    }
    toolbar.style.left = `${Math.max(left, Math.min(x, right - width))}px`;
    toolbar.style.top = `${Math.max(top, Math.min(y, bottom - height))}px`;
    toolbar.style.visibility = 'visible';
  };
  const sample = () => {
    place();
    frame = --remainingFrames > 0 ? requestAnimationFrame(sample) : 0;
  };
  const schedule = () => {
    // The viewport's transform mutation can precede its painted bounds by several frames.
    remainingFrames = 4;
    if (!frame) frame = requestAnimationFrame(sample);
  };
  const resize = new ResizeObserver(schedule);
  for (const element of [node, canvas, header, toolbar]) if (element) resize.observe(element);
  // React Flow pans, zooms and drags nodes with transforms, without resizing their layout boxes.
  const transforms = new MutationObserver(schedule);
  for (const element of [node, viewport]) transforms.observe(element, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', schedule);
  place();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    transforms.disconnect();
    window.removeEventListener('resize', schedule);
  };
}
