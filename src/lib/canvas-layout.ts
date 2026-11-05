import type { ThoughtEdge, ThoughtNode } from '../types';
import { nodeHeight } from './layout';
import { NODE_CSS_WIDTH } from './constants';
import { frameMembers, isFrameNode, nodeRect } from './frames';
import { FRAME_CONTENT_PADDING, FRAME_MIN_WIDTH, FRAME_MIN_HEIGHT } from './frame-sizing';
import type { LayoutProblem, LayoutShape, LayoutSolution } from './layout-model';

export interface CanvasLayoutOptions {
  direction: 'vertical' | 'horizontal';
  method: 'manual' | 'chains' | 'layers';
  density: 'compact' | 'standard' | 'relaxed';
  route: 'auto' | 'curve' | 'orthogonal';
}
export type CanvasLayoutError = 'empty-selection' | 'cycle' | 'boundary-conflict'
  | 'obstacle-conflict' | 'frame-conflict' | 'layout-failed' | 'stale-layout';
export interface CanvasLayoutResult { nodes: ThoughtNode[]; error?: CanvasLayoutError }

const SPACING = { compact: { gap: 48, crossGap: 40 }, standard: { gap: 80, crossGap: 64 }, relaxed: { gap: 128, crossGap: 96 } };
const widthOf = (node: ThoughtNode) => node.width ?? node.measured?.width ?? NODE_CSS_WIDTH;
const heightOf = (node: ThoughtNode) => isFrameNode(node) ? node.height ?? node.measured?.height ?? 420 : nodeHeight(node);
const compare = (a: ThoughtNode, b: ThoughtNode) => (a.data.createdAt ?? '').localeCompare(b.data.createdAt ?? '') || a.id.localeCompare(b.id);

