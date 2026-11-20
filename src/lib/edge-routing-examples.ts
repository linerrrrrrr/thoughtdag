import { Position } from '@xyflow/react';
import { normalizeEdgeRoutingSettings, routeEdge, type EdgeRouteMode, type EdgeRoutingContext } from './edge-path';

const source = { x: 8, y: 111, width: 96, height: 48 };
const target = { x: 536, y: 111, width: 96, height: 48 };
const obstacle = { x: 242, y: 115, width: 156, height: 72 };
const start = { x: source.x + source.width, y: source.y + source.height / 2 };
const end = { x: target.x, y: target.y + target.height / 2 };

export const avoidanceExample = { viewBox: '0 8 640 188', source, target, obstacle, start, end };

// The drawing and the router share measured bounds in canvas units. This
// isolated edge has no sibling lanes and never needs live canvas nodes.
const cards = Object.entries({ source, target, obstacle }).map(([id, { x, y, width, height }]) => ({
  id, x1: x, x2: x + width, y1: y, y2: y + height,
}));
const lanes: EdgeRoutingContext['lanes'] = new Map();

export function avoidanceExamplePath(routeMode: Exclude<EdgeRouteMode, 'auto'>, obstacleClearance: number): string {
  const settings = normalizeEdgeRoutingSettings({ avoidObstacles: true, obstacleClearance });
  return routeEdge(start.x, start.y, Position.Right, end.x, end.y, Position.Left,
    'source', 'target', [], routeMode, { context: { settings, cards, lanes } }).path;
}
