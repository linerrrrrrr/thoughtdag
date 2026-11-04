import { getBezierPath, type Position } from '@xyflow/react';
import type { ThoughtEdge, ThoughtNode } from '../types';
import { nodeHeight } from './layout';
import { NODE_CSS_WIDTH } from './constants';
import { handleSide, resolveEdgeAnchors, sideAnchorOffset, type AnchorSide } from './edge-anchors';

interface Pt { x: number; y: number }
interface Box { x1: number; y1: number; x2: number; y2: number }
interface Card extends Box { id: string }
type Cubic = [Pt, Pt, Pt, Pt];

const CLEARANCE = 20;
const PORT_LEAD = 28;
const CORNER_RADIUS = 12;
const TURN_COST = 24;
const EPSILON = 0.001;
export type EdgeRouteMode = 'auto' | 'curve' | 'orthogonal';

export interface RoutedPath {
  path: string;
  labelX: number;
  labelY: number;
}

interface EdgeLane { sourceOffset: number; targetOffset: number; sourceStep: number; targetStep: number; obstacleOffset: number }
export interface EdgeRoutingContext {
  readonly cards: readonly Card[];
  readonly lanes: ReadonlyMap<string, EdgeLane>;
}
export interface EdgeRouteOptions {
  edgeId?: string;
  context?: EdgeRoutingContext;
  /** Convenience for one-off routes. Memoize createEdgeRoutingContext for a graph. */
  edges?: readonly ThoughtEdge[];
}

function visibleCards(nodes: readonly ThoughtNode[]): Card[] {
  return nodes.filter((node) => !node.hidden && node.data.stepKind !== 'frame').map((node) => ({
    id: node.id, x1: node.position.x, y1: node.position.y,
    x2: node.position.x + (node.measured?.width ?? node.width ?? NODE_CSS_WIDTH),
    y2: node.position.y + (node.measured?.height ?? node.height ?? nodeHeight(node)),
  }));
}

/** Per-canvas immutable plan; geometric order avoids crossed fan-outs. */
export function createEdgeRoutingContext(nodes: readonly ThoughtNode[], edges: readonly ThoughtEdge[]): EdgeRoutingContext {
  const cards = visibleCards(nodes), visible = new Set(cards.map((card) => card.id));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, { id: string; across: number; along: number }[]>(), lanes = new Map<string, EdgeLane>();
  const anchor = (id: string, side: AnchorSide): Pt => {
    const card = cardById.get(id)!;
    return side === 'left' || side === 'right'
      ? { x: side === 'left' ? card.x1 : card.x2, y: card.y1 + sideAnchorOffset(card.y2 - card.y1) }
      : { x: (card.x1 + card.x2) / 2, y: side === 'top' ? card.y1 : card.y2 };
  };
  for (const edge of edges) {
    if (edge.hidden || !visible.has(edge.source) || !visible.has(edge.target)) continue;
    const fallback = (!handleSide(edge.sourceHandle) || !handleSide(edge.targetHandle)) ? resolveEdgeAnchors(edge, nodeById) : null;
    const sourceSide = handleSide(edge.sourceHandle) ?? fallback?.sourceSide ?? 'bottom';
    const targetSide = handleSide(edge.targetHandle) ?? fallback?.targetSide ?? 'top';
    const source = anchor(edge.source, sourceSide), target = anchor(edge.target, targetSide);
    lanes.set(edge.id, { sourceOffset: 0, targetOffset: 0, sourceStep: 0, targetStep: 0, obstacleOffset: 0 });
    for (const [key, side, opposite] of [
      [`source:${edge.source}:${sourceSide}`, sourceSide, target],
      [`target:${edge.target}:${targetSide}`, targetSide, source],
    ] as const) {
      const group = groups.get(key) ?? [];
      const horizontal = side === 'left' || side === 'right';
      group.push({ id: edge.id, across: horizontal ? opposite.y : opposite.x, along: horizontal ? opposite.x : opposite.y });
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.across - b.across || a.along - b.along || a.id.localeCompare(b.id));
    for (let index = 0; index < group.length; index++) {
      const lane = lanes.get(group[index].id)!;
      lane[key.startsWith('source:') ? 'sourceOffset' : 'targetOffset'] = (index - (group.length - 1) / 2) * 20;
      lane[key.startsWith('source:') ? 'sourceStep' : 'targetStep'] = index * 14;
      // Distinct obstacle contours keep siblings apart after their port fan-out.
      lane.obstacleOffset = Math.max(lane.obstacleOffset, index * 14);
    }
  }
  return { cards, lanes };
}

