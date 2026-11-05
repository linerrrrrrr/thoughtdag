import type { ThoughtNode } from '../types';
import { nodeHeight } from './layout';
import { FRAME_CONTENT_PADDING, FRAME_MIN_WIDTH, FRAME_MIN_HEIGHT } from './frame-sizing';

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

/** Membership follows geometry. Each card must fit completely inside;
 * outside cards never move with the region. */
export function frameMembers(frame: ThoughtNode, nodes: ThoughtNode[]): ThoughtNode[] {
  const r = frameRect(frame);
  return nodes.filter((n) => {
    if (n.id === frame.id) return false;
    if (isFrameNode(n)) return frameContains(r, frameRect(n));
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
export function fittedFrameRect(frame: ThoughtNode, nodes: ThoughtNode[], members = frameMembers(frame, nodes)): Rect | undefined {
  // Use the working card size, not its smaller semantic-zoom thumbnail.
  const bounds = nodesRect(members.map(node => {
    const current = nodeRect(node);
    const width = positive(node.width, current.width);
    const height = isFrameNode(node) ? positive(node.height, current.height) : nodeHeight(node);
    return { ...node, measured: { width, height } };
  }));
  if (!bounds) return undefined;
  const padding = FRAME_CONTENT_PADDING;
  let width = Math.max(FRAME_MIN_WIDTH, bounds.width + padding.left + padding.right);
  let height = Math.max(FRAME_MIN_HEIGHT, bounds.height + padding.top + padding.bottom);
  if (frame.data.lockAspectRatio) {
    const current = nodeRect(frame);
    const ratio = current.width / current.height;
    if (width / height < ratio) width = height * ratio;
    else height = width / ratio;
  }
  // Minimum sizes and a ratio lock can leave spare room. Keep an already
  // fitted frame in place instead of moving that room to another side.
  const x = Math.min(bounds.x - padding.left, Math.max(frame.position.x, bounds.x + bounds.width + padding.right - width));
  const y = Math.min(bounds.y - padding.top, Math.max(frame.position.y, bounds.y + bounds.height + padding.bottom - height));
  return { x, y, width, height };
}

/** Freeze membership before fitting, then resolve nested regions inside out. */
export function fitFrameNodes(nodes: ThoughtNode[], frameIds: string[]): ThoughtNode[] {
  const selected = new Set(frameIds);
  const frames = nodes.filter(node => isFrameNode(node) && selected.has(node.id));
  const members = new Map(frames.map(frame => [frame.id, frameMembers(frame, nodes).map(node => node.id)]));
  const current = new Map(nodes.map(node => [node.id, node]));
  frames.sort((a, b) => nodeRect(a).width * nodeRect(a).height - nodeRect(b).width * nodeRect(b).height || a.id.localeCompare(b.id));
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let changed = false;
  for (const frame of frames) {
    const bounds = fittedFrameRect(frame, nodes, members.get(frame.id)!.map(id => current.get(id)!));
    if (!bounds) continue;
    const x = round(bounds.x), y = round(bounds.y), width = round(bounds.width), height = round(bounds.height);
    if (Math.abs(x - frame.position.x) < 0.01 && Math.abs(y - frame.position.y) < 0.01
      && Math.abs(width - (frame.width ?? nodeRect(frame).width)) < 0.01
      && Math.abs(height - (frame.height ?? nodeRect(frame).height)) < 0.01) continue;
    current.set(frame.id, { ...frame, position: { x, y }, width, height,
      measured: { ...frame.measured, width, height }, style: { ...frame.style, width, height } });
    changed = true;
  }
  return changed ? nodes.map(node => current.get(node.id)!) : nodes;
}

/** Resolve once before either dragging or aligning. Overlapping frames may
 * share members; IDs are unique, so every member receives one translation. */
export function resolveCarriedNodeIds(nodes: ThoughtNode[], ids: string[]): string[] {
  const carried = new Set(ids);
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
