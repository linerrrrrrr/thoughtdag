/** Reading geometry only; never affects the conversation or its context. */
export const DEFAULT_QUESTION_HEIGHT_RATIO = 0.35;
export const MIN_QUESTION_HEIGHT_RATIO = 0.05;
export const MAX_QUESTION_HEIGHT_RATIO = 0.95;

export function questionHeightRatio(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_QUESTION_HEIGHT_RATIO, Math.max(MIN_QUESTION_HEIGHT_RATIO, value))
    : DEFAULT_QUESTION_HEIGHT_RATIO;
}