const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const inflate = (b: Box, amount: number): Box => ({ x1: b.x1 - amount, y1: b.y1 - amount, x2: b.x2 + amount, y2: b.y2 + amount });
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 - EPSILON && a.x2 > b.x1 + EPSILON && a.y1 < b.y2 - EPSILON && a.y2 > b.y1 + EPSILON;
function bounds(points: Pt[]): Box {
  let x1 = points[0].x, x2 = x1, y1 = points[0].y, y2 = y1;
  for (let i = 1; i < points.length; i++) {
    x1 = Math.min(x1, points[i].x); x2 = Math.max(x2, points[i].x);
    y1 = Math.min(y1, points[i].y); y2 = Math.max(y2, points[i].y);
  }
  return { x1, x2, y1, y2 };
}
const inside = (p: Pt, b: Box) => p.x > b.x1 + EPSILON && p.x < b.x2 - EPSILON && p.y > b.y1 + EPSILON && p.y < b.y2 - EPSILON;

function extend(p: Pt, direction: Position | undefined, amount: number): Pt {
  switch (direction) {
    case 'left': return { x: p.x - amount, y: p.y };
    case 'right': return { x: p.x + amount, y: p.y };
    case 'top': return { x: p.x, y: p.y - amount };
    default: return { x: p.x, y: p.y + amount };
  }
}

// Subdivision tests the whole curve, including thin cards between sample
// points. A control polygon outside a box proves that part of the arc clear.
function curveHits(points: [Pt, Pt, Pt, Pt], box: Box, depth = 0): boolean {
  if (!overlaps(bounds(points), box)) return false;
  if (inside(points[0], box) || inside(points[3], box) || depth === 10) return true;
  const [a, b, c, d] = points;
  const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
  const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd);
  return curveHits([a, ab, abc, center], box, depth + 1) || curveHits([center, bcd, cd, d], box, depth + 1);
}

function segmentHits(a: Pt, b: Pt, box: Box): boolean {
  if (a.x === b.x) return a.x > box.x1 + EPSILON && a.x < box.x2 - EPSILON
    && Math.min(a.y, b.y) < box.y2 - EPSILON && Math.max(a.y, b.y) > box.y1 + EPSILON;
  return a.y > box.y1 + EPSILON && a.y < box.y2 - EPSILON
    && Math.min(a.x, b.x) < box.x2 - EPSILON && Math.max(a.x, b.x) > box.x1 + EPSILON;
}

function orthogonalPoints(start: Pt, end: Pt, sourcePosition: Position, targetPosition: Position, lead: number): Pt[] {
  const exit = extend(start, sourcePosition, lead), entry = extend(end, targetPosition, lead);
  const sourceHorizontal = sourcePosition === 'left' || sourcePosition === 'right';
  const targetHorizontal = targetPosition === 'left' || targetPosition === 'right';
  if (sourceHorizontal && targetHorizontal) {
    const x = (exit.x + entry.x) / 2;
    return [start, exit, { x, y: exit.y }, { x, y: entry.y }, entry, end];
  }
  if (!sourceHorizontal && !targetHorizontal) {
    const y = (exit.y + entry.y) / 2;
    return [start, exit, { x: exit.x, y }, { x: entry.x, y }, entry, end];
  }
  const corner = sourceHorizontal ? { x: entry.x, y: exit.y } : { x: exit.x, y: entry.y };
  return [start, exit, corner, entry, end];
}

