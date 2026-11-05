import type { ThoughtNode } from '../types';
import { estimateNodeHeight } from './layout';
import { isFrameNode, resolveCarriedNodeIds } from './frames';

export interface NodeGeometryPatch {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  lockAspectRatio?: boolean;
}

const isMaterial = (node: ThoughtNode) => ['note', 'file', 'link'].includes(node.data.stepKind ?? '');
const positive = (value: number | undefined): value is number => value != null && Number.isFinite(value) && value > 0;

/** Stored sizes describe the working card, even when semantic zoom changes its preview. */
export function effectiveNodeGeometry(node: ThoughtNode): { width: number; height: number } {
  return {
    width: positive(node.width) ? node.width : positive(node.measured?.width) ? node.measured.width : isFrameNode(node) ? 640 : 520,
    height: positive(node.height) ? node.height : positive(node.measured?.height) ? node.measured.height : isFrameNode(node) ? 420 : isMaterial(node) ? 240 : estimateNodeHeight(node),
  };
}

export function nodeGeometryMinimum(node: ThoughtNode): { width: number; height: number } {
  if (isFrameNode(node)) return { width: 280, height: 180 };
  // Material cards have a 340px CSS floor in every zoom tier.
  return isMaterial(node) ? { width: 340, height: 120 } : { width: 360, height: 240 };
}

export function nodeGeometryMaximum(node: ThoughtNode): { width: number; height: number } {
  return { width: isMaterial(node) ? 860 : Infinity, height: Infinity };
}

/** Apply deltas from a frozen drag snapshot without moving nodes or replacing live content. */
export function resizeSelectionBy(nodes: ThoughtNode[], originals: ThoughtNode[], dx: number | undefined, dy: number | undefined): ThoughtNode[] {
  if ((dx !== undefined && !Number.isFinite(dx)) || (dy !== undefined && !Number.isFinite(dy))) return nodes;
  const sizes = new Map(originals.map(node => {
    const size = effectiveNodeGeometry(node);
    const patch: NodeGeometryPatch = {
      ...(dx !== undefined && dx !== 0 ? { width: Math.max(1, size.width + dx) } : {}),
      ...(dy !== undefined && dy !== 0 ? { height: Math.max(1, size.height + dy) } : {}),
    };
    // Corner drags must respond to the dominant axis, including mostly
    // vertical gestures. Each locked card keeps its own original ratio.
    if (node.data.lockAspectRatio && dx !== undefined && dy !== undefined) {
      if (Math.abs(dx / size.width) >= Math.abs(dy / size.height)) delete patch.height;
      else delete patch.width;
    }
    const resized = applySelectionGeometry([node], [node.id], patch)[0];
    return [node.id, { width: resized.width, height: resized.height,
      keepOverviewHeight: node.data.keepOverviewHeight || resized.height !== node.height }];
  }));
  return nodes.map(node => {
    const size = sizes.get(node.id);
    return !size ? node : { ...node, width: size.width, height: size.height,
      data: { ...node.data, keepOverviewHeight: size.keepOverviewHeight || undefined } };
  });
}

/** One local formatting operation uses the exact selection; only a single
 * selected object has coordinates. Moving a carrying frame uses the same
 * membership snapshot as dragging it, whereas resizing never moves contents. */
export function applySelectionGeometry(nodes: ThoughtNode[], nodeIds: string[], patch: NodeGeometryPatch): ThoughtNode[] {
  const fields = ['width', 'height', 'x', 'y'] as const;
  if (fields.some(key => patch[key] !== undefined && !Number.isFinite(patch[key]))) return nodes;
  if ((patch.width !== undefined && patch.width <= 0) || (patch.height !== undefined && patch.height <= 0)) return nodes;
  if (patch.lockAspectRatio !== undefined && typeof patch.lockAspectRatio !== 'boolean') return nodes;
  const ids = new Set(nodeIds);
  const selected = nodes.filter(node => ids.has(node.id));
  if (!selected.length) return nodes;

  const single = selected.length === 1 ? selected[0] : undefined;
  const dx = single && patch.x !== undefined ? patch.x - single.position.x : 0;
  const dy = single && patch.y !== undefined ? patch.y - single.position.y : 0;
  const moving = dx || dy ? new Set(resolveCarriedNodeIds(nodes, [single!.id])) : new Set<string>();
  let changed = false;
  const result = nodes.map(node => {
    let next = node;
    if (ids.has(node.id)) {
      const current = effectiveNodeGeometry(node);
      const min = nodeGeometryMinimum(node);
      const max = nodeGeometryMaximum(node);
      const locked = patch.lockAspectRatio ?? !!node.data.lockAspectRatio;
      let width = patch.width === undefined ? undefined : Math.min(max.width, Math.max(min.width, patch.width));
      let height = patch.height === undefined ? undefined : Math.max(min.height, patch.height);
      if (locked && (width !== undefined || height !== undefined)) {
        // If a caller supplies both axes, width is the source. The editor can
        // send only its last edited axis to make that choice explicit.
        const requestedScale = patch.width !== undefined ? patch.width / current.width : patch.height! / current.height;
        const minimumScale = Math.max(min.width / current.width, min.height / current.height);
        const maximumScale = Math.min(max.width / current.width, max.height / current.height);
        if (minimumScale > maximumScale) return node;
        const scale = Math.min(maximumScale, Math.max(minimumScale, requestedScale));
        width = current.width * scale;
        height = current.height * scale;
      }
      if ((width !== undefined && width !== node.width) || (height !== undefined && height !== node.height)) {
        next = { ...next, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
      }
      if (patch.lockAspectRatio !== undefined && patch.lockAspectRatio !== !!node.data.lockAspectRatio) {
        next = { ...next, data: { ...next.data, lockAspectRatio: patch.lockAspectRatio } };
      }
    }
    if (moving.has(node.id)) next = { ...next, position: { x: node.position.x + dx, y: node.position.y + dy } };
    changed ||= next !== node;
    return next;
  });
  return changed ? result : nodes;
}
