/** Screen-space UI uses the density of the former 75% browser view.
 * Keep the default in sync with --ui-scale in index.css. Canvas coordinates
 * stay in screen pixels; convert only when crossing into a UI surface. */
export const UI_SCALE = 0.75;

export function uiScale(): number {
  if (typeof document === 'undefined') return UI_SCALE;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || UI_SCALE;
}

export const screenToUi = (value: number): number => value / uiScale();
export const uiToScreen = (value: number): number => value * uiScale();

export function uiViewport() {
  return { width: screenToUi(window.innerWidth), height: screenToUi(window.innerHeight) };
}

export function uiRect(element: Element) {
  const rect = element.getBoundingClientRect();
  const scale = uiScale();
  return {
    x: rect.x / scale, y: rect.y / scale,
    left: rect.left / scale, top: rect.top / scale,
    right: rect.right / scale, bottom: rect.bottom / scale,
    width: rect.width / scale, height: rect.height / scale,
  };
}