// A small binary heap keeps obstructed long-distance links responsive.
class Queue {
  items: { state: number; cost: number; priority: number }[] = [];
  push(item: (typeof this.items)[number]) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= item.priority) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].priority < this.items[child].priority) child++;
        if (this.items[child].priority >= last.priority) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

// Rectilinear visibility grid, only built when the natural curve is blocked.
// Direction is part of the search state: penalize bends and prohibit a
// reversal at either port so the arrow always enters along its handle.
function findDetour(start: Pt, end: Pt, source: Pt, target: Pt, boxes: Box[]): Pt[] | null {
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap((b) => [b.x1, b.x2])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap((b) => [b.y1, b.y2])])].sort((a, b) => a - b);
  const width = xs.length;
  const indexOf = (p: Pt) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const pointAt = (index: number): Pt => ({ x: xs[index % width], y: ys[Math.floor(index / width)] });
  const direction = (a: Pt, b: Pt) => a.x !== b.x ? (b.x > a.x ? 0 : 1) : (b.y > a.y ? 2 : 3);
  const firstDirection = direction(source, start), lastDirection = direction(end, target);
  const first = indexOf(start) * 4 + firstDirection, goal = indexOf(end);
  const costs = new Map<number, number>([[first, 0]]), previous = new Map<number, number>();
  const queue = new Queue();
  const heuristic = (p: Pt) => Math.abs(end.x - p.x) + Math.abs(end.y - p.y);
  queue.push({ state: first, cost: 0, priority: heuristic(start) });
  while (queue.items.length) {
    const { state, cost } = queue.pop();
    if (cost !== costs.get(state)) continue;
    const index = Math.floor(state / 4), incoming = state % 4;
    if (index === goal) {
      const points: Pt[] = [];
      for (let s: number | undefined = state; s !== undefined; s = previous.get(s)) points.push(pointAt(Math.floor(s / 4)));
      return points.reverse();
    }
    const x = index % width, y = Math.floor(index / width), a = pointAt(index);
    const neighbors = [x + 1 < width ? index + 1 : -1, x > 0 ? index - 1 : -1,
      y + 1 < ys.length ? index + width : -1, y > 0 ? index - width : -1];
    for (let outgoing = 0; outgoing < 4; outgoing++) {
      const next = neighbors[outgoing];
      if (next < 0 || outgoing === (incoming ^ 1) || (next === goal && outgoing === (lastDirection ^ 1))) continue;
      const b = pointAt(next);
      if (boxes.some((box) => segmentHits(a, b, box))) continue;
      const nextCost = cost + distance(a, b) + (outgoing === incoming ? 0 : TURN_COST)
        + (next === goal && outgoing !== lastDirection ? TURN_COST : 0);
      const nextState = next * 4 + outgoing;
      if (nextCost >= (costs.get(nextState) ?? Infinity)) continue;
      costs.set(nextState, nextCost);
      previous.set(nextState, state);
      queue.push({ state: nextState, cost: nextCost, priority: nextCost + heuristic(b) });
    }
  }
  return null;
}

function simplify(points: Pt[]): Pt[] {
  const simple: Pt[] = [];
  for (const p of points) {
    if (simple.length && distance(simple[simple.length - 1], p) < EPSILON) continue;
    while (simple.length > 1) {
      const a = simple[simple.length - 2], b = simple[simple.length - 1];
      if (((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))
        && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0) simple.pop();
      else break;
    }
    simple.push(p);
  }
  return simple;
}

function cubicPoint([a, b, c, d]: Cubic, t: number): Pt {
  return lerp(lerp(lerp(a, b, t), lerp(b, c, t), t), lerp(lerp(b, c, t), lerp(c, d, t), t), t);
}

