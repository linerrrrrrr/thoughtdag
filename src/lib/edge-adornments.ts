/** Sample the rendered route so direction and order stay attached to their edge.
 * The detached SVG is only a geometry calculator; it never enters the canvas. */
export function edgeAdornments(path: string, incomingIndex: number, incomingCount: number) {
  const meter = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  meter.setAttribute('d', path);
  const length = meter.getTotalLength();
  if (!Number.isFinite(length) || length < 1) return null;
  const at = (distance: number) => meter.getPointAtLength(Math.max(0, Math.min(length, distance)));
  const tangent = (distance: number) => {
    const before = at(distance - 1), after = at(distance + 1);
    return Math.atan2(after.y - before.y, after.x - before.x);
  };
  // Keep the arrow clear of the square handle. Stagger shared arrivals without
  // moving ports or changing the route, with a proportional limit for short gaps.
  const inset = Math.min(incomingCount > 1 ? 30 + incomingIndex * 18 : 18, length * 0.28);
  const arrowDistance = length - inset;
  const arrow = at(arrowDistance);
  const badgeDistance = Math.max(length * 0.38, length - Math.max(90, inset + 40));
  const badge = at(badgeDistance);
  const badgeAngle = tangent(badgeDistance);
  return {
    arrow: { x: arrow.x, y: arrow.y, angle: tangent(arrowDistance) * 180 / Math.PI, scale: Math.min(1, length / 40) },
    badge: { x: badge.x, y: badge.y, normalX: -Math.sin(badgeAngle), normalY: Math.cos(badgeAngle) },
  };
}
