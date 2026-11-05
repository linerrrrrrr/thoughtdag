/** Content geometry stays independent of the title's length and zoom. */
export const FRAME_CONTENT_PADDING = { top: 80, left: 32, right: 32, bottom: 32 } as const;
export const FRAME_MIN_WIDTH = 280;
export const FRAME_MIN_HEIGHT = 180;
export const FRAME_HEADER_INSET = 8;

/** Enlarge overview labels only as far as the existing content inset allows. */
export function frameHeaderScale(zoom: number, width: number, topSpace: number, naturalWidth: number, naturalHeight: number): number {
  const availableWidth = Math.max(0, width - FRAME_HEADER_INSET * 2);
  const availableHeight = Math.max(0, topSpace - FRAME_HEADER_INSET * 2);
  return Math.max(1, Math.min(5, 1 / Math.max(zoom, 0.01),
    availableWidth / Math.max(1, naturalWidth), availableHeight / Math.max(1, naturalHeight)));
}