function cubicPath(curves: Cubic[]): RoutedPath {
  const first = curves[0][0];
  const path = `M ${first.x} ${first.y}` + curves.map(([, b, c, d]) => ` C ${b.x} ${b.y} ${c.x} ${c.y} ${d.x} ${d.y}`).join('');
  if (curves.length === 1) {
    const point = cubicPoint(curves[0], 0.5);
    return { path, labelX: point.x, labelY: point.y };
  }
  const pieces = curves.map((curve) => {
    let length = 0;
    for (let i = 1; i <= 24; i++) length += distance(cubicPoint(curve, (i - 1) / 24), cubicPoint(curve, i / 24));
    return { curve, length };
  });
  let remaining = pieces.reduce((sum, piece) => sum + piece.length, 0) / 2;
  for (const { curve, length } of pieces) {
    if (remaining <= length) {
      const point = cubicPoint(curve, length ? remaining / length : 0);
      return { path, labelX: point.x, labelY: point.y };
    }
    remaining -= length;
  }
  return { path, labelX: first.x, labelY: first.y };
}

function nativeBezier(start: Pt, end: Pt, sourcePosition: Position, targetPosition: Position): { route: RoutedPath; curve: Cubic } {
  // Use xyflow's MIT-licensed implementation, including its distance-scaled
  // controls and reverse-facing handles. No short port fans or artificial bow.
  // https://github.com/xyflow/xyflow/blob/main/packages/system/src/utils/edges/bezier-edge.ts
  const [path, labelX, labelY] = getBezierPath({ sourceX: start.x, sourceY: start.y, sourcePosition,
    targetX: end.x, targetY: end.y, targetPosition });
  const coordinates = path.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)!.map(Number);
  return { route: { path, labelX, labelY }, curve: [start,
    { x: coordinates[2], y: coordinates[3] }, { x: coordinates[4], y: coordinates[5] }, end] };
}

const subtract = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const unit = (point: Pt): Pt => {
  const length = Math.hypot(point.x, point.y);
  return length ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
};
const normal = (side: Position): Pt => extend({ x: 0, y: 0 }, side, 1);

/** Segment/rectangle clipping, including diagonals and arbitrarily thin cards. */
function lineHits(a: Pt, b: Pt, box: Box): boolean {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.x1 + EPSILON, box.x2 - EPSILON],
    [a.y, b.y - a.y, box.y1 + EPSILON, box.y2 - EPSILON]]) {
    if (Math.abs(delta) < EPSILON) { if (start <= min || start >= max) return false; }
    else {
      const enter = (min - start) / delta, leave = (max - start) / delta;
      lo = Math.max(lo, Math.min(enter, leave)); hi = Math.min(hi, Math.max(enter, leave));
      if (lo >= hi - 1e-10) return false;
    }
  }
  return lo < hi - 1e-10;
}

/** Any-angle visibility routing, separate from the SVG connector. Corners are
 * clearance guides, not a Manhattan path to disguise with rounded elbows.
 * The router/connector split follows React Flow Smart Edge (MIT):
 * https://github.com/tisoap/react-flow-smart-edge/blob/main/src/getSmartEdge/index.ts
 */
function findFreeDetour(start: Pt, end: Pt, source: Pt, target: Pt, boxes: Box[]): Pt[] | null {
  const corners = boxes.flatMap((box) => [{ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y1 },
    { x: box.x2, y: box.y2 }, { x: box.x1, y: box.y2 }]).sort((a, b) => a.x - b.x || a.y - b.y);
  const seen = new Set([`${start.x}:${start.y}`, `${end.x}:${end.y}`]);
  const points = [start, end];
  for (const point of corners) {
    const key = `${point.x}:${point.y}`;
    if (!seen.has(key) && !boxes.some((box) => inside(point, box))) { points.push(point); seen.add(key); }
  }
  const costs = new Map<number, number>([[0, 0]]), previous = new Map<number, number>();
  const queue = new Queue();
  queue.push({ state: 0, cost: 0, priority: distance(start, end) });
  while (queue.items.length) {
    const { state, cost } = queue.pop();
    if (cost !== costs.get(state)) continue;
    if (state === 1) {
      const result: Pt[] = [];
      for (let index: number | undefined = state; index !== undefined; index = previous.get(index)) result.push(points[index]);
      return result.reverse();
    }
    const from = points[state];
    for (let index = 1; index < points.length; index++) {
      if (index === state) continue;
      const to = points[index];
      if (state === 0 && dot(subtract(to, source), subtract(start, source)) < -EPSILON) continue;
      if (index === 1 && dot(subtract(target, from), subtract(target, end)) < -EPSILON) continue;
      if (boxes.some((box) => lineHits(from, to, box))) continue;
      const nextCost = cost + distance(from, to) + (index === 1 ? 0 : 8);
      if (nextCost >= (costs.get(index) ?? Infinity)) continue;
      costs.set(index, nextCost); previous.set(index, state);
      queue.push({ state: index, cost: nextCost, priority: nextCost + distance(to, end) });
    }
  }
  return null;
}