/** Streamed text only invalidates a plan when it changes the footprint. */
export function canvasLayoutInputKey(nodes: ThoughtNode[], edges: ThoughtEdge[]): string {
  return JSON.stringify([
    nodes.map((node) => [node.id, node.position.x, node.position.y, widthOf(node), heightOf(node),
      nodeRect(node).width, nodeRect(node).height, node.data.stepKind,
      node.data.createdAt, node.data.lockAspectRatio, node.data.layoutDirection, node.data.edgeRouteDefault]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    edges.map((edge) => [edge.id, edge.source, edge.target, edge.data?.isBranchFromSelection,
      edge.data?.isCrossLink, edge.data?.isWatch, edge.data?.createdAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, (result: LayoutSolution) => void>();
async function solve(problem: LayoutProblem): Promise<LayoutSolution> {
  // Engines load on demand, off the main thread. Node tests use the same core.
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return (await import('./layout-engine')).solveLayout(problem);
  if (!worker) {
    worker = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; result: LayoutSolution }>) => {
      pending.get(event.data.id)?.(event.data.result); pending.delete(event.data.id);
    };
    worker.onerror = () => {
      for (const resolve of pending.values()) resolve({ error: 'layout-failed' });
      pending.clear(); worker?.terminate(); worker = undefined;
    };
  }
  return new Promise((resolve) => {
    const id = ++requestId; pending.set(id, resolve); worker!.postMessage({ id, problem });
  });
}

/** Freeze the compound graph once. ELK optimizes layers and crossings; VPSC
 * enforces alignment/containment. Engines receive geometry, never content. */
export async function planCanvasLayout(
  nodes: ThoughtNode[], edges: ThoughtEdge[], options: CanvasLayoutOptions, selectedIds?: string[],
): Promise<CanvasLayoutResult> {
  const fail = (error: CanvasLayoutError): CanvasLayoutResult => ({ nodes, error });
  const scope = new Set(selectedIds ?? nodes.map((node) => node.id));
  const contents = new Map(nodes.filter(isFrameNode).map((frame) => [frame.id, frameMembers(frame, nodes)]));
  if (options.method !== 'manual') for (const frame of nodes.filter((node) => isFrameNode(node) && scope.has(node.id))) {
    for (const member of contents.get(frame.id)!) scope.add(member.id);
  }
  const cards = nodes.filter((node) => scope.has(node.id) && !isFrameNode(node)).sort(compare);
  if (!cards.length) return fail('empty-selection');
  const preferences = (node: ThoughtNode) => ({ ...node.data, layoutDirection: options.direction, edgeRouteDefault: options.route });
  if (options.method === 'manual') return { nodes: nodes.map((node) => scope.has(node.id) && !isFrameNode(node) ? { ...node, data: preferences(node) } : node) };
  // Only scoped cards move; other cards remain fixed layout boundaries.
  // Empty selected regions still occupy space. Omitting them lets arranged
  // cards enter the region and silently changes membership on the next run.
  const frames = nodes.filter((node) => isFrameNode(node) && scope.has(node.id)).sort(compare);
  const moving = [...cards, ...frames].sort(compare);
  const ids = new Set(moving.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parent = new Map<string, string>();
  const smaller = [...frames].sort((a, b) => nodeRect(a).width * nodeRect(a).height - nodeRect(b).width * nodeRect(b).height || compare(a, b));
  for (const node of moving) {
    const containing = smaller.filter((frame) => contents.get(frame.id)!.some((member) => member.id === node.id));
    if (!containing.length) continue;
    const first = containing[0];
    // Overlapping sibling frames cannot both own one compound-graph child.
    if (containing.slice(1).some((frame) => !contents.get(frame.id)!.some((member) => member.id === first.id))) return fail('frame-conflict');
    parent.set(node.id, first.id);
  }
  const live = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target)
    && !isFrameNode(byId.get(edge.source)!) && !isFrameNode(byId.get(edge.target)!))
    .sort((a, b) => (a.data?.createdAt ?? byId.get(a.target)!.data.createdAt ?? '').localeCompare(b.data?.createdAt ?? byId.get(b.target)!.data.createdAt ?? '')
      || compare(byId.get(a.source)!, byId.get(b.source)!) || compare(byId.get(a.target)!, byId.get(b.target)!) || a.id.localeCompare(b.id));
  const structural = live.filter((edge) => !edge.data?.isCrossLink && !edge.data?.isWatch);
  const parented = new Set(structural.map((edge) => edge.target));
  for (const edge of live) if (edge.data?.isCrossLink && !edge.data.isWatch && !parented.has(edge.target)) {
    structural.push(edge); parented.add(edge.target);
  }
  const degree = new Map(cards.map((node) => [node.id, 0]));
  const children = new Map<string, string[]>();
  for (const edge of structural) if (degree.has(edge.source) && degree.has(edge.target)) {
    degree.set(edge.target, degree.get(edge.target)! + 1);
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }
  const ready = cards.filter((node) => !degree.get(node.id)).map((node) => node.id);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop()!; visited++;
    for (const target of children.get(id) ?? []) { degree.set(target, degree.get(target)! - 1); if (!degree.get(target)) ready.push(target); }
  }
  if (visited !== cards.length) return fail('cycle');
  const owner = new Map<string, ThoughtEdge>();
  for (const edge of structural) if (!owner.has(edge.target) || owner.get(edge.target)?.data?.isBranchFromSelection && !edge.data?.isBranchFromSelection) owner.set(edge.target, edge);
  const firstChildren = new Set<string>();
  const continuation = new Set(structural.filter((edge) => {
    if (edge.data?.isBranchFromSelection || owner.get(edge.target) !== edge || firstChildren.has(edge.source)) return false;
    firstChildren.add(edge.source); return true;
  }).map((edge) => edge.id));
  const structuralIds = new Set(structural.map((edge) => edge.id));
  const shapes: LayoutShape[] = nodes.filter((node) => ids.has(node.id) || !isFrameNode(node)).sort(compare).map((node) => ({
    id: node.id, ...node.position, width: widthOf(node), height: heightOf(node), frame: isFrameNode(node),
    parent: parent.get(node.id), fixed: !ids.has(node.id),
    ...(isFrameNode(node) ? { ...(contents.get(node.id)!.length ? { minWidth: FRAME_MIN_WIDTH, minHeight: FRAME_MIN_HEIGHT } : {}),
      aspectRatio: node.data.lockAspectRatio ? widthOf(node) / heightOf(node) : undefined } : {}),
  }));
  const problem: LayoutProblem = { shapes, links: live.filter((edge) => ids.has(edge.source) || ids.has(edge.target)).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, structural: structuralIds.has(edge.id), continuation: continuation.has(edge.id),
    auxiliary: edge.data?.isWatch ? 'watch' : edge.data?.isCrossLink && !structuralIds.has(edge.id) ? 'reference' : undefined,
  })), options: { direction: options.direction, method: options.method, ...SPACING[options.density],
    framePadding: FRAME_CONTENT_PADDING } };
  let solution: LayoutSolution;
  try { solution = await solve(problem); } catch { return fail('layout-failed'); }
  if (solution.error || !solution.shapes) return fail(solution.error ?? 'layout-failed');
  const geometry = new Map(solution.shapes.map((shape) => [shape.id, shape]));
  let changed = false;
  const result = nodes.map((node) => {
    if (!ids.has(node.id)) return node;
    const shape = geometry.get(node.id)!;
    const x = Math.round(shape.x * 1000) / 1000, y = Math.round(shape.y * 1000) / 1000;
    const width = Math.round(shape.width * 1000) / 1000, height = Math.round(shape.height * 1000) / 1000;
    if (Math.abs(node.position.x - x) < 0.01 && Math.abs(node.position.y - y) < 0.01
      && (!isFrameNode(node) || Math.abs(widthOf(node) - width) < 0.01 && Math.abs(heightOf(node) - height) < 0.01)
      && (isFrameNode(node) || node.data.layoutDirection === options.direction && node.data.edgeRouteDefault === options.route)) return node;
    changed = true;
    return { ...node, position: { x, y }, ...(isFrameNode(node) ? { width, height,
      measured: { ...node.measured, width, height }, style: { ...node.style, width, height } } : { data: preferences(node) }) };
  });
  return { nodes: changed ? result : nodes };
}
