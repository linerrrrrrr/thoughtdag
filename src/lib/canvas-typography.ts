import { UI_SCALE } from './ui-scale';

export interface CanvasTypography {
  bodySize: number;
  bodyExponent: number;
  summaryExponent: number;
}

export const DEFAULT_CANVAS_TYPOGRAPHY: Readonly<CanvasTypography> = {
  bodySize: 16,
  bodyExponent: 1,
  summaryExponent: 0,
};

const SUMMARY_MIN_ZOOM = 0.32; // Lower compensation bound in NodeOverview.css.

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeCanvasTypography(value: unknown): CanvasTypography {
  const data = (value ?? {}) as Partial<CanvasTypography>;
  return {
    bodySize: bounded(data.bodySize, 12, 24, DEFAULT_CANVAS_TYPOGRAPHY.bodySize),
    bodyExponent: bounded(data.bodyExponent, 0, 1, DEFAULT_CANVAS_TYPOGRAPHY.bodyExponent),
    summaryExponent: bounded(data.summaryExponent, 0, 1, DEFAULT_CANVAS_TYPOGRAPHY.summaryExponent),
  };
}

/** Local multipliers before the viewport scales each node. Summary cards also apply overview compensation. */
export function canvasTypeScale(settings: CanvasTypography, zoom: number) {
  return {
    conversation: (settings.bodySize / 16) * Math.min(zoom, 1) ** settings.bodyExponent / zoom,
    summary: Math.max(zoom, SUMMARY_MIN_ZOOM) ** settings.summaryExponent,
  };
}

/** Screen sizes at the default 16px root, including the overview's interface density. */
export function canvasTypePreview(settings: CanvasTypography, zoom: number) {
  const scale = canvasTypeScale(settings, zoom);
  return {
    body: 16 * zoom * scale.conversation,
    summary: 14 * UI_SCALE * Math.min(1, zoom / SUMMARY_MIN_ZOOM) * scale.summary,
  };
}