function normalRoom(port: Pt, side: Position, cards: readonly Card[], ownId: string): number {
  let room = Infinity;
  for (const card of cards) {
    if (card.id === ownId) continue;
    if (side === 'right' || side === 'left') {
      if (port.y <= card.y1 || port.y >= card.y2) continue;
      const gap = side === 'right' ? card.x1 - port.x : port.x - card.x2;
      if (gap >= 0) room = Math.min(room, gap);
    } else {
      if (port.x <= card.x1 || port.x >= card.x2) continue;
      const gap = side === 'bottom' ? card.y1 - port.y : port.y - card.y2;
      if (gap >= 0) room = Math.min(room, gap);
    }
  }
  return room;
}

/** Cubic Hermite interpolation with shared interior tangents and prescribed
 * endpoint normals. This independently implemented connector follows the
 * tangent-constraint approach documented by JointJS curve, not its source:
 * https://docs.jointjs.com/api/connectors/#curve
 */
function connectFreeRoute(points: Pt[], sourceSide: Position, targetSide: Position,
  cards: readonly Card[], sourceId: string, targetId: string): RoutedPath | null {
  const simple = points.filter((point, index) => !index || distance(point, points[index - 1]) > EPSILON);
  if (simple.length < 2) return null;
  const directions = simple.map((point, index) => {
    if (!index) return normal(sourceSide);
    if (index === simple.length - 1) { const n = normal(targetSide); return { x: -n.x, y: -n.y }; }
    const before = unit(subtract(point, simple[index - 1])), after = unit(subtract(simple[index + 1], point));
    return unit({ x: before.x + after.x, y: before.y + after.y });
  });
  const sourceRoom = normalRoom(simple[0], sourceSide, cards, sourceId) * 0.45;
  const targetRoom = normalRoom(simple[simple.length - 1], targetSide, cards, targetId) * 0.45;
  for (const tension of [0.4, 0.3, 0.2, 0.1, 0.04, 0.01]) {
    const tangents = simple.map((point, index) => {
      const before = index ? distance(point, simple[index - 1]) : Infinity;
      const after = index + 1 < simple.length ? distance(point, simple[index + 1]) : Infinity;
      const amount = Math.min(Math.min(before, after) * tension,
        !index ? sourceRoom : index === simple.length - 1 ? targetRoom : Infinity);
      return { x: directions[index].x * amount, y: directions[index].y * amount };
    });
    const curves: Cubic[] = simple.slice(1).map((point, index) => [simple[index],
      { x: simple[index].x + tangents[index].x, y: simple[index].y + tangents[index].y },
      { x: point.x - tangents[index + 1].x, y: point.y - tangents[index + 1].y }, point]);
    // Smoothing is not a collision guarantee: check the finished curve, not
    // its endpoint chord or the route's waypoint polygon.
    if (!curves.some((curve) => cards.some((card) => curveHits(curve, card)))) return cubicPath(curves);
  }
  return null;
}

