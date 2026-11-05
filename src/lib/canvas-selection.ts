import type { ThoughtNode } from '../types';
import { nodeRect, type Rect } from './frames';

/** Marquees select each fully enclosed node. */
export function enclosedSelection(nodes: ThoughtNode[], rect: Rect, baseIds: string[] = []): string[] {
  const enclosed = new Set(nodes.filter(node => {
    if (node.hidden || node.selectable === false) return false;
    const bounds = nodeRect(node);
    return bounds.x >= rect.x && bounds.y >= rect.y
      && bounds.x + bounds.width <= rect.x + rect.width
      && bounds.y + bounds.height <= rect.y + rect.height;
  }).map(node => node.id));
  const base = new Set(baseIds);
  return nodes.filter(node => base.has(node.id) || enclosed.has(node.id)).map(node => node.id);
}

type Point = { x: number; y: number };
export type EdgeSelectionPath = { id: string; points: Point[] };

/** The confirmed area keeps both object sets, including an empty active set. */
export type SelectionRegion = { rect: Rect; nodeIds: string[]; edgeIds: string[] };

/** Sample the rendered route once per marquee, including curves and detours. */
export function snapshotEdgeSelectionPaths(root: Element): EdgeSelectionPath[] {
  return [...root.querySelectorAll<SVGGElement>('.react-flow__edge')].flatMap(group => {
    const path = group.querySelector<SVGPathElement>('.react-flow__edge-path');
    const id = group.getAttribute('data-id');
    const matrix = path?.getScreenCTM();
    if (!path || !id || !matrix) return [];
    const length = path.getTotalLength();
    const count = Math.max(1, Math.ceil(length * Math.hypot(matrix.a, matrix.b) / 6));
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const point = path.getPointAtLength(length * index / count).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
    return [{ id, points }];
  });
}

/** Any visible part of a line crossing the rectangle is selectable. */
export function intersectingEdgeSelection(paths: EdgeSelectionPath[], rect: Rect, base: string[] = []): string[] {
  const selected = new Set(base);
  for (const { id, points } of paths) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      let low = 0, high = 1;
      for (const axis of ['x', 'y'] as const) {
        const delta = b[axis] - a[axis];
        const min = rect[axis], max = min + (axis === 'x' ? rect.width : rect.height);
        if (delta === 0) { if (a[axis] < min || a[axis] > max) high = -1; }
        else {
          const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
          low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        }
      }
      if (low <= high) { selected.add(id); break; }
    }
  }
  return [...selected];
}
