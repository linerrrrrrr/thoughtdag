import type { ThoughtNode } from '../types';
import { canvasGroupId, expandGroupSelection } from './node-groups';

export type Rect = { x: number; y: number; width: number; height: number };

export interface FramePropertiesPatch {
  title?: string;
  color?: string;
  carry?: boolean;
}

export const isFrameNode = (node: ThoughtNode): boolean => node.data.stepKind === 'frame';

function positive(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The current footprint is shared by containment, alignment, and new frames. */
export function nodeRect(node: ThoughtNode): Rect {
  return {
    ...node.position,
    width: positive(node.measured?.width, positive(node.width, isFrameNode(node) ? 640 : 520)),
    height: positive(node.measured?.height, positive(node.height, isFrameNode(node) ? 420 : 120)),
  };
}

export const frameRect = nodeRect;

export function nodesRect(nodes: ThoughtNode[]): Rect | undefined {
  if (!nodes.length) return undefined;
  const rects = nodes.map(nodeRect);
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x, y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

export function nodeCenter(node: ThoughtNode): { x: number; y: number } {
  const rect = nodeRect(node);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

/** `inner` lies fully inside `outer` and is strictly smaller: the only
 *  relation that nests one frame in another. */
export function frameContains(outer: Rect, inner: Rect): boolean {
  return outer.width * outer.height > inner.width * inner.height && contains(outer, inner);
}

/** Every object must fit completely inside. A rigid group enters only as a
 * whole, preventing a region from dragging another region's group members. */
export function frameMembers(frame: ThoughtNode, nodes: ThoughtNode[]): ThoughtNode[] {
  const r = frameRect(frame);
  const groups = new Map<string, ThoughtNode[]>();
  for (const node of nodes) {
    const group = canvasGroupId(node);
    if (!group) continue;
    const members = groups.get(group) ?? [];
    members.push(node);
    groups.set(group, members);
  }
  const containedGroups = new Set([...groups].filter(([, members]) => contains(r, nodesRect(members)!)).map(([group]) => group));
  return nodes.filter((n) => {
    if (n.id === frame.id) return false;
    if (isFrameNode(n)) return frameContains(r, frameRect(n));
    const group = canvasGroupId(n);
    if (group) return containedGroups.has(group);
    return contains(r, nodeRect(n));
  });
}

/** An explicit content scope is geometric, independent of movement settings.
 * Root frames are excluded; callers can explicitly add them for a frame-and-
 * contents operation. Nested frames are included only when requested. */
export function frameContentIds(nodes: ThoughtNode[], frameIds: string[], includeFrames = false): string[] {
  const roots = new Set(frameIds);
  const members = new Set<string>();
  for (const frame of nodes) {
    if (!roots.has(frame.id) || !isFrameNode(frame)) continue;
    for (const member of frameMembers(frame, nodes)) {
      if (!roots.has(member.id) && (includeFrames || !isFrameNode(member))) members.add(member.id);
    }
  }
  return nodes.filter(node => members.has(node.id)).map(node => node.id);
}

/** Fit to one membership snapshot. Resizing a region never transforms its
 * contents, and a ratio lock expands the padded bounds rather than clipping. */
export function fittedFrameRect(frame: ThoughtNode, nodes: ThoughtNode[]): Rect | undefined {
  const bounds = nodesRect(frameMembers(frame, nodes));
  if (!bounds) return undefined;
  let width = Math.max(280, bounds.width + 64);
  let height = Math.max(180, bounds.height + 96);
  if (frame.data.lockAspectRatio) {
    const current = nodeRect(frame);
    const ratio = current.width / current.height;
    if (width / height < ratio) width = height * ratio;
    else height = width / ratio;
  }
  return { x: bounds.x - 32, y: bounds.y - 64, width, height };
}

/** Resolve once before either dragging or aligning. Overlapping frames may
 * share members; IDs are unique, so every member receives one translation. */
export function resolveCarriedNodeIds(nodes: ThoughtNode[], ids: string[]): string[] {
  const carried = new Set(expandGroupSelection(nodes, ids));
  for (;;) {
    const before = carried.size;
    for (const node of nodes) {
      if (carried.has(node.id) && isFrameNode(node) && node.data.frameCarry !== false) {
        for (const member of frameMembers(node, nodes)) carried.add(member.id);
      }
    }
    if (carried.size === before) break;
  }
  return nodes.filter((node) => carried.has(node.id)).map((node) => node.id);
}