function roundedPath(points: Pt[], clearance: number): RoutedPath {
  const simple = simplify(points);
  let path = `M ${simple[0].x} ${simple[0].y}`;
  // Keep edge actions on the path, near its length midpoint.
  const pieces: { length: number; at: (t: number) => Pt }[] = [];
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  let cursor = simple[0];
  const lineTo = (p: Pt) => {
    const a = cursor;
    pieces.push({ length: distance(a, p), at: (t) => lerp(a, p, t) });
    path += ` L ${p.x} ${p.y}`;
    cursor = p;
  };
  for (let i = 1; i < simple.length - 1; i++) {
    const a = simple[i - 1], b = simple[i], c = simple[i + 1];
    const radius = Math.min(CORNER_RADIUS, clearance * 0.6, distance(a, b) / 2, distance(b, c) / 2);
    const entry = lerp(b, a, radius / distance(a, b)), exit = lerp(b, c, radius / distance(b, c));
    lineTo(entry);
    path += ` Q ${b.x} ${b.y} ${exit.x} ${exit.y}`;
    const at = (t: number) => lerp(lerp(entry, b, t), lerp(b, exit, t), t);
    // Quadratic corners are short; this approximation is subpixel accurate.
    let length = 0;
    for (let j = 1; j <= 12; j++) length += distance(at((j - 1) / 12), at(j / 12));
    pieces.push({ length, at });
    cursor = exit;
  }
  lineTo(simple[simple.length - 1]);
  let remaining = pieces.reduce((sum, piece) => sum + piece.length, 0) / 2;
  for (const piece of pieces) {
    if (remaining <= piece.length) {
      const mid = piece.at(piece.length ? remaining / piece.length : 0);
      return { path, labelX: mid.x, labelY: mid.y };
    }
    remaining -= piece.length;
  }
  return { path, labelX: cursor.x, labelY: cursor.y };
}

