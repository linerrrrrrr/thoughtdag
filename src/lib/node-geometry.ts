import type { ThoughtNode } from '../types';
import { estimateNodeHeight } from './layout';
import { isFrameNode, resolveCarriedNodeIds } from './frames';
import { getNodeContentHeightLimit } from './node-content-height';

export interface NodeGeometryPatch {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  lockAspectRatio?: boolean;
  autoHeight?: boolean;
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

export function nodeGeometryMaximum(node: ThoughtNode, width?: number): { width: number; height: number } {
  const limit = isFrameNode(node) || isMaterial(node) ? undefined : getNodeContentHeightLimit(node.id, width);
  return { width: isMaterial(node) ? 860 : Infinity,
    height: Math.max(nodeGeometryMinimum(node).height, positive(limit) ? limit : Infinity) };
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
  let changed = false;
  const result = nodes.map(node => {
    const size = sizes.get(node.id);
    if (!size || (size.width === node.width && size.height === node.height
      && !!size.keepOverviewHeight === !!node.data.keepOverviewHeight)) return node;
    changed = true;
    return { ...node, width: size.width, height: size.height,
      data: { ...node.data, keepOverviewHeight: size.keepOverviewHeight || undefined } };
  });
  return changed ? result : nodes;
}

/** One local formatting operation uses the exact selection; only a single
 * selected object has coordinates. Moving a carrying frame uses the same
 * membership snapshot as dragging it, whereas resizing never moves contents. */
export function applySelectionGeometry(nodes: ThoughtNode[], nodeIds: string[], patch: NodeGeometryPatch): ThoughtNode[] {
  const fields = ['width', 'height', 'x', 'y'] as const;
  if (fields.some(key => patch[key] !== undefined && !Number.isFinite(patch[key]))) return nodes;
  if ((patch.width !== undefined && patch.width <= 0) || (patch.height !== undefined && patch.height <= 0)) return nodes;
  if (patch.lockAspectRatio !== undefined && typeof patch.lockAspectRatio !== 'boolean') return nodes;
  if (patch.autoHeight !== undefined && typeof patch.autoHeight !== 'boolean') return nodes;
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
      // Natural content height cannot maintain a fixed geometric ratio.
      const autoHeight = patch.autoHeight === true && !isFrameNode(node);
      const locked = autoHeight ? false : patch.lockAspectRatio ?? !!node.data.lockAspectRatio;
      const requestedScale = patch.width !== undefined ? patch.width / current.width
        : patch.height !== undefined ? patch.height / current.height : undefined;
      const minimumScale = Math.max(min.width / current.width, min.height / current.height);
      const candidateWidth = locked && requestedScale !== undefined
        ? current.width * Math.max(minimumScale, requestedScale)
        : patch.width !== undefined ? Math.max(min.width, patch.width) : undefined;
      const max = nodeGeometryMaximum(node, candidateWidth);
      const maximumHeight = max.height;
      let width = patch.width === undefined ? undefined : Math.min(max.width, Math.max(min.width, patch.width));
      let height = autoHeight || patch.height === undefined ? undefined : Math.min(maximumHeight, Math.max(min.height, patch.height));
      // A saved oversized height must not bypass the current content cap,
      // including width-only edits that change text wrapping.
      if (!autoHeight && height === undefined && node.height !== undefined && current.height > maximumHeight) height = maximumHeight;
      if (locked && (width !== undefined || height !== undefined)) {
        // If a caller supplies both axes, width is the source. The editor can
        // send only its last edited axis to make that choice explicit.
        const maximumWidthScale = max.width / current.width;
        if (minimumScale > maximumWidthScale) return node;
        let scale = Math.min(maximumWidthScale, Math.max(minimumScale, requestedScale ?? 1));
        let correctedBounds = false;
        if (current.height * scale > maximumHeight) {
          let lower = Math.max(minimumScale, maximumHeight / current.height);
          const lowerMaximum = nodeGeometryMaximum(node, current.width * lower).height;
          if (current.height * lower > lowerMaximum) {
            // An inherited extreme ratio may have no solution within both
            // the minimum width and content height. Enforce those bounds
            // once; subsequent locked edits use the corrected card ratio.
            width = Math.min(max.width, Math.max(min.width, patch.width ?? current.width));
            height = Math.min(nodeGeometryMaximum(node, width).height, Math.max(min.height, patch.height ?? current.height));
            correctedBounds = true;
          }
          // Constant limits resolve exactly with two reads. Reflow can raise
          // the cap at this narrower width; only then search the fit boundary.
          if (!correctedBounds && lowerMaximum > maximumHeight) {
            let upper = scale;
            for (let iteration = 0; iteration < 14 && (upper - lower) * current.height > 0.25; iteration++) {
              const midpoint = (lower + upper) / 2;
              const allowed = nodeGeometryMaximum(node, current.width * midpoint).height;
              if (current.height * midpoint <= allowed) lower = midpoint;
              else upper = midpoint;
            }
          }
          if (!correctedBounds) scale = lower;
        }
        if (!correctedBounds) {
          width = current.width * scale;
          height = current.height * scale;
        }
      }
      if ((width !== undefined && width !== node.width) || (height !== undefined && height !== node.height)) {
        next = { ...next, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
      }
      if (autoHeight && (node.height !== undefined || node.data.keepOverviewHeight || node.data.lockAspectRatio)) {
        next = { ...next, height: undefined,
          data: { ...next.data, keepOverviewHeight: undefined, lockAspectRatio: false } };
      } else if (!autoHeight && patch.lockAspectRatio !== undefined && patch.lockAspectRatio !== !!node.data.lockAspectRatio) {
        next = { ...next, data: { ...next.data, lockAspectRatio: patch.lockAspectRatio } };
      }
    }
    if (moving.has(node.id)) next = { ...next, position: { x: node.position.x + dx, y: node.position.y + dy } };
    changed ||= next !== node;
    return next;
  });
  return changed ? result : nodes;
}
