import type { SuperDoc } from 'superdoc';

export interface DocxZoomSnapshot {
  mode: 'fit-width' | 'manual';
  value: number;
}

export interface DocxViewport {
  attach(host: HTMLElement | null): void;
  refresh(): void;
  engineReady(): void;
  engineZoomChanged(change: { zoom: number; mode: 'manual' | 'fit-width' }): void;
  getSnapshot(): DocxZoomSnapshot;
  subscribe(listener: () => void): () => void;
  setZoom(value: number | 'fit-width'): void;
  dispose(): void;
}

interface ScrollBookmark {
  top: number;
  left: number;
  zoom: number;
}

const MIN_FIT_ZOOM = 15;
const MAX_FIT_ZOOM = 100;
const FIT_PADDING = 16;
const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.001;

/** Keep native hit testing in screen pixels; the document's own zoom supplies
 * the visual scaling previously inherited from the canvas or reader shell. */
export function createDocxViewport(element: HTMLElement, getInstance: () => SuperDoc | null): DocxViewport {
  let host: HTMLElement | null = null;
  let readyInstance: SuperDoc | null = null;
  let disposed = false;
  let frame = 0;
  let remainingSamples = 0;
  let restoreFrame = 0;
  let stopGeometry: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let mutationObserver: MutationObserver | undefined;
  let snapshot: DocxZoomSnapshot = { mode: 'fit-width', value: 100 };
  let outerScale = 1;
  let width = 0;
  let height = 0;
  let applyingZoom = false;
  let expectedZoom: number | null = null;
  let bookmark: ScrollBookmark | null = null;
  let restoreDeadline = 0;
  const listeners = new Set<() => void>();

  const publish = (next: DocxZoomSnapshot) => {
    if (snapshot.mode === next.mode && nearlyEqual(snapshot.value, next.value)) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  // The native contained editor owns its scrollport below the application host.
  // Discover the scrolling element by browser layout, without private APIs.
  const scrollport = (): HTMLElement | null => {
    const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')];
    return candidates.find(candidate => {
      const style = getComputedStyle(candidate);
      return (/auto|scroll/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 1)
        || (/auto|scroll/.test(style.overflowX) && candidate.scrollWidth > candidate.clientWidth + 1);
    }) ?? null;
  };

  const currentZoom = () => {
    const value = getInstance()?.getZoomState().value;
    return value && value > 0 ? value : snapshot.value * outerScale;
  };

  const rememberScroll = () => {
    if (bookmark && restoreDeadline > 0 && performance.now() > restoreDeadline) stopPendingRestore();
    if (bookmark) return;
    const scroller = scrollport();
    if (scroller) bookmark = { top: scroller.scrollTop, left: scroller.scrollLeft, zoom: currentZoom() };
  };

  const restoreScroll = () => {
    if (!bookmark || !host || !readyInstance || getInstance() !== readyInstance) return;
    const scroller = scrollport();
    if (!scroller) return;
    const factor = currentZoom() / bookmark.zoom;
    scroller.scrollTop = bookmark.top * factor;
    scroller.scrollLeft = bookmark.left * factor;
  };

  const scheduleRestore = () => {
    if (!bookmark || restoreFrame || !host) return;
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = 0;
      if (disposed) return;
      restoreScroll();
      // One additional frame accommodates the public zoom propagation. Later
      // native repaints also invoke the geometry observer below.
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = 0;
        if (!disposed) restoreScroll();
      });
    });
  };

  const stopPendingRestore = () => {
    bookmark = null;
    restoreDeadline = 0;
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  };

  const measureViewport = () => {
    if (disposed || !host?.isConnected) return;
    if (bookmark && restoreDeadline && performance.now() > restoreDeadline) stopPendingRestore();
    const rect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const layoutWidth = parseFloat(style.width);
    if (!(rect.width > 0 && rect.height > 0 && layoutWidth > 0)) return;
    const scale = rect.width / layoutWidth;
    const geometryChanged = !nearlyEqual(outerScale, scale) || !nearlyEqual(width, rect.width) || !nearlyEqual(height, rect.height);
    if (geometryChanged) {
      // Confirm two stable frames after a change, including animated zoom.
      remainingSamples = Math.max(remainingSamples, 2);
      rememberScroll();
      outerScale = scale;
      width = rect.width;
      height = rect.height;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
      element.style.transformOrigin = '0 0';
      element.style.transform = `scale(${1 / outerScale})`;
    }
    const instance = getInstance();
    if (!instance || instance !== readyInstance) return;
    let logicalZoom = snapshot.value;
    const documentWidth = instance.getViewportMetrics()?.documentWidth;
    if (snapshot.mode === 'fit-width' && documentWidth && documentWidth > 0) {
      logicalZoom = Math.min(MAX_FIT_ZOOM, Math.max(MIN_FIT_ZOOM, (layoutWidth - FIT_PADDING) / documentWidth * 100));
    }
    const actualZoom = logicalZoom * outerScale;
    const nativeState = instance.getZoomState();
    const zoomChanged = nativeState.mode !== 'manual' || !nearlyEqual(nativeState.value, actualZoom);
    if (zoomChanged) {
      rememberScroll();
      expectedZoom = actualZoom;
      applyingZoom = true;
      try { instance.setZoom(actualZoom); }
      finally { applyingZoom = false; }
    }
    publish({ mode: snapshot.mode, value: logicalZoom });
    if (geometryChanged || zoomChanged) {
      restoreDeadline = performance.now() + 500;
      scheduleRestore();
    }
  };

  const queueSample = () => {
    if (!disposed && host && remainingSamples > 0 && !frame) frame = requestAnimationFrame(synchronize);
  };

  const synchronize = () => {
    frame = 0;
    remainingSamples = Math.max(0, remainingSamples - 1);
    try { measureViewport(); }
    finally { queueSample(); }
  };

  const refresh = () => {
    if (disposed || !host) return;
    // Ancestor transform notifications can precede the updated client rect by
    // several frames. Only external notifications replenish this short window;
    // continuation samples never call refresh, so an idle editor stops polling.
    remainingSamples = Math.max(remainingSamples, 4);
    queueSample();
  };

  const disconnectHost = () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver = undefined;
    window.removeEventListener('resize', refresh);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    remainingSamples = 0;
  };

  // User interaction takes precedence over a pending post-layout restoration.
  element.addEventListener('wheel', stopPendingRestore, { passive: true, capture: true });
  element.addEventListener('pointerdown', stopPendingRestore, true);
  element.addEventListener('keydown', stopPendingRestore, true);

  return {
    attach(nextHost) {
      if (disposed) return;
      rememberScroll();
      disconnectHost();
      host = nextHost;
      if (!host) {
        // A detached session retains its last reading position until reattached;
        // only active post-layout restoration has a short expiry window.
        restoreDeadline = 0;
        if (restoreFrame) cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
        return;
      }
      width = 0;
      height = 0;
      restoreDeadline = performance.now() + 500;
      resizeObserver = new ResizeObserver(refresh);
      resizeObserver.observe(host);
      mutationObserver = new MutationObserver(records => {
        // React Flow changes this transform on every pan frame. Translation
        // cannot change the document's size or scale; canvas zoom is already
        // observed by CanvasDocxViewportSync. Other ancestor changes can still
        // affect the scale inherited by a reader or canvas host.
        if (records.some(record => !(record.attributeName === 'style'
          && record.target instanceof Element && record.target.classList.contains('react-flow__viewport')))) refresh();
      });
      for (let ancestor: HTMLElement | null = host; ancestor; ancestor = ancestor.parentElement) {
        mutationObserver.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class'] });
      }
      window.addEventListener('resize', refresh);
      refresh();
    },
    refresh,
    engineReady() {
      stopGeometry?.();
      readyInstance = getInstance();
      expectedZoom = null;
      stopGeometry = readyInstance?.ui.viewport.observe(() => {
        if (bookmark && performance.now() <= restoreDeadline) scheduleRestore();
        else if (restoreDeadline) stopPendingRestore();
      });
      refresh();
    },
    engineZoomChanged(change) {
      if (disposed || applyingZoom || !readyInstance || getInstance() !== readyInstance) return;
      if (expectedZoom !== null && nearlyEqual(change.zoom, expectedZoom)) return;
      if (!(change.zoom > 0 && Number.isFinite(change.zoom))) return;
      publish({ mode: change.mode, value: change.zoom / outerScale });
      refresh();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setZoom(value) {
      if (disposed) return;
      if (value !== 'fit-width' && !(value > 0 && Number.isFinite(value))) return;
      rememberScroll();
      publish(value === 'fit-width' ? { ...snapshot, mode: 'fit-width' } : { mode: 'manual', value });
      refresh();
    },
    dispose() {
      disposed = true;
      disconnectHost();
      stopPendingRestore();
      stopGeometry?.();
      stopGeometry = undefined;
      readyInstance = null;
      element.removeEventListener('wheel', stopPendingRestore, true);
      element.removeEventListener('pointerdown', stopPendingRestore, true);
      element.removeEventListener('keydown', stopPendingRestore, true);
      listeners.clear();
    },
  };
}