function routeSingleEdge(
  sourceX: number, sourceY: number, sourcePosition: Position | undefined,
  targetX: number, targetY: number, targetPosition: Position | undefined,
  sourceId: string, targetId: string,
  nodes: ThoughtNode[],
  routeMode: EdgeRouteMode = 'auto',
  cards: readonly Card[] = visibleCards(nodes),
  obstacleOffset = 0,
): RoutedPath {
  sourcePosition ??= 'bottom' as Position;
  targetPosition ??= 'top' as Position;
  const src = cards.find((n) => n.id === sourceId), tgt = cards.find((n) => n.id === targetId);
  // Keep reference links on the facing sides of hand-placed cards.
  if (sourcePosition === 'right' && targetPosition === 'left' && src && tgt
    && tgt.x1 + tgt.x2 < src.x1 + src.x2) {
    sourceX = src.x1 + src.x2 - sourceX;
    targetX = tgt.x1 + tgt.x2 - targetX;
    sourcePosition = 'left' as Position;
    targetPosition = 'right' as Position;
  }
  const start = { x: sourceX, y: sourceY }, end = { x: targetX, y: targetY };
  const native = nativeBezier(start, end, sourcePosition, targetPosition);
  const natural = native.route;
  // Tight hand-placed gaps may need less breathing room, rather than a
  // fallback that cuts through the card because its padded box blocks a port.
  for (const clearance of [CLEARANCE, 8, 2, 0.5]) {
    const siblingClearance = clearance + obstacleOffset * clearance / CLEARANCE;
    const obstacles = cards.map((card) => ({ ...inflate(card, card.id === sourceId || card.id === targetId ? 0 : siblingClearance), id: card.id }));
    const sourceGap = dot(subtract(end, start), normal(sourcePosition));
    const targetGap = dot(subtract(start, end), normal(targetPosition));
    const lead = Math.min(PORT_LEAD * clearance / CLEARANCE,
      sourceGap > 0 && targetGap > 0 ? Math.min(sourceGap, targetGap) / 3 : Infinity,
      normalRoom(start, sourcePosition, cards, sourceId) / 2,
      normalRoom(end, targetPosition, cards, targetId) / 2);
    const directPoints = routeMode === 'orthogonal' ? orthogonalPoints(start, end, sourcePosition, targetPosition, lead) : null;
    const blocked = obstacles.filter((box) => directPoints
      ? directPoints.some((p, i) => i > 0 && segmentHits(directPoints[i - 1], p, box))
      : curveHits(native.curve, box));
    if (!blocked.length) return directPoints ? roundedPath(directPoints, clearance) : natural;
    const exit = extend(start, sourcePosition, lead), entry = extend(end, targetPosition, lead);
    if (obstacles.some((box) => (box.id !== sourceId && segmentHits(start, exit, box))
      || (box.id !== targetId && segmentHits(entry, end, box)))) continue;

    const relevant = new Set([...blocked.map((b) => b.id), sourceId, targetId]);
    // Grow the routing region only if a detour meets another card. Distant
    // canvas nodes do not multiply grid coordinates for a local connection.
    for (;;) {
      const boxes = cards.filter((b) => relevant.has(b.id)).map((b) => inflate(b, b.id === sourceId || b.id === targetId ? clearance : siblingClearance));
      const detour = routeMode === 'orthogonal' ? findDetour(exit, entry, start, end, boxes) : findFreeDetour(exit, entry, start, end, boxes);
      if (!detour) break;
      const hits = obstacles.filter((box) => !relevant.has(box.id)
        && detour.some((p, i) => i > 0 && lineHits(detour[i - 1], p, box)));
      if (!hits.length) {
        if (routeMode === 'orthogonal') return roundedPath([start, ...detour, end], clearance);
        // Endpoint guides constrain routing, but are not forced short SVG
        // segments: the connector can span the entire free corridor.
        const connected = connectFreeRoute([start, ...detour.slice(1, -1), end], sourcePosition, targetPosition, cards, sourceId, targetId)
          ?? connectFreeRoute([start, ...detour, end], sourcePosition, targetPosition, cards, sourceId, targetId);
        if (connected) return connected;
        break;
      }
      for (const hit of hits) relevant.add(hit.id);
    }
  }
  // Physically overlapping cards can cover a port completely; preserve the
  // connection until the user separates them instead of losing the edge.
  return routeMode === 'orthogonal' ? roundedPath(orthogonalPoints(start, end, sourcePosition, targetPosition, PORT_LEAD), CLEARANCE) : natural;
}

interface PortFan { point: Pt; points: Pt[] }
function portFan(port: Pt, side: Position, offset: number, reach: number): PortFan {
  const horizontal = side === 'left' || side === 'right';
  const shift = (point: Pt) => horizontal ? { x: point.x, y: point.y + offset } : { x: point.x + offset, y: point.y };
  const point = shift(extend(port, side, reach));
  const lead = extend(port, side, Math.min(12, reach / 3));
  return { point, points: [port, lead, shift(lead), point] };
}

/** React Flow may retain an offscreen handle measurement after a card resize
 * or semantic-zoom transition. Keep normal handle protrusion, but project
 * clearly stale coordinates onto the newest side instead of routing from
 * inside the source card. This repairs geometry without changing its side.
 */
function coherentPort(point: Pt, side: Position, card: Card | undefined): Pt {
  if (!card) return point;
  const horizontal = side === 'left' || side === 'right';
  const boundary = side === 'left' ? card.x1 : side === 'right' ? card.x2 : side === 'top' ? card.y1 : card.y2;
  const outward = side === 'left' || side === 'top' ? -1 : 1;
  const coordinate = horizontal ? point.x : point.y;
  const offset = (coordinate - boundary) * outward;
  const corrected = offset >= -1 && offset <= 10 ? coordinate : boundary + outward * 7;
  const transverse = horizontal ? point.y : point.x;
  const min = horizontal ? card.y1 : card.x1, max = horizontal ? card.y2 : card.x2;
  const aligned = transverse >= min - 8 && transverse <= max + 8 ? transverse
    : horizontal ? card.y1 + sideAnchorOffset(card.y2 - card.y1) : (card.x1 + card.x2) / 2;
  return horizontal ? { x: corrected, y: aligned } : { x: aligned, y: corrected };
}

