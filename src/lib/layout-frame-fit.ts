import { FRAME_MIN_HEIGHT, FRAME_MIN_WIDTH } from './frame-sizing';
import type { LayoutProjectionOptions, LayoutShape, LayoutSolution } from './layout-model';

const EPSILON = 0.0001;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/** Tighten only inside the already feasible solution. A subset cannot acquire
 * outside members, collide with siblings, or invalidate an ancestor's bounds.
 * Use the frozen compound hierarchy, never fresh geometric membership. */
export function tightenLayoutFrames(shapes: LayoutShape[], padding: LayoutProjectionOptions['framePadding']): LayoutSolution {
  const byId = new Map(shapes.map(shape => [shape.id, shape]));
  const children = new Map<string, string[]>();
  for (const shape of shapes) if (shape.parent) {
    children.set(shape.parent, [...(children.get(shape.parent) ?? []), shape.id]);
  }
  const fitted = new Map<string, LayoutShape>();
  const active = new Set<string>();
  let conflict = false;
  const fit = (id: string): LayoutShape => {
    const shape = byId.get(id)!;
    if (fitted.has(id)) return fitted.get(id)!;
    if (active.has(id)) { conflict = true; return shape; }
    const memberIds = children.get(id) ?? [];
    if (!shape.frame || shape.fixed || !memberIds.length) {
      fitted.set(id, shape); return shape;
    }
    active.add(id);
    const members = memberIds.map(fit);
    active.delete(id);
    const left = Math.min(...members.map(member => member.x)) - padding.left;
    const top = Math.min(...members.map(member => member.y)) - padding.top;
    const right = Math.max(...members.map(member => member.x + member.width)) + padding.right;
    const bottom = Math.max(...members.map(member => member.y + member.height)) + padding.bottom;
    let width = Math.max(shape.minWidth ?? FRAME_MIN_WIDTH, right - left);
    let height = Math.max(shape.minHeight ?? FRAME_MIN_HEIGHT, bottom - top);
    const ratio = shape.aspectRatio;
    if (ratio && Number.isFinite(ratio) && ratio > 0) {
      width = Math.max(width, height * ratio); height = width / ratio;
    }
    // A feasible projection already encloses these padded bounds. Allow only
    // solver rounding noise; never expand a region into an unverified area.
    if (width > shape.width + EPSILON || height > shape.height + EPSILON
      || left < shape.x - EPSILON || top < shape.y - EPSILON
      || right > shape.x + shape.width + EPSILON || bottom > shape.y + shape.height + EPSILON) {
      conflict = true; fitted.set(id, shape); return shape;
    }
    const scale = Math.min(1, shape.width / width, shape.height / height);
    width *= scale; height *= scale;
    // Center any minimum-size/aspect-ratio slack around the content, while
    // keeping all four new sides inside the solver's original rectangle.
    const x = clamp((left + right - width) / 2, shape.x, shape.x + shape.width - width);
    const y = clamp((top + bottom - height) / 2, shape.y, shape.y + shape.height - height);
    if (x > left + EPSILON || y > top + EPSILON
      || x + width < right - EPSILON || y + height < bottom - EPSILON) {
      conflict = true; fitted.set(id, shape); return shape;
    }
    const next = { ...shape, x, y, width, height };
    fitted.set(id, next); return next;
  };
  const result = shapes.map(shape => fit(shape.id));
  return conflict ? { error: 'frame-conflict' } : { shapes: result };
}
