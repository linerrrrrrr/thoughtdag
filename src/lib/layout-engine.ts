import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import type { LayoutProblem, LayoutShape, LayoutSolution } from './layout-model';
import { projectLayout } from './layout-projector';
import { tightenLayoutFrames } from './layout-frame-fit';

const elk = new ELK();

/** Sugiyama layering / crossing minimization and component packing are
 * delegated to ELK. VPSC supplies the application's exact constraints.
 * https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
 * https://github.com/tgdwyer/WebCola/blob/master/src/vpsc.ts */
export async function solveLayout(problem: LayoutProblem): Promise<LayoutSolution> {
  const { shapes, links, options } = problem;
  const moving = shapes.filter((shape) => !shape.fixed);
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
      const shape = moving.find((item) => item.id === child.id)!;
      const left = x + (child.x ?? 0), top = y + (child.y ?? 0);
      desired.set(child.id, { ...shape, x: left, y: top, width: child.width ?? shape.width, height: child.height ?? shape.height });
      flatten(child, left, top);
    }
  };
  flatten(graph);
  const origin = { x: Math.min(...moving.map((shape) => shape.x)), y: Math.min(...moving.map((shape) => shape.y)) };
  const elkOrigin = { x: Math.min(...[...desired.values()].map((shape) => shape.x)), y: Math.min(...[...desired.values()].map((shape) => shape.y)) };
  const anchored = shapes.some(shape => shape.fixed);
  const boundaryIds = new Set(links.filter(link => link.structural && ids.has(link.source) !== ids.has(link.target))
    .map(link => ids.has(link.source) ? link.target : link.source));
  const boundaries = shapes.filter(shape => shape.fixed && boundaryIds.has(shape.id));
  // Fixed context, rather than the previous frame border, supplies the soft
  // origin of a constrained selection. Otherwise fitting that border feeds
  // its small displacement back into the next solve and causes drift.
  const desiredOrigin = boundaries.length ? {
    x: Math.min(...boundaries.map(shape => shape.x)), y: Math.min(...boundaries.map(shape => shape.y)),
  } : origin;
  const initial = shapes.map((shape) => {
    if (shape.fixed) return shape;
    const placement = desired.get(shape.id)!;
    // For a free graph, solve in canonical local coordinates. Large dragged
    // offsets must not influence floating-point tie breaking in compaction.
    return { ...placement, x: placement.x + (anchored ? desiredOrigin.x : 0) - elkOrigin.x,
      y: placement.y + (anchored ? desiredOrigin.y : 0) - elkOrigin.y };
  });
  const projected = projectLayout(initial, links, options);
  if (!projected.shapes) return projected;
  // Fit before restoring the selection origin so shrinking a frame cannot
  // change that origin again on the next one-click layout.
  const solution = tightenLayoutFrames(projected.shapes, padding);
  if (!solution.shapes) return solution;
  // A free component retains its overall origin even when unrelated fixed
  // cards exist elsewhere. Otherwise soft frame compaction would translate
  // the same region a little further on every click.
  const boundary = boundaryIds.size > 0;
  if (!boundary) {
    const free = solution.shapes.filter(shape => !shape.fixed);
    const minX = Math.min(...free.map(shape => shape.x)), minY = Math.min(...free.map(shape => shape.y));
    const translated = solution.shapes.map(shape => shape.fixed ? shape
      : { ...shape, x: shape.x + origin.x - minX, y: shape.y + origin.y - minY });
    const fixed = translated.filter(shape => shape.fixed);
    const blocked = translated.filter(shape => !shape.fixed).some(a => fixed.some(b =>
      a.x < b.x + b.width + 16 && a.x + a.width + 16 > b.x && a.y < b.y + b.height + 16 && a.y + a.height + 16 > b.y));
    if (!blocked) solution.shapes = translated;
  }
  return solution;
}
