import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type DismissReason = 'outside' | 'escape';
export interface DismissableLayerOptions {
  open: boolean;
  onDismiss: (reason: DismissReason) => void;
  refs: ReadonlyArray<RefObject<HTMLElement | null>>;
  dismissOnOutside?: boolean;
  dismissOnEscape?: boolean;
  dismissOnFocusOutside?: boolean;
  /** Canvas selections can clear while unrelated non-modal work panels stay open. */
  independentOutside?: boolean;
  restoreFocus?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  priority?: number;
  ignoreOutside?: (event: PointerEvent) => boolean;
  /** Modal layers keep Tab in their content and block canvas shortcuts. */
  modal?: boolean;
}

interface Layer {
  options: () => DismissableLayerOptions;
  opener: HTMLElement | null;
  order: number;
  dismissedBy?: DismissReason;
}
const layers = new Set<Layer>();
let order = 0;
let observers = 0;
const focusHistory: HTMLElement[] = [];
function rememberFocus(event: FocusEvent) {
  if (!(event.target instanceof HTMLElement)) return;
  const previous = focusHistory.indexOf(event.target);
  if (previous >= 0) focusHistory.splice(previous, 1);
  focusHistory.push(event.target);
  if (focusHistory.length > 20) focusHistory.shift();
}
const roots = (layer: Layer) => layer.options().refs.flatMap(ref => ref.current ? [ref.current] : []);
const contains = (layer: Layer, target: Node | null) => !!target && roots(layer).some(root => root.contains(target));

function orderedLayers(): Layer[] {
  return [...layers].filter(layer => roots(layer).length).sort((a, b) => {
    // Child effects may register before their parent's effect on first mount.
    const aContainsB = roots(b).some(root => contains(a, root));
    const bContainsA = roots(a).some(root => contains(b, root));
    if (aContainsB !== bContainsA) return aContainsB ? -1 : 1;
    return (a.options().priority ?? 0) - (b.options().priority ?? 0) || a.order - b.order;
  });
}
function topLayer(): Layer | undefined { return orderedLayers().at(-1); }

export function hasDismissableLayer(): boolean { return !!topLayer(); }

function dismiss(layer: Layer, reason: DismissReason) {
  layer.dismissedBy = reason;
  layer.options().onDismiss(reason);
  if (reason === 'escape' && layer.options().restoreFocus !== false) {
    queueMicrotask(() => {
      const target = layer.options().restoreFocusRef?.current ?? layer.opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }
}

function onFocusIn(event: FocusEvent) {
  const target = event.target as Node;
  // A child portal/modal may autoFocus before its opening effect registers.
  // Let that registration settle before evaluating the complete focus boundary.
  setTimeout(() => {
    if (document.activeElement !== target) return;
    for (const layer of orderedLayers().reverse()) {
      if (contains(layer, target) || !layer.options().dismissOnFocusOutside) break;
      dismiss(layer, 'outside');
    }
  }, 0);
}

function onPointerDown(event: PointerEvent) {
  if (event.button > 0) return;
  const ordered = orderedLayers().reverse();
  // Settle the nested chain once, stopping at the surface that owns the click.
  // A working panel or a protected form remains the interaction boundary.
  for (const layer of ordered) {
    if (layer.options().independentOutside) continue;
    if (contains(layer, event.target as Node)) break;
    const options = layer.options();
    if (options.dismissOnOutside === false || options.ignoreOutside?.(event)) break;
    dismiss(layer, 'outside');
  }
  // A persistent work panel is not the owner of another canvas selection.
  // Modal dialogs still protect their background until explicitly dismissed.
  if (!ordered.some(layer => layer.options().modal)) {
    for (const layer of ordered) {
      const options = layer.options();
      if (options.independentOutside && options.dismissOnOutside !== false
        && !contains(layer, event.target as Node) && !options.ignoreOutside?.(event)) dismiss(layer, 'outside');
    }
  }
  // Do not cancel the pointer event: its intended target still receives the click.
}

/** Canvas controls can route Escape here before React Flow consumes it. */
export function handleDismissableLayerKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  const layer = topLayer();
  if (!layer) return;
  const options = layer.options();
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (options.dismissOnEscape !== false) dismiss(layer, 'escape');
    return;
  }
  const modalLayer = orderedLayers().filter(candidate => candidate.options().modal).at(-1);
  if (!modalLayer) return;
  if (event.key === 'Tab') {
    // Include a child popup rendered in a portal, while keeping background
    // canvas controls outside the modal's focus cycle.
    const focusRoots = [...new Set([...roots(modalLayer), ...roots(layer)])];
    const candidates = [...new Set(focusRoots.flatMap(root => [...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )]))].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
    const active = document.activeElement;
    const inside = active instanceof Node && focusRoots.some(root => root.contains(active));
    const first = candidates[0], last = candidates.at(-1);
    if (!first) { event.preventDefault(); roots(modalLayer)[0]?.focus(); }
    else if (event.shiftKey && (active === first || !inside)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (active === last || !inside)) { event.preventDefault(); first.focus(); }
  }
  // Local text editing still works; only the global canvas shortcut is blocked.
  event.stopPropagation();
}

/** One stack owns outside-click and Escape for every temporary interaction. */
export function useDismissableLayer(options: DismissableLayerOptions): { isTopLayer: () => boolean } {
  // Capture before React mounts autoFocus inputs. An opening transition is a
  // render-time state sync; capturing in an effect would already be too late.
  const [activation, setActivation] = useState(() => ({ open: options.open, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null }));
  if (activation.open !== options.open) {
    setActivation({ open: options.open, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }
  const latest = useRef(options);
  const opener = useRef(activation.opener);
  const registered = useRef<Layer | null>(null);
  useLayoutEffect(() => { latest.current = options; opener.current = activation.opener; });
  // Track focus even while closed: React autoFocus runs before this layer's
  // opening effect, so document.activeElement alone would lose its trigger.
  useEffect(() => {
    if (++observers === 1) document.addEventListener('focusin', rememberFocus, true);
    return () => { if (--observers === 0) document.removeEventListener('focusin', rememberFocus, true); };
  }, []);
  useEffect(() => {
    if (!options.open) return;
    const layer: Layer = {
      options: () => latest.current,
      opener: opener.current,
      order: ++order,
    };
    if (!layer.opener?.isConnected) {
      layer.opener = [...focusHistory].reverse().find(element => element.isConnected && !contains(layer, element)) ?? null;
    }
    registered.current = layer;
    if (!layers.size) {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', handleDismissableLayerKeyDown);
      document.addEventListener('focusin', onFocusIn);
    }
    layers.add(layer);
    if (layer.options().modal && !contains(layer, document.activeElement)) {
      const root = roots(layer)[0];
      const first = root?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]');
      (first ?? root)?.focus({ preventScroll: true });
    }
    return () => {
      const focusWasInside = contains(layer, document.activeElement);
      layers.delete(layer);
      registered.current = null;
      if (layer.dismissedBy !== 'outside' && layer.options().restoreFocus !== false) {
        queueMicrotask(() => {
          const target = layer.options().restoreFocusRef?.current ?? layer.opener;
          if (target?.isConnected && (focusWasInside || document.activeElement === document.body)) target.focus({ preventScroll: true });
        });
      }
      if (!layers.size) {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', handleDismissableLayerKeyDown);
        document.removeEventListener('focusin', onFocusIn);
      }
    };
  }, [options.open]);
  return { isTopLayer: () => registered.current !== null && registered.current === topLayer() };
}