/** Route one rendered edge; a shared context separates port and obstacle lanes. */
export function routeEdge(
  sourceX: number, sourceY: number, sourcePosition: Position | undefined,
  targetX: number, targetY: number, targetPosition: Position | undefined,
  sourceId: string, targetId: string, nodes: ThoughtNode[],
  routeMode: EdgeRouteMode = 'auto', options: EdgeRouteOptions = {},
): RoutedPath {
  const context = options.context ?? (options.edges ? createEdgeRoutingContext(nodes, options.edges) : undefined);
  const cards = context?.cards ?? visibleCards(nodes);
  const lane = options.edgeId ? context?.lanes.get(options.edgeId) : undefined;
  sourcePosition ??= 'bottom' as Position;
  targetPosition ??= 'top' as Position;
  const sourceCard = cards.find((card) => card.id === sourceId), targetCard = cards.find((card) => card.id === targetId);
  const sourcePort = coherentPort({ x: sourceX, y: sourceY }, sourcePosition, sourceCard);
  const targetPort = coherentPort({ x: targetX, y: targetY }, targetPosition, targetCard);
  sourceX = sourcePort.x; sourceY = sourcePort.y;
  targetX = targetPort.x; targetY = targetPort.y;
  if (routeMode !== 'orthogonal' || !lane || (!lane.sourceOffset && !lane.targetOffset)) {
    return routeSingleEdge(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, sourceId, targetId, nodes, routeMode, cards, lane?.obstacleOffset);
  }
  // Legacy side handles can still be restored before the display mapper runs.
  if (sourcePosition === 'right' && targetPosition === 'left' && sourceCard && targetCard
    && targetCard.x1 + targetCard.x2 < sourceCard.x1 + sourceCard.x2) {
    sourceX = sourceCard.x1 + sourceCard.x2 - sourceX;
    targetX = targetCard.x1 + targetCard.x2 - targetX;
    sourcePosition = 'left' as Position;
    targetPosition = 'right' as Position;
  }
  const start = { x: sourceX, y: sourceY }, end = { x: targetX, y: targetY };
  const sourceGap = dot(subtract(end, start), normal(sourcePosition));
  const targetGap = dot(subtract(start, end), normal(targetPosition));
  const gap = sourceGap > 0 && targetGap > 0 ? Math.min(sourceGap, targetGap) : distance(start, end);
  const reach = Math.min(52, gap / 4);
  const safe = (fan: PortFan, endpointId: string) => !cards.some((card) =>
    fan.points.some((point, index) => index > 0 && segmentHits(fan.points[index - 1], point, card.id === endpointId ? card : inflate(card, 6))));
  for (const scale of [1, 0.65, 0.35, 0.15]) {
    const from = portFan(start, sourcePosition, lane.sourceOffset * scale, Math.min(reach + lane.sourceStep, gap * 0.4) * scale);
    const to = portFan(end, targetPosition, lane.targetOffset * scale, Math.min(reach + lane.targetStep, gap * 0.4) * scale);
    if (!safe(from, sourceId) || !safe(to, targetId)) continue;
    const middle = routeSingleEdge(from.point.x, from.point.y, sourcePosition, to.point.x, to.point.y, targetPosition,
      sourceId, targetId, nodes, routeMode, cards, lane.obstacleOffset * scale);
    const first = roundedPath(from.points, CLEARANCE);
    const last = roundedPath([...to.points].reverse(), CLEARANCE);
    const continuation = (path: string) => path.replace(/^M\s+\S+\s+\S+/, '');
    return { ...middle, path: first.path + continuation(middle.path) + continuation(last.path) };
  }
  // A blocked port has no safe fan-out; keep the shortest valid route visible.
  return routeSingleEdge(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, sourceId, targetId, nodes, routeMode, cards);
}
