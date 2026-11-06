import type { CSSProperties } from 'react';

/** Screen-space targets stay usable independently of the visible grip. */
export const RESIZE_HIT_SIZE = 32;
export const RESIZE_TARGET_GAP = 4;

export function resizeControlStyle(zoom: number, canvasSpace = false): CSSProperties {
  return {
    '--resize-scale': canvasSpace ? zoom : 1,
    '--resize-mark-size': `${Math.min(16, Math.max(12, 14 * zoom))}px`,
    '--resize-hit-size': `${RESIZE_HIT_SIZE}px`,
  } as CSSProperties;
}
