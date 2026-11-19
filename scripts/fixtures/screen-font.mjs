// A 1em box follows CSS zoom and ancestor transforms just as a glyph does.
export function screenFont(locator) {
  return locator.evaluate(element => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:1em;height:1em;padding:0;border:0;font:inherit';
    element.append(probe);
    const pixels = probe.getBoundingClientRect().width;
    probe.remove();
    return pixels;
  });
}
