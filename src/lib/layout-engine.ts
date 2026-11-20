import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { LayoutProblem, LayoutShape, LayoutSolution } from './layout-model';
import { projectLayout } from './layout-projector';
import { tightenLayoutFrames } from './layout-frame-fit';

const elk = new ELK();
type Point = { x: number; y: number };

/** Nearest legal translation on one axis. Each open interval is a pair
 * of rectangles that would be too close at that displacement. */
function nearestClearOffset(intervals: [number, number][]): number {
  intervals.sort((a, b) => a[0] - b[0]);
  let positive = 0, negative = 0;
  for (const [start, end] of intervals) {
    if (start < positive && positive < end) positive = end;
  }
  for (let i = intervals.length - 1; i >= 0; i--) {
    const [start, end] = intervals[i];
    if (start < negative && negative < end) negative = start;
  }
  return positive <= -negative ? positive : negative;
}

/** Slide the selection the shorter distance horizontally or vertically.
 * Card-only obstructions retain the existing per-node projection. */
function translationPastFixedFrames(moving: LayoutShape[], fixed: LayoutShape[], gap: Point): Point | undefined {
  const xIntervals: [number, number][] = [], yIntervals: [number, number][] = [];
  let blockedByCard = false, blockedByFrame = false;
  for (const item of moving) for (const obstacle of fixed) {
    const left = obstacle.x - item.x - item.width - gap.x, right = obstacle.x + obstacle.width + gap.x - item.x;
    const top = obstacle.y - item.y - item.height - gap.y, bottom = obstacle.y + obstacle.height + gap.y - item.y;
    const overlapsX = left < 0 && right > 0, overlapsY = top < 0 && bottom > 0;
    if (overlapsY) xIntervals.push([left, right]);
    if (overlapsX) yIntervals.push([top, bottom]);
    if (overlapsX && overlapsY) {
      if (obstacle.frame) blockedByFrame = true;
      else blockedByCard = true;
    }
  }
  if (!blockedByFrame) return blockedByCard ? undefined : { x: 0, y: 0 };
  const x = nearestClearOffset(xIntervals), y = nearestClearOffset(yIntervals);
  return Math.abs(x) <= Math.abs(y) ? { x, y: 0 } : { x: 0, y };
}

function restoreOrigin(shapes: LayoutShape[], origin: Point): LayoutShape[] {
  const moving = shapes.filter(shape => !shape.fixed);
  const dx = origin.x - Math.min(...moving.map(shape => shape.x)), dy = origin.y - Math.min(...moving.map(shape => shape.y));
  return shapes.map(shape => shape.fixed ? shape : { ...shape, x: shape.x + dx, y: shape.y + dy });
}

/** Sugiyama layering / crossing minimization and component packing are
 * delegated to ELK. VPSC supplies the application's exact constraints.
 * https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
 * https://github.com/tgdwyer/WebCola/blob/master/src/vpsc.ts */
