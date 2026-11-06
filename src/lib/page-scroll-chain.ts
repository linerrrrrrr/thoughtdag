const scrollable = (overflow: string) => /^(auto|scroll|overlay)$/.test(overflow);

/** Route one vertical wheel through visible scrollports without losing the
 * last part of a step at a nested boundary. Touch scrolling stays native. */
export function attachPageScrollChain(page: HTMLElement): () => void {
  const fractions = new WeakMap<HTMLElement, number>();
  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey
      || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const target = event.target instanceof Element ? event.target
      : event.target instanceof Node ? event.target.parentElement : null;
    const pane = target?.closest<HTMLElement>('[data-conversation-split-question], [data-conversation-split-answer]');
    if (!target || !pane || !page.contains(pane)) return;

    const ports: HTMLElement[] = [];
    for (let element: Element | null = target; element; element = element.parentElement) {
      if (element instanceof HTMLElement) {
        const style = getComputedStyle(element);
        // Diagonal movement over horizontally scrollable code keeps native
        // handling, as a wheel event cannot cancel only one of its axes.
        if (event.deltaX && scrollable(style.overflowX) && element.scrollWidth > element.clientWidth) return;
        if (element === page || scrollable(style.overflowY) && element.scrollHeight > element.clientHeight) ports.push(element);
      }
      if (element === page) break;
    }
    const targetStyle = getComputedStyle(target);
    const line = parseFloat(targetStyle.lineHeight) || (parseFloat(targetStyle.fontSize) || 16) * 1.2;
    let remaining = event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? pane.clientHeight : 1);
    if (!Number.isFinite(remaining)) return;
    event.preventDefault();

    for (const port of ports) {
      remaining += fractions.get(port) ?? 0;
      fractions.delete(port);
      if (!remaining) break;
      const direction = Math.sign(remaining);
      const before = port.scrollTop;
      const max = Math.max(0, port.scrollHeight - port.clientHeight);
      const next = Math.min(max, Math.max(0, before + remaining));
      port.scrollTo({ top: next, behavior: 'instant' });
      remaining -= port.scrollTop - before;
      const hasRoom = direction > 0 ? port.scrollTop < max : port.scrollTop > 0;
      if (Math.sign(remaining) !== direction || hasRoom) {
        // Some device scales round scrollTop to whole pixels. Carry that
        // fraction into the next wheel instead of moving a parent too soon.
        if (remaining) fractions.set(port, remaining);
        break;
      }
      // At an edge, consume the rest in the next real scrollport. Hidden
      // flex wrappers are deliberately absent from this path.
    }
  };
  page.addEventListener('wheel', onWheel, { passive: false });
  return () => page.removeEventListener('wheel', onWheel);
}