export async function solveLayout(problem: LayoutProblem): Promise<LayoutSolution> {
  const { shapes, links, options } = problem;
  const moving = shapes.filter((shape) => !shape.fixed);
  if (!moving.length) return { shapes };
  const ids = new Set(moving.map((shape) => shape.id));
  const byId = new Map(shapes.map(shape => [shape.id, shape]));
  const crossesRegions = links.some(link => link.auxiliary !== 'reference' && ids.has(link.source) && ids.has(link.target)
    && byId.get(link.source)!.parent !== byId.get(link.target)!.parent);
  const children = (id?: string) => moving.filter((shape) => shape.parent === id);
  const padding = options.framePadding;
  const settings: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': options.direction === 'horizontal' ? 'RIGHT' : 'DOWN',
    // Compound processing disables ELK's disconnected-component packer.
    // Enable it only when an actual edge crosses a region boundary.
    'elk.hierarchyHandling': crossesRegions ? 'INCLUDE_CHILDREN' : 'SEPARATE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.randomSeed': '1',
    'elk.aspectRatio': '1.35',
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': String(options.crossGap * 1.5),
    'elk.spacing.nodeNode': String(options.crossGap),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(options.gap),
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.nodePlacement.favorStraightEdges': 'true',
    'elk.layered.compaction.connectedComponents': 'true',
  };
  const build = (shape: LayoutShape): ElkNode => {
    const nested = children(shape.id);
    return nested.length ? { id: shape.id, children: nested.map(build), layoutOptions: {
      ...settings, 'elk.padding': `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`,
      // ELK 0.12.x model-order processing crashes on disconnected children
      // inside a compound graph. Stable input order and seed still apply.
      'elk.layered.considerModelOrder.strategy': 'NONE',
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${shape.minWidth ?? 400},${shape.minHeight ?? 240})`,
    } } : { id: shape.id, width: shape.width, height: shape.height };
  };
  const graph = await elk.layout({ id: '__layout__', children: children().map(build),
    edges: links.filter((link) => link.auxiliary !== 'reference' && ids.has(link.source) && ids.has(link.target)).map((link) => ({
      id: link.id, sources: [link.source], targets: [link.target], layoutOptions: {
        'elk.layered.priority.direction': link.structural ? '10' : '0',
        'elk.layered.priority.straightness': link.continuation ? '100' : link.structural ? '10' : '1',
      },
    })), layoutOptions: settings });
  const desired = new Map<string, LayoutShape>();
  const flatten = (node: ElkNode, x = 0, y = 0) => {
    for (const child of node.children ?? []) {
      const shape = byId.get(child.id)!;
      const left = x + (child.x ?? 0), top = y + (child.y ?? 0);
      desired.set(child.id, { ...shape, x: left, y: top, width: child.width ?? shape.width, height: child.height ?? shape.height });
      flatten(child, left, top);
    }
  };
  flatten(graph);
  const origin = { x: Math.min(...moving.map((shape) => shape.x)), y: Math.min(...moving.map((shape) => shape.y)) };
  const elkOrigin = { x: Math.min(...[...desired.values()].map((shape) => shape.x)), y: Math.min(...[...desired.values()].map((shape) => shape.y)) };
  const fixed = shapes.filter(shape => shape.fixed);
  const boundaryIds = new Set(links.filter(link => link.structural && ids.has(link.source) !== ids.has(link.target))
    .map(link => ids.has(link.source) ? link.target : link.source));
  const anchors = fixed.filter(shape => boundaryIds.has(shape.id)).map(shape => ({ x: shape.x, y: shape.y }));
  // Keep ELK's relative positions within each fixed region. When fixed
  // regions overlap, the shared members start in their intersection.
  const groups = new Map<string, LayoutShape[]>();
  for (const shape of desired.values()) {
    if (!shape.fixedContainers?.length) continue;
    const key = JSON.stringify([...shape.fixedContainers].sort());
    const group = groups.get(key);
    if (group) group.push(shape);
    else groups.set(key, [shape]);
  }
  const frameOffsets = new Map<string, Point>();
  for (const group of groups.values()) {
    const frames = group[0].fixedContainers!.map(id => byId.get(id)!);
    const x = Math.max(...frames.map(frame => frame.x)) + padding.left;
    const y = Math.max(...frames.map(frame => frame.y)) + padding.top;
    const offset = { x: x - Math.min(...group.map(shape => shape.x)), y: y - Math.min(...group.map(shape => shape.y)) };
    for (const shape of group) frameOffsets.set(shape.id, offset);
    anchors.push({ x, y });
  }
  // A fixed origin prevents the previous projected position from feeding
  // back into the next click, even for selections spanning several regions.
  const desiredOrigin = anchors.length ? {
    x: Math.min(...anchors.map(point => point.x)), y: Math.min(...anchors.map(point => point.y)),
  } : origin;
  const globalOffset = { x: (fixed.length ? desiredOrigin.x : 0) - elkOrigin.x, y: (fixed.length ? desiredOrigin.y : 0) - elkOrigin.y };
  const initial = shapes.map((shape) => {
    if (shape.fixed) return shape;
    const placement = desired.get(shape.id)!;
    const offset = frameOffsets.get(shape.id) ?? globalOffset;
    return { ...placement, x: placement.x + offset.x, y: placement.y + offset.y };
  });
  const projectAndFit = (input: LayoutShape[]) => {
    const projected = projectLayout(input, links, options);
    return projected.shapes ? tightenLayoutFrames(projected.shapes, padding) : projected;
  };
  const gap = options.direction === 'horizontal' ? { x: options.gap, y: options.crossGap } : { x: options.crossGap, y: options.gap };
  // Without a fixed context edge or containing region the selection can
  // translate as a unit. Use its canonical layout when a fixed region
  // blocks it so that the displaced origin is already feasible next time.
  if (!anchors.length && fixed.some(shape => shape.frame)) {
    const free = moving.map(shape => desired.get(shape.id)!);
    const fitted = projectAndFit(restoreOrigin(free, { x: 0, y: 0 }));
    if (!fitted.shapes) return fitted;
    const placed = restoreOrigin(fitted.shapes, origin);
    const shift = translationPastFixedFrames(placed, fixed, gap);
    if (shift) {
      const result = new Map(placed.map(shape => [shape.id, { ...shape, x: shape.x + shift.x, y: shape.y + shift.y }]));
      return { shapes: shapes.map(shape => result.get(shape.id) ?? shape) };
    }
  }
  // Fit before restoring the selection origin so shrinking a frame cannot
  // change that origin again on the next one-click layout.
  const solution = projectAndFit(initial);
  if (!solution.shapes) return solution;
  // A free component retains its overall origin even when unrelated fixed
  // cards exist elsewhere. Otherwise soft frame compaction would translate
  // the same region a little further on every click.
  if (!anchors.length) {
    const translated = restoreOrigin(solution.shapes, origin);
    const blocked = translated.filter(shape => !shape.fixed).some(a => fixed.some(b => {
      const gapX = b.frame ? gap.x : 16, gapY = b.frame ? gap.y : 16;
      return a.x < b.x + b.width + gapX && a.x + a.width + gapX > b.x && a.y < b.y + b.height + gapY && a.y + a.height + gapY > b.y;
    }));
    if (!blocked) solution.shapes = translated;
  }
  return solution;
}
